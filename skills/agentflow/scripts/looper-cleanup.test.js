'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const G = require('./looper-integration')
const S = require('./looper-state')
const C = require('./looper-cleanup')
const git = (cwd, ...args) => G.git(cwd, args)
function fixture() {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-cleanup-test-')))
  const repo = path.join(home, 'repo'), root = path.join(home, 'run'), trash_root = path.join(home, 'Trash')
  for (const dir of [repo, root, trash_root]) fs.mkdirSync(dir)
  git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.name', 'Test'); git(repo, 'config', 'user.email', 'test@localhost')
  fs.writeFileSync(path.join(repo, '.gitignore'), '.wts/\n.aglite-records/\n')
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'base')
  const base = G.head(repo), branch = 'aglite-test-G1', worktree = path.join(repo, '.wts', branch)
  git(repo, 'worktree', 'add', '-b', branch, worktree)
  fs.writeFileSync(path.join(worktree, 'output.txt'), 'retained product\n')
  git(worktree, 'add', '.'); git(worktree, 'commit', '-m', 'task')
  const candidate = G.head(worktree)
  const merge_branch = `aglite-merge-test-G1-${crypto.randomUUID()}`, merge_tree = path.join(repo, '.wts', merge_branch)
  git(repo, 'worktree', 'add', '-b', merge_branch, merge_tree, base)
  git(merge_tree, 'merge', '--no-ff', branch, '-m', 'integrate')
  const result = G.head(merge_tree); git(repo, 'merge', '--ff-only', result)
  fs.mkdirSync(path.join(worktree, '.aglite-records')); fs.writeFileSync(path.join(worktree, '.aglite-records/devlog.md'), 'history bytes\n')
  fs.writeFileSync(path.join(root, 'request.md'), 'Implement product.'); fs.writeFileSync(path.join(root, 'group-001.md'), '## T1\n\nImplement product.\n')
  fs.mkdirSync(path.join(root, 'inputs')); const input_file = path.join(root, 'inputs/G1-T1.md'); fs.writeFileSync(input_file, 'snapshot')
  fs.mkdirSync(path.join(root, 'evidence')); fs.writeFileSync(path.join(root, 'evidence/run-report.txt'), 'report bytes')
  fs.mkdirSync(path.join(root, 'attempts')); fs.mkdirSync(path.join(root, 'attempts/foreign')); fs.writeFileSync(path.join(root, 'attempts/foreign/file'), 'foreign')
  const q = { schema_version: 2, run_id: 'test', repo, target_branch: 'main', base_commit: base, expected_head: result, phase: 'complete', authorization: { execute: true, worktrees: true, local_commits: true }, request: 'request.md', request_sha256: crypto.createHash('sha256').update('Implement product.').digest('hex'), checks: { product: { command: ['true'] } }, integration_checks: ['product'], ready: [], processes: [], groups: [{ id: 'G1', file: 'group-001.md', state: 'done', candidate, workspace: { branch, worktree, base }, integration: { id: merge_branch, group_id: 'G1', branch: merge_branch, worktree: merge_tree, base, candidate, result, phase: 'landing', checks: [{ id: 'product', passed: true }] }, tasks: [{ id: 'T1', allowed_paths: ['output.txt'], checks: ['product'], checks_result: [{ id: 'product', passed: true }], state: 'done', result: { outcome: 'pass' }, candidate, input_file }] }] }
  const write = () => S.write_json(path.join(root, 'queue.json'), q); write()
  const options = { trash_root, trash: async (bundle, { destination }) => fs.renameSync(bundle, destination) }
  return { home, repo, root, q, options, write, worktree }
}
test('settled resumed integration history is not mistaken for active work or recycled twice', async () => {
  const f = fixture()
  f.q.groups[0].suspended_integration = structuredClone(f.q.groups[0].integration)
  f.write()
  const q = await C.cleanup(f.root, f.options)
  assert.equal(q.cleanup.state, 'complete')
  assert.equal(q.cleanup.items.filter(item => item.kind === 'worktree').length, 2)
})
test('completed cleanup retains only queue/request/plans and recoverable products/refs/history; repeat is inert', async () => {
  const f = fixture(), refs = git(f.repo, 'show-ref')
  const saved = require('./looper-report').save_report(f.root, f.q, { code: 0, locale: 'en-us' })
  assert.ok(saved.latest)
  const report_bytes = fs.readFileSync(saved.latest)
  const q = await C.cleanup(f.root, f.options)
  assert.equal(q.phase, 'complete'); assert.equal(q.cleanup.state, 'complete')
  assert.equal(fs.readFileSync(require('./looper-report').record_path(q, q.cleanup.records[0].source) + '/devlog.md', 'utf8'), 'history bytes\n')
  assert.equal(fs.readFileSync(path.join(f.repo, 'output.txt'), 'utf8'), 'retained product\n')
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  assert.ok(fs.existsSync(q.cleanup.claim_release.destination))
  assert.equal(fs.existsSync(path.join(f.root, 'attempts')), false)
  const report_item = q.cleanup.compaction.items.find(item => item.source === saved.latest)
  assert.ok(report_item)
  assert.deepEqual(fs.readFileSync(path.join(q.cleanup.compaction.trash_path, path.basename(report_item.staged))), report_bytes)
  assert.equal(git(f.repo, 'show-ref'), refs)
  assert.equal(git(f.repo, 'worktree', 'list', '--porcelain').includes(f.worktree), false)
  const again = await C.cleanup(f.root, { ...f.options, trash: () => assert.fail('replayed Trash') })
  assert.equal(again.cleanup.id, q.cleanup.id); C.assert_completed(again)
})
test('dirty, live claim, unfinished and output overlap refuse before movement', async () => {
  for (const kind of ['dirty', 'claim', 'target-claim', 'unfinished', 'overlap', 'symlink', 'marker', 'locked', 'head']) {
    const f = fixture()
    if (kind === 'dirty') fs.writeFileSync(path.join(f.worktree, 'foreign.txt'), 'keep')
    if (kind === 'claim') S.acquire_claim(path.join(f.root, '.queue.owner'), { run_id: 'test' })
    if (kind === 'target-claim') {
      const common = path.resolve(f.repo, git(f.repo, 'rev-parse', '--git-common-dir'))
      S.acquire_claim(path.join(common, `aglite-target-${crypto.createHash('sha256').update('main').digest('hex').slice(0, 20)}.owner`), { run_id: 'foreign' })
    }
    if (kind === 'marker') fs.writeFileSync(path.join(f.worktree, '.aglite-records/.devlog.md.owner'), '{}')
    if (kind === 'locked') git(f.repo, 'worktree', 'lock', f.worktree)
    if (kind === 'head') { git(f.worktree, 'commit', '--allow-empty', '-m', 'foreign') }
    if (kind === 'unfinished') { f.q.phase = 'running'; f.write() }
    if (kind === 'overlap') { f.q.groups[0].tasks[0].allowed_paths = ['inputs']; f.q.repo = f.repo; f.write(); f.q.groups[0].tasks[0].input_file = path.join(f.repo, 'inputs'); f.write() }
    if (kind === 'symlink') fs.symlinkSync(path.join(f.root, 'request.md'), path.join(f.worktree, '.aglite-records/link'))
    let calls = 0
    await assert.rejects(C.cleanup(f.root, { ...f.options, trash: () => { calls++ } }))
    assert.equal(calls, 0); assert.ok(fs.existsSync(f.worktree))
  }
})
test('provider moves then throws: exact recoverable identity permits retry without replay', async () => {
  const f = fixture()
  await assert.rejects(C.cleanup(f.root, { ...f.options, trash: async (bundle, { destination }) => { fs.renameSync(bundle, destination); throw Error('lost provider reply') } }), /lost provider reply/)
  const q = await C.cleanup(f.root, { ...f.options, trash: (bundle, details) => { assert.notEqual(bundle, S.read_json(path.join(f.root, 'queue.json')).cleanup.bundle); return f.options.trash(bundle, details) } })
  assert.equal(q.cleanup.state, 'complete')
})
test('unknown absent bundle never implies Trash success', async () => {
  const f = fixture()
  await assert.rejects(C.cleanup(f.root, { ...f.options, trash: async bundle => fs.renameSync(bundle, path.join(f.home, 'unknown')) }), /Trash outcome unknown/)
  await assert.rejects(C.cleanup(f.root, f.options), /identity missing or uncertain/)
  assert.ok(git(f.repo, 'worktree', 'list', '--porcelain').includes(f.worktree))
})
test('crash after record rename reconciles exact inode and retains intent', async () => {
  const f = fixture(); let failed = false
  await assert.rejects(C.cleanup(f.root, { ...f.options, on_save: q => {
    const r = q.cleanup?.records?.[0]
    if (!failed && r?.move === 'done' && fs.existsSync(r.destination)) { failed = true; throw Error('injected record interruption') }
  }, trash: async () => { throw Error('provider pause') } }))
  const q = await C.cleanup(f.root, f.options)
  assert.equal(q.cleanup.state, 'complete')
})

