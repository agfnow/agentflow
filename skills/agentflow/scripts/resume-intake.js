#!/usr/bin/env node
'use strict'

// Bounded local facts for the first `godev` response. This command deliberately
// performs no network request, hook installation, archive read, or write.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { isDeepStrictEqual } = require('node:util')
const { execFileSync } = require('node:child_process')
const settings = require('./ag-settings.js')
const { resolve_default_branch } = require('./default-branch.js')
const { parse_fast_lane } = require('./fast-lane.js')

const MAX_NOTEBOOK_BYTES = 64 * 1024
const MAX_ASK_BYTES = 16 * 1024
const MAX_STATUS_BYTES = 32 * 1024
const MAX_CURRENT_ROUND_BYTES = 64 * 1024
const STREAM_DECISION_REASONS = Object.freeze(['none', 'owner_input_only', 'bootstrap_files_only', 'foreign_or_parallel_work', 'not_git_repository'])

const git = (repo_root, args) => {
  try {
    return execFileSync('git', args, { cwd: repo_root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim()
    throw new Error(detail || `git ${args[0]} failed`)
  }
}

const bounded_git = (repo_root, args) => {
  try {
    return execFileSync('git', args, { cwd: repo_root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_CURRENT_ROUND_BYTES })
  } catch {
    return null
  }
}

const file_identity = file => {
  try {
    const stat = fs.lstatSync(file, { bigint: true })
    if (!stat.isFile() || stat.isSymbolicLink()) return null
    return {
      dev: String(stat.dev),
      ino: String(stat.ino),
      size: String(stat.size),
      mode: String(stat.mode),
      mtime: String(stat.mtimeNs),
      ctime: String(stat.ctimeNs),
      sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
    }
  } catch {
    return null
  }
}

const same_file_identity = (expected, actual) => Boolean(expected && actual) && Object.keys(expected).every(key => String(expected[key]) === String(actual[key]))

const read_bounded = file => {
  const stat = fs.statSync(file)
  if (!stat.isFile()) throw new Error(`notebook is not a regular file: ${file}`)
  if (stat.size <= MAX_NOTEBOOK_BYTES) return { text: fs.readFileSync(file, 'utf8'), complete: true }
  const descriptor = fs.openSync(file, 'r')
  try {
    const head_size = Math.min(stat.size, MAX_STATUS_BYTES)
    const tail_size = Math.min(stat.size, MAX_CURRENT_ROUND_BYTES)
    const head = Buffer.alloc(head_size)
    const tail = Buffer.alloc(tail_size)
    fs.readSync(descriptor, head, 0, head_size, 0)
    fs.readSync(descriptor, tail, 0, tail_size, stat.size - tail_size)
    return { head: head.toString('utf8'), tail: tail.toString('utf8'), complete: false }
  } finally {
    fs.closeSync(descriptor)
  }
}

const status_block = text => {
  const separator = /(?:^|\r?\n)---\r?\n/u.exec(text)
  if (!separator) throw new Error('notebook has no STATUS separator')
  return text.slice(0, separator.index).trimEnd()
}

const final_ask_span = text => {
  const matches = [...text.matchAll(/^# → Ask \/ (A-\d+)(?: \([^\)\r\n]*\))?[ \t]*\r?$/gmu)]
  if (matches.length === 0) return null
  const match = matches[matches.length - 1]
  const body_start = match.index + match[0].length
  const following = text.slice(body_start)
  const next_ask = following.search(/^# → Ask \/ /mu)
  const round = next_ask < 0 ? following : following.slice(0, next_ask)
  if (/^# ← Reply \/ /mu.test(round)) return null
  const progress_record = round.search(/^(?:---\n\s*)?## \[(?:RUN-\d+\] Event|WIP-\d+\] Checkpoint)/mu)
  const body = (progress_record < 0 ? round : round.slice(0, progress_record)).trim()
  return { id: match[1], text: body, body_start }
}

const final_ask = text => {
  const span = final_ask_span(text)
  if (span === null) return null
  const bytes = Buffer.byteLength(span.text, 'utf8')
  return bytes > MAX_ASK_BYTES
    ? { id: span.id, text: '', bytes, requires_full_read: true }
    : { id: span.id, text: span.text }
}

const changed_paths = repo_root => {
  const records = git(repo_root, ['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0').filter(Boolean)
  const paths = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    paths.push(record.slice(3))
    if (/[RC]/u.test(code)) index += 1
  }
  return [...new Set(paths)].sort()
}

const head_text = (repo_root, notebook_path) => {
  try {
    return git(repo_root, ['show', `HEAD:${notebook_path}`])
  } catch {
    return null
  }
}

const expected_owner_input = ({ repo_root, notebook_path, notebook_text, current_ask, changed }) => {
  if (changed.length !== 1 || changed[0] !== notebook_path || current_ask === null || current_ask.text === '+') return false
  const base = head_text(repo_root, notebook_path)
  if (base === null) return false
  const base_ask = final_ask_span(base)
  const working_ask = final_ask_span(notebook_text)
  return base_ask !== null && working_ask !== null &&
    base_ask.id === current_ask.id && base_ask.text === '+' &&
    base.slice(0, base_ask.body_start) === notebook_text.slice(0, working_ask.body_start)
}

const expected_large_owner_input = ({ repo_root, notebook_path, current_ask, changed }) => {
  if (changed.length !== 1 || changed[0] !== notebook_path || current_ask === null || current_ask.text === '+') return false
  const diff = bounded_git(repo_root, ['diff', '--no-ext-diff', '--unified=0', '--', notebook_path])
  if (diff === null) return false
  const hunks = [...diff.matchAll(/^@@ [^\r\n]+@@.*$/gmu)]
  if (hunks.length !== 1) return false
  const changes = diff.slice(hunks[0].index + hunks[0][0].length).split(/\r?\n/).filter(line => /^[+-]/u.test(line))
  const expected = ['-+', ...current_ask.text.split(/\r?\n/).map(line => `+${line}`)]
  return changes.length === expected.length && changes.every((line, index) => line === expected[index])
}

const expected_unborn_owner_input = ({ repo_root, notebook_path, notebook_text, current_ask, changed, active_host, config }) => {
  if (bounded_git(repo_root, ['rev-parse', '--verify', 'HEAD']) !== null || current_ask === null || current_ask.text === '+') return false
  if (JSON.stringify(changed) !== JSON.stringify([notebook_path, '.gitignore', 'ag.json'].sort())) return false

  const expected_config = settings.make_template(active_host)
  expected_config.switches.lang = settings.detect_initial_language()
  expected_config.switches['workspace-dir'] = '.agentflow'
  expected_config.switches['target-doc'] = notebook_path
  if (!isDeepStrictEqual(config, expected_config)) return false
  if (fs.readFileSync(path.join(repo_root, '.gitignore'), 'utf8') !== '.claude/\n.codex/\n.worktrees/\n') return false

  const expected_status = settings.format_status({
    project: path.basename(repo_root),
    notebook: notebook_path,
    notebook_kind: 'root',
    current_commit: 'none yet; the first Agentflow closeout will create it',
    tests_scenarios: 'none',
    config_path: 'ag.json',
    host: active_host,
    validation: 'validated',
    proven: 'the host template was initialized',
    open: 'none',
    next: 'await the first request',
    artifacts: 'none',
    archived_eras: 'none',
    streams: [],
  })
  const expected_notebook = `${expected_status}\n---\n\n${settings.format_ask_heading('A-001', { config, repo_root })}\n\n+ \n`
  const expected_span = final_ask_span(expected_notebook)
  const working_span = final_ask_span(notebook_text)
  return expected_span !== null && working_span !== null &&
    notebook_text.slice(0, working_span.body_start) === expected_notebook.slice(0, expected_span.body_start) &&
    notebook_text.slice(working_span.body_start).trim() === current_ask.text
}

const default_branch = repo_root => resolve_default_branch(args => bounded_git(repo_root, args)).branch || null

const has_active_stream = status => /^stream:\s+[^\r\n]+\s+—\s+active\s+—\s+[^\r\n]+$/mu.test(status)

const bootstrap_paths_match = ({ repo_root, changed, bootstrap_provenance }) => {
  if (!Array.isArray(bootstrap_provenance) || bootstrap_provenance.length === 0 || changed.length === 0) return false
  const records = new Map()
  for (const record of bootstrap_provenance) {
    if (record === null || typeof record !== 'object' || typeof record.path !== 'string' || records.has(record.path)) return false
    records.set(record.path, record)
  }
  if (changed.some(relative => !records.has(relative))) return false
  return changed.every(relative => {
    const record = records.get(relative)
    const after = file_identity(path.join(repo_root, relative))
    return same_file_identity(record.after, after) && JSON.stringify(record.before ?? null) !== JSON.stringify(record.after ?? null)
  })
}

const stream_decision = ({ repo_root, branch, status, changed, expected_owner, expected_unborn, bootstrap_provenance, interrupted_start = false }) => {
  const reasons = []
  const default_ref = default_branch(repo_root)
	if (default_ref !== null && branch !== default_ref) reasons.push(`branch ${branch} is not the default branch ${default_ref}`)
	if (default_ref === null && !['main', 'master'].includes(branch)) reasons.push(`branch ${branch} has no proven default branch`)
  if (has_active_stream(status)) reasons.push('STATUS contains an active stream')
  if (interrupted_start && changed.length > 0) reasons.push('startup did not return a completed transaction result')

  if (reasons.length === 0 && expected_owner) {
    return { reason: 'owner_input_only', required_next_rulebook: null, evidence: ['the final empty Ask changed into the current owner message only'] }
  }
  if (reasons.length === 0 && bootstrap_paths_match({ repo_root, changed, bootstrap_provenance })) {
    return { reason: 'bootstrap_files_only', required_next_rulebook: null, evidence: ['every changed path matches the current startup transaction identities'] }
  }
  if (reasons.length === 0 && expected_unborn) {
    return { reason: 'owner_input_only', required_next_rulebook: null, evidence: ['the exact canonical unborn bootstrap contains one unresolved first Ask'] }
  }
  if (changed.length === 0 && reasons.length === 0) {
    return { reason: 'none', required_next_rulebook: null, evidence: [] }
  }
  if (reasons.length === 0 && changed.length > 0) reasons.push('changed paths are not proven to be current owner input or current startup files')
  return { reason: 'foreign_or_parallel_work', required_next_rulebook: 'references/streams.md', evidence: reasons }
}

const collect_intake = ({ repo_root = process.cwd(), notebook_path, active_host = 'codex', host_family, bootstrap_provenance, interrupted_start = false } = {}) => {
	const root = fs.realpathSync(repo_root)
	const root_config_path = path.join(root, 'ag.json')
	const settings_options = { repo_root: root, active_host, persist_migration: false, ...(host_family ? { host_family } : {}) }
	const root_config = settings.read_json_config(root_config_path, settings_options)
	notebook_path = notebook_path || root_config.switches['target-doc']
	const notebook = path.resolve(root, notebook_path)
  const relative_notebook = path.relative(root, notebook).split(path.sep).join('/')
  if (relative_notebook === '' || relative_notebook.startsWith('../') || path.isAbsolute(relative_notebook)) throw new Error('notebook must stay inside the repository')
	const config_path = relative_notebook === root_config.switches['target-doc'] ? root_config_path : settings.resolve_config_path(root, relative_notebook)
	const config = settings.read_json_config(config_path, { ...settings_options, notebook_path: relative_notebook })
  let bounded = read_bounded(notebook)
  // A long open round can put its heading outside the fast tail window.
  // Return bounded metadata, while the host reads the actual saved Ask in full.
  if (!bounded.complete && final_ask(bounded.tail) === null) {
    bounded = { text: require('./notebook-write').read_regular_file(notebook, 'notebook').text, complete: true }
  }
  const text = bounded.complete ? bounded.text : bounded.tail
  const current_ask = final_ask(text)
  const fast_lane = parse_fast_lane(current_ask?.text)
  if (!bounded.complete && current_ask === null) throw new Error(`current round exceeds the ${MAX_CURRENT_ROUND_BYTES}-byte fast-intake limit or has no complete final Ask boundary`)
  if (bounded_git(root, ['rev-parse', '--show-toplevel']) === null) return {
    repository: root,
    notebook: relative_notebook,
    ...(host_family ? { host_family } : {}),
    configuration: { valid: true, path: settings.display_path(config_path, root), language: config.switches.lang, ...settings.notebook_controls(config) },
    branch: null,
    changed_paths: [],
    expected_owner_input: false,
    stream_decision: { reason: 'not_git_repository', required_next_rulebook: null, open_new_stream: false, evidence: ['plain folder; Git change tracking and streams are unavailable'] },
    status: status_block(bounded.complete ? text : bounded.head),
    current_ask,
    ...(fast_lane ? { fast_lane } : {}),
  }
  const changed = changed_paths(root)
  const expected = bounded.complete
    ? expected_owner_input({ repo_root: root, notebook_path: relative_notebook, notebook_text: text, current_ask, changed })
    : expected_large_owner_input({ repo_root: root, notebook_path: relative_notebook, current_ask, changed })
  const expected_unborn = bounded.complete && expected_unborn_owner_input({
    repo_root: root,
    notebook_path: relative_notebook,
    notebook_text: text,
    current_ask,
    changed,
    active_host,
    config,
  })
  const status = status_block(bounded.complete ? text : bounded.head)
  return {
    repository: root,
    notebook: relative_notebook,
    ...(host_family ? { host_family } : {}),
    configuration: { valid: true, path: settings.display_path(config_path, root), language: config.switches.lang, ...settings.notebook_controls(config) },
    branch: git(root, ['branch', '--show-current']).trim() || 'detached',
    changed_paths: changed,
    expected_owner_input: expected || expected_unborn,
    stream_decision: { ...stream_decision({
      repo_root: root,
      branch: git(root, ['branch', '--show-current']).trim() || 'detached',
      status,
      changed,
      expected_owner: expected,
      expected_unborn,
      bootstrap_provenance,
      interrupted_start,
    }), ...(fast_lane ? { open_new_stream: false } : {}) },
    status,
    current_ask,
    ...(fast_lane ? { fast_lane } : {}),
  }
}

const parse_args = argv => {
	const result = { repo_root: process.cwd(), notebook_path: undefined, active_host: 'codex' }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
		if (!['--repo', '--notebook', '--host', '--host-family'].includes(flag) || index + 1 >= argv.length) throw new Error('usage: node resume-intake.js [--repo <path>] [--notebook <path>] [--host <safe-id>] [--host-family <safe-id>]')
		const value = argv[++index]
		if (flag === '--repo') result.repo_root = value
		if (flag === '--notebook') result.notebook_path = value
		if (flag === '--host') result.active_host = value
		if (flag === '--host-family') result.host_family = value
	}
	if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(result.active_host)) throw new Error('host must be a safe lowercase id')
	if (result.host_family !== undefined && !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(result.host_family)) throw new Error('host-family must be a safe lowercase id')
	return result
}

const main = argv => {
  process.stdout.write(`${JSON.stringify(collect_intake(parse_args(argv)), null, 2)}\n`)
}

module.exports = { collect_intake, final_ask, final_ask_span, expected_owner_input, expected_unborn_owner_input, status_block, file_identity, stream_decision, STREAM_DECISION_REASONS }

if (require.main === module) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
