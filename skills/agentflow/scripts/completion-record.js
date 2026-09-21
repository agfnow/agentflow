'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { format_local_timestamp, parse_numeric_timestamp } = require('./local-time')
const MAX_BYTES = 64 * 1024
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const encode = record => JSON.stringify(record, null, 2) + '\n'
const metadata_field = /^(?:Cross-check implementation|Cross-check review|Review record|Host review|Informational document|Non-behavioral change):/imu
const writer = () => require('./notebook-write')

// Bind evidence to the authored report, allowing writer stamps and later owner answers.
const reply_digest = reply => {
  const body = reply.replace(/\r\n/gu, '\n').replace(/^\s*#{1,2} (?:← )?Reply \/[^\n]*\n/u, '').replace(/^\s*\* _[^\n]+_\n/u, '')
  const lines = []
  let fence
  for (const line of body.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (!fence && /^## \[?Questions\b/iu.test(line)) break
    if (!fence && marker) fence = { char: marker[1][0], length: marker[1].length }
    else if (fence && marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
    lines.push(line)
  }
  return digest(lines.join('\n').trim().replace(/\n---\s*$/u, '').trim())
}

const safe_path = (root, relative, create = false) => {
  if (typeof relative !== 'string' || !relative || /[\\\u0000-\u001f\u007f]/u.test(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[A-Za-z]:/u.test(relative) || relative.split('/').some(part => ['', '.', '..'].includes(part))) throw Error('completion path is not canonical repository-relative text')
  const parts = relative.split('/')
  let current = root
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i])
    let stat = fs.lstatSync(current, { throwIfNoEntry: false })
    if (!stat && create && i < parts.length - 1) { fs.mkdirSync(current, { mode: 0o700 }); stat = fs.lstatSync(current) }
    if (stat && (stat.isSymbolicLink() || (i < parts.length - 1 && !stat.isDirectory()))) throw Error('completion path contains a symbolic link or non-directory parent')
  }
  return current
}

const location = options => {
  const { project_root, notebook_path, ask } = options
  if (!project_root || !notebook_path || !/^A-\d{3}$/u.test(ask)) throw Error('project, notebook and Ask context are required')
  const root = fs.realpathSync(project_root)
  writer().resolve_path(root, notebook_path, 'notebook')
  let workspace = options.workspace_dir
  if (workspace === undefined) {
    const config_file = options.config_path || require('./ag-settings').active_config_path(root, notebook_path)
    workspace = fs.existsSync(config_file) ? JSON.parse(writer().read_regular_file(config_file, 'configuration').text)?.switches?.['workspace-dir'] : '.agentflow'
  }
  if (typeof workspace !== 'string' || !workspace) throw Error('configured workspace is unavailable')
  safe_path(root, workspace)
  const stream = new RegExp('^' + workspace.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '/features/([a-z0-9][a-z0-9-]*)/\\1\\.devlog\\.md$').exec(notebook_path)
  const namespace = notebook_path === workspace + '/devlog.md' ? '' : stream ? 'features/' + stream[1] : 'notebooks/' + digest(notebook_path).slice(0, 16)
  const relative = path.posix.join(workspace, '.tmp', namespace, ask, 'completion.json')
  const file = safe_path(root, relative)
  const href = path.posix.relative(path.posix.dirname(notebook_path), relative).split('/').map(part => encodeURIComponent(part).replace(/[!'()*]/gu, char => '%' + char.charCodeAt(0).toString(16).toUpperCase())).join('/')
  const reference_relative = relative.replace(/completion\.json$/u, 'completion.ref.json')
  return { root, workspace, relative, file, href, notebook: notebook_path, ask, reference_relative, reference_file: safe_path(root, reference_relative) }
}

const read_reference = info => {
  writer().resolve_path(info.root, info.reference_relative, 'completion reference')
  if (fs.lstatSync(info.reference_file).size > 4096) throw Error('completion reference is oversized')
  const snapshot = writer().read_regular_file(info.reference_file, 'completion reference')
  const after = writer().read_regular_file(info.reference_file, 'completion reference')
  if (snapshot.hash !== after.hash || JSON.stringify(snapshot.identity) !== JSON.stringify(after.identity)) throw Error('completion reference changed while reading')
  const reference = JSON.parse(snapshot.text)
  if (!reference || Object.keys(reference).sort().join(',') !== 'reply_sha256,sha256,version' || reference.version !== 1 || !/^[a-f0-9]{64}$/u.test(reference.sha256) || !/^[a-f0-9]{64}$/u.test(reference.reply_sha256) || encode(reference) !== snapshot.text) throw Error('completion reference is invalid')
  return reference
}

// Match only top-level metadata fences; quoted and indented examples stay prose.
const fence_span = reply => {
  const lines = reply.split(/(?<=\n)/u)
  let offset = 0, fence, span
  for (const line of lines) {
    const marker = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/u.exec(line)
    if (!fence && marker) fence = { char: marker[1][0], length: marker[1].length, metadata: marker[2].trim() === 'completion-metadata', start: offset, body: offset + line.length }
    else if (fence && marker && marker[1][0] === fence.char && marker[1].length >= fence.length && marker[2].trim() === '') {
      if (fence.metadata) {
        if (span) throw Error('Reply permits only one completion-metadata fence')
        span = { start: fence.start, end: offset + line.length, text: reply.slice(fence.body, offset).trimEnd() }
      }
      fence = undefined
    }
    offset += line.length
  }
  if (fence?.metadata) throw Error('completion-metadata fence must be closed')
  return span
}

const read_record = (info, expected_digest) => {
  writer().resolve_path(info.root, info.relative, 'completion record')
  if (fs.lstatSync(info.file).size > MAX_BYTES) throw Error('completion record is oversized')
  const snapshot = writer().read_regular_file(info.file, 'completion record')
  const after = writer().read_regular_file(info.file, 'completion record')
  writer().resolve_path(info.root, info.relative, 'completion record')
  if (snapshot.hash !== after.hash || JSON.stringify(snapshot.identity) !== JSON.stringify(after.identity)) throw Error('completion record changed while reading')
  if (snapshot.hash !== expected_digest) throw Error('completion record digest does not match its reference')
  const record = JSON.parse(snapshot.text)
  if (!record || Array.isArray(record) || Object.keys(record).sort().join(',') !== 'ask,created_at,metadata_text,notebook,version' || record.version !== 1 || record.notebook !== info.notebook || record.ask !== info.ask || typeof record.metadata_text !== 'string' || !Number.isFinite(parse_numeric_timestamp(record.created_at))) throw Error('completion record schema or identity is invalid')
  // Writer-owned canonical bytes also reject duplicate JSON keys.
  if (encode(record) !== snapshot.text) throw Error('completion record is not canonical JSON')
  return record
}

const read_metadata = (reply, options, inline_parser) => {
  const base = inline_parser(reply)
  const candidates = base.text.split(/\r?\n/u).filter(line => /^Completion record:/iu.test(line))
  const unavailable = reason => ({ text: '', document_effects: [], error: 'Completion records unavailable: ' + reason })
  try {
    if (!candidates.length) {
      if (base.error || !options?.project_root || !options.notebook_path || !options.ask) return base
      const info = location(options)
      const has_reference = fs.lstatSync(info.reference_file, { throwIfNoEntry: false })
      if (fence_span(reply) || metadata_field.test(base.text)) {
        if (has_reference) throw Error('mixed completion metadata authority is ambiguous')
        return base
      }
      // Legacy metadata-free Replies carry no evidence; absence never invents any.
      if (!has_reference && !fs.lstatSync(info.file, { throwIfNoEntry: false })) return base
      const reference = read_reference(info)
      const record = read_record(info, reference.sha256)
      if (reference.reply_sha256 !== reply_digest(reply)) throw Error('completion record does not match the Reply')
      const parsed = inline_parser(record.metadata_text)
      if (parsed.error || !metadata_field.test(parsed.text) || /^Completion record:/imu.test(parsed.text)) throw Error(parsed.error || 'completion record has no valid metadata')
      return { ...parsed, record, record_file: info.file }
    }
    if (base.error) throw Error(base.error)
    if (candidates.length !== 1) throw Error('Reply requires exactly one completion record link')
    if (fence_span(reply) || metadata_field.test(base.text)) throw Error('mixed completion metadata authority is ambiguous')
    const match = /^Completion record: \[(A-\d{3})\]\(([^\s()]+)\) sha256:([a-f0-9]{64})$/u.exec(candidates[0])
    if (!match) throw Error('completion record link is malformed')
    const info = location(options || {})
    if (match[1] !== info.ask || match[2] !== info.href) throw Error('completion record link path or Ask does not match')
    const record = read_record(info, match[3])
    const parsed = inline_parser(record.metadata_text)
    if (parsed.error || !metadata_field.test(parsed.text) || /^Completion record:/imu.test(parsed.text)) throw Error(parsed.error || 'completion record has no valid metadata')
    return { ...parsed, record, record_file: info.file }
  } catch (error) { return unavailable(error.message) }
}

// Retain only the queried digest and heading state, never an archive line or round.
const archive_facts = (info, hash) => {
  const relative = info.notebook.replace(/\.md$/u, '.archive.md')
  const file = path.join(info.root, relative)
  const facts = { linked: false, completed: false }
  if (!fs.lstatSync(file, { throwIfNoEntry: false })) return facts
  writer().resolve_path(info.root, relative, 'archive')
  const needle = 'sha256:' + hash
  const prefixes = ['# → Ask / A-', '# ← Reply / A-', '## Reply / A-']
  let overlap = '', in_ask = false, in_reply = false
  let prefix = '', kind = -1, phase = 'prefix', id = '', nonempty = false
  const end_line = () => {
    const heading = ['digits', 'space', 'tail', 'legacy'].includes(phase) && id.length > 0
    if (heading && kind === 0) { in_ask = 'A-' + id === info.ask; in_reply = false }
    else if (in_ask) {
      if (in_reply && nonempty) facts.completed = true
      if (heading && kind > 0) in_reply = true
    }
    prefix = ''; kind = -1; phase = 'prefix'; id = ''; nonempty = false
  }
  writer().read_regular_file(file, 'archive', text => {
    const search = overlap + text
    if (search.includes(needle)) facts.linked = true
    overlap = search.slice(1 - needle.length)
    const parts = text.split(/([\r\n\u2028\u2029])/u)
    for (const part of parts) {
      if (/^[\r\n\u2028\u2029]$/u.test(part)) { end_line(); continue }
      if (part.trim()) nonempty = true
      for (const char of part) {
        if (phase === 'invalid' || phase === 'legacy') break
        if (phase === 'prefix') {
          prefix += char
          kind = prefixes.indexOf(prefix)
          if (kind >= 0) phase = 'digits'
          else if (!prefixes.some(value => value.startsWith(prefix))) phase = 'invalid'
        } else if (phase === 'digits') {
          if (/[0-9]/u.test(char)) { if (id.length < info.ask.length) id += char }
          else if (!id) phase = 'invalid'
          else if (kind === 2 && !/[A-Za-z0-9_]/u.test(char)) phase = 'legacy'
          else phase = char === ' ' ? 'space' : char === '\t' ? 'tail' : 'invalid'
        } else if (phase === 'name') {
          if (char === ')') phase = 'tail'
        } else if (phase === 'space' && char === '(') phase = 'name'
        else phase = /[ \t]/u.test(char) ? 'tail' : 'invalid'
      }
    }
  })
  end_line()
  return facts
}

const publish_reply = (reply, options) => {
  if (!options?.read_only) {
    const owner = require('./notebook-owner');
    if (!options?.ownership) {
      const root = fs.realpathSync(options.project_root);
      const file = writer().resolve_path(root, options.notebook_path, 'notebook');
      const lock = writer().acquire_close_round_lock(`${file}.close-round.lock`);
      try {
        const ownership = owner.guard({ root, notebook: options.notebook_path, ask: options.ask, host: options.host, session: options.session });
        return publish_reply(reply, { ...options, ownership });
      } finally { writer().release_close_round_lock(lock); }
    }
    owner.verify(options.ownership, { root: options.project_root, notebook: options.notebook_path, ask: options.ask, active: true });
  }
  const { completion_metadata } = require('./round-linter')
  const span = fence_span(reply)
  if (!span) {
    const parsed = completion_metadata(reply, options)
    if (parsed.error) throw Error(parsed.error)
    if (!options?.read_only && !parsed.record && metadata_field.test(parsed.text)) {
      throw Error('Completion fields require a completion-metadata fence; put literal examples in an xml/text fence or blockquote')
    }
    return reply
  }
  const parsed = completion_metadata(reply)
  if (parsed.error) throw Error(parsed.error)
  if (/^Completion record:/imu.test(parsed.text)) throw Error('mixed completion metadata authority is ambiguous')
  const body = completion_metadata(span.text)
  if (body.error || !metadata_field.test(body.text)) throw Error(body.error || 'completion metadata is empty')
  const outside = completion_metadata(reply.slice(0, span.start) + reply.slice(span.end))
  if (metadata_field.test(outside.text)) throw Error('mixed completion metadata authority is ambiguous')
  const info = location(options)
  const published = reply.slice(0, span.start) + reply.slice(span.end)
  let record = { version: 1, notebook: info.notebook, ask: info.ask, created_at: format_local_timestamp(), metadata_text: span.text }
  let prior
  try { prior = writer().read_regular_file(info.file, 'completion record') } catch (error) { if (fs.existsSync(info.file) || fs.lstatSync(path.dirname(info.file), { throwIfNoEntry: false })?.isSymbolicLink()) throw error }
  const prior_reference = fs.lstatSync(info.reference_file, { throwIfNoEntry: false }) ? read_reference(info) : undefined
  const reference_current = prior_reference && prior && prior_reference.sha256 === prior.hash
  if (prior_reference && !reference_current && (!prior || options.read_only || read_record(info, prior.hash).metadata_text !== span.text)) throw Error('completion record digest does not match its reference')
  if (prior) {
    const existing = read_record(info, prior.hash)
    if (reference_current && existing.metadata_text === span.text && prior_reference.reply_sha256 === reply_digest(published)) return published
    const notebook = writer().read_regular_file(path.join(info.root, info.notebook), 'notebook').text
    const archive = archive_facts(info, prior.hash)
    const legacy_linked = notebook.includes('sha256:' + prior.hash) || archive.linked
    if (!prior_reference && legacy_linked && existing.metadata_text === span.text) {
      // An old closeout retry must preserve its historical link and bytes.
      return reply.slice(0, span.start) + `Completion record: [${info.ask}](${info.href}) sha256:${prior.hash}\n` + reply.slice(span.end)
    }
    if (options.read_only) throw Error('completion record differs from retry input')
    if (legacy_linked) throw Error('referenced completion record is immutable')
    if (archive.completed || require('./round-linter').parse_devlog(notebook).rounds.some(round => round.id === info.ask && round.reply_text.trim())) throw Error('completed record is immutable')
    const round = require('./round-linter').parse_devlog(notebook).rounds.at(-1)
    if (!round || round.id !== info.ask || round.reply_text.trim()) throw Error('record replacement requires its open unreferenced Ask')
    if (existing.metadata_text === span.text) record = existing
  }
  const bytes = Buffer.from(encode(record))
  if (bytes.length > MAX_BYTES) throw Error('completion record is oversized')
  if (!prior || prior.hash !== digest(bytes)) {
    if (options.read_only) throw Error('completion records unavailable for retry')
    safe_path(info.root, info.relative, true)
    const ignore = safe_path(info.root, path.posix.join(info.workspace, '.tmp', '.gitignore'))
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 })
    writer().atomic_replace(info.file, bytes, 0o600)
  }
  const hash = digest(bytes)
  read_record(info, hash)
  const reference = { version: 1, sha256: hash, reply_sha256: reply_digest(published) }
  if (encode(reference) !== encode(prior_reference)) {
    if (options.read_only) throw Error('completion reference unavailable for retry')
    writer().atomic_replace(info.reference_file, Buffer.from(encode(reference)), 0o600)
  }
  const verified_reference = read_reference(info)
  read_record(info, verified_reference.sha256)
  return published
}

// These are observed review facts, not an isolation or authentication service.
// Legacy external reports keep their original validation path.
const validate_review_record = (record, policy = {}) => {
  const text = value => typeof value === 'string' && value.trim().length > 0
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!object(record) || record.version !== 1) return 'review record must use version 1'
  const kinds = { 'external-review': 'external', 'native-review': 'internal', 'host-review': 'host' }
  const kind = kinds[record.kind]
  if (!kind) return 'review kind must be external-review, native-review or host-review'
  const allowed = policy.allowed_worker || ['external', 'host']
  if (!Array.isArray(allowed) || !allowed.length || new Set(allowed).size !== allowed.length || !allowed.every(value => ['external', 'internal', 'host'].includes(value))) return 'review needs a valid executor policy'
  if (policy.review_policy !== undefined && !['prefer-independent', 'require-independent'].includes(policy.review_policy)) return 'review policy is invalid'
  if (!allowed.includes(kind)) return `review executor ${kind} is not permitted`
  if (!text(record.reviewer) || !text(record.host) || !text(record.report)) return 'review needs reviewer, host and report identities'
  if (!Array.isArray(record.limitations) || !record.limitations.every(text)) return 'review limitations must be an explicit list'
  if (!object(record.verdicts) || !['outcome', 'minimality', 'conformance'].every(key => record.verdicts[key] === 'PASS')) return 'review requires Outcome, Minimality and Conformance PASS'
  const independence = record.independence
  if (!object(independence) || typeof independence.separate_reviewer !== 'boolean'
      || !['shared', 'fresh', 'unknown'].includes(independence.context)
      || !['shared', 'restricted', 'unknown'].includes(independence.permissions)
      || !['same', 'different', 'unknown'].includes(independence.family)
      || ![true, false, 'unknown'].includes(independence.read_only_enforced)) return 'review must distinguish separation, context, permissions, family and read-only enforcement'
  if (policy.enforced_read_only_required === true && independence.read_only_enforced !== true) return 'required read-only enforcement is not proven'
  if (policy.fresh_context_required === true && independence.context !== 'fresh') return 'required fresh review context is not proven'
  if (kind === 'host') {
    if (record.reviewer !== record.host || independence.separate_reviewer !== false) return 'host review cannot claim a separate reviewer'
    if (policy.review_policy !== 'prefer-independent' || policy.independent_required === true) return 'independent review is required; host review cannot satisfy it'
    if (!Array.isArray(record.unavailable)) return 'host review must record separate-review unavailability'
    for (const candidate of allowed.filter(value => value !== 'host')) {
      const reasons = record.unavailable.filter(value => object(value) && value.kind === candidate && text(value.reason))
      if (reasons.length !== 1) return `host review needs one unavailability reason for ${candidate}`
    }
    if (!record.limitations.length) return 'host review must disclose its independence limitation'
  } else {
    if (record.reviewer === record.host || independence.separate_reviewer !== true) return 'separate review requires a different reviewer identity'
    if (!object(record.transport)) return 'separate review needs observed transport facts'
    if (kind === 'internal' && (!text(record.transport.tool) || record.transport.handle !== record.reviewer)) return 'native review needs its actual tool and matching thread handle'
    if (kind === 'external' && (record.transport.runner_id !== 'external-runner-v1' || !text(record.transport.clone))) return 'external review needs runner and clone facts'
  }
  if (independence.read_only_enforced === true && (!object(record.transport) || !text(record.transport.read_only_proof))) return 'enforced read-only claim needs observed enforcement evidence'
  if (independence.context === 'fresh' && (!object(record.transport) || !text(record.transport.context_proof))) return 'fresh context claim needs observed context evidence'
  const source = record.source
  if (!object(source)) return 'review needs a source identity'
  if (source.kind === 'git') {
    if (!/^[a-f0-9]{40}$/u.test(source.commit || '')) return 'review requires an exact Git commit'
  } else if (source.kind === 'no-git') {
    if (!Array.isArray(source.files) || source.files.length === 0 || source.files.length > 128) return 'no-Git review needs a bounded declared file manifest'
    const names = new Set()
    for (const file of source.files) {
      if (!object(file) || !text(file.path) || names.has(file.path) || !/^[a-f0-9]{64}$/u.test(file.sha256 || '')) return 'no-Git source files need unique paths and SHA-256 identities'
      names.add(file.path)
    }
    if (Object.hasOwn(source, 'commit')) return 'no-Git review must not invent a commit'
  } else return 'review source kind must be git or no-git'
  return null
}

const verify_review_files = (root, source) => {
  for (const file of source.files) {
    const absolute = safe_path(root, file.path)
    const first = writer().read_regular_file(absolute, 'review source')
    const second = writer().read_regular_file(absolute, 'review source')
    if (first.hash !== file.sha256 || first.hash !== second.hash || JSON.stringify(first.identity) !== JSON.stringify(second.identity)) throw Error(`review source changed: ${file.path}`)
  }
  return digest(JSON.stringify(source.files))
}

module.exports = { location, read_metadata, publish_reply, validate_review_record, verify_review_files }