test('referenced scratch and unknown run-root siblings all recycle', async () => {
  const f = fixture(), id = crypto.randomUUID()
  const attempt = path.join(f.root, 'attempts', id), check = path.join(f.root, 'evidence', `T1-${crypto.randomUUID()}`)
  fs.mkdirSync(attempt); fs.writeFileSync(path.join(attempt, 'result.json'), 'worker evidence')
  fs.mkdirSync(check); fs.writeFileSync(path.join(check, 'check.log'), 'passed')
  const question_id = crypto.randomUUID(), unrelated = path.join(f.root, 'attempts', question_id)
  fs.mkdirSync(unrelated); fs.writeFileSync(path.join(unrelated, 'foreign'), 'keep')
  f.q.questions = [{ id: question_id, answer: 'settled owner answer' }]
  f.q.groups[0].tasks[0].result.attempt_id = id
  f.q.groups[0].tasks[0].checks_result[0].log = path.join(check, 'check.log'); f.write()
  const q = await C.cleanup(f.root, f.options)
  assert.ok(q.cleanup.items.some(x => x.source === attempt))
  assert.ok(q.cleanup.items.some(x => x.source === check))
  assert.equal(fs.existsSync(attempt), false); assert.equal(fs.existsSync(check), false)
  assert.equal(fs.existsSync(path.join(f.root, 'attempts')), false)
  const item = q.cleanup.compaction.items.find(item => item.source === path.join(f.root, 'attempts'))
  assert.equal(fs.readFileSync(path.join(q.cleanup.compaction.trash_path, path.basename(item.staged), question_id, 'foreign'), 'utf8'), 'keep')
})
test('current directory and actual declared-output overlap are protected before movement', async () => {
  const f = fixture(), original = process.cwd()
  try {
    process.chdir(f.worktree)
    await assert.rejects(C.cleanup(f.root, f.options), /current/)
  } finally { process.chdir(original) }
  const root = path.join(f.repo, 'deliverable')
  fs.renameSync(f.root, root)
  f.q.groups[0].tasks[0].allowed_paths = ['deliverable']
  f.q.groups[0].tasks[0].input_file = path.join(root, 'inputs/G1-T1.md')
  S.write_json(path.join(root, 'queue.json'), f.q)
  await assert.rejects(C.cleanup(root, f.options), /overlaps declared output/)
  assert.ok(fs.existsSync(f.worktree))
})
test('ordinary ignored symlinks move without traversal; records links remain refused', async () => {
  const f = fixture()
  fs.appendFileSync(path.join(f.repo, '.git/info/exclude'), '\n/node_modules/\n')
  fs.mkdirSync(path.join(f.worktree, 'node_modules'))
  fs.symlinkSync(f.home, path.join(f.worktree, 'node_modules/foreign-target'))
  const q = await C.cleanup(f.root, f.options)
  assert.equal(q.cleanup.state, 'complete'); assert.ok(fs.existsSync(f.home))
})

