'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const S = require('./looper-state')
const G = require('./looper-integration')
const A = require('./looper-agent')
const insist = (ok, message) => { if (!ok) throw Error(message) }
const now = () => new Date().toISOString()
const inside = (a, b) => a === b || b.startsWith(a + path.sep)
const overlaps = (a, b) => inside(a, b) || inside(b, a)
const exists = file => { try { fs.lstatSync(file); return true } catch (e) { if (e.code !== 'ENOENT') throw e; return false } }
const identity = file => { S.inspect_path(file); const s = fs.lstatSync(file); return { dev: s.dev, ino: s.ino } }
const matches = (file, id) => exists(file) && JSON.stringify(identity(file)) === JSON.stringify(id)
const ancestor = (repo, a, b) => { G.oid(repo, a); G.oid(repo, b); insist(G.git(repo, ['merge-base', a, b]) === a, 'Commit ancestry proof missing') }
const workspaces = group => [group.workspace, group.integration, ...(group.integration_history || []), group.suspended_integration]
  .filter((item, index, all) => item && all.findIndex(other => other?.worktree === item.worktree) === index)

function assert_completed(q) {
  insist(q.phase === 'complete' && !q.integration && !(q.ready || []).length && !q.lane_error && !q.lane_wait,
    'Cleanup requires a completed settled run')
  insist(!(q.questions || []).some(x => !x.answer) && !(q.handoffs || []).some(x => !x.completed || x.error), 'Unsettled question or native handoff')
  for (const p of q.processes || []) insist(p.ended_at || S.writer_stopped(p), 'Writer alive or uncertain')
  const actual = { branch: G.git(q.repo, ['symbolic-ref', '--short', 'HEAD']), head: G.head(q.repo) }
  insist(actual.branch === q.target_branch, 'Target branch mismatch')
  ancestor(q.repo, q.expected_head, actual.head)
  G.no_operation(q.repo)
  for (const g of q.groups) {
    insist(g.state === 'done' && !g.attempt && !g.resume_integration, 'Group is not settled')
    if (g.suspended_integration) {
      const old = g.suspended_integration
      insist(!old.attempt && (old.result || old.phase === 'prepared'), 'Suspended integration is not settled history')
      if (old.result) ancestor(q.repo, old.result, g.integration?.result)
    }
    for (const t of g.tasks) {
      insist(t.state === 'done' && t.result?.outcome === 'pass' && t.checks.every(id => t.checks_result?.some(x => x.id === id && x.passed === true)), 'Completed task lacks passing evidence')
      ancestor(q.repo, t.candidate, g.integration?.result)
    }
    const i = g.integration
    insist(i && !i.attempt && i.checks?.length && i.checks.every(x => x.passed === true), 'Completed integration lacks passing evidence')
    for (const id of q.integration_checks) insist(i.checks.some(x => x.id === id && x.passed === true), 'Missing integration check')
    ancestor(q.repo, i.candidate, i.result)
    ancestor(q.repo, i.base, i.result)
    ancestor(q.repo, i.result, q.expected_head)
  }
  function reviews(value) {
    if (!value || typeof value !== 'object') return
    if (value.ordinary_reviews) for (const r of value.ordinary_reviews)
      insist(['complete', 'cancelled'].includes(r.state) && r.result && !r.settlement_error && !r.error, 'Unsettled ordinary review')
    for (const [key, child] of Object.entries(value)) if (key !== 'cleanup') reviews(child)
  }
  reviews(q)
  return q
}

