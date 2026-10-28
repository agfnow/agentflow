'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const S = require('./looper-state')
const insist = (ok, message) => { if (!ok) throw Error(message) }
const safePath = (root, relative) => S.safe_path(root, relative)
const exists = file => { try { fs.lstatSync(file); return true } catch (e) { if (e.code !== 'ENOENT') throw e; return false } }
function readOptional(file) {
  S.inspect_path(file)
  if (!exists(file)) return null
  S.checked_file(file)
  return fs.readFileSync(file, 'utf8')
}
function git(cwd, args, options = {}) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (/^GIT_(?:DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG.*|NAMESPACE|PREFIX|CEILING_DIRECTORIES|LITERAL_PATHSPECS|GLOB_PATHSPECS|NOGLOB_PATHSPECS|ICASE_PATHSPECS)$/.test(key)) delete env[key]
  Object.assign(env, options.env)
  const r = spawnSync('git', [...(args[0] === 'check-ignore' ? [] : ['--literal-pathspecs']), '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, ...args], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, input: options.input, env, windowsHide: true })
  if (options.allowFailure) return r
  insist(!r.error && r.status === 0, `Git ${args[0]} failed in ${cwd}: ${r.error?.message || r.stderr?.trim() || r.status}`)
  return r.stdout.trimEnd()
}
function writeChanged(file, old, next) {
  insist(readOptional(file) === old, `Source changed: ${file}; retain state and reconcile before retrying`)
  S.inspect_path(file)
  const tmp = `${file}.tmp-${crypto.randomUUID()}`
  const fd = fs.openSync(tmp, 'wx', 0o600)
  try { fs.writeFileSync(fd, next); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  insist(readOptional(file) === old, `Source changed: ${file}; temporary result retained at ${tmp}`)
  fs.renameSync(tmp, file)
  insist(readOptional(file) === next, `Write verification failed: ${file}`)
}
function discover(root, { allowAbsent = false } = {}) {
  const candidates = [], unresolved = [], unknownLinks = []
  function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.aglite-records'].includes(ent.name)) continue
      const file = path.join(dir, ent.name)
      if (ent.isSymbolicLink()) { if (ent.name === 'ag.json') unresolved.push(file); else unknownLinks.push(file); continue }
      if (ent.name === 'ag.json') insist(ent.isFile(), `Nonregular configuration: ${file}`)
      if (ent.isDirectory()) { if (!exists(path.join(file, '.git'))) walk(file); continue }
      if (ent.name !== 'ag.json') continue
      insist(ent.isFile(), `Nonregular configuration: ${file}`)
      let value
      try { value = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { unresolved.push(file); continue }
      insist(value && typeof value === 'object' && !Array.isArray(value), `Invalid configuration object: ${file}`)
      insist(!value.switches || typeof value.switches === 'object' && !Array.isArray(value.switches), `Invalid switches: ${file}`)
      const settings = value.switches || {}, agDir = settings['ag-dir'] ?? '.agentflow'
      insist(typeof agDir === 'string' && !/[\x00-\x1f\x7f]/.test(agDir), `Unsafe ag-dir: ${file}`)
      const parent = path.relative(root, path.dirname(file)).split(path.sep).join('/')
      safePath(root, agDir)
      if (parent === agDir || parent === '' || parent === '.agentflow') candidates.push({ file, value, settings, agDir, canonical: parent === agDir })
      // Bundled or unrelated configurations are not canonical candidates.
    }
  }
  walk(root)
  if (!candidates.length) unresolved.push(...unknownLinks)
  if (!candidates.length && !unresolved.length && allowAbsent) {
    const value = JSON.parse(JSON.stringify(require('../assets/.agentflow/ag.json')))
    value.switches['use-lang'] = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase()
    const stem = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, '')
    value.switches['notebook-name'] = stem ? `${stem}.devlog.md` : 'devlog.md'
    return { file: safePath(root, '.agentflow/ag.json'), value, settings: value.switches, agDir: '.agentflow', canonical: true, absent: true }
  }
  insist(candidates.length === 1 && !unresolved.length, `Configuration requires host reconciliation: ${[...candidates.map(x => x.file), ...unresolved].join(', ') || 'no canonical ag.json'}`)
  const c = candidates[0], targetSchema = require('../assets/.agentflow/ag.json')['schema-version']
  const legacy = ['skip-asker', 'skip-run', 'skip-wip', 'skip-plan', 'target-doc', 'workspace-dir', 'lang', 'ask-names', 'log-verbosity', 'allowed-worker', 'review-policy', 'cli-provider', 'allow-ag', 'away-gates', 'streams', 'auto-reply', 'notebook-ownership', 'large-work-minutes', 'git-timeout-ms', 'completion-cleanup', 'completion-cleanup-interval-days', 'metrics']
  insist(c.canonical && (c.value['schema-version'] === undefined || c.value['schema-version'] === targetSchema) && !legacy.some(k => k in c.settings) && !('cross-check' in (c.value['pipeline-roles'] || {})) && !Object.values(c.value['external-workers'] || {}).some(v => v && typeof v === 'object' && ('tiers' in v || 'family' in v)) && ['on', 'off'].includes(c.settings['saving-mode']), `Configuration migration requires host continuation: ${c.file}`)
  for (const key of ['inline-reply', 'omit-asker', 'omit-run', 'omit-wip', 'gate-design', 'gate-tracker', 'auto-commit', 'auto-push', 'saving-mode']) {
    insist(c.settings[key] === undefined || ['on', 'off'].includes(c.settings[key]), `Invalid ${key}: ${c.file}; expected on|off`)
  }
  for (const [key, values] of [['plan-mode', ['must', 'optional', 'off']], ['plan-order', ['3ways', 'external', 'native', 'host']], ['review-order', ['external', 'native', 'host']]]) {
    insist(c.settings[key] === undefined || values.includes(c.settings[key]), `Invalid or migration-required ${key}: ${c.file}; expected ${values.join('|')}`)
  }
  insist(c.settings['use-lang'] === undefined || typeof c.settings['use-lang'] === 'string' && /^[a-z]+(?:[-_][a-z0-9]+)*$/i.test(c.settings['use-lang']), `Invalid use-lang: ${c.file}`)
  if (c.settings['notebook-name'] !== undefined) insist(typeof c.settings['notebook-name'] === 'string' && c.settings['notebook-name'].length && !/[\\/\x00-\x1f\x7f]/.test(c.settings['notebook-name']) && !['.', '..'].includes(c.settings['notebook-name']) && !c.settings['notebook-name'].endsWith('.owner'), `Unsafe notebook-name: ${c.file}`)
  insist(c.value['default-editor'] === undefined || typeof c.value['default-editor'] === 'string' && c.value['default-editor'].trim().length > 0 && !/[\x00-\x1f\x7f]/.test(c.value['default-editor']), `Invalid default-editor: ${c.file}; expected a nonempty executable name or path`)
  return c
}
function registrations(main) {
  return git(main, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').filter(Boolean).map(block => Object.fromEntries(block.split('\0').filter(Boolean).map(line => { const i = line.indexOf(' '); return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)] })))
}
function noOperation(cwd) {
  for (const name of ['index.lock', 'HEAD.lock', 'packed-refs.lock', 'config.lock', 'shallow.lock', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG']) {
    const file = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', name])
    insist(!exists(file), `Git operation/lock blocks lifecycle: ${file}`)
  }
}
function supportedRecordLocale(settings) {
  const locale = settings['use-lang'] || Intl.DateTimeFormat().resolvedOptions().locale
  insist(require('./looper-report').supported_locale(locale), `Unsupported record locale ${locale}; no feature records were written. Continue with a host that can render the configured language; do not persist an English fallback.`)
}
function preflightClaimDisposal() {
  insist(['darwin', 'win32'].includes(process.platform), 'Linux feature record operations are unsupported: recoverable claim disposal is unproved; no mutation performed. Continue through a host with verified recoverable disposal.')
  if (process.platform === 'darwin') {
    S.checked_file('/usr/bin/trash')
    fs.accessSync('/usr/bin/trash', fs.constants.X_OK)
    const root = path.join(os.homedir(), '.Trash')
    S.inspect_path(root)
    insist(fs.statSync(root).isDirectory(), 'Recoverable Trash directory required before feature mutation')
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    fs.readdirSync(root)
  }
}
function preflightTrash(target) {
  preflightClaimDisposal()
  if (process.platform !== 'darwin') return
  const root = path.join(os.homedir(), '.Trash')
  insist(fs.statSync(root).dev === fs.statSync(target).dev, 'Same-volume recoverable Trash required before retirement writes')
  insist(target !== root && !target.startsWith(root + path.sep) && !root.startsWith(target + path.sep), 'Unsafe Trash/feature location')
}
function inheritedConfig(main, target) {
  const source = discover(main), value = JSON.parse(JSON.stringify(source.value))
  if (value.switches['notebook-name'] === undefined) {
    const stem = path.basename(main).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, '')
    value.switches['notebook-name'] = stem ? `${stem}.devlog.md` : 'devlog.md'
  }
  return { file: safePath(target, `${source.agDir}/ag.json`), value, settings: value.switches, agDir: source.agDir, canonical: true, absent: true, inheritedFrom: source.file, inheritedSource: readOptional(source.file) }
}
function localLifecycleConfig(c, { previousPath } = {}) {
  const relative = `${c.agDir}/ag.json`
  if (git(c.main, ['ls-tree', '-z', 'HEAD', '--', relative]) && previousPath !== relative) return null
  // A separately staged/modified config is owner work, not disposable setup.
  const headEntry = git(c.target, ['ls-tree', '-z', 'HEAD', '--', relative])
  const indexEntry = git(c.target, ['ls-files', '--stage', '-z', '--', relative])
  if (!headEntry && indexEntry) return null
  if (headEntry && git(c.target, ['diff', '--quiet', 'HEAD', '--', relative], { allowFailure: true }).status !== 0) return null
  const main = discover(c.main), feature = discover(c.target)
  insist(main.agDir === c.agDir && feature.agDir === c.agDir, 'Private inherited config routing changed; continue with the host')
  const stem = path.basename(c.main).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '')
  const normalize = source => {
    const value = JSON.parse(JSON.stringify(source))
    delete value.next_update_date
    value.switches['ag-dir'] ??= '.agentflow'
    value.switches['notebook-name'] ??= stem ? `${stem}.devlog.md` : 'devlog.md'
    const sorted = item => Array.isArray(item) ? item.map(sorted) : item && typeof item === 'object'
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])])) : item
    return JSON.stringify(sorted(value))
  }
  insist(normalize(main.value) === normalize(feature.value), 'Private inherited feature config differs from main; host decision required before discarding or integrating it')
  return relative
}
function context(cwd = process.cwd(), name, verb = 'new-feature') {
  cwd = fs.realpathSync(cwd)
  insist(!/[\x00-\x1f\x7f]/.test(cwd), 'Control characters in the checkout path are unsupported; no feature mutation performed')
  const current = fs.realpathSync(git(cwd, ['rev-parse', '--show-toplevel']))
  const entries = registrations(current)
  const primary = entries[0]
  insist(primary && !primary.bare && primary.branch && primary.branch.startsWith('refs/heads/') && !primary.branch.startsWith('refs/heads/feature/'), 'Expected primary registered main checkout on a symbolic branch; reconcile worktree identities')
  const main = fs.realpathSync(primary.worktree), mainBranch = primary.branch.slice(11)
  insist(git(main, ['symbolic-ref', '--short', 'HEAD']) === mainBranch && fs.realpathSync(git(main, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) === fs.realpathSync(git(current, ['rev-parse', '--path-format=absolute', '--git-common-dir'])), 'Primary main/shared Git identity mismatch')
  const currentBranch = git(current, ['symbolic-ref', '--short', 'HEAD'])
  if (!name && currentBranch.startsWith('feature/')) name = currentBranch.slice(8)
  insist(typeof name === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name), 'Supply a feature name matching [a-z0-9]+(-[a-z0-9]+)*')
  const branch = `feature/${name}`, target = safePath(main, `.wts/ft-${name}`)
  if (current !== main) insist(current === target && currentBranch === branch && verb !== 'new-feature', `Run agf ${verb} ${name} from ${main}`)
  const registration = entries.find(x => path.resolve(x.worktree) === target)
  const ref = git(main, ['rev-parse', '--verify', `refs/heads/${branch}`], { allowFailure: true })
  const featureTip = ref.status === 0 ? ref.stdout.trim() : null
  if (registration) insist(registration.branch === `refs/heads/${branch}` && !registration.locked, 'Managed checkout branch mismatch or locked registration')
  if (exists(target)) insist(registration && fs.realpathSync(target) === target && git(target, ['symbolic-ref', '--short', 'HEAD']) === branch, 'Unregistered or mismatched feature checkout')
  if (verb === 'new-feature') insist(Boolean(registration) === Boolean(featureTip) && Boolean(registration) === exists(target), 'Feature branch/path collision; retain existing objects')
  let config = discover(exists(target) ? target : main, { allowAbsent: exists(target) })
  if (config.absent) config = inheritedConfig(main, target)
  supportedRecordLocale(config.settings)
  preflightClaimDisposal()
  const relativeNotebook = `${config.agDir}/features/${name}/${name}.devlog.md`
  let mainTipResult = git(main, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  if (mainTipResult.status !== 0) {
    insist(verb === 'new-feature' && current === main && !registration && !featureTip, 'Main has no committed HEAD; use host setup before this operation')
    noOperation(main)
    insist(git(main, ['rev-parse', '--is-bare-repository']) === 'false' && !git(main, ['for-each-ref', '--format=%(refname)']), 'Empty bootstrap requires nonbare unborn repository with no refs')
    const indexBefore = git(main, ['ls-files', '--stage', '-z'])
    git(main, ['commit', '--allow-empty', '--only', '-m', 'chore: initialize repository'])
    insist(git(main, ['ls-files', '--stage', '-z']) === indexBefore && !git(main, ['ls-tree', '-r', '--name-only', 'HEAD']) && git(main, ['rev-list', '--parents', '-1', 'HEAD']).split(' ').length === 1, 'Bootstrap outcome unexpected; stop and inspect retained repository state')
    mainTipResult = git(main, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  }
  insist(mainTipResult.status === 0, 'Committed main baseline unavailable')
  return { main, target, name, branch, mainBranch, mainTip: mainTipResult.stdout.trim(), featureTip, settings: config.settings, config, agDir: config.agDir, notebook: safePath(target, relativeNotebook), relativeNotebook, registration }
}
function assertIdentity(c) {
  insist(git(c.main, ['symbolic-ref', '--short', 'HEAD']) === c.mainBranch, 'Main branch identity changed')
  insist(git(c.main, ['rev-parse', `refs/heads/${c.branch}`]) === c.featureTip, 'Feature tip changed; retain state and reconcile')
  insist(registrations(c.main).some(x => path.resolve(x.worktree) === c.target && x.branch === `refs/heads/${c.branch}` && !x.locked), 'Feature registration changed or locked')
  const branchLock = git(c.main, ['rev-parse', '--path-format=absolute', '--git-path', `refs/heads/${c.branch}.lock`])
  insist(!exists(branchLock), `Feature branch lock blocks lifecycle: ${branchLock}`)
  insist(fs.realpathSync(c.target) === c.target && git(c.target, ['symbolic-ref', '--short', 'HEAD']) === c.branch, 'Feature checkout identity changed')
  const mainLock = git(c.main, ['rev-parse', '--path-format=absolute', '--git-path', `refs/heads/${c.mainBranch}.lock`])
  insist(!exists(mainLock), `Main branch lock blocks lifecycle: ${mainLock}`)
  noOperation(c.main); noOperation(c.target)
}
function localExclude(cwd, rule) {
  insist(!/[\x00-\x1f\x7f]/.test(rule), 'Unsafe local exclude path')
  rule = rule.replace(/[\\*?\[\]]/g, char => '\\' + char)
  const file = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'info/exclude'])
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const old = readOptional(file) || ''
  if (old.split(/\r?\n/).includes(rule)) return
  const fd = fs.openSync(file, 'a', 0o600)
  try { fs.writeFileSync(fd, `${old && !old.endsWith('\n') ? '\n' : ''}${rule}\n`) } finally { fs.closeSync(fd) }
  insist(readOptional(file).split(/\r?\n/).includes(rule), 'Local exclude verification failed')
}
function dispose(file) {
  if (process.platform === 'win32') fs.unlinkSync(file)
  else {
    const r = spawnSync(process.platform === 'darwin' ? '/usr/bin/trash' : 'trash', [file], { encoding: 'utf8' })
    insist(!r.error && r.status === 0 && !exists(file), `Claim retained: dispose through recoverable Trash: ${file}`)
  }
}
function roundHeadings(text) {
  const result = []
  let fence = null, offset = 0
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, ''), start = offset
    offset += raw.length + 1
    if (fence) {
      const close = line.match(/^ {0,3}(`+|~+)\s*$/)
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) fence = null
      continue
    }
    const code = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (code && (code[1][0] !== '`' || !code[2].includes('`'))) {
      fence = { char: code[1][0], length: code[1].length }; continue
    }
    const m = line.match(/^# → ([^/\n]+) \/ (A-\d+)(?: \([^\n]*\))?$/)
    if (m) result.push({ label: m[1].trim(), ask: m[2], index: start, end: start + raw.length })
  }
  return result
}
function claim(notebook, ask = 'A-001') {
  const file = path.join(path.dirname(notebook), `.${path.basename(notebook)}.owner`)
  S.inspect_path(file)
  const token = crypto.randomUUID(), identity = { session: token, ask, claimed_at: new Date().toISOString() }
  let value = JSON.stringify(identity) + '\n'
  let fd
  try { fd = fs.openSync(file, 'wx', 0o600) } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const marker = readOptional(file)
    throw Error(`Feature claim collision: ${file}; existing marker ${marker?.trim() || '(empty)'}; explicit host handoff required, no stale takeover`)
  }
  try { fs.writeFileSync(fd, value) } finally { fs.closeSync(fd) }
  const verify = () => insist(readOptional(file) === value, `Foreign or changed claim: ${file}`)
  return { path: file, token, verify,
    rebind(nextAsk) {
      verify(); insist(/^A-\d+$/.test(nextAsk), 'Invalid claim Ask identity')
      identity.ask = nextAsk
      const next = JSON.stringify(identity) + '\n'
      writeChanged(file, value, next); value = next
    },
    release() { verify(); dispose(file) } }
}
function treeDigest(root) {
  const hash = crypto.createHash('sha256')
  function visit(file, relative) {
    const st = fs.lstatSync(file)
    hash.update(JSON.stringify([relative, st.mode, st.isSymbolicLink() ? fs.readlinkSync(file) : st.isFile() ? fs.readFileSync(file).toString('base64') : null]))
    if (st.isDirectory()) for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`)
  }
  visit(root, '')
  return hash.digest('hex')
}
function cleanFeature(c, allowedPaths = []) {
  const raw = git(c.target, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'])
  const entries = raw.split('\0').filter(Boolean), changed = []
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]; changed.push(entry.slice(3))
    if (/[RC]/.test(entry.slice(0, 2))) changed.push(entries[++i])
  }
  const config = localLifecycleConfig(c)
  const allowed = name => name === config || allowedPaths.some(rule => rule.endsWith('/') ? name.startsWith(rule) : name === rule)
  insist(changed.every(allowed), `Feature has tracked, untracked or ignored data: ${changed.filter(p => !allowed(p)).join(', ')}; use --abandon to abandon it`)
}
function retire(c, { abandon = false, expectedTip = c.featureTip, allowedPaths = [] } = {}) {
  insist(['darwin', 'win32'].includes(process.platform), 'Feature cleanup unsupported on this platform; retain checkout and branch')
  insist(expectedTip && c.featureTip === expectedTip, 'Cleanup feature tip mismatch')
  noOperation(c.main)
  insist(git(c.main, ['symbolic-ref', '--short', 'HEAD']) === c.mainBranch, 'Main branch identity changed')
  const checkTip = () => insist(git(c.main, ['rev-parse', `refs/heads/${c.branch}`]) === expectedTip, 'Feature branch changed; retain it and reconcile before retrying')
  checkTip()
  if (!abandon) insist(git(c.main, ['merge-base', '--is-ancestor', expectedTip, 'HEAD'], { allowFailure: true }).status === 0, 'Feature is unmerged; use --abandon only to abandon it')
  let recovered
  if (exists(c.target)) {
    assertIdentity(c)
    const owner = path.join(path.dirname(c.notebook), `.${path.basename(c.notebook)}.owner`)
    insist(!exists(owner), `Target feature claim blocks cleanup: ${owner}`)
    if (!abandon) cleanFeature(c, allowedPaths)
    preflightTrash(c.target)
    supportedRecordLocale(c.settings)
    const old = readOptional(c.notebook)
    if (old) {
      const ask = roundHeadings(old).at(-1)?.ask
      insist(ask, 'Feature round identity missing; ask host to reconcile before cleanup')
      const own = claim(c.notebook, ask)
      own.verify()
      let next = old.replace(/^(Stream|功能):.*$/m, '$1: dropped').replace(/^(Session|工作階段):.*$/m, '$1: retired').replace(/^(Cleanup|清理):.*$/m, '$1: pending')
      // Merge callers already saved merged/retired status and its recovery identity.
      if (/^(Stream|功能): merged$/m.test(old)) next = old.replace(/^(Cleanup|清理):.*$/m, '$1: pending')
      const zh = /^(?:功能|工作階段|清理):/m.test(old)
      const fields = [[zh ? '功能' : 'Stream', /^(Stream|功能):/m.test(next) ? null : 'dropped'], [zh ? '工作階段' : 'Session', /^(Session|工作階段):/m.test(next) ? null : 'retired'], [zh ? '清理' : 'Cleanup', /^(Cleanup|清理):/m.test(next) ? null : 'pending']].filter(([, value]) => value)
      if (fields.length) {
        insist(/^# STATUS\r?\n/.test(next) && /\n---\r?\n/.test(next), 'Cannot safely initialize missing feature STATUS fields; request host reconciliation')
        next = next.replace(/\n---\r?\n/, `\n${fields.map(([key, value]) => `${key}: ${value}\n`).join('\n')}\n---\n`)
      }
      own.verify(); writeChanged(c.notebook, old, next)
      own.release()
    }
    const id = fs.statSync(c.target), digest = treeDigest(c.target), trashRoot = path.join(os.homedir(), '.Trash')
    if (process.platform === 'darwin') {
      S.inspect_path(trashRoot)
      insist(fs.statSync(trashRoot).dev === id.dev, 'Same-volume recoverable Trash required')
      const before = new Set(fs.readdirSync(trashRoot))
      assertIdentity(c); checkTip()
      const r = spawnSync('/usr/bin/trash', [c.target], { encoding: 'utf8' })
      insist(!r.error && r.status === 0 && !exists(c.target), `Trash failed/uncertain for ${c.target}, inspected tip ${expectedTip}; inspect ${trashRoot} before renewed drop; registration/branch retained`)
      const matches = fs.readdirSync(trashRoot).filter(n => !before.has(n)).map(n => path.join(trashRoot, n)).filter(p => { const st = fs.lstatSync(p); return st.dev === id.dev && st.ino === id.ino })
      insist(matches.length === 1 && treeDigest(matches[0]) === digest, `Trash preservation unproved for ${c.target}, inspected tip ${expectedTip}; retain registration/branch and inspect Trash manually`)
      recovered = matches[0]
    } else { assertIdentity(c); checkTip(); fs.rmSync(c.target, { recursive: true }); insist(!exists(c.target), `Windows removal incomplete: ${c.target}; inspected tip ${expectedTip}; inspect remaining exact checkout`) }
  } else {
    // A renewed explicit command may finish an exact missing/prunable registration.
    insist(!registrations(c.main).some(x => x.branch === `refs/heads/${c.branch}` && path.resolve(x.worktree) !== c.target), 'Feature branch reused in another checkout; stop cleanup')
  }
  if (registrations(c.main).some(x => path.resolve(x.worktree) === c.target)) git(c.main, ['worktree', 'remove', c.target])
  insist(!registrations(c.main).some(x => path.resolve(x.worktree) === c.target), `Feature registration remains: ${c.target}; inspected tip ${expectedTip}; retain branch and renew drop only after inspection`)
  checkTip()
  insist(!registrations(c.main).some(x => x.branch === `refs/heads/${c.branch}`), 'Feature branch checked out elsewhere; retain it')
  git(c.main, ['branch', abandon ? '-D' : '-d', c.branch])
  insist(git(c.main, ['show-ref', '--verify', `refs/heads/${c.branch}`], { allowFailure: true }).status !== 0, 'Feature branch deletion unproved')
  const zh = /^zh(?:$|[-_](?:tw|hant)(?:[-_]|$))/i.test(c.settings['use-lang'] || Intl.DateTimeFormat().resolvedOptions().locale)
  return { destination: c.main, message: zh ? `已移除 ${c.target}\n\n已取消工作目錄登錄並刪除 ${c.branch}（${expectedTip}）。${recovered ? `\n\n可復原的工作目錄：${recovered}` : process.platform === 'win32' ? '\n\nWindows 功能工作目錄已永久刪除。' : '\n\n工作目錄原已不存在；本次明確要求已完成剩餘 Git 清理。'}` : `Removed ${c.target}\n\nUnregistered worktree and deleted ${c.branch} at ${expectedTip}.${recovered ? `\n\nRecoverable checkout: ${recovered}` : process.platform === 'win32' ? '\n\nWindows permanent feature cleanup.' : '\n\nCheckout was already absent; renewed command completed remaining Git cleanup.'}` }
}

module.exports = { insist, exists, safePath, readOptional, git, writeChanged, discover, registrations, noOperation, context, assertIdentity, localExclude, claim, retire, cleanFeature, treeDigest, roundHeadings, supportedRecordLocale, preflightClaimDisposal, preflightTrash, localLifecycleConfig }