test('cleaned repeat run requires neither settings nor removed worktrees; partial cleanup refuses run', async () => {
  const L = require('./looper'), f = fixture()
  const q = await C.cleanup(f.root, f.options)
  fs.mkdirSync(path.join(f.repo, '.agentflow'))
  fs.writeFileSync(path.join(f.repo, '.agentflow/ag.json'), 'invalid worker settings')
  assert.equal(await L.run(f.root, { agent: () => assert.fail('task redispatched') }), 0)
  q.cleanup.state = 'failed'; S.write_json(path.join(f.root, 'queue.json'), q)
  await assert.rejects(L.run(f.root, { agent: () => assert.fail('task redispatched') }), /cleanup/i)
})
test('destination without saved rename intent refuses; saved partial rename reconciles', async () => {
  for (const saved_intent of [false, true]) {
    const f = fixture(); let injected = false
    await assert.rejects(C.cleanup(f.root, { ...f.options, on_save: q => {
      const r = q.cleanup?.items?.find(x => x.records)?.records
      if (!injected && r && (saved_intent ? r.move === 'intent' : !r.move)) {
        injected = true; fs.mkdirSync(path.dirname(r.destination), { recursive: true }); fs.renameSync(r.source, r.destination)
        if (saved_intent) throw Error('crash after rename with intent')
      }
    } }), saved_intent ? /crash after rename/ : /lacks saved intent/)
    if (saved_intent) {
      const q = await C.cleanup(f.root, f.options)
      assert.equal(q.cleanup.state, 'complete')
      const record = q.cleanup.items.find(item => item.records).records
      assert.equal(q.cleanup.records[0].move, 'done')
      const status = require('./looper').status(f.root)
      assert.ok(status.includes(`records ${require('./looper-report').record_path(q, record.source)}`))
      assert.ok(status.includes(`Retained task records G1: ${require('./looper-report').record_path(q, record.source)}`))
      assert.equal(status.includes(record.source), false)
    }
    else await assert.rejects(C.cleanup(f.root, f.options), /lacks saved intent/)
  }
})
test('changed branch after Trash proof blocks exact unregistration', async () => {
  const f = fixture(), branch = f.q.groups[0].workspace.branch
  await assert.rejects(C.cleanup(f.root, { ...f.options, trash: async (bundle, { destination }) => {
    fs.renameSync(bundle, destination); git(f.repo, 'update-ref', `refs/heads/${branch}`, f.q.base_commit)
  } }), /ref changed before unregistration/)
  assert.ok(git(f.repo, 'worktree', 'list', '--porcelain').includes(f.worktree))
})
test('changed claim during provider settlement is never overwritten', async () => {
  const f = fixture(), claim_file = path.join(f.root, '.queue.owner')
  let foreign
  await assert.rejects(C.cleanup(f.root, { ...f.options, trash: async (bundle, { destination }) => {
    fs.renameSync(bundle, destination)
    foreign = { ...S.read_json(claim_file), token: crypto.randomUUID(), children: [{ foreign: true }] }
    S.write_json(claim_file, foreign)
  } }), /Foreign or changed claim/)
  assert.deepEqual(S.read_json(claim_file), foreign)
})
test('a refused live claim cannot write an existing cleanup journal', async () => {
  const f = fixture()
  await assert.rejects(C.cleanup(f.root, { ...f.options, trash: async () => { throw Error('provider paused') } }))
  S.acquire_claim(path.join(f.root, '.queue.owner'), { run_id: 'test' })
  const before = fs.readFileSync(path.join(f.root, 'queue.json'))
  await assert.rejects(C.cleanup(f.root, f.options), /Takeover refused/)
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'queue.json')), before)
})
test('recovered stopped Trash process is saved as settled on a completed repeat', async () => {
  const f = fixture(), q = await C.cleanup(f.root, f.options)
  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},500)'])
  const started_at = S.process_identity(child.pid)
  assert.ok(started_at)
  await new Promise(resolve => child.once('exit', resolve))
  q.processes.push({ pid: child.pid, started_at, kind: 'cleanup' })
  S.write_json(path.join(f.root, 'queue.json'), q)
  const after = await C.cleanup(f.root, f.options)
  assert.ok(after.processes.at(-1).ended_at)
  assert.ok(S.read_json(path.join(f.root, 'queue.json')).processes.at(-1).ended_at)
  assert.doesNotMatch(require('./looper').status(f.root), /Writer\/claim settlement may need reconciliation/)
})