function tree_safe(file, allow_links = false, nested = false) {
  if (!nested) S.inspect_path(file)
  const s = fs.lstatSync(file)
  if (s.isSymbolicLink()) { insist(allow_links, `Unsafe cleanup symlink: ${file}`); return }
  insist(s.isDirectory() || s.isFile(), `Unsafe cleanup entry: ${file}`)
  if (s.isDirectory()) for (const entry of fs.readdirSync(file))
    tree_safe(path.join(file, entry), allow_links && entry !== '.aglite-records', true)
}
function registration(repo, file) {
  const entries = G.git(repo, ['worktree', 'list', '--porcelain']).split('\n\n')
  return entries.find(block => block.split('\n')[0] === `worktree ${file}`)
}
function acquire(file, q) {
  if (!exists(file)) return S.acquire_claim(file, { run_id: q.run_id })
  const old = S.read_json(file)
  insist(old.run_id === q.run_id, 'Foreign cleanup claim')
  return S.takeover_claim(file, old.token, (q.processes || []).filter(p => !p.ended_at))
}

async function cleanup(root, options = {}) {
  root = path.resolve(root)
  S.inspect_path(root)
  insist(fs.realpathSync(root) === root, 'Physical run-root required')
  const file = path.join(root, 'queue.json')
  let source = fs.readFileSync(file, 'utf8')
  const q = require('./looper').load(root)
  assert_completed(q)
  insist(root !== q.repo, 'Cleanup run-root cannot be the main checkout')
  const common = path.resolve(q.repo, G.git(q.repo, ['rev-parse', '--git-common-dir']))
  const names = [path.join(root, '.queue.owner'), path.join(common, `aglite-target-${crypto.createHash('sha256').update(q.target_branch).digest('hex').slice(0, 20)}.owner`)]
  const owners = []
  const prior_cleanup = q.cleanup?.state === 'complete' && (!q.cleanup.compaction || q.cleanup.compaction.state === 'complete') ? structuredClone(q.cleanup) : undefined
  let unsettled = false, claim_recycled = false, movement_started = false, cleanup_saved = !!q.cleanup
  const save = () => {
    insist(owners.length === names.length, 'Cleanup does not own both claims')
    owners.forEach((owner, i) => S.verify_claim(names[i], owner))
    insist(fs.readFileSync(file, 'utf8') === source, 'queue.json changed outside cleanup')
    q.updated_at = now(); S.write_json(file, q); cleanup_saved = !!q.cleanup; source = fs.readFileSync(file, 'utf8')
    options.on_save?.(q)
  }
  try {
    for (const name of names) owners.push(acquire(name, q))
    let reconciled = false
    for (const proc of q.processes || []) if (!proc.ended_at) {
      insist(S.writer_stopped(proc), 'Cleanup writer settlement uncertain')
      proc.ended_at = now(); reconciled = true
    }
    const outputs = q.groups.flatMap(g => g.tasks.flatMap(t => t.allowed_paths.map(p => S.safe_path(q.repo, p))))
    const protect = target => {
      S.inspect_path(target)
      insist(![root, q.repo, process.cwd()].some(p => inside(target, path.resolve(p))), 'Cleanup target contains current/main/run-root')
      insist(!outputs.some(p => overlaps(p, target)), 'Cleanup target overlaps declared output')
    }
    const trash_root = path.resolve(options.trash_root || path.join(os.homedir(), '.Trash'))
    S.inspect_path(trash_root)
    insist(fs.statSync(trash_root).isDirectory() && fs.statSync(trash_root).dev === fs.statSync(root).dev, 'Accessible same-volume Trash required')
    fs.accessSync(trash_root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK)
    if (!options.trash) {
      insist(process.platform === 'darwin', 'Native cleanup supports macOS only')
      S.checked_file('/usr/bin/trash'); fs.accessSync('/usr/bin/trash', fs.constants.X_OK)
    }
    const scratch = new Set()
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    function referenced(value) {
      if (!value || typeof value !== 'object') return
      for (const [key, v] of Object.entries(value)) {
        if (key === 'cleanup') continue
        if ((['attempt_id', 'parent_attempt_id', 'task_attempt_id'].includes(key) || key === 'id' && value.role && value.selection) && typeof v === 'string' && uuid.test(v)) scratch.add(path.join(root, 'attempts', v))
        if (key === 'log' && typeof v === 'string') {
          const parent = path.dirname(v), name = path.basename(parent)
          const labels = ['combined', ...q.groups.flatMap(g => g.tasks.map(t => t.id))]
          if (path.dirname(parent) === path.join(root, 'evidence') && labels.some(label => name.startsWith(label + '-') && uuid.test(name.slice(label.length + 1)))) scratch.add(parent)
        }
        referenced(v)
      }
    }
    referenced(q)
    for (const g of q.groups) for (const t of g.tasks) if (t.input_file) {
      insist(t.input_file === path.join(root, 'inputs', `${g.id}-${t.id}.md`), 'Input snapshot identity mismatch')
      scratch.add(t.input_file)
    }
    const saved_workspaces = q.groups.flatMap(workspaces)
    let c = q.cleanup
    if (c) {
      insist(c.run_id === q.run_id && c.repo === q.repo && c.root === root && uuid.test(c.id), 'Cleanup journal binding mismatch')
      insist(c.bundle === path.join(root, `cleanup-${c.id}`) && c.trash_path === path.join(trash_root, path.basename(c.bundle)), 'Cleanup journal path mismatch')
      protect(c.bundle)
      for (const item of c.items) {
        protect(item.source)
        insist(item.kind === 'worktree' ? saved_workspaces.some(w => w.worktree === item.source && w.branch === item.branch) : item.kind === 'scratch' && scratch.has(item.source), 'Cleanup source lacks queue ownership')
        insist(item.staged === path.join(c.bundle, String(c.items.indexOf(item))), 'Cleanup staged path mismatch')
        if (item.kind === 'worktree') {
          const group = q.groups.find(g => workspaces(g).some(w => w.worktree === item.source))
          const stable = `aglite-${q.run_id}-${group.id}`, prefix = `aglite-merge-${q.run_id}-${group.id}-`
          insist(item.source === path.join(q.repo, '.wts', item.branch) && (item.branch === stable || item.branch.startsWith(prefix) && uuid.test(item.branch.slice(prefix.length))), 'Generated retry workspace identity mismatch')
          const w = saved_workspaces.find(w => w.worktree === item.source)
          insist(item.head === (w.result || group.candidate || group.tasks.at(-1).candidate), 'Cleanup saved HEAD identity mismatch')
        }
        if (item.records) { protect(item.records.destination); insist(item.records.source === path.join(item.source, '.aglite-records') && item.records.destination === path.join(root, 'records', c.id, path.basename(item.source)), 'Cleanup record destination mismatch') }
      }
      c.records = c.items.filter(item => item.records).map(item => item.records)
      if (c.state === 'complete') c.worktrees_complete = true
    } else {
      const id = crypto.randomUUID(), bundle = path.join(root, `cleanup-${id}`)
      protect(bundle)
      c = { id, run_id: q.run_id, repo: q.repo, root, state: 'running', provider: options.trash ? 'injected' : '/usr/bin/trash', bundle, trash_path: path.join(trash_root, path.basename(bundle)), items: [], retained: [], created_at: now() }
      const add = (source, kind, extra = {}) => {
        protect(source); tree_safe(source, kind === 'worktree')
        insist(identity(source).dev === fs.statSync(root).dev, 'Cleanup requires same-volume staging')
        c.items.push({ source, kind, staged: path.join(bundle, String(c.items.length)), identity: identity(source), ...extra })
      }
      for (const g of q.groups) {
        const candidates = workspaces(g).map(w => w === g.workspace ? { ...w, expected: g.candidate || g.tasks.at(-1).candidate, group: true } : w)
        for (const w of candidates) {
          insist(w && w.worktree && w.branch, 'Missing recorded workspace')
          if (!w.group && !w.result) { c.retained.push({ path: w.worktree, reason: 'unproved_integration' }); continue }
          const expected = w.group ? w.expected : w.result
          const prefix = w.group ? `aglite-${q.run_id}-${g.id}` : `aglite-merge-${q.run_id}-${g.id}-`
          insist(w.group ? w.branch === prefix : w.branch.startsWith(prefix) && uuid.test(w.branch.slice(prefix.length)), 'Generated branch identity mismatch')
          insist(w.worktree === path.join(q.repo, '.wts', w.branch), 'Generated workspace path mismatch')
          const reg = registration(q.repo, w.worktree)
          insist(reg && !/^locked(?: |$)/m.test(reg) && reg.includes(`\nbranch refs/heads/${w.branch}`), 'Worktree registration missing, foreign or locked')
          insist(G.head(w.worktree) === expected && G.git(w.worktree, ['symbolic-ref', '--short', 'HEAD']) === w.branch, 'Worktree HEAD/branch mismatch')
          ancestor(q.repo, w.base, expected); ancestor(q.repo, expected, q.expected_head)
          G.no_operation(w.worktree)
          insist(!G.git(w.worktree, ['status', '--porcelain', '--untracked-files=all']), 'Dirty worktree refused')
          const records = path.join(w.worktree, '.aglite-records')
          insist(!exists(path.join(records, '.devlog.md.owner')), 'Active notebook marker refused')
          const extra = { branch: w.branch, head: expected, ignored: G.git(w.worktree, ['ls-files', '--others', '--ignored', '--exclude-standard', '-z']).split('\0').filter(Boolean) }
          if (exists(records)) { protect(path.join(root, 'records', id, path.basename(w.worktree))); extra.records = { source: records, destination: path.join(root, 'records', id, path.basename(w.worktree)), identity: identity(records) } }
          add(w.worktree, 'worktree', extra)
        }
      }
      for (const p of scratch) if (exists(p)) add(p, 'scratch')
      // Other run-root entries are handled by the final sweep.
      for (const dir of ['attempts', 'evidence', 'inputs']) if (exists(path.join(root, dir)))
        for (const entry of fs.readdirSync(path.join(root, dir))) {
          const p = path.join(root, dir, entry)
          if (!c.items.some(x => x.source === p)) c.retained.push({ path: p, reason: 'unproved_scratch' })
        }
      insist(!exists(bundle) && !exists(c.trash_path), 'Cleanup bundle collision')
      c.records = c.items.filter(x => x.records).map(x => x.records)
      q.cleanup = c
    }
    const keep = new Set(['queue.json', q.request, ...q.groups.map(g => g.file)].map(p => S.safe_path(root, p)))
    // Case-insensitive/normalizing filesystems must never turn a kept file into an extra.
    for (const file of keep) {
      let directory = root
      for (const part of path.relative(root, file).split(path.sep)) {
        insist(fs.readdirSync(directory).includes(part), `Retained path spelling mismatch: ${file}`)
        directory = path.join(directory, part)
      }
    }
    const candidates = () => {
      const found = []
      const visit = directory => {
        for (const name of fs.readdirSync(directory)) {
          const p = path.join(directory, name)
          if (keep.has(p) || p === names[0] || p === c.bundle || p === c.compaction?.bundle) continue
          if ([...keep].some(file => inside(p, file))) {
            S.inspect_path(p); insist(name !== '.git' && !(name.startsWith('.') && name.endsWith('.owner')), `Unsafe retained parent directory: ${p}`); visit(p)
          }
          else found.push(p)
        }
      }
      visit(root); return found
    }
    const inspect_extra = p => {
      protect(p); tree_safe(p)
      const visit = file => {
        const name = path.basename(file)
        insist(name !== '.git' && !(name.startsWith('.') && name.endsWith('.owner')), `Active claim or nested checkout in cleanup extra: ${file}`)
        if (fs.lstatSync(file).isDirectory()) for (const child of fs.readdirSync(file)) visit(path.join(file, child))
      }
      visit(p)
      insist(identity(p).dev === fs.statSync(root).dev, 'Cleanup requires same-volume staging')
    }
    if (c.worktrees_complete) insist(!exists(c.bundle), 'Completed cleanup staging bundle reappeared')
    candidates().forEach(inspect_extra)
    if (!c.worktrees_complete) {
    // Recheck all remaining sources before any retry moves another item.
    for (const item of c.items) if (exists(item.source)) {
      insist(matches(item.source, item.identity), 'Cleanup source identity changed'); tree_safe(item.source, item.kind === 'worktree')
      if (item.kind === 'worktree') {
        const reg = registration(q.repo, item.source)
        insist(reg && !/^locked(?: |$)/m.test(reg) && reg.includes(`\nbranch refs/heads/${item.branch}`), 'Worktree registration changed or locked')
        insist(G.head(item.source) === item.head && G.git(item.source, ['symbolic-ref', '--short', 'HEAD']) === item.branch, 'Worktree identity changed')
        G.no_operation(item.source)
        insist(!G.git(item.source, ['status', '--porcelain', '--untracked-files=all']), 'Dirty worktree refused')
        insist(!exists(path.join(item.source, '.aglite-records/.devlog.md.owner')), 'Active notebook marker refused')
      }
    }
    c.state = 'running'; delete c.error; save()
    if (!c.bundle_identity) {
      insist(!exists(c.bundle), 'Unjournaled bundle exists')
      c.bundle_intent = true; save(); fs.mkdirSync(c.bundle); c.bundle_identity = identity(c.bundle); save()
    }
    const move = (item, from, to, id, key) => {
      if (item[key] === 'done') { insist(matches(to, id) && !exists(from), 'Completed move identity changed'); return }
      if (matches(to, id) && !exists(from)) { insist(item[key] === 'intent', 'Move lacks saved intent'); item[key] = 'done'; save(); return }
      insist(matches(from, id) && !exists(to), 'Move source/destination identity uncertain')
      item[key] = 'intent'; save()
      S.inspect_path(to)
      insist(matches(from, id) && !exists(to), 'Move changed after intent save')
      fs.mkdirSync(path.dirname(to), { recursive: true }); S.inspect_path(to)
      fs.renameSync(from, to); item[key] = 'done'; save()
    }
    const recovered_trash = matches(c.trash_path, c.bundle_identity) && !exists(c.bundle)
    if (!recovered_trash) {
      insist(matches(c.bundle, c.bundle_identity), 'Staging bundle identity missing or uncertain')
      for (const item of c.items) {
        if (item.records) move(item.records, item.records.source, item.records.destination, item.records.identity, 'move')
        move(item, item.source, item.staged, item.identity, 'move')
      }
      c.trash_operation = 'intent'; save()
      const tracked = []
      const track = async p => {
        const list = Array.isArray(p) ? p : [p]; tracked.push(...list); q.processes ??= []; q.processes.push(...list)
        owners.forEach((owner, i) => { S.verify_claim(names[i], owner); owner.children = [...(owner.children || []), ...list]; S.write_json(names[i], owner) }); save()
      }
      try {
        if (options.trash) await options.trash(c.bundle, { trash_root, destination: c.trash_path })
        else {
          const evidence = S.safe_path(root, 'evidence'); fs.mkdirSync(evidence, { recursive: true })
          const log = path.join(evidence, `cleanup-${c.id}-${crypto.randomUUID()}.log`)
          c.log = log; save()
          const observed = await A.execute({ command: ['/usr/bin/trash', c.bundle], cwd: root, log, timeout_ms: 60000, on_launch: track, on_descendant: track, kind: 'cleanup' })
          insist(observed.exit_code === 0 && !observed.error && !observed.timed_out && !observed.aborted, 'Trash process failed')
        }
      } catch (e) { unsettled = !!e.unsettled; throw e }
      finally {
        if (!unsettled) {
          for (const p of tracked) p.ended_at = now()
          owners.forEach((owner, i) => { S.verify_claim(names[i], owner); owner.children = (owner.children || []).filter(p => !tracked.includes(p)); S.write_json(names[i], owner) }); save()
        }
      }
    }
    insist(c.trash_operation === 'intent' || c.trash_operation === 'done', 'Trash outcome lacks saved intent')
    insist(matches(c.trash_path, c.bundle_identity) && !exists(c.bundle), 'Trash outcome unknown; exact recoverable bundle required')
    for (const item of c.items) insist(matches(path.join(c.trash_path, path.basename(item.staged)), item.identity), 'Recoverable staged item identity mismatch')
    c.trash_operation = 'done'; save()
    for (const item of c.items.filter(x => x.kind === 'worktree')) {
      if (item.unregister === 'done') { insist(!registration(q.repo, item.source), 'Unregistered workspace reappeared'); continue }
      if (!registration(q.repo, item.source)) insist(item.unregister === 'intent', 'Missing registration without intent')
      else {
        item.unregister = 'intent'; save()
        const reg = registration(q.repo, item.source)
        insist(reg && !/^locked(?: |$)/m.test(reg) && reg.includes(`\nbranch refs/heads/${item.branch}`), 'Worktree registration changed or locked before unregistration')
        insist(G.git(q.repo, ['rev-parse', `refs/heads/${item.branch}`]) === item.head, 'Worktree ref changed before unregistration')
        G.git(q.repo, ['worktree', 'remove', item.source])
        insist(G.git(q.repo, ['rev-parse', `refs/heads/${item.branch}`]) === item.head, 'Worktree ref changed during unregistration')
      }
      insist(G.git(q.repo, ['rev-parse', `refs/heads/${item.branch}`]) === item.head, 'Worktree ref changed after unregistration')
      insist(!registration(q.repo, item.source), 'Worktree unregistration incomplete'); item.unregister = 'done'; save()
    }
    c.worktrees_complete = true; save()
    }
    c.state = 'compacting'; delete c.error; save()
    // A completed old journal still needs the new retention sweep.
    const initial_extras = new Set(candidates())
    do {
    let p = c.compaction
    if (p) {
      insist(uuid.test(p.id) && p.bundle === path.join(root, `compact-${p.id}`) && p.trash_path === path.join(trash_root, path.basename(p.bundle)), 'Compaction journal binding mismatch')
      protect(p.bundle)
      if (p.state === 'complete') insist(!exists(p.bundle), 'Completed compaction staging bundle reappeared')
      for (const [index, item] of p.items.entries()) {
        insist(inside(root, item.source) && item.source !== root && ![...keep, names[0]].some(file => overlaps(file, item.source)), 'Compaction source overlaps retained file')
        insist(item.staged === path.join(p.bundle, String(index)), 'Compaction staged path mismatch')
        protect(item.source)
      }
    }
    if (!p || p.state === 'complete' && candidates().length) {
      // Inspect the whole selection before moving any run-root history.
      const selected = candidates(); selected.forEach(inspect_extra)
      if (p) (c.compaction_history ??= []).push(p)
      const id = crypto.randomUUID(), bundle = path.join(root, `compact-${id}`)
      protect(bundle)
      p = { id, bundle, trash_path: path.join(trash_root, path.basename(bundle)), state: 'running', items: selected.map((source, index) => ({ source, staged: path.join(bundle, String(index)), identity: identity(source) })) }
      insist(!exists(p.bundle) && !exists(p.trash_path), 'Compaction bundle collision')
      c.compaction = p; c.retained = c.retained.filter(item => !inside(root, item.path)); save()
    }
    if (p.state !== 'complete') {
      for (const item of p.items) if (exists(item.source)) { insist(matches(item.source, item.identity), 'Compaction source identity changed'); inspect_extra(item.source) }
      if (!p.bundle_identity) {
        insist(!exists(p.bundle), 'Unjournaled compaction bundle exists')
        p.bundle_intent = true; save(); fs.mkdirSync(p.bundle); p.bundle_identity = identity(p.bundle); save()
      }
      if (!(matches(p.trash_path, p.bundle_identity) && !exists(p.bundle))) {
        insist(matches(p.bundle, p.bundle_identity), 'Compaction staging identity missing or uncertain')
        for (const item of p.items) {
          if (matches(item.staged, item.identity) && !exists(item.source)) {
            insist(['intent', 'done'].includes(item.move), 'Compaction move lacks intent'); item.move = 'done'; save(); continue
          }
          insist(matches(item.source, item.identity) && !exists(item.staged), 'Compaction source/destination identity uncertain')
          movement_started = true
          item.move = 'intent'; save()
          insist(matches(item.source, item.identity) && !exists(item.staged), 'Compaction source changed after intent')
          inspect_extra(item.source); fs.renameSync(item.source, item.staged); item.move = 'done'; save()
        }
        p.trash_operation = 'intent'; save()
        const tracked = []
        const track = async child => {
          const list = Array.isArray(child) ? child : [child]; tracked.push(...list); q.processes ??= []; q.processes.push(...list)
          owners.forEach((owner, i) => { S.verify_claim(names[i], owner); owner.children = [...(owner.children || []), ...list]; S.write_json(names[i], owner) }); save()
        }
        try {
          if (options.trash) await options.trash(p.bundle, { trash_root, destination: p.trash_path })
          else {
            const observed = await A.execute({ command: ['/usr/bin/trash', p.bundle], cwd: root, log: path.join(p.bundle, `.trash-${crypto.randomUUID()}.log`), timeout_ms: 60000, on_launch: track, on_descendant: track, kind: 'cleanup' })
            insist(observed.exit_code === 0 && !observed.error && !observed.timed_out && !observed.aborted, 'Compaction Trash process failed')
          }
        } catch (e) { unsettled = !!e.unsettled; throw e }
        finally {
          if (!unsettled) {
            for (const child of tracked) child.ended_at = now()
            owners.forEach((owner, i) => { S.verify_claim(names[i], owner); owner.children = (owner.children || []).filter(child => !tracked.includes(child)); S.write_json(names[i], owner) }); save()
          }
        }
      }
      insist(['intent', 'done'].includes(p.trash_operation) && matches(p.trash_path, p.bundle_identity) && !exists(p.bundle), 'Compaction Trash outcome unknown')
      for (const item of p.items) insist(matches(path.join(p.trash_path, path.basename(item.staged)), item.identity), 'Compaction recoverable item identity mismatch')
      p.trash_operation = 'done'; p.state = 'complete'; save()
    }
    insist(candidates().every(file => initial_extras.has(file)), 'New run-root entries appeared during cleanup; retry manual cleanup')
    } while (candidates().length)
    const destination = path.join(trash_root, `agf-queue-claim-${crypto.randomUUID()}`)
    insist(!exists(destination), 'Claim Trash collision')
    if (c.claim_release) (c.claim_release_history ??= []).push(c.claim_release)
    c.claim_release = { destination, identity: identity(names[0]), operation: 'intent' }
    c.state = 'complete'; c.completed_at = now(); save()
    // Last root mutation: retire only our exact active claim, directly to recoverable Trash.
    S.verify_claim(names[0], owners[0])
    insist(!candidates().length, 'New run-root entries appeared before claim release; retry manual cleanup')
    insist(matches(names[0], c.claim_release.identity) && !exists(destination), 'Claim release identity changed')
    fs.renameSync(names[0], destination); claim_recycled = true
    return q
  } catch (e) {
    if (q.cleanup && cleanup_saved && owners.length === names.length) {
      if (prior_cleanup && !movement_started) q.cleanup = prior_cleanup
      else { q.cleanup.state = 'failed'; q.cleanup.error = e.message }
      try { save() } catch {}
    }
    throw e
  } finally {
    if (!unsettled) for (let i = owners.length - 1; i >= 0; i--) if (i !== 0 || !claim_recycled) S.release_claim(names[i], owners[i])
  }
}

module.exports = { cleanup, assert_completed }