test('run-root sweep includes metadata, empty dirs, inbox, released claims and later additions', async () => {
  const f = fixture()
  for (const name of ['empty', 'inbox']) fs.mkdirSync(path.join(f.root, name))
  for (const name of ['.DS_Store', '.queue.owner.released-old', 'note.txt', 'queue.json.tmp-old']) fs.writeFileSync(path.join(f.root, name), 'history')
  let q = await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  const snapshot = fs.readFileSync(path.join(f.root, 'queue.json'))
  const status = require('./looper').status(f.root)
  assert.match(status, /Tasks 1\/1/)
  assert.match(status, /Run history recycled/)
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'queue.json')), snapshot)
  fs.writeFileSync(path.join(f.root, 'late.txt'), 'late')
  q = await C.cleanup(f.root, f.options)
  assert.equal(q.cleanup.compaction_history.length, 1)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
})

test('safe nested request/group filenames retain only their necessary parents', async () => {
  const f = fixture()
  fs.mkdirSync(path.join(f.root, 'plans'))
  for (const [old, renamed] of [['request.md', 'plans/owner.txt']]) fs.renameSync(path.join(f.root, old), path.join(f.root, renamed))
  f.q.request = 'plans/owner.txt'; f.write()
  fs.writeFileSync(path.join(f.root, 'plans/extra.txt'), 'recycle')
  await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'plans', 'queue.json'])
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'plans')).sort(), ['owner.txt'])
  assert.match(require('./looper').status(f.root), /Tasks 1\/1/)
})

test('compaction retries staged rename and provider lost reply without replaying the same bundle', async () => {
  for (const kind of ['rename', 'provider']) {
    const f = fixture(); let once = false; const moved = new Set()
    const trash = async (bundle, details) => {
      assert.equal(moved.has(bundle), false); moved.add(bundle)
      await f.options.trash(bundle, details)
      if (kind === 'provider' && path.basename(bundle).startsWith('compact-') && !once) { once = true; throw Error('compaction lost reply') }
    }
    await assert.rejects(C.cleanup(f.root, { ...f.options, trash, on_save: q => {
      if (kind === 'rename' && !once && q.cleanup?.compaction?.items.some(item => item.move === 'done')) { once = true; throw Error('compaction rename interruption') }
    } }), /compaction/)
    const q = await C.cleanup(f.root, { ...f.options, trash })
    assert.equal(q.cleanup.state, 'complete')
    assert.equal(q.cleanup.error, undefined)
    assert.doesNotMatch(require('./looper').status(f.root), /Cleanup blocker:/)
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  }
})

test('old completed cleanup is upgraded without requiring old worktrees', async () => {
  const f = fixture()
  await assert.rejects(C.cleanup(f.root, { ...f.options, on_save: q => {
    if (q.cleanup?.worktrees_complete && !q.cleanup.compaction) throw Error('old phase complete')
  } }), /old phase complete/)
  const q = S.read_json(path.join(f.root, 'queue.json'))
  delete q.cleanup.worktrees_complete; q.cleanup.state = 'complete'
  S.write_json(path.join(f.root, 'queue.json'), q)
  await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
})

test('run-root active markers, nested repositories, symlinks and outputs refuse before sweeping history', async () => {
  for (const kind of ['marker', 'checkout', 'symlink', 'output', 'cwd']) {
    const f = fixture(), extra = path.join(f.root, 'notes')
    fs.mkdirSync(extra); fs.writeFileSync(path.join(extra, 'history'), 'keep')
    if (kind === 'marker') fs.writeFileSync(path.join(extra, '.notes.md.owner'), '{}')
    if (kind === 'checkout') fs.writeFileSync(path.join(extra, '.git'), 'gitdir: somewhere')
    if (kind === 'symlink') fs.symlinkSync(f.repo, path.join(extra, 'link'))
    if (kind === 'output') { f.q.groups[0].tasks[0].allowed_paths.push(path.relative(f.repo, extra)); f.write() }
    const cwd = process.cwd()
    try {
      if (kind === 'cwd') process.chdir(extra)
      await assert.rejects(C.cleanup(f.root, f.options))
      assert.equal(fs.readFileSync(path.join(extra, 'history'), 'utf8'), 'keep')
      assert.ok(fs.existsSync(f.worktree))
      assert.equal(S.read_json(path.join(f.root, 'queue.json')).cleanup, undefined)
      assert.ok(fs.existsSync(path.join(f.root, 'evidence/run-report.txt')))
    } finally { process.chdir(cwd) }
  }
})

test('native macOS Trash leaves only retained files after manual cleanup and both repeat CLI forms', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(), { main } = require('./agf'), L = require('./looper')
  const options = { trash_root: path.join(os.homedir(), '.Trash') }
  const io = { stdout: { write() {} }, stderr: { write() {} }, cleanup: root => C.cleanup(root, options),
    read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }) }
  assert.equal(await main(['looper', 'run', f.root, '--cleanup'], { ...io, run: async (_, { on_save }) => { on_save(f.q); return 0 } }), 0)
  const q = L.load(f.root)
  assert.ok(fs.existsSync(q.cleanup.trash_path)); assert.ok(fs.existsSync(q.cleanup.compaction.trash_path))
  assert.ok(fs.existsSync(q.cleanup.claim_release.destination))
  for (const args of [['looper', 'run', f.root], ['looper', 'run', f.root, '--cleanup'], ['looper', 'cleanup', f.root], ['looper', 'status', f.root]]) {
    assert.equal(await main(args, io), 0)
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  }
})


test('four-group cleanup retains exactly six files', async () => {
  const f = fixture()
  for (let n = 2; n <= 4; n++) {
    const g = structuredClone(f.q.groups[0]); g.id = `G${n}`; g.file = `group-00${n}.md`; g.tasks[0].id = `T${n}`; delete g.tasks[0].input_file
    g.workspace.branch = `aglite-test-${g.id}`; g.workspace.worktree = path.join(f.repo, '.wts', g.workspace.branch)
    git(f.repo, 'worktree', 'add', '-b', g.workspace.branch, g.workspace.worktree, g.candidate)
    g.integration.branch = `aglite-merge-test-${g.id}-${crypto.randomUUID()}`; g.integration.worktree = path.join(f.repo, '.wts', g.integration.branch)
    git(f.repo, 'worktree', 'add', '-b', g.integration.branch, g.integration.worktree, g.integration.result)
    fs.writeFileSync(path.join(f.root, g.file), `## T${n}\n\nImplement product.\n`); f.q.groups.push(g)
  }
  f.write()
  await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'group-002.md', 'group-003.md', 'group-004.md', 'queue.json', 'request.md'])
  assert.match(require('./looper').status(f.root), /Tasks 4\/4/)
})

test('interrupted final claim intent converges; unknown compaction Trash outcome stays blocked', async () => {
  const f = fixture(); let failed = false
  await assert.rejects(C.cleanup(f.root, { ...f.options, on_save: q => {
    if (!failed && q.cleanup?.claim_release) { failed = true; throw Error('claim release interrupted') }
  } }), /claim release interrupted/)
  await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  const other = fixture()
  await assert.rejects(C.cleanup(other.root, { ...other.options, trash: async (bundle, details) => {
    if (path.basename(bundle).startsWith('compact-')) fs.renameSync(bundle, path.join(other.home, 'unknown-compaction'))
    else await other.options.trash(bundle, details)
  } }), /Compaction Trash outcome unknown/)
  await assert.rejects(C.cleanup(other.root, other.options), /Compaction staging identity missing or uncertain/)
  assert.equal(S.read_json(path.join(other.root, 'queue.json')).cleanup.state, 'failed')
})

test('late final-save files and recreated completed staging refuse a false clean result', async () => {
  const f = fixture(); let added = false
  await assert.rejects(C.cleanup(f.root, { ...f.options, on_save: q => {
    if (!added && q.cleanup?.claim_release) { added = true; fs.writeFileSync(path.join(f.root, 'late-note.txt'), 'keep until retry') }
  } }), /New run-root entries appeared before claim release/)
  await C.cleanup(f.root, f.options)
  assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  const q = S.read_json(path.join(f.root, 'queue.json'))
  fs.mkdirSync(q.cleanup.compaction.bundle)
  await assert.rejects(C.cleanup(f.root, f.options), /Completed compaction staging bundle reappeared/)
  assert.ok(fs.existsSync(q.cleanup.compaction.bundle))
})


test('a retained request cannot hide a nested Git directory from preflight', async () => {
  const f = fixture()
  fs.mkdirSync(path.join(f.root, '.git')); fs.renameSync(path.join(f.root, 'request.md'), path.join(f.root, '.git/request.md'))
  f.q.request = '.git/request.md'; f.write()
  await assert.rejects(C.cleanup(f.root, f.options), /Unsafe retained parent directory/)
  assert.ok(fs.existsSync(f.worktree))
  assert.equal(fs.readFileSync(path.join(f.root, '.git/request.md'), 'utf8'), 'Implement product.')
})

test('failed repeat preflight preserves completed state and prior claim retirement history', async () => {
  for (const kind of ['trash', 'marker', 'journal']) {
    const f = fixture(); const first = await C.cleanup(f.root, f.options)
    const saved = structuredClone(first.cleanup)
    if (kind === 'marker') fs.writeFileSync(path.join(f.root, '.notes.owner'), '{}')
    let refused = false
    if (kind === 'journal') fs.writeFileSync(path.join(f.root, 'new-note.txt'), 'not moved')
    const options = kind === 'trash' ? { ...f.options, trash_root: path.join(f.home, 'absent-Trash') } : kind === 'journal' ? { ...f.options, on_save: q => {
      if (!refused && q.cleanup.compaction.id !== saved.compaction.id) { refused = true; throw Error('before movement') }
    } } : f.options
    await assert.rejects(C.cleanup(f.root, options))
    assert.deepEqual(S.read_json(path.join(f.root, 'queue.json')).cleanup, saved)
    assert.equal(await require('./looper').run(f.root), 0)
    if (kind !== 'marker') {
      const again = await C.cleanup(f.root, f.options)
      assert.ok(again.cleanup.claim_release_history.some(item => item.destination === saved.claim_release.destination))
      assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
    }
  }
})

test('case-mismatched retained request refuses before movement on case-insensitive filesystems', async t => {
  const f = fixture()
  if (!fs.existsSync(path.join(f.root, 'Request.md'))) { t.skip('requires case-insensitive filesystem'); return }
  f.q.request = 'Request.md'; f.write()
  await assert.rejects(C.cleanup(f.root, f.options), /Retained path spelling mismatch/)
  assert.equal(S.read_json(path.join(f.root, 'queue.json')).cleanup, undefined)
  assert.ok(fs.existsSync(f.worktree))
  assert.equal(fs.readFileSync(path.join(f.root, 'request.md'), 'utf8'), 'Implement product.')
})

test('native Trash failure retries with a unique exclusive diagnostic log', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture(), A = require('./looper-agent'), original = A.execute
  let failed = false; const logs = []
  A.execute = async ({ command, log }) => {
    const fd = fs.openSync(log, 'wx'); fs.closeSync(fd); logs.push(log)
    if (path.basename(command[1]).startsWith('compact-') && !failed) { failed = true; return { exit_code: 1 } }
    fs.renameSync(command[1], path.join(f.options.trash_root, path.basename(command[1])))
    return { exit_code: 0 }
  }
  try {
    await assert.rejects(C.cleanup(f.root, { trash_root: f.options.trash_root }), /Compaction Trash process failed/)
    await C.cleanup(f.root, { trash_root: f.options.trash_root })
    assert.equal(new Set(logs).size, logs.length)
    assert.deepEqual(fs.readdirSync(f.root).sort(), ['group-001.md', 'queue.json', 'request.md'])
  } finally { A.execute = original }
})
