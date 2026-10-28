'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const current_schema = require('../assets/.agentflow/ag.json')['schema-version']
const crypto = require('node:crypto')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const L = require('./looper')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const read = root => JSON.parse(fs.readFileSync(path.join(root, 'queue.json')))
const write = (root, q) => fs.writeFileSync(path.join(root, 'queue.json'), JSON.stringify(q))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const selection = { kind: 'cli', provider: 'codex', model: 'gpt-6.1-sol', effort: 'low' }

// Fake ordinary task hosts render their own notebook before acting.
const real_run = L.run
L.run = async (root, options = {}) => {
  if (!options.agent) return real_run(root, options)
  const delegate = options.agent
  return real_run(root, { ...options, agent: async args => {
    if (args.role === 'task') render_notebook(args.cwd)
    return delegate(args)
  } })
}
function render_notebook(cwd) {
  const file = path.join(cwd, '.aglite-records/devlog.md')
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# STATUS\n\n# → Ask / A-001\n')
}

test('Codex CLI network inheritance preserves parent blocks and read-only scope', async () => {
  const { launch_agent } = require('./looper-agent')
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-network-test-')))
  const original = process.env.CODEX_SANDBOX_NETWORK_DISABLED
  try {
    for (const [role, blocked, network] of [
      ['task', undefined, true], ['task', '1', false],
      ['repair', undefined, true], ['review', undefined, false],
      ['repair', '1', false], ['review', '1', false]
    ]) {
      if (blocked === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED
      else process.env.CODEX_SANDBOX_NETWORK_DISABLED = blocked
      const attempt = { id: crypto.randomUUID() }
      const attempt_dir = path.join(home, attempt.id)
      // Node deliberately rejects Codex's argv; no provider call or credentials are needed.
      await assert.rejects(launch_agent({ selection: { ...selection, executable: process.execPath },
        role, cwd: home, prompt: 'Check only the assigned outcome.', attempt, attempt_dir }), /Worker failed/)
      const { command } = JSON.parse(fs.readFileSync(path.join(attempt_dir, 'launch.json')))
      assert.equal(command.includes('sandbox_workspace_write.network_access=true'), network)
      assert.ok(command.includes(`web_search=${JSON.stringify(blocked === '1' ? 'disabled' : 'live')}`))
      assert.equal(command[command.indexOf('-s') + 1], role === 'review' ? 'read-only' : 'workspace-write')
      assert.equal(command.some(arg => arg.startsWith('--dangerously-')), false)
    }
  } finally {
    if (original === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED
    else process.env.CODEX_SANDBOX_NETWORK_DISABLED = original
  }
})

function symlink_or_skip(t, ...args) {
  try { fs.symlinkSync(...args); return true }
  catch (error) {
    if (process.platform !== 'win32' || error.code !== 'EPERM' || args[2] === 'junction') throw error
    t.skip('Windows symlink privilege unavailable (EPERM); link refusal remains unproved on this machine')
    return false
  }
}

function fixture(groups, options = {}) {
  // Keep failed fixtures for inspection; do not destructively clean worker worktrees.
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-loop-test-')))
  const repo = path.join(home, 'repo'), root = path.join(home, 'planned')
  fs.mkdirSync(repo); fs.mkdirSync(root)
  git(repo, 'init', '-b', 'main')
  git(repo, 'config', 'user.name', 'Looper test')
  git(repo, 'config', 'user.email', 'test@localhost')
  fs.writeFileSync(path.join(repo, '.gitignore'), '.wts/\n')
  fs.writeFileSync(path.join(repo, 'owner.txt'), 'owner baseline\n')
  fs.writeFileSync(path.join(repo, 'shared.txt'), 'baseline\n')
  const { task = selection, repair, acceptance, max_workers = 2, max_repairs = 2, ...queue_options } = options
  const config = { 'schema-version': current_schema, switches: { 'saving-mode': 'off' }, 'pipeline-roles': { implementation: 'basic', acceptance: 'better' }, 'model-family': {}, 'looper-routes': {}, 'looper-limits': { 'max-workers': max_workers, 'max-repairs': max_repairs } }
  for (const [role, value] of Object.entries({ task, repair, acceptance })) if (value) {
    config['looper-routes'][role] = { kind: value.kind, provider: value.provider, 'model-family': role }
    if (value.executable) config['looper-routes'][role].executable = value.executable
    config['model-family'][role] = { [role === 'acceptance' ? 'better' : 'basic']: `${value.model}/${value.effort}` }
  }
  fs.mkdirSync(path.join(repo, '.agentflow'))
  fs.writeFileSync(path.join(repo, '.agentflow/ag.json'), JSON.stringify(config))
  git(repo, 'add', '.gitignore', 'owner.txt', 'shared.txt', '.agentflow/ag.json'); git(repo, 'commit', '-m', 'baseline')
  const q = { schema_version: 2, run_id: 'fixture', repo, target_branch: 'main', base_commit: git(repo, 'rev-parse', 'HEAD'), request: 'request.md', request_sha256: crypto.createHash('sha256').update('Implement every registered task while preserving owner content.').digest('hex'), authorization: { execute: true, worktrees: true, local_commits: true }, checks: { product: { command: [process.execPath, '-e', 'process.exit(0)'] } }, integration_checks: ['product'], groups: groups.map((tasks, i) => ({ id: `G${i + 1}`, file: `group-${String(i + 1).padStart(3, '0')}.md`, tasks: tasks.map((file, j) => ({ id: `T${i + 1}-${j + 1}`, allowed_paths: [file], checks: ['product'] })) })), ...queue_options }
  for (const group of q.groups) fs.writeFileSync(path.join(root, group.file), group.tasks.map(t => `## ${t.id}\n\nWrite ${t.allowed_paths[0]}.\n`).join('\n'))
  fs.writeFileSync(path.join(root, 'request.md'), 'Implement every registered task while preserving owner content.')
  write(root, q)
  return { root, repo, q }
}
const result = (attempt, outcome = 'pass') => ({ attempt_id: attempt.id, outcome, summary: outcome === 'pass' ? 'Completed assigned work.' : 'Which value should be used?', evidence: [] })
function closeout(cwd) {
  const file = path.join(cwd, '.aglite-records/devlog.md')
  render_notebook(cwd)
  const source = fs.readFileSync(file, 'utf8')
  const n = Math.max(0, ...[...source.matchAll(/^# → Reply \/ A-(\d+)$/gm)].map(m => Number(m[1]))) + 1
  const id = n => String(n).padStart(3, '0')
  fs.appendFileSync(file, `\n# → Reply / A-${id(n)}\n\nAssigned task completed.\n\n# → Ask / A-${id(n + 1)}\n`)
}
function task_edit({ cwd, prompt }) {
  const match = prompt.match(/Group (\S+), task (\S+); edit only (\[[^\n]+\])\./)
  assert.ok(match, 'ordinary assignment declares exact editable paths')
  const files = JSON.parse(match[3])
  for (const file of files) fs.writeFileSync(path.join(cwd, file), `${match[1]}/${match[2]}\n`)
  closeout(cwd)
  return match[2]
}
const agent = async args => { fs.mkdirSync(args.attempt_dir, { recursive: true }); task_edit(args); return result(args.attempt) }
const checks = async ({ ids }) => ids.map(id => ({ id, passed: true }))

function submit_ordinary_review(args, change = value => value) {
  const files = JSON.parse(args.prompt.match(/edit only (\[[^\n]+\])\./)[1])
  const directory = path.join(args.cwd, '.aglite-records/ordinary-review', args.attempt.id)
  fs.mkdirSync(directory, { recursive: true })
  const request = change({ version: 1, task_attempt_id: args.attempt.id, request_id: crypto.randomUUID(),
    source: { head: git(args.cwd, 'rev-parse', 'HEAD'), files: Object.fromEntries(files.map(file => {
      const absolute = path.join(args.cwd, file)
      return [file, fs.existsSync(absolute) ? crypto.createHash('sha256').update(fs.readFileSync(absolute)).digest('hex') : null]
    })) }, context: 'Review original outcome and INV-1 against actual source; checks passed; report missing proof.' })
  const bytes = JSON.stringify(request)
  fs.writeFileSync(path.join(directory, 'request.tmp'), bytes)
  fs.renameSync(path.join(directory, 'request.tmp'), path.join(directory, 'request.json'))
  return { directory, request, digest: crypto.createHash('sha256').update(bytes).digest('hex') }
}
async function relay_response(directory, request_id) {
  const file = path.join(directory, 'response.json')
  const deadline = Date.now() + 10000
  while (true) {
    if (fs.existsSync(file)) {
      const response = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!request_id || response.request_id === request_id) return response
    }
    assert.ok(Date.now() < deadline, 'ordinary reviewer response arrived')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

test('ordinary review relay preserves configured fresh CLI selection and task closeout', { timeout: 30000 }, async () => {
  const acceptance = { ...selection, effort: 'high' }
  const { root, repo } = fixture([['a.txt']], { acceptance })
  let reviews = 0, task_id, response
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    if (args.role === 'review') {
      reviews++
      assert.notEqual(args.attempt.id, task_id)
      assert.equal(args.selection.kind, 'cli')
      assert.equal(args.selection.provider, acceptance.provider)
      assert.equal(args.selection.model, acceptance.model)
      assert.equal(args.selection.effort, 'high')
      assert.match(args.prompt, /Original authorized request \(context only; execute the selected task\): Implement every registered task/)
      assert.equal(args.prompt.split('Changed contract inputs at workspace base').length - 1, 1)
      assert.match(args.prompt, /commands that do not require shell temporary files/)
      assert.match(args.prompt, /INV-1/)
      assert.match(args.prompt, /Read only; launch no agents/)
      return { ...result(args.attempt), evidence: ['INV-1: pass; inspected a.txt.'] }
    }
    task_id = args.attempt.id
    assert.match(args.prompt, /optional discovery inputs, test existence quietly/)
    assert.equal(args.selection.effort, 'low')
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'ordinary product\n')
    const submitted = submit_ordinary_review(args)
    response = await relay_response(submitted.directory)
    assert.equal(response.request_sha256, submitted.digest)
    assert.equal(response.task_attempt_id, args.attempt.id)
    assert.equal(response.request_id, submitted.request.request_id)
    assert.deepEqual(response.source, submitted.request.source)
    assert.equal(response.result.outcome, 'pass')
    await new Promise(resolve => setTimeout(resolve, 120))
    assert.equal(reviews, 1, 'unchanged request is not dispatched twice')
    closeout(args.cwd)
    return result(args.attempt)
  } }), 0)
  assert.equal(reviews, 1)
  const saved = read(root)
  assert.equal(saved.groups[0].tasks[0].round, 1)
  assert.equal(saved.groups[0].attempt, null)
  assert.equal(saved.groups[0].tasks[0].ordinary_reviews[0].request_id, response.request_id)
  assert.equal(saved.groups[0].tasks[0].ordinary_reviews[0].attempt.selection.effort, 'high')
  const request = JSON.parse(fs.readFileSync(path.join(root, 'attempts', task_id, 'ordinary-reviews', response.request_id, 'request.json')))
  assert.equal(request.task_attempt_id, task_id)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'ordinary product\n')
  assert.equal(git(repo, 'ls-tree', '-r', '--name-only', 'HEAD').includes('ordinary-review'), false)
})

test('ordinary review relay rejects stale identity, source hashes, route injection and unsafe paths before dispatch', { timeout: 30000 }, async t => {
  for (const kind of ['stale', 'source', 'route', 'symlink']) await t.test(kind, async () => {
    const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
    let reviews = 0
    assert.equal(await L.run(root, { checks, agent: async args => {
      if (args.role !== 'task') { reviews++; return result(args.attempt) }
      const submitted = submit_ordinary_review(args, request => {
        if (kind === 'stale') request.task_attempt_id = crypto.randomUUID()
        if (kind === 'source') request.source.files['a.txt'] = '0'.repeat(64)
        if (kind === 'route') request.provider = 'claude'
        return request
      })
      if (kind === 'symlink') {
        const file = path.join(submitted.directory, 'request.json')
        fs.renameSync(file, path.join(submitted.directory, 'original.json'))
        if (!symlink_or_skip(t, 'original.json', file)) return result(args.attempt, 'blocked')
      }
      await new Promise(resolve => {
        if (args.signal.aborted) resolve()
        else args.signal.addEventListener('abort', resolve, { once: true })
      })
      return result(args.attempt, 'blocked')
    } }), 2)
    assert.equal(reviews, 0)
    assert.match(read(root).questions[0].question, /Malformed or stale|source identity|Symlink/)
    assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  })
})

test('ordinary review relay blocks changed source and preserves structured blocked evidence', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
  assert.equal(await L.run(root, { checks, agent: async args => {
    if (args.role === 'review') {
      // Simulate a task changing its product while its reviewer is inspecting it.
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'moved source\n')
      return result(args.attempt)
    }
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'original source\n')
    const submitted = submit_ordinary_review(args)
    const response = await relay_response(submitted.directory)
    assert.equal(response.result.outcome, 'blocked')
    assert.match(response.result.summary, /source changed during review/)
    return { ...result(args.attempt, 'blocked'), summary: response.result.summary, evidence: [response.evidence_dir] }
  } }), 2)
  const saved = read(root)
  const attempt = saved.groups[0].attempt
  assert.equal(attempt.ordinary_reviews[0].state, 'blocked')
  assert.equal(attempt.result.outcome, 'blocked')
  assert.deepEqual(saved.questions[0].evidence, attempt.result.evidence)
  assert.equal(saved.questions[0].attempt_dir, path.join(root, 'attempts', attempt.id))
  assert.equal(saved.groups[0].tasks[0].candidate, undefined)
})

test('ordinary review sibling process settles before task slot and claims release', { timeout: 30000 }, async () => {
  const { execute } = require('./looper-agent')
  const S = require('./looper-state')
  const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
  const launched = deferred()
  let identity, observation
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    if (args.role === 'review') {
      observation = await execute({ command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'], cwd: args.cwd,
        log: path.join(args.attempt_dir, 'review-process.log'), signal: args.signal,
        on_launch: async proc => { identity = proc; await args.on_launch(proc); launched.resolve() },
        on_descendant: args.on_descendant })
      return result(args.attempt)
    }
    submit_ordinary_review(args)
    await launched.promise
    assert.ok(read(root).processes.some(proc => proc.pid === identity.pid))
    closeout(args.cwd)
    return result(args.attempt) // Exiting with an outstanding request cancels its sibling.
  } }), 2)
  assert.equal(observation.aborted, true)
  assert.equal(S.writer_stopped(identity), true)
  const saved = read(root)
  assert.equal(saved.groups[0].attempt.ordinary_reviews[0].state, 'cancelled')
  assert.match(saved.questions[0].question, /before ordinary review settled/)
  assert.deepEqual(saved.processes, [])
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
})

test('ordinary review pass requires latest successful verdict and unchanged source at return and resume', { timeout: 30000 }, async t => {
  for (const kind of ['after-verdict', 'repair-verdict', 'saved-pass', 'pending-import']) await t.test(kind, async () => {
    const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
    let cwd
    assert.equal(await L.run(root, { checks, agent: async args => {
      fs.mkdirSync(args.attempt_dir, { recursive: true })
      if (args.role === 'review') return result(args.attempt, kind === 'repair-verdict' ? 'repair' : 'pass')
      cwd = args.cwd
      fs.writeFileSync(path.join(cwd, 'a.txt'), 'reviewed product\n')
      const submitted = submit_ordinary_review(args)
      await relay_response(submitted.directory)
      closeout(cwd)
      if (kind === 'after-verdict') fs.writeFileSync(path.join(cwd, 'a.txt'), 'unreviewed product\n')
      if (kind === 'saved-pass' || kind === 'pending-import') {
        fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), JSON.stringify(result(args.attempt)))
        fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0 }))
        return result(args.attempt, 'blocked')
      }
      return result(args.attempt)
    } }), 2)
    if (kind === 'saved-pass' || kind === 'pending-import') {
      if (kind === 'saved-pass') fs.writeFileSync(path.join(cwd, 'a.txt'), 'changed after process stopped\n')
      else {
        const interrupted = read(root)
        interrupted.groups[0].attempt.ordinary_reviews[0].state = 'pending'
        write(root, interrupted) // Simulate a crash before the parent persisted review completion.
      }
      fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
      fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: read(root).questions[0].id, answer: 'Continue preserved task.', source: 'host' }]))
      assert.equal(await L.run(root, { checks, agent: () => { throw Error('Unexpected replacement worker') } }), 2)
    }
    const saved = read(root)
    assert.match(saved.questions.filter(item => !item.answer).at(-1).question,
      /changed after its latest successful|lacks a successful latest|unsettled ordinary review/)
    assert.equal(saved.groups[0].tasks[0].candidate, undefined)
  })
})

test('ordinary review repair findings return to task before a fresh review of corrected bytes', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
  const reviewers = []
  assert.equal(await L.run(root, { checks, agent: async args => {
    if (args.role === 'review') {
      reviewers.push(args.attempt.id)
      assert.equal(fs.readFileSync(path.join(args.cwd, 'a.txt'), 'utf8'), reviewers.length === 1 ? 'defect\n' : 'corrected\n')
      return result(args.attempt, reviewers.length === 1 ? 'repair' : 'pass')
    }
    for (const [content, outcome] of [['defect\n', 'repair'], ['corrected\n', 'pass']]) {
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), content)
      const submitted = submit_ordinary_review(args)
      const response = await relay_response(submitted.directory, submitted.request.request_id)
      assert.equal(response.result.outcome, outcome)
    }
    closeout(args.cwd)
    return result(args.attempt)
  } }), 0)
  assert.equal(reviewers.length, 2)
  assert.notEqual(reviewers[0], reviewers[1])
})

test('ordinary review supports directory scopes and rejects dirty predecessor inputs', { timeout: 30000 }, async t => {
  for (const dirty_predecessor of [false, true]) await t.test(String(dirty_predecessor), async () => {
    const { root } = fixture([['docs']], { acceptance: { ...selection, effort: 'high' } })
    let reviews = 0
    assert.equal(await L.run(root, { checks, agent: async args => {
      if (args.role === 'review') { reviews++; return result(args.attempt) }
      fs.mkdirSync(path.join(args.cwd, 'docs'))
      fs.writeFileSync(path.join(args.cwd, 'docs/a.md'), 'directory product\n')
      const submitted = submit_ordinary_review({ ...args, prompt: args.prompt.replace('edit only ["docs"].', 'edit only ["docs/a.md"].') })
      if (dirty_predecessor) {
        fs.writeFileSync(path.join(args.cwd, 'shared.txt'), 'unreviewed predecessor movement\n')
        await new Promise(resolve => args.signal.addEventListener('abort', resolve, { once: true }))
        return result(args.attempt, 'blocked')
      }
      assert.equal((await relay_response(submitted.directory)).result.outcome, 'pass')
      closeout(args.cwd)
      return result(args.attempt)
    } }), dirty_predecessor ? 2 : 0)
    assert.equal(reviews, dirty_predecessor ? 0 : 1)
    if (dirty_predecessor) assert.match(read(root).questions[0].question, /out-of-scope source change: shared.txt/)
  })
})

test('ordinary review binds commit-intent recovery before staging and after committed HEAD advancement', { timeout: 30000 }, async t => {
  for (const committed of [false, true]) for (const changed of [false, true])
    await t.test(`committed=${committed}; changed=${changed}`, async () => {
      const { root, repo } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
      let image, calls = 0
      assert.equal(await L.run(root, { checks, agent: async args => {
        if (args.role === 'review') return result(args.attempt)
        calls++
        fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'reviewed bytes\n')
        const submitted = submit_ordinary_review(args)
        await relay_response(submitted.directory, submitted.request.request_id)
        closeout(args.cwd)
        return result(args.attempt)
      }, on_save: q => {
        const group = q.groups[0], task = group.tasks[0]
        if (task.commit_intent && !image) {
          image = structuredClone(q)
          if (changed) fs.writeFileSync(path.join(group.workspace.worktree, 'a.txt'), 'unreviewed bytes\n')
          if (committed) {
            git(group.workspace.worktree, 'add', 'a.txt')
            git(group.workspace.worktree, 'commit', '-m', task.commit_intent.message)
          }
          throw Error('Injected crash at reviewed task commit intent')
        }
      } }), 2)
      assert.equal(image.groups[0].tasks[0].ordinary_reviews[0].result.outcome, 'pass')
      write(root, image)
      assert.equal(await L.run(root, { checks, agent: () => { throw Error('Recovery repeated a task worker') } }), changed ? 2 : 0)
      assert.equal(calls, 1)
      const saved = read(root)
      if (changed) {
        assert.match(saved.questions.at(-1).question, /changed after its latest successful ordinary review/)
        assert.equal(fs.existsSync(path.join(repo, 'a.txt')), false)
        assert.equal(saved.groups[0].tasks[0].candidate, undefined)
      } else {
        assert.equal(saved.groups[0].tasks[0].ordinary_reviews[0].result.outcome, 'pass')
        assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'reviewed bytes\n')
      }
    })
})

function simulate_dead_coordinator(root, repo) {
  const common = path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir'))
  const claims = [path.join(root, '.queue.owner'), ...fs.readdirSync(common)
    .filter(file => /^aglite-target-.*\.owner$/.test(file)).map(file => path.join(common, file))]
  for (const file of claims) {
    const claim = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...claim, pid: 2147483647, started_at: 'simulated-dead-coordinator' }))
  }
}
test('ordinary review native child preserves claims and slot until explicit stopped or never-dispatched import', { timeout: 30000 }, async t => {
  for (const dispatched of [false, true]) await t.test(`dispatched=${dispatched}`, async () => {
    const { spawn } = require('node:child_process')
    const { root, repo } = fixture([['a.txt'], ['b.txt']], { acceptance: { ...selection, kind: 'native', effort: 'high' }, max_workers: 1 })
    let calls = 0, native_child
    try {
      assert.equal(await L.run(root, { checks, agent: async args => {
        calls++
        assert.equal(args.role, 'task', 'native acceptance must never substitute CLI')
        assert.equal(calls, 1, 'pending native review keeps the single group slot')
        fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'product awaiting native review\n')
        submit_ordinary_review(args)
        const deadline = Date.now() + 5000
        while (!read(root).handoffs.length) {
          assert.ok(Date.now() < deadline)
          await new Promise(resolve => setTimeout(resolve, 10))
        }
        if (dispatched) {
          native_child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
          await new Promise((resolve, reject) => { native_child.once('spawn', resolve); native_child.once('error', reject) })
        }
        closeout(args.cwd)
        return result(args.attempt)
      } }), 2)
      let saved = read(root)
      const parent_id = saved.groups[0].attempt.id
      const handoff = saved.handoffs[0]
      assert.equal(handoff.parent_attempt_id, parent_id)
      assert.equal(handoff.cancel_requested, true)
      assert.equal(handoff.completed, false)
      assert.equal(saved.groups[1].workspace, undefined)
      assert.equal(fs.existsSync(path.join(root, '.queue.owner')), true)
      assert.equal(saved.groups[0].attempt.ordinary_reviews[0].state, 'pending')
      const forbidden = () => { throw Error('Replacement dispatched before native settlement') }
      simulate_dead_coordinator(root, repo)
      assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
      assert.equal(read(root).groups[0].attempt.id, parent_id)
      assert.equal(fs.existsSync(path.join(root, '.queue.owner')), true)
      fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
      const mailbox = path.join(root, 'inbox', `${handoff.id}.json`)
      fs.writeFileSync(mailbox, JSON.stringify({ ...result({ id: handoff.id }, 'blocked'), writer_stopped: false }))
      simulate_dead_coordinator(root, repo)
      assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
      assert.equal(read(root).handoffs[0].completed, false)
      assert.equal(fs.existsSync(path.join(root, '.queue.owner')), true)
      answer(root, read(root).questions.find(item => !item.answer), 'owner')
      simulate_dead_coordinator(root, repo)
      await assert.rejects(L.run(root, { checks, agent: forbidden }), /Native ordinary review settlement pending/)
      assert.equal(read(root).groups[0].attempt.id, parent_id)
      assert.equal(read(root).handoffs[0].completed, false)
      fs.writeFileSync(path.join(root, 'inbox/answers.json'), '[]')
      if (native_child) {
        const stopped = new Promise(resolve => native_child.once('close', resolve))
        native_child.kill('SIGTERM')
        await stopped
      }
      fs.writeFileSync(mailbox, JSON.stringify({ ...result({ id: handoff.id }, 'blocked'),
        summary: dispatched ? 'Host stopped the actual reviewer.' : 'Host never dispatched the reviewer.',
        ...(dispatched ? { writer_stopped: true } : { dispatched: false }) }))
      simulate_dead_coordinator(root, repo)
      assert.equal(await L.run(root, { checks, agent: async args => {
        assert.match(args.prompt, /Group G2,/, 'only unrelated work may start before the parent task receives a correction')
        return agent(args)
      } }), 2)
      saved = read(root)
      assert.equal(saved.handoffs[0].completed, true)
      assert.equal(saved.handoffs[0].not_dispatched, dispatched ? undefined : true)
      assert.equal(saved.groups[0].attempt.ordinary_reviews[0].state, 'cancelled')
      assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
      answer(root, saved.questions.find(item => !item.answer), 'owner')
      assert.equal(await L.run(root, { checks, agent }), 0, L.status(root))
      assert.equal(read(root).groups[0].tasks[0].ordinary_reviews[0].parent_attempt_id, parent_id)
    } finally {
      if (native_child && native_child.exitCode === null && native_child.signalCode === null) native_child.kill('SIGKILL')
    }
  })
})

test('ordinary review cancelled native saved pass renews only after settlement and correction, archiving its own marker', { timeout: 30000 }, async t => {
  for (const correction of ['host', 'owner']) await t.test(correction, async () => {
    const { root, repo } = fixture([['a.txt']], { acceptance: { ...selection, kind: 'native', effort: 'high' } })
    let original, marker, saved_result, calls = 0
    assert.equal(await L.run(root, { checks, agent: async args => {
      calls++; original = args.attempt.id
      fs.mkdirSync(args.attempt_dir, { recursive: true })
      marker = path.join(args.cwd, '.aglite-records/.devlog.md.owner')
      fs.writeFileSync(marker, JSON.stringify({ session: original }))
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'preserved product\n')
      submit_ordinary_review(args)
      const deadline = Date.now() + 5000
      while (!read(root).handoffs.length) {
        assert.ok(Date.now() < deadline)
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      closeout(args.cwd)
      saved_result = JSON.stringify(result(args.attempt))
      fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), saved_result)
      fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0 }))
      return result(args.attempt)
    } }), 2)
    const blocked = read(root), handoff = blocked.handoffs[0]
    const archived = path.join(root, 'attempts', original, 'notebook-owner.released.json')
    assert.equal(fs.existsSync(marker), true)
    assert.equal(fs.existsSync(archived), false)
    answer(root, blocked.questions[0], correction)
    simulate_dead_coordinator(root, repo)
    await assert.rejects(L.run(root, { checks, agent: () => { throw Error('Unsettled task repeated') } }), /Native ordinary review settlement pending/)
    assert.equal(calls, 1)
    assert.equal(fs.existsSync(marker), true)
    fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
    fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({
      ...result({ id: handoff.id }, 'blocked'), dispatched: false, summary: 'Live host never dispatched this exact reviewer.' }))
    simulate_dead_coordinator(root, repo)
    if (correction === 'owner') {
      fs.writeFileSync(marker, JSON.stringify({ session: 'foreign-marker-session' }))
      await assert.rejects(L.run(root, { checks, agent: () => { throw Error('Foreign marker was replaced') } }), /Foreign isolated notebook claim/)
      assert.equal(JSON.parse(fs.readFileSync(marker)).session, 'foreign-marker-session')
      assert.equal(fs.existsSync(archived), false)
      assert.equal(calls, 1)
      fs.writeFileSync(marker, JSON.stringify({ session: original }))
    }
    assert.equal(await L.run(root, { checks, agent: async args => {
      calls++
      assert.notEqual(args.attempt.id, original, 'saved pass must not be imported as successful work')
      assert.equal(fs.existsSync(marker), false)
      assert.equal(JSON.parse(fs.readFileSync(archived)).session, original)
      assert.equal(fs.readFileSync(path.join(args.cwd, 'a.txt'), 'utf8'), 'preserved product\n')
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'preserved product\ncorrected completion\n')
      closeout(args.cwd)
      return result(args.attempt)
    } }), 0, L.status(root))
    assert.equal(calls, 2)
    assert.equal(fs.readFileSync(path.join(root, 'attempts', original, 'result.json'), 'utf8'), saved_result)
    assert.equal(read(root).groups[0].tasks[0].ordinary_reviews[0].state, 'cancelled')
  })
})

test('ordinary review missing native handoff imports only exact truthful never-dispatched proof', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { acceptance: { ...selection, kind: 'native', effort: 'high' } })
  let image
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'preserved crash product\n')
    const submitted = submit_ordinary_review(args)
    assert.equal((await relay_response(submitted.directory)).result.outcome, 'blocked')
    return result(args.attempt, 'blocked')
  }, on_save: q => {
    if (!image && q.groups[0].attempt?.ordinary_reviews?.[0]?.attempt && !q.handoffs.length) {
      image = structuredClone(q)
      throw Error('Crash after native selection save, before assignment and handoff creation')
    }
  } }), 2)
  const parent = image.groups[0].attempt, review = parent.ordinary_reviews[0]
  assert.equal(fs.existsSync(path.join(root, 'attempts', review.attempt.id, 'assignment.md')), false)
  assert.equal(image.handoffs.length, 0)
  write(root, image)
  simulate_dead_coordinator(root, repo)
  const forbidden = () => { throw Error('Unknown native child was silently replaced') }
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), true)
  assert.equal(read(root).handoffs.length, 0)
  assert.equal(read(root).groups[0].attempt.id, parent.id)
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  const mailbox = path.join(root, 'inbox', `${review.attempt.id}.json`)
  for (const invalid of [
    { ...result({ id: crypto.randomUUID() }, 'blocked'), dispatched: false },
    { ...result(review.attempt, 'blocked'), writer_stopped: false },
    { ...result(review.attempt, 'blocked'), writer_stopped: true }
  ]) {
    fs.writeFileSync(mailbox, JSON.stringify(invalid))
    simulate_dead_coordinator(root, repo)
    assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
    assert.equal(read(root).handoffs.length, 0)
    assert.equal(fs.existsSync(path.join(root, '.queue.owner')), true)
  }
  fs.writeFileSync(mailbox, JSON.stringify({ ...result(review.attempt, 'blocked'),
    dispatched: false, summary: 'Live host verified this exact saved reviewer was never dispatched.' }))
  simulate_dead_coordinator(root, repo)
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  const settled = read(root), recovered = settled.handoffs[0]
  assert.equal(recovered.id, review.attempt.id)
  assert.equal(recovered.parent_attempt_id, parent.id)
  assert.deepEqual(recovered.selection, review.attempt.selection)
  assert.equal(recovered.completed, true)
  assert.equal(recovered.not_dispatched, true)
  assert.equal(recovered.recovered_without_dispatch, true)
  assert.equal(recovered.assignment, undefined, 'recovery must invent no dispatch evidence')
  assert.equal(settled.groups[0].attempt.ordinary_reviews[0].result.writer_stopped, undefined)
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  answer(root, settled.questions.find(item => !item.answer), 'host')
  assert.equal(await L.run(root, { checks, agent }), 0)
})

test('ordinary review cancelled CLI saved result renews only with saved process settlement and host correction', { timeout: 30000 }, async t => {
  for (const outcome of ['pass', 'blocked']) await t.test(outcome, async () => {
    const A = require('./looper-agent'), S = require('./looper-state')
    const { root } = fixture([['a.txt']], { acceptance: { ...selection, effort: 'high' } })
    const launched = deferred()
    let original, reviewer, marker, saved_result, calls = 0
    assert.equal(await L.run(root, { checks, agent: async args => {
      fs.mkdirSync(args.attempt_dir, { recursive: true })
      if (args.role === 'review') {
        reviewer = args.attempt.id
        const observation = await A.execute({ command: [process.execPath, '-e', 'setInterval(() => {}, 1000)'],
          cwd: args.cwd, signal: args.signal, log: path.join(args.attempt_dir, 'transcript.log'),
          on_launch: async identity => {
            S.write_json(path.join(args.attempt_dir, 'process.json'), identity)
            await args.on_launch(identity)
            launched.resolve()
          }, on_descendant: A.descendant_recorder(path.join(args.attempt_dir, 'descendants.json'), args.on_descendant) })
        S.write_json(path.join(args.attempt_dir, 'exit.json'), observation)
        assert.equal(observation.aborted, true)
        throw Error('Reviewer stopped after its task returned early')
      }
      calls++; original = args.attempt.id
      marker = path.join(args.cwd, '.aglite-records/.devlog.md.owner')
      fs.writeFileSync(marker, JSON.stringify({ session: original }))
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'preserved CLI product\n')
      submit_ordinary_review(args)
      await launched.promise
      closeout(args.cwd)
      saved_result = JSON.stringify(result(args.attempt, outcome))
      fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), saved_result)
      S.write_json(path.join(args.attempt_dir, 'exit.json'), { exit_code: 0, root_closed: true, spawned: true })
      return result(args.attempt, outcome)
    } }), 2)
    let blocked = read(root)
    assert.equal(blocked.groups[0].attempt.ordinary_reviews[0].state, 'cancelled')
    assert.ok(blocked.groups[0].attempt.ordinary_reviews[0].attempt.stopped_at)
    assert.equal(fs.existsSync(marker), true)
    const exit_file = path.join(root, 'attempts', reviewer, 'exit.json')
    const exit_bytes = fs.readFileSync(exit_file)
    if (outcome === 'pass') {
      S.write_json(exit_file, { ...JSON.parse(exit_bytes), root_closed: false })
      answer(root, blocked.questions.find(item => !item.answer), 'host')
      assert.equal(await L.run(root, { checks, agent: () => { throw Error('Unproved CLI cancellation repeated its task') } }), 2)
      assert.equal(calls, 1)
      assert.equal(fs.existsSync(marker), true)
      assert.match(read(root).questions.filter(item => !item.answer).at(-1).question, /unsettled ordinary review/)
      fs.writeFileSync(exit_file, exit_bytes)
      blocked = read(root)
    }
    answer(root, blocked.questions.find(item => !item.answer), 'host')
    assert.equal(await L.run(root, { checks, agent: async args => {
      calls++
      assert.notEqual(args.attempt.id, original)
      assert.equal(fs.existsSync(marker), false)
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'attempts', original, 'notebook-owner.released.json'))).session, original)
      assert.equal(fs.readFileSync(path.join(args.cwd, 'a.txt'), 'utf8'), 'preserved CLI product\n')
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'preserved CLI product\ncorrected completion\n')
      closeout(args.cwd)
      return result(args.attempt)
    } }), 0, L.status(root))
    assert.equal(calls, 2)
    assert.equal(fs.readFileSync(path.join(root, 'attempts', original, 'result.json'), 'utf8'), saved_result)
    assert.deepEqual(fs.readFileSync(exit_file), exit_bytes)
  })
})

test('real Git integration preserves disjoint owner edits, sequential fresh tasks, and ancestry', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt', 'b.txt'], ['c.txt']])
  fs.writeFileSync(path.join(repo, 'owner.txt'), 'unfinished owner edit\n')
  const attempts = [], active = new Set(), first = deferred()
  let overlap = false
  assert.equal(await L.run(root, { checks, agent: async args => {
    const group = args.prompt.match(/Group (\S+), task/)[1]
    assert.ok(!active.has(group), 'a group has one worker at a time')
    active.add(group); attempts.push(args.attempt.id)
    if (active.size === 2) { overlap = true; first.resolve() }
    await first.promise
    const answer = await agent(args)
    active.delete(group)
    return answer
  } }), 0)
  const saved = read(root)
  assert.ok(overlap)
  assert.equal(new Set(attempts).size, 3)
  assert.equal(saved.groups[0].tasks[0].round, 1)
  assert.equal(saved.groups[0].tasks[1].round, 2)
  assert.equal(fs.readFileSync(path.join(repo, 'owner.txt'), 'utf8'), 'unfinished owner edit\n')
  for (const group of saved.groups) {
    assert.equal(git(repo, 'merge-base', group.candidate, 'HEAD'), group.candidate)
    for (const task of group.tasks) assert.equal(fs.readFileSync(path.join(repo, task.allowed_paths[0]), 'utf8'), `${group.id}/${task.id}\n`)
  }
  assert.equal(git(repo, 'merge-base', q.base_commit, 'HEAD'), q.base_commit)
  assert.equal(git(repo, 'ls-tree', '-r', '--name-only', 'HEAD').includes('.aglite-records'), false)
})

test('third group starts while first integration waits and second task still runs', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt'], ['c.txt']])
  const third = deferred(), integration = deferred(), second = deferred()
  let merging = false, thirdStarted = false
  const execution = L.run(root, { agent: async args => {
    if (args.prompt.includes('Group G2,')) await second.promise
    if (args.prompt.includes('Group G3,')) { thirdStarted = true; third.resolve() }
    return agent(args)
  }, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && !merging) { merging = true; await integration.promise }
    return checks(args)
  } })
  await third.promise
  assert.ok(thirdStarted)
  assert.equal(read(root).groups[1].state, 'working')
  second.resolve(); integration.resolve()
  assert.equal(await execution, 0)
})

test('stopped question blocks only its group, releases slot, and owner answer resumes', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt']], { max_workers: 1 })
  let asked = false
  assert.equal(await L.run(root, { checks, agent: async args => {
    if (!asked) { asked = true; return result(args.attempt, 'needs_owner') }
    return agent(args)
  } }), 2)
  let q = read(root)
  assert.equal(q.groups[0].state, 'blocked'); assert.equal(q.groups[1].state, 'done')
  assert.match(L.status(root), /Which value should be used/)
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: q.questions[0].id, answer: 'Use the assigned value.' }]))
  assert.equal(await L.run(root, { checks, agent: async args => {
    assert.match(args.prompt, /Use the assigned value/)
    return agent(args)
  } }), 0)
})

test('queue authority refuses unregistered Markdown and missing required fields', () => {
  const { root, q } = fixture([['a.txt']])
  fs.writeFileSync(path.join(root, 'group-999.md'), '## Handwritten\n')
  assert.throws(() => L.load(root), /Unregistered/)
  for (const key of ['schema_version', 'request', 'authorization', 'integration_checks']) {
    const broken = structuredClone(q); delete broken[key]
    assert.throws(() => L.validate(broken, root), undefined, key)
  }
})

test('native dispatch waits for exact stopped inbox result and never substitutes CLI', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { task: { ...selection, kind: 'native' } })
  let calls = 0
  const noCli = async () => { calls++; throw Error('CLI substitution forbidden') }
  assert.equal(await L.run(root, { checks, agent: noCli }), 2)
  let q = read(root)
  const handoff = q.handoffs[0]
  assert.equal(calls, 0)
  const assignment = fs.readFileSync(handoff.assignment, 'utf8')
  assert.ok(assignment.includes(path.join(root, 'inbox', `${handoff.id}.json`)))
  task_edit({ cwd: handoff.cwd, prompt: assignment })
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), '{ malformed response')
  assert.equal(await L.run(root, { checks, agent: noCli }), 2)
  assert.equal(read(root).groups[0].state, 'native')
  assert.equal(read(root).groups[0].attempt.id, handoff.id)
  assert.equal(read(root).questions.length, 0)
  assert.ok(read(root).handoffs[0].error)
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: false }))
  assert.equal(await L.run(root, { checks, agent: noCli }), 2)
  assert.equal(read(root).groups[0].state, 'native')
  assert.equal(read(root).questions.length, 0)
  assert.match(L.status(root), /Native host must prove worker and descendants stopped/)
  assert.equal(calls, 0)
})

test('live queue and target claims refuse competing coordinators', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt']])
  const entered = deferred(), release = deferred()
  const running = L.run(root, { checks, agent: async args => { entered.resolve(); await release.promise; return agent(args) } })
  await entered.promise
  await assert.rejects(L.run(root, { agent, checks }), /alive|claim|owned/i)
  const other = path.join(path.dirname(root), 'other'); fs.mkdirSync(other)
  fs.copyFileSync(path.join(root, q.groups[0].file), path.join(other, q.groups[0].file))
  fs.copyFileSync(path.join(root, q.request), path.join(other, q.request))
  write(other, { ...q, run_id: 'other', repo })
  await assert.rejects(L.run(other, { agent, checks }), /alive|claim|owned/i)
  release.resolve(); assert.equal(await running, 0)
})

test('external forward target movement integrates once and preserves owner ancestry', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let moved
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner commit\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'outside lane')
    moved = git(repo, 'rev-parse', 'HEAD')
    return agent(args)
  } }), 0)
  assert.equal(git(repo, 'merge-base', moved, 'HEAD'), moved)
  assert.equal(read(root).groups[0].state, 'done')
  assert.equal(read(root).target_adoptions.length, 1)
})

test('simultaneously observed readiness uses group ID order and serial verified bases', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt']])
  const gate = deferred()
  let waiting = 0
  const landings = []
  assert.equal(await L.run(root, { agent, checks: async args => {
    if (!path.basename(args.cwd).startsWith('aglite-merge-')) {
      waiting++
      if (waiting === 2) gate.resolve()
      await gate.promise
    }
    return checks(args)
  }, on_save: q => {
    if (q.integration?.phase === 'landing' && !landings.some(x => x.group_id === q.integration.group_id)) landings.push(structuredClone(q.integration))
  } }), 0)
  assert.deepEqual(landings.map(x => x.group_id), ['G1', 'G2'])
  assert.equal(landings[1].base, landings[0].result)
})

test('checked landed crash image recovers once; missing checked proof cannot complete', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let crashImage
  assert.equal(await L.run(root, { agent, checks, on_save: q => {
    if (q.integration?.phase === 'landing' && !crashImage) {
      crashImage = structuredClone(q)
      git(repo, 'merge', '--ff-only', q.integration.result)
      throw Error('Injected coordinator crash after target fast-forward')
    }
  } }), 2)
  const landed = git(repo, 'rev-parse', 'HEAD')
  const count = git(repo, 'rev-list', '--count', 'HEAD')
  assert.equal(crashImage.integration.result, landed)
  // Restore exactly the durable state preceding the actual fast-forward, while
  // retaining the landed Git effect: the crash window's two independent stores.
  write(root, crashImage)
  let workers = 0
  assert.equal(await L.run(root, { agent: async () => { workers++; throw Error('duplicate work') }, checks }), 0)
  assert.equal(workers, 0)
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), count)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), landed)
  const unproved = structuredClone(crashImage)
  delete unproved.integration.checks
  write(root, unproved)
  await assert.rejects(L.run(root, { agent, checks }), /lacks checked evidence/)
  assert.notEqual(read(root).groups[0].state, 'done')
})

test('failed combined check requires repair, fresh checks, review, then acceptance', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: { ...selection, provider: 'claude', model: 'test-counterpart' } })
  const events = []
  let failed = false
  assert.equal(await L.run(root, { agent: async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    events.push(args.role)
    assert.ok(args.prompt.includes(`read inherited configuration only at ${path.join(args.cwd, '.agentflow/ag.json')}`))
    assert.ok(args.prompt.includes('No configuration discovery, creation, migration writes, release checks or project adoption'))
    if (['review', 'acceptance'].includes(args.role)) assert.ok(args.prompt.includes('against original request Implement every registered task while preserving owner content.. Base '))
    if (args.role === 'task') task_edit(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'repaired\n')
    return result(args.attempt)
  }, checks: async args => {
    const combined = path.basename(args.cwd).startsWith('aglite-merge-')
    events.push(combined ? 'combined-checks' : 'task-checks')
    if (combined && !failed) { failed = true; return args.ids.map(id => ({ id, passed: false })) }
    return checks(args)
  } }), 0)
  assert.deepEqual(events, ['task', 'task-checks', 'combined-checks', 'repair', 'combined-checks', 'review', 'acceptance'])
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'repaired\n')
})

for (const verdict of ['pass', 'blocked']) test(`same-provider fresh repaired review ${verdict} retains integration safeguards`, { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: selection })
  const attempts = []
  let fail = true
  const code = await L.run(root, { agent: async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    attempts.push({ role: args.role, id: args.attempt.id })
    if (args.role === 'task') task_edit(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'repaired\n')
    return result(args.attempt, args.role === 'review' ? verdict : 'pass')
  }, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && fail) {
      fail = false
      return args.ids.map(id => ({ id, passed: false }))
    }
    return checks(args)
  } })
  const roles = attempts.map(x => x.role)
  assert.equal(new Set(attempts.map(x => x.id)).size, attempts.length)
  assert.equal(code, verdict === 'pass' ? 0 : 2)
  assert.deepEqual(roles, verdict === 'pass'
    ? ['task', 'repair', 'review', 'acceptance'] : ['task', 'repair', 'review'])
  assert.equal(fs.existsSync(path.join(repo, 'a.txt')), verdict === 'pass')
  assert.equal(read(root).groups[0].state, verdict === 'pass' ? 'done' : 'blocked')
})

test('stopped blocked repair preserves its attempt and other ready groups integrate', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt'], ['b.txt']], { repair: selection, acceptance: { ...selection, provider: 'claude', model: 'test-counterpart' } })
  let failed = false
  assert.equal(await L.run(root, { agent: async args => {
    if (args.role === 'repair') return result(args.attempt, 'needs_owner')
    return agent(args)
  }, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-fixture-G1-') && !failed) {
      failed = true; return args.ids.map(id => ({ id, passed: false }))
    }
    return checks(args)
  } }), 2)
  const q = read(root)
  assert.equal(q.groups[0].state, 'blocked')
  assert.ok(fs.existsSync(q.groups[0].suspended_integration.worktree))
  assert.equal(q.groups[1].state, 'done')
  assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'G2/T2-1\n')
  assert.equal(fs.existsSync(path.join(repo, 'a.txt')), false)
})

test('stopped native handoff resumes exact attempt through successful integration', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { task: { ...selection, kind: 'native' } })
  const forbidden = async () => { throw Error('Native selection cannot launch a CLI') }
  assert.equal(await L.run(root, { agent: forbidden, checks }), 2)
  const handoff = read(root).handoffs[0]
  task_edit({ cwd: handoff.cwd, prompt: fs.readFileSync(handoff.assignment, 'utf8') })
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  assert.equal(await L.run(root, { agent: forbidden, checks }), 0)
  assert.equal(read(root).handoffs[0].completed, true)
})

test('ordinary closeout accepts arrowless Reply but requires a newly advanced round', () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-closeout-test-')))
  fs.mkdirSync(path.join(cwd, '.aglite-records'))
  const file = path.join(cwd, '.aglite-records/devlog.md')
  fs.writeFileSync(file, '# → Ask / A-001\n\n# Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n')
  assert.equal(L.ordinary_closeout(cwd, { previous_round: 0 }), 1)
  assert.throws(() => L.ordinary_closeout(cwd, { previous_round: 1 }), /new Reply/)
  fs.appendFileSync(file, '\n# Reply / A-002\n\nCompleted next task.\n\n# → Ask / A-003\n')
  assert.equal(L.ordinary_closeout(cwd, { previous_round: 1 }), 2)
  fs.writeFileSync(file, 'Quoted prior completion: # Reply / A-003\n\n# → Ask / A-004\n')
  assert.throws(() => L.ordinary_closeout(cwd, { previous_round: 2 }), /new Reply/)
})

test('native outstanding assignments reserve max_workers until a stopped result is imported', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt'], ['c.txt']], { task: { ...selection, kind: 'native' }, max_workers: 2 })
  const forbidden = async () => { throw Error('CLI substitution forbidden') }
  assert.equal(await L.run(root, { agent: forbidden, checks }), 2)
  let q = read(root)
  assert.equal(q.handoffs.length, 2)
  assert.equal(q.groups[2].state, 'pending')
  assert.equal(q.groups[2].workspace, undefined)
  // Merely resuming without any host result must not issue a third assignment.
  assert.equal(await L.run(root, { agent: forbidden, checks }), 2)
  assert.equal(read(root).handoffs.length, 2)
  const handoff = q.handoffs[0]
  task_edit({ cwd: handoff.cwd, prompt: fs.readFileSync(handoff.assignment, 'utf8') })
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  assert.equal(await L.run(root, { agent: forbidden, checks }), 2)
  q = read(root)
  assert.equal(q.groups[0].state, 'done')
  assert.equal(q.groups[2].state, 'native')
  assert.equal(q.handoffs.filter(item => !item.completed).length, 2)
})

function answer(root, question, source) {
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: question.id, answer: 'Correction supplied; continue.', source }]))
}

test('host corrects technical blocker and reuses exact stopped successful attempt', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let calls = 0, original
  assert.equal(await L.run(root, { checks, agent: async args => {
    calls++; original = args.attempt.id
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    const response = result(args.attempt)
    fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0, aborted: false, timed_out: false }))
    fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), JSON.stringify(response))
    // Agent completed product work but its notebook needs a host technical fix.
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'completed product\n')
    return response
  } }), 2)
  let q = read(root)
  assert.equal(q.questions[0].requires_owner, false)
  closeout(q.groups[0].workspace.worktree)
  answer(root, q.questions[0], 'host')
  assert.equal(await L.run(root, { checks, agent: async () => { calls++; throw Error('Completed attempt repeated') } }), 0)
  q = read(root)
  assert.equal(calls, 1)
  assert.equal(q.groups[0].tasks[0].result.attempt_id, original)
  assert.equal(q.questions[0].answer_source, 'host')
})

test('owner-only worker question rejects host source and accepts actual owner answer', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  assert.equal(await L.run(root, { checks, agent: async args => result(args.attempt, 'needs_owner') }), 2)
  const q = read(root)
  assert.equal(q.questions[0].requires_owner, true)
  answer(root, q.questions[0], 'host')
  await assert.rejects(L.run(root, { agent, checks }), /actual owner answer/)
  assert.equal(read(root).questions[0].answer, undefined)
  answer(root, q.questions[0], 'owner')
  assert.equal(await L.run(root, { agent, checks }), 0)
  assert.equal(read(root).questions[0].answer_source, 'owner')
})

for (const unrelated of [false, true]) test(`task commit crash ${unrelated ? 'refuses unrelated commit identity' : 'resumes exact committed task without repeating worker'}`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let image, calls = 0, committed
  assert.equal(await L.run(root, { checks, agent: async args => { calls++; return agent(args) }, on_save: q => {
    const group = q.groups[0], task = group.tasks[0]
    if (task.commit_intent && !image) {
      image = structuredClone(q)
      const cwd = group.workspace.worktree
      git(cwd, 'add', 'a.txt')
      git(cwd, 'commit', '-m', unrelated ? 'unrelated owner commit' : task.commit_intent.message)
      committed = git(cwd, 'rev-parse', 'HEAD')
      throw Error('Injected crash after task product commit')
    }
  } }), 2)
  assert.ok(image.groups[0].tasks[0].round === 1, 'ordinary closeout recorded before commit intent')
  write(root, image)
  const code = await L.run(root, { checks, agent: async () => { calls++; throw Error('Task worker repeated') } })
  assert.equal(calls, 1)
  const q = read(root)
  if (unrelated) {
    assert.equal(code, 2)
    assert.match(q.questions.at(-1).question, /commit identity is uncertain/)
    assert.notEqual(q.groups[0].state, 'done')
  } else {
    assert.equal(code, 0)
    assert.equal(q.groups[0].tasks[0].candidate, committed)
    assert.equal(q.groups[0].tasks[0].checks_result[0].passed, true)
  }
})

test('next task cannot reuse the prior arrowless ordinary Reply', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt', 'b.txt']])
  let calls = 0
  assert.equal(await L.run(root, { checks, agent: async args => {
    calls++
    if (calls === 1) {
      const response = await agent(args)
      const file = path.join(args.cwd, '.aglite-records/devlog.md')
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('# → Reply / A-001', '# Reply / A-001'))
      return response
    }
    fs.writeFileSync(path.join(args.cwd, 'b.txt'), 'second task edits without closeout\n')
    return result(args.attempt)
  } }), 2)
  const q = read(root)
  assert.equal(q.groups[0].tasks[0].state, 'done')
  assert.notEqual(q.groups[0].tasks[1].state, 'done')
  assert.match(q.questions[0].question, /new Reply/)
})

test('killed coordinator after actual landing leaves dead claims that resume exactly once', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  const { spawn } = require('node:child_process')
  const childSource = `
    const fs = require('node:fs')
    const path = require('node:path')
    const { execFileSync } = require('node:child_process')
    const L = require(${JSON.stringify(require.resolve('./looper'))})
    const root = ${JSON.stringify(root)}
    L.run(root, {
      agent: async args => {
        fs.mkdirSync(args.attempt_dir, { recursive: true })
        fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'child completed product\\n')
        fs.writeFileSync(path.join(args.cwd, '.aglite-records/devlog.md'), '# → Ask / A-001\\n')
        fs.appendFileSync(path.join(args.cwd, '.aglite-records/devlog.md'), '\\n# Reply / A-001\\n\\nCompleted.\\n\\n# → Ask / A-002\\n')
        return { attempt_id: args.attempt.id, outcome: 'pass', summary: 'Completed.', evidence: [] }
      },
      checks: async ({ ids }) => ids.map(id => ({ id, passed: true })),
      on_save: q => {
        if (q.integration?.phase === 'landing') {
          execFileSync('git', ['merge', '--ff-only', q.integration.result], { cwd: q.repo, stdio: 'pipe' })
          process.kill(process.pid, 'SIGKILL')
        }
      }
    }).catch(error => { console.error(error); process.exitCode = 1 })
  `
  const child = spawn(process.execPath, ['-e', childSource], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => { stderr += data })
  const death = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
  if (process.platform === 'win32') assert.notEqual(death.code, 0, stderr)
  else {
    assert.equal(death.signal, 'SIGKILL', stderr)
    assert.equal(death.code, null)
  }
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
  const interrupted = read(root)
  assert.equal(interrupted.integration.phase, 'landing')
  const landed = interrupted.integration.result
  assert.equal(git(repo, 'rev-parse', 'HEAD'), landed)
  const count = git(repo, 'rev-list', '--count', 'HEAD')
  assert.ok(fs.existsSync(path.join(root, '.queue.owner')))
  const common = path.resolve(repo, git(repo, 'rev-parse', '--git-common-dir'))
  assert.equal(fs.readdirSync(common).filter(name => /^aglite-target-.*\.owner$/.test(name)).length, 1)
  let calls = 0
  assert.equal(await L.run(root, { checks, agent: async () => { calls++; throw Error('Killed landed worker repeated') } }), 0)
  assert.equal(calls, 0)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), landed)
  assert.equal(git(repo, 'rev-list', '--count', 'HEAD'), count)
  assert.equal(read(root).groups[0].state, 'done')
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  assert.equal(fs.readdirSync(common).filter(name => /^aglite-target-.*\.owner$/.test(name)).length, 0)
})

test('Claude JSON envelopes require one final successful structured result', () => {
  const { parse_claude_result } = require('./looper-agent')
  const output = { attempt_id: 'exact-attempt', outcome: 'pass', summary: 'Checked.', evidence: [] }
  const final = { type: 'result', subtype: 'success', is_error: false, structured_output: output }
  const assistant = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }
  assert.deepEqual(parse_claude_result(JSON.stringify(final)), output)
  assert.deepEqual(parse_claude_result(JSON.stringify([assistant, { type: 'tool_result' }, final])), output)
  for (const envelope of [[assistant], [final, final], [final, assistant], { ...final, is_error: true }, { ...final, subtype: 'error_during_execution' }, { ...final, structured_output: undefined }]) {
    assert.throws(() => parse_claude_result(JSON.stringify(envelope)), /failed or ambiguous/)
  }
})

for (const outcome of ['blocked', 'needs_owner']) test(`repair review ${outcome} preserves stage and safely retries ${outcome === 'blocked' ? 'same base' : 'after another ready group lands'}`, { timeout: 30000 }, async () => {
  const groups = outcome === 'blocked' ? [['a.txt']] : [['a.txt'], ['b.txt']]
  const { root, repo } = fixture(groups, { repair: selection, acceptance: { ...selection, provider: 'claude', model: 'test-counterpart' } })
  const reviews = [], repairs = []
  let stopReview = true
  const reviewAgent = async args => {
    if (args.role === 'task') return agent(args)
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    if (!stopReview) {
      assert.equal(args.prompt.split('Resolved answers/corrections (').length - 1, 1)
      assert.match(args.prompt, /Correction supplied; continue/)
      assert.match(args.prompt, new RegExp(`\"answer_source\":\"${outcome === 'blocked' ? 'host' : 'owner'}\"`))
      assert.match(args.prompt, /host technical corrections grant no new scope/)
    }
    if (args.role === 'repair') {
      repairs.push(args.attempt.id)
      fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'repaired\n')
    }
    if (args.role === 'review') {
      reviews.push(args.attempt.id)
      assert.match(args.prompt, /Coordinator-observed exact Git evidence: HEAD [a-f0-9]+/)
      assert.match(args.prompt, /diff --git a\/a.txt b\/a.txt/)
      assert.match(args.prompt, /Observed check output:/)
      assert.ok(args.prompt.includes(git(args.cwd, 'rev-parse', 'HEAD')))
      if (stopReview) return { ...result(args.attempt, outcome), summary: 'Review needs additional external evidence.' }
    }
    return result(args.attempt)
  }
  const repairChecks = async args => args.ids.map(id => ({ id, passed: !path.basename(args.cwd).startsWith('aglite-merge-') || !fs.existsSync(path.join(args.cwd, 'a.txt')) || fs.readFileSync(path.join(args.cwd, 'a.txt'), 'utf8') === 'repaired\n' }))
  assert.equal(await L.run(root, { agent: reviewAgent, checks: repairChecks }), 2)
  let q = read(root)
  const suspended = q.groups[0].suspended_integration
  assert.equal(suspended.phase, 'review')
  assert.equal(repairs.length, 1, 'unavailable proof must not trigger another code repair')
  assert.equal(reviews.length, 1)
  assert.equal(q.questions[0].requires_owner, outcome === 'needs_owner')
  assert.equal(fs.readFileSync(path.join(suspended.worktree, 'a.txt'), 'utf8'), 'repaired\n')
  if (outcome === 'needs_owner') {
    assert.equal(q.groups[1].state, 'done', 'blocked read-only review releases the safe lane')
    assert.notEqual(q.expected_head, suspended.base)
    answer(root, q.questions[0], 'host')
    await assert.rejects(L.run(root, { agent: reviewAgent, checks: repairChecks }), /actual owner answer/)
  }
  stopReview = false
  answer(root, q.questions[0], outcome === 'blocked' ? 'host' : 'owner')
  assert.equal(await L.run(root, { agent: reviewAgent, checks: repairChecks }), 0)
  q = read(root)
  assert.equal(reviews.length, 2)
  assert.notEqual(reviews[0], reviews[1], 'retry uses a fresh read-only session')
  if (outcome === 'blocked') {
    assert.equal(q.groups[0].integration.id, suspended.id)
    assert.equal(repairs.length, 1, 'same-base review retry preserves repaired product')
  } else {
    assert.notEqual(q.groups[0].integration.id, suspended.id)
    assert.equal(repairs.length, 1, 'moved target carries the preserved checked repair forward')
    assert.equal(fs.readFileSync(path.join(repo, 'b.txt'), 'utf8'), 'G2/T2-1\n')
  }
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'repaired\n')
})

test('repair cannot commit unresolved conflict markers', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: { ...selection, provider: 'claude', model: 'test-counterpart' } })
  let initial = true
  assert.equal(await L.run(root, { checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && initial) { initial = false; return args.ids.map(id => ({ id, passed: false })) }
    return checks(args)
  }, agent: async args => {
    if (args.role === 'task') return agent(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), '<<<<<<< ours\nleft\n=======\nright\n>>>>>>> theirs\n')
    return result(args.attempt)
  } }), 2)
  const q = read(root), attempt = q.groups[0].suspended_integration
  assert.equal(q.groups[0].state, 'blocked')
  assert.match(q.questions[0].question, /conflict|marker/i)
  assert.equal(git(attempt.worktree, 'diff', '--cached', '--name-only'), '')
  assert.equal(fs.existsSync(path.join(repo, 'a.txt')), false)
})

test('startup target movement is adopted before new task workspaces', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt'], ['b.txt']])
  fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner change\n')
  git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'owner moved target')
  const actual = git(repo, 'rev-parse', 'HEAD')
  assert.equal(await L.run(root, { agent, checks }), 0)
  const q = read(root)
  assert.equal(q.lane_error, null)
  assert.ok(q.groups.every(group => group.tasks.every(task => task.state === 'done')))
  assert.ok(q.groups.every(group => group.state === 'done' && group.workspace.base === actual))
  assert.equal(git(repo, 'merge-base', actual, 'HEAD'), actual)
})

test('PID reuse with a proved different start identity is stopped, without signaling it', () => {
  const S = require('./looper-state')
  const actual = S.process_identity(process.pid)
  assert.ok(actual)
  assert.equal(S.process_alive({ pid: process.pid, started_at: `${actual}-different` }), false)
  assert.equal(S.process_alive({ pid: process.pid, started_at: actual }), true)
})

test('host technical correction rechecks exact saved candidate without rerunning worker', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let calls = 0, first = true
  assert.equal(await L.run(root, { agent: async args => { calls++; return agent(args) }, checks: async args => {
    if (first) { first = false; return args.ids.map(id => ({ id, passed: false })) }
    return checks(args)
  } }), 2)
  let q = read(root)
  const candidate = q.groups[0].tasks[0].candidate
  assert.ok(candidate)
  answer(root, q.questions[0], 'host')
  assert.equal(await L.run(root, { agent: async () => { calls++; throw Error('Worker repeated after flaky check') }, checks }), 0)
  q = read(root)
  assert.equal(calls, 1)
  assert.equal(q.groups[0].tasks[0].candidate, candidate)
})

test('unsettled writer stops subsequent dispatch and retains ownership claims', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt']], { max_workers: 1 })
  let calls = 0
  assert.equal(await L.run(root, { checks, agent: async () => {
    calls++
    const error = Error('Worker settlement uncertain'); error.unsettled = true; throw error
  } }), 2)
  const q = read(root)
  assert.equal(calls, 1)
  assert.equal(q.groups[1].workspace, undefined)
  assert.equal(q.groups[1].state, 'pending')
  assert.notEqual(q.groups[0].state, 'done')
  assert.ok(fs.existsSync(path.join(root, '.queue.owner')))
})

for (const intent of [true, false]) test(`staged task ${intent ? 'coordinator commit intent recovers own index' : 'worker index without intent is refused'}`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let image, calls = 0
  const code = await L.run(root, { checks, agent: async args => {
    calls++
    const response = await agent(args)
    if (!intent) git(args.cwd, 'add', 'a.txt')
    return response
  }, on_save: q => {
    const group = q.groups[0], task = group.tasks[0]
    if (intent && task.commit_intent && !image) {
      image = structuredClone(q)
      git(group.workspace.worktree, 'add', 'a.txt')
      throw Error('Crash after coordinator staging')
    }
  } })
  assert.equal(code, 2)
  if (intent) {
    write(root, image)
    assert.equal(await L.run(root, { checks, agent: async () => { calls++; throw Error('Staged task worker repeated') } }), 0)
    assert.equal(calls, 1)
  } else {
    assert.equal(read(root).groups[0].tasks[0].commit_intent, undefined)
    assert.match(read(root).questions[0].question, /stag/i)
  }
})

test('owner answer cannot supersede uncertain native writer without stopped attestation', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { task: { ...selection, kind: 'native' } })
  const forbidden = async () => { throw Error('Native CLI substitution') }
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  const original = read(root).handoffs[0]
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  const responseFile = path.join(root, 'inbox', `${original.id}.json`)
  fs.writeFileSync(responseFile, JSON.stringify({ ...result({ id: original.id }, 'needs_owner'), writer_stopped: false }))
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  let waiting = read(root)
  assert.equal(waiting.groups[0].state, 'native')
  assert.equal(waiting.groups[0].attempt.id, original.id)
  assert.equal(waiting.questions.length, 0)
  fs.writeFileSync(responseFile, JSON.stringify({ ...result({ id: original.id }, 'needs_owner'), writer_stopped: true }))
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  waiting = read(root)
  assert.equal(waiting.questions[0].requires_owner, true)
  assert.equal(waiting.groups[0].state, 'blocked')
  answer(root, waiting.questions[0], 'owner')
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  const q = read(root)
  assert.notEqual(q.groups[0].attempt.id, original.id)
  assert.equal(q.handoffs.find(item => item.id === original.id).completed, true)
  assert.equal(q.handoffs.find(item => item.id === original.id).superseded, true)
  assert.equal(L.status(root).includes(`Native ${original.id}:`), false)
})

test('interrupted prepared integration retry preserves old attempt and makes fresh progress', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let interrupted
  assert.equal(await L.run(root, { agent, checks, on_save: q => {
    if (q.integration?.phase === 'prepared' && !interrupted) { interrupted = structuredClone(q.integration); throw Error('Crash before integration worktree creation') }
  } }), 2)
  const q = read(root)
  assert.equal(q.groups[0].suspended_integration.phase, 'prepared')
  answer(root, q.questions[0], 'host')
  assert.equal(await L.run(root, { agent, checks }), 0)
  const saved = read(root)
  assert.notEqual(saved.groups[0].integration.id, interrupted.id)
  assert.equal(saved.groups[0].state, 'done')
})

test('exceptional coordinator save waits for active jobs before rejecting', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt']])
  let injected = false, secondStopped = false
  await assert.rejects(L.run(root, { checks, agent: async args => {
    if (args.prompt.includes('Group G2,')) {
      await new Promise(resolve => {
        if (args.signal.aborted) resolve()
        else args.signal.addEventListener('abort', resolve, { once: true })
      })
      await new Promise(resolve => setImmediate(resolve))
      secondStopped = true
      return result(args.attempt, 'blocked')
    }
    return agent(args)
  }, on_save: q => {
    if (!injected && q.ready?.includes('G1') && q.groups[1].state === 'working') {
      injected = true
      throw Error('Injected exceptional coordinator save')
    }
  } }), /Injected exceptional coordinator save/)
  assert.equal(secondStopped, true, 'run rejection must follow worker settlement')
  const saved = fs.readFileSync(path.join(root, 'queue.json'), 'utf8')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(fs.readFileSync(path.join(root, 'queue.json'), 'utf8'), saved, 'no job saves after rejection')
})

for (const foreign of [false, true]) test(`ordinary owner question ${foreign ? 'preserves foreign notebook ownership' : 'archives exact mapped notebook claim for fresh handoff'}`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let firstId, marker, notebookBefore
  assert.equal(await L.run(root, { checks, agent: async args => {
    firstId = args.attempt.id
    assert.ok(args.prompt.includes(`Use generated workflow session UUID ${firstId}`))
    marker = path.join(args.cwd, '.aglite-records/.devlog.md.owner')
    notebookBefore = fs.readFileSync(path.join(args.cwd, '.aglite-records/devlog.md'), 'utf8')
    fs.writeFileSync(marker, JSON.stringify({ session: foreign ? 'foreign-owner-session' : firstId, note: 'Open ordinary Ask' }))
    return result(args.attempt, 'needs_owner')
  } }), 2)
  const q = read(root)
  const notebook = path.join(q.groups[0].workspace.worktree, '.aglite-records/devlog.md')
  assert.equal(fs.readFileSync(notebook, 'utf8'), notebookBefore)
  const archive = path.join(root, 'attempts', firstId, 'notebook-owner.released.json')
  if (foreign) {
    assert.equal(fs.existsSync(marker), true)
    assert.equal(JSON.parse(fs.readFileSync(marker)).session, 'foreign-owner-session')
    assert.equal(fs.existsSync(archive), false)
    assert.match(q.questions[0].question, /Foreign isolated notebook claim/)
    assert.equal(q.groups[0].state, 'blocked')
  } else {
    assert.equal(fs.existsSync(marker), false)
    assert.equal(JSON.parse(fs.readFileSync(archive)).session, firstId)
    assert.equal(q.questions[0].requires_owner, true)
    answer(root, q.questions[0], 'owner')
    assert.equal(await L.run(root, { checks, agent: async args => {
      assert.notEqual(args.attempt.id, firstId)
      assert.equal(fs.existsSync(marker), false)
      assert.equal(fs.readFileSync(notebook, 'utf8'), notebookBefore)
      return agent(args)
    } }), 0)
    assert.match(fs.readFileSync(notebook, 'utf8'), /# → Reply \/ A-001/)
  }
})

test('repair accepts a legitimate Markdown setext heading underline', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.md']], { repair: selection, acceptance: { ...selection, provider: 'claude', model: 'test-counterpart' } })
  let fail = true
  assert.equal(await L.run(root, { checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && fail) { fail = false; return args.ids.map(id => ({ id, passed: false })) }
    return checks(args)
  }, agent: async args => {
    if (args.role === 'task') return agent(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.md'), 'Legitimate heading\n=======\n\nResolved product documentation.\n')
    return result(args.attempt)
  } }), 0)
  assert.equal(fs.readFileSync(path.join(repo, 'a.md'), 'utf8'), 'Legitimate heading\n=======\n\nResolved product documentation.\n')
})

test('ag.json alone selects shared implementation/acceptance tiers and extensible catalogs', () => {
  const { root, repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json')
  const config = JSON.parse(fs.readFileSync(file))
  config['looper-routes'] = {
    task: { kind: 'native', provider: 'owner-host', 'model-family': 'owner-catalog' },
    repair: { kind: 'native', provider: 'owner-host', 'model-family': 'owner-catalog' },
    acceptance: { kind: 'native', provider: 'owner-host', 'model-family': 'owner-catalog' },
    '//': 'ignored explanatory text'
  }
  config['model-family'] = { 'owner-catalog': { basic: 'namespace/model/low', better: 'review-model/high', '//': 'comment' } }
  config['pipeline-roles']['//'] = 'comment'
  fs.writeFileSync(file, JSON.stringify(config))
  const settings = L.read_settings(repo)
  assert.equal(L.select(settings, 'task').model, L.select(settings, 'repair').model)
  assert.equal(L.select(settings, 'task').effort, L.select(settings, 'repair').effort)
  assert.equal(L.select(settings, 'task').model, 'namespace/model')
  assert.equal(L.select(settings, 'task').effort, 'low')
  assert.deepEqual(L.select(settings, 'review'), L.select(settings, 'acceptance'))
  assert.equal(L.select(settings, 'review').model, 'review-model')
  assert.equal(L.select(settings, 'review').source.tier, 'better')
  assert.equal(L.select(settings, 'task').source.file, '.agentflow/ag.json')
  assert.ok(!Object.hasOwn(L.load(root), 'task_worker'))
})

test('invalid selected settings fail before claims; status remains read-only without valid settings', async () => {
  const { root, repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json'), original = fs.readFileSync(file, 'utf8')
  const queue = fs.readFileSync(path.join(root, 'queue.json'), 'utf8')
  const cases = [
    [c => { delete c['looper-routes'].task }, /looper-routes.task required/],
    [c => { delete c['pipeline-roles'].implementation }, /pipeline-roles.implementation/],
    [c => { c['model-family'].task.basic = 'missing-effort' }, /model-family.task.basic/],
    [c => { c['looper-routes'].task.provider = 'unknown-cli' }, /Unsupported CLI provider/],
    [c => { c['model-family'].task.basic = 'm/unsupported' }, /Unsupported selected effort/],
    [c => { c['looper-routes'].task.model = 'duplicate' }, /belongs in model-family/],
    [c => { c['looper-limits']['max-workers'] = 0 }, /looper-limits.max-workers/],
    [c => { c['looper-limits']['max-repairs'] = -1 }, /looper-limits.max-repairs/],
    [c => { c['looper-limits']['max-workers'] = null }, /looper-limits.max-workers/]
  ]
  for (const [mutate, error] of cases) {
    const config = JSON.parse(original); mutate(config)
    fs.writeFileSync(file, JSON.stringify(config))
    await assert.rejects(L.run(root, { agent, checks }), error)
    assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
    assert.equal(fs.readFileSync(path.join(root, 'queue.json'), 'utf8'), queue)
    assert.match(L.status(root), /Tasks 0\/1/)
  }
  fs.writeFileSync(file, '{ invalid')
  await assert.rejects(L.run(root, { agent, checks }), /ag\.json/)
  assert.equal(fs.readFileSync(path.join(root, 'queue.json'), 'utf8'), queue)
  const config = JSON.parse(original)
  delete config['looper-limits']
  fs.writeFileSync(file, JSON.stringify(config))
  assert.equal(L.read_settings(repo).max_workers, 3)
  assert.equal(L.read_settings(repo).max_repairs, 2)
})

test('queue refuses editable worker and limit overrides', () => {
  const { root, q } = fixture([['a.txt']])
  for (const key of ['task_worker', 'repair_worker', 'review_worker', 'acceptance_worker', 'max_workers', 'max_repairs'])
    assert.throws(() => L.validate({ ...q, [key]: key.endsWith('worker') ? selection : 2 }, root), new RegExp(key))
})

test('native resume preserves selections and drains outstanding results after lowering concurrency', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt', 'b.txt'], ['c.txt']], { task: { ...selection, kind: 'native' } })
  const noCli = async () => { throw Error('must not substitute CLI') }
  assert.equal(await L.run(root, { checks, agent: noCli }), 2)
  // Simulate outstanding attempts recorded before configuration relocation.
  const pending = read(root)
  for (const group of pending.groups) group.attempt.selection.source.file = 'ag.json'
  for (const handoff of pending.handoffs) handoff.selection.source.file = 'ag.json'
  write(root, pending)
  const first = read(root).handoffs
  assert.equal(first.length, 2)
  const file = path.join(repo, '.agentflow/ag.json'), config = JSON.parse(fs.readFileSync(file))
  config['model-family'].task.basic = 'changed-model/high'
  config['looper-limits']['max-workers'] = 1
  fs.writeFileSync(file, JSON.stringify(config))
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  for (const handoff of first) {
    assert.equal(handoff.selection.model, selection.model)
    task_edit({ cwd: handoff.cwd, prompt: fs.readFileSync(handoff.assignment, 'utf8') })
    fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  }
  assert.equal(await L.run(root, { checks, agent: noCli }), 2)
  const q = read(root)
  for (const handoff of first) {
    const saved = q.handoffs.find(x => x.id === handoff.id)
    assert.equal(saved.completed, true)
    assert.deepEqual(saved.selection, handoff.selection)
    assert.equal(saved.selection.source.file, 'ag.json')
  }
  const next = q.handoffs.find(x => !x.completed)
  assert.ok(next)
  assert.equal(next.selection.model, 'changed-model')
  assert.equal(next.selection.effort, 'high')
  assert.equal(next.selection.source.file, '.agentflow/ag.json')
  assert.notEqual(next.selection.source.digest, first[0].selection.source.digest)
  assert.deepEqual(q.groups[0].attempt.selection, next.selection)
  task_edit({ cwd: next.cwd, prompt: fs.readFileSync(next.assignment, 'utf8') })
  fs.writeFileSync(path.join(root, 'inbox', `${next.id}.json`), JSON.stringify({ ...result({ id: next.id }), writer_stopped: true }))
  assert.equal(await L.run(root, { checks, agent: noCli }), 0)
  assert.equal(read(root).handoffs.length, 3, 'no completed task replayed')
})

test('a restarted repair can use the available same-provider fresh reviewer', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: { ...selection, provider: 'claude' } })
  let combined = 0, reviews = 0
  const attempts = []
  const perform = async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    if (args.role === 'task') task_edit(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'fixed\n')
    if (args.role === 'review') reviews++
    attempts.push({ role: args.role, id: args.attempt.id, provider: args.selection.provider })
    return result(args.attempt)
  }
  assert.equal(await L.run(root, { agent: perform, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-')) {
      combined++
      if (combined === 1) return args.ids.map(id => ({ id, passed: false }))
      throw Error('preserve repaired candidate before review')
    }
    return checks(args)
  } }), 2)
  let q = read(root)
  assert.equal(q.groups[0].suspended_integration.repair_selection.provider, 'codex')
  const file = path.join(repo, '.agentflow/ag.json'), config = JSON.parse(fs.readFileSync(file))
  config['looper-routes'].acceptance.provider = 'codex'
  fs.writeFileSync(file, JSON.stringify(config))
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: q.questions[0].id, answer: 'Recheck the preserved candidate.', source: 'host' }]))
  assert.equal(await L.run(root, { agent: perform, checks }), 0)
  q = read(root)
  assert.equal(reviews, 1)
  assert.equal(q.groups[0].state, 'done')
  const repaired = attempts.filter(x => ['repair', 'review', 'acceptance'].includes(x.role))
  assert.deepEqual(repaired.map(x => x.role), ['repair', 'review', 'acceptance'])
  assert.equal(new Set(repaired.map(x => x.id)).size, 3)
  assert.ok(repaired.every(x => x.provider === 'codex'))
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'fixed\n')
})

test('outstanding native repair imports despite lower repair budget and broken future review route', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: { ...selection, kind: 'native' }, acceptance: { ...selection, provider: 'claude' } })
  let fail = true
  assert.equal(await L.run(root, { agent, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && fail) { fail = false; return args.ids.map(id => ({ id, passed: false })) }
    return checks(args)
  } }), 2)
  let q = read(root)
  const handoff = q.handoffs.find(x => x.role === 'repair')
  assert.ok(handoff)
  fs.writeFileSync(path.join(handoff.cwd, 'a.txt'), 'native repair\n')
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  const file = path.join(repo, '.agentflow/ag.json'), config = JSON.parse(fs.readFileSync(file))
  config['looper-limits']['max-repairs'] = 0
  delete config['looper-routes'].task // no new task remains; route is irrelevant to repair import
  delete config['looper-routes'].acceptance
  fs.writeFileSync(file, JSON.stringify(config))
  assert.equal(await L.run(root, { agent, checks }), 2)
  q = read(root)
  assert.equal(q.handoffs.find(x => x.id === handoff.id).completed, true, 'import already dispatched repair before applying new settings')
  assert.equal(q.groups[0].repairs, 1)
  assert.equal(q.groups[0].suspended_integration.phase, 'review')
  assert.ok(q.questions.some(x => /looper-routes.acceptance required/.test(x.question)))
  config['looper-routes'].acceptance = { kind: 'cli', provider: 'claude', 'model-family': 'acceptance' }
  fs.writeFileSync(file, JSON.stringify(config))
  fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: q.questions.find(x => !x.answer).id, answer: 'Review route restored; retain repaired candidate.', source: 'host' }]))
  assert.equal(await L.run(root, { agent: async args => {
    assert.ok(['review', 'acceptance'].includes(args.role), 'no task/repair replay')
    return result(args.attempt)
  }, checks }), 0)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'native repair\n')
  assert.equal(read(root).handoffs.filter(x => x.role === 'repair').length, 1)
})

test('request file supplies exact original text to a real Git task and survives status without mutation', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt']])
  const original = '原始需求\r\nWrite a.txt without changing owner content.\r\n'
  fs.writeFileSync(path.join(root, q.request), original)
  q.request_sha256 = crypto.createHash('sha256').update(original).digest('hex')
  write(root, q)
  const before = fs.readFileSync(path.join(root, 'queue.json'))
  assert.match(L.status(root), /planned/)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), before)
  assert.equal(await L.run(root, { checks, agent: async args => {
    assert.ok(args.prompt.includes(`Original authorized request (context only; execute the selected task): ${original}\nExplicit session overrides:`))
    return agent(args)
  } }), 0)
  assert.equal(read(root).groups[0].state, 'done')
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'G1/T1-1\n')
  assert.equal(fs.readFileSync(path.join(root, q.request), 'utf8'), original)
})

test('invalid request files fail before claims or worktrees', async t => {
  const cases = {
    missing: ({ q }) => { q.request = 'missing.md' },
    empty: ({ root }) => fs.writeFileSync(path.join(root, 'request.md'), ''),
    directory: ({ q }) => { q.request = 'directory' },
    absolute: ({ root, q }) => { q.request = path.join(root, 'request.md') },
    traversal: ({ q }) => { q.request = '../request.md' },
    symlink: ({ root, q }) => { fs.symlinkSync('request.md', path.join(root, 'alias.md')); q.request = 'alias.md' },
    changed: ({ root }) => fs.appendFileSync(path.join(root, 'request.md'), ' changed'),
    inline: ({ q }) => { q.request = 'Implement every original task.' },
    digest: ({ q }) => { q.request_sha256 = 'not-a-digest' },
    invalid_utf8: ({ root }) => fs.writeFileSync(path.join(root, 'request.md'), Buffer.from([0xff])),
    old_schema: ({ q }) => { q.schema_version = 1 }
  }
  for (const [name, change] of Object.entries(cases)) await t.test(name, async st => {
    const f = fixture([['a.txt']])
    fs.mkdirSync(path.join(f.root, 'directory'))
    try { change(f) } catch (error) {
      if (name !== 'symlink' || process.platform !== 'win32' || error.code !== 'EPERM') throw error
      st.skip('Windows file-symlink privilege unavailable (EPERM); refusal remains unproved'); return
    }
    write(f.root, f.q)
    const errors = { missing: /ENOENT/, empty: /nonempty UTF-8/, directory: /regular file/, absolute: /relative path/, traversal: /Unsafe path/, symlink: /Symlink path refused/, changed: /Original request changed/, inline: /ENOENT/, digest: /request_sha256 required/, invalid_utf8: /nonempty UTF-8/, old_schema: /Queue schema 2.*prior runtime/ }
    await assert.rejects(L.run(f.root), errors[name], name)
    assert.equal(fs.existsSync(path.join(f.root, '.queue.owner')), false)
    assert.equal(fs.existsSync(path.join(f.repo, '.wts')), false)
    assert.equal(git(f.repo, 'rev-parse', 'HEAD'), f.q.base_commit)
  })
})

test('request mutation after a native pause blocks resume while status preserves diagnostics', { timeout: 30000 }, async () => {
  const { root, q } = fixture([['a.txt']], { task: { ...selection, kind: 'native' } })
  assert.equal(await L.run(root, { checks }), 2)
  const saved = read(root), original = fs.readFileSync(path.join(root, q.request))
  fs.appendFileSync(path.join(root, q.request), '\nchanged original')
  await assert.rejects(L.run(root, { checks }), /Original request changed/)
  assert.match(L.status(root), /Request input blocked: Original request changed/)
  assert.deepEqual(read(root), saved)
  fs.writeFileSync(path.join(root, q.request), original)
  assert.doesNotThrow(() => L.load(root))
})

test('coordinator requires host migration for old configuration schema without rewriting it', () => {
  const { repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json'), config = JSON.parse(fs.readFileSync(file))
  for (const version of ['aglite-5', 8, 9, 10, 11, 12, String(current_schema), current_schema + 1]) {
    config['schema-version'] = version; fs.writeFileSync(file, JSON.stringify(config))
    const before = fs.readFileSync(file)
    assert.throws(() => L.read_settings(repo), new RegExp(`migrate to integer ${current_schema} via the host`))
    assert.deepEqual(fs.readFileSync(file), before)
  }
  config['schema-version'] = current_schema; fs.writeFileSync(file, JSON.stringify(config))
  assert.doesNotThrow(() => L.read_settings(repo))
  delete config['schema-version']; fs.writeFileSync(file, JSON.stringify(config))
  assert.doesNotThrow(() => L.read_settings(repo))
})

test('dependency graphs start from checked integrated files and ancestry', { timeout: 30000 }, async () => {
  for (const edges of [[[], [], [], ['G1', 'G2', 'G3']], [[], ['G1'], ['G1'], ['G1'], ['G2', 'G3', 'G4']]]) {
    const { root, repo, q } = fixture(edges.map((_, i) => [`output-${i}.txt`]), { max_workers: 3 })
    q.groups.forEach((g, i) => { g.depends_on = edges[i] }); write(root, q)
    assert.equal(await L.run(root, { checks, agent: async args => {
      const saved = read(root), group = saved.groups.find(g => args.prompt.includes(`Group ${g.id},`))
      for (const dependency of group.depends_on) {
        const ancestor = saved.groups.find(g => g.id === dependency)
        assert.equal(ancestor.state, 'done')
        assert.throws(() => git(repo, 'cat-file', '-e', `${q.base_commit}:${ancestor.tasks[0].allowed_paths[0]}`),
          'the initial base cannot supply dependency outputs')
        assert.ok(fs.existsSync(path.join(args.cwd, ancestor.tasks[0].allowed_paths[0])))
        assert.equal(git(repo, 'merge-base', ancestor.integration.result, group.workspace.base), ancestor.integration.result)
      }
      return agent(args)
    } }), 0)
    assert.ok(read(root).groups.every(g => g.state === 'done'))
  }
})

test('invalid dependency edges refuse before claims or worktrees', async () => {
  for (const value of [null, 'G1', {}, [1], ['missing'], ['G2'], ['G1', 'G1'], ['G3']]) {
    const { root, repo, q } = fixture([['a.txt'], ['b.txt'], ['c.txt']])
    q.groups[1].depends_on = value; write(root, q)
    await assert.rejects(L.run(root, { agent, checks }), /depends_on/)
    assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
    assert.equal(fs.existsSync(path.join(repo, '.wts')), false)
  }
})

test('blocked ancestor leaves dependent unstarted while independent group integrates', { timeout: 30000 }, async () => {
  const { root, q } = fixture([['a.txt'], ['archive.txt'], ['independent.txt']], { max_workers: 1 })
  q.groups[1].depends_on = ['G1']; write(root, q)
  assert.equal(await L.run(root, { checks, agent: async args => args.prompt.includes('Group G1,')
    ? result(args.attempt, 'blocked') : agent(args) }), 2)
  const saved = read(root)
  assert.equal(saved.groups[0].state, 'blocked')
  assert.equal(saved.groups[1].workspace, undefined)
  assert.equal(saved.groups[2].state, 'done')
  assert.match(L.status(root), /G2: pending;.*unmet dependencies G1\n  records not started/)
})

test('dependent native pause resumes same workspace and refuses missing integration proof', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt'], ['archive.txt']], { task: { ...selection, kind: 'native' } })
  q.groups[1].depends_on = ['G1']; write(root, q)
  const noCli = async () => { throw Error('CLI substitution forbidden') }
  const finish = handoff => {
    task_edit({ cwd: handoff.cwd, prompt: fs.readFileSync(handoff.assignment, 'utf8') })
    fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
    fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  }
  assert.equal(await L.run(root, { agent: noCli, checks }), 2)
  assert.equal(read(root).groups[1].workspace, undefined)
  finish(read(root).handoffs[0])
  assert.equal(await L.run(root, { agent: noCli, checks }), 2)
  const paused = read(root), workspace = paused.groups[1].workspace, handoff = paused.handoffs.at(-1)
  assert.ok(fs.existsSync(path.join(workspace.worktree, 'a.txt')))
  assert.equal(git(repo, 'merge-base', paused.groups[0].integration.result, workspace.base), paused.groups[0].integration.result)
  fs.writeFileSync(path.join(workspace.worktree, 'archive.txt'), 'unfinished dependent edit\n')
  assert.equal(await L.run(root, { agent: noCli, checks }), 2)
  assert.deepEqual(read(root).groups[1].workspace, workspace)
  assert.equal(fs.readFileSync(path.join(workspace.worktree, 'archive.txt'), 'utf8'), 'unfinished dependent edit\n')
  const broken = read(root); delete broken.groups[0].integration; write(root, broken)
  await assert.rejects(L.run(root, { agent: noCli, checks }), /Completed group lacks checked integration proof/)
  assert.equal(fs.readFileSync(path.join(workspace.worktree, 'archive.txt'), 'utf8'), 'unfinished dependent edit\n')
  write(root, paused)
  finish(handoff)
  assert.equal(await L.run(root, { agent: noCli, checks }), 0)
  assert.deepEqual(read(root).groups[1].workspace, workspace)
})

test('dependent starts against latest forward target after its ancestor integrates', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt'], ['archive.txt']])
  q.groups[1].depends_on = ['G1']; write(root, q)
  let moved = false
  assert.equal(await L.run(root, { agent, checks, on_save: saved => {
    if (moved || saved.groups[0].state !== 'done') return
    moved = true
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner history\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'owner move')
  } }), 0)
  assert.ok(read(root).groups[1].workspace)
  assert.equal(read(root).target_adoptions.length, 1)
  const unproved = read(root); delete unproved.groups[0].integration; write(root, unproved)
  await assert.rejects(L.run(root, { agent, checks }), /Completed group lacks checked integration proof/)
  assert.ok(read(root).groups[1].workspace)
})

for (const outcome of ['blocked', 'repair', 'needs_owner']) test(`answered CLI ${outcome} creates a fresh task attempt while retaining stopped evidence`, { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let original, savedResult, calls = 0, marker, product
  assert.equal(await L.run(root, { checks, agent: async args => {
    calls++; original = structuredClone(args.attempt)
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    product = path.join(args.cwd, 'a.txt')
    fs.writeFileSync(product, 'preserved unfinished product\n')
    marker = path.join(args.cwd, '.aglite-records/.devlog.md.owner')
    fs.writeFileSync(marker, JSON.stringify({ session: original.id }))
    const response = result(args.attempt, outcome)
    savedResult = JSON.stringify(response)
    fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), savedResult)
    fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0, aborted: false, timed_out: false }))
    return response
  } }), 2)
  const blocked = read(root), question = blocked.questions[0]
  assert.equal(fs.existsSync(marker), false)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'attempts', original.id, 'notebook-owner.released.json'))).session, original.id)
  const forbidden = async () => { calls++; throw Error('Unanswered blocked attempt repeated') }
  assert.equal(await L.run(root, { checks, agent: forbidden }), 2)
  assert.equal(calls, 1)
  answer(root, question, 'host')
  if (outcome === 'needs_owner') {
    await assert.rejects(L.run(root, { checks, agent: forbidden }), /actual owner answer/)
    assert.equal(calls, 1)
    answer(root, question, 'owner')
  }
  assert.equal(await L.run(root, { checks, agent: async args => {
    calls++
    assert.notEqual(args.attempt.id, original.id)
    assert.match(args.prompt, /Correction supplied; continue/)
    assert.ok(args.prompt.includes(`Use generated workflow session UUID ${args.attempt.id}`))
    assert.equal(args.prompt.includes(`Use generated workflow session UUID ${original.id}`), false)
    assert.equal(fs.readFileSync(product, 'utf8'), 'preserved unfinished product\n')
    assert.equal(fs.existsSync(marker), false)
    fs.writeFileSync(product, 'preserved unfinished product\ncompleted correction\n')
    closeout(args.cwd)
    return result(args.attempt)
  } }), 0)
  assert.equal(calls, 2)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'preserved unfinished product\ncompleted correction\n')
  assert.equal(fs.readFileSync(path.join(root, 'attempts', original.id, 'result.json'), 'utf8'), savedResult)
  assert.deepEqual(read(root).groups[0].tasks[0].result.outcome, 'pass')
})

for (const [outcome, prior_answer] of [['blocked', false], ['needs_owner', false], ['needs_owner', true]]) test(`crashed CLI ${outcome} imports its blocker without retry${prior_answer ? ' despite an older answered question' : ''}`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  let calls = 0, crash_image, crashed_attempt
  const stopped = async args => {
    calls++
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    const current = prior_answer && calls === 1 ? 'blocked' : outcome
    const response = result(args.attempt, current)
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'unfinished crash-window product\n')
    fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), JSON.stringify(response))
    fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0, aborted: false, timed_out: false }))
    if (!prior_answer || calls === 2) crashed_attempt = args.attempt.id
    return response
  }
  const capture = q => {
    if (!crashed_attempt || crash_image || q.groups[0].state !== 'working' || q.groups[0].attempt?.id !== crashed_attempt) return
    crash_image = structuredClone(q) // Durable image after transport stop, before collect records the question.
  }
  assert.equal(await L.run(root, { checks, agent: stopped, on_save: capture }), 2)
  if (prior_answer) {
    answer(root, read(root).questions[0], 'host')
    assert.equal(await L.run(root, { checks, agent: stopped, on_save: capture }), 2)
  }
  assert.ok(crash_image)
  assert.equal(crash_image.questions.filter(q => !q.answer).length, 0)
  assert.equal(crash_image.groups[0].retry_attempt, undefined)
  write(root, crash_image)
  const before = calls
  assert.equal(await L.run(root, { checks, agent: async () => { calls++; throw Error('Crashed nonpass retried without answer') } }), 2)
  assert.equal(calls, before)
  const saved = read(root), question = saved.questions.find(q => !q.answer)
  assert.equal(saved.groups[0].state, 'blocked')
  assert.equal(saved.groups[0].attempt.id, crashed_attempt)
  assert.equal(question.requires_owner, outcome === 'needs_owner')
  assert.equal(fs.readFileSync(path.join(saved.groups[0].workspace.worktree, 'a.txt'), 'utf8'), 'unfinished crash-window product\n')
})


test('configuration discovery selects deeply nested ag-dir and passes its exact inherited path', async () => {
  const { root, repo } = fixture([['a.txt']])
  const relative = 'docs/agent/records/one/two/notes/ag.json'
  const old = path.join(repo, '.agentflow/ag.json'), file = path.join(repo, relative)
  const config = JSON.parse(fs.readFileSync(old))
  config.switches = { ...config.switches, 'ag-dir': path.posix.dirname(relative) }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  git(repo, 'mv', '.agentflow/ag.json', relative)
  fs.writeFileSync(file, JSON.stringify(config))
  git(repo, 'add', relative); git(repo, 'commit', '-m', 'custom configuration')
  const queue = read(root); queue.base_commit = git(repo, 'rev-parse', 'HEAD'); write(root, queue)
  // Bundled source, nested checkout and isolated record configs are not this config.
  for (const [directory, ag_dir] of [['skills/example/assets/.agentflow', '.agentflow'],
    ['.wts/other/notes', '.wts/other/notes'], ['.aglite-records', '.aglite-records']]) {
    fs.mkdirSync(path.join(repo, directory), { recursive: true })
    fs.writeFileSync(path.join(repo, directory, 'ag.json'), JSON.stringify({ switches: { 'ag-dir': ag_dir } }))
  }
  fs.writeFileSync(path.join(repo, '.wts/other/.git'), 'gitdir: elsewhere')
  const settings = L.read_settings(repo)
  assert.equal(settings.file, relative)
  assert.equal(L.select(settings, 'task').source.file, relative)
  assert.equal(await L.run(root, { checks, agent: async args => {
    assert.ok(args.prompt.includes(`read inherited configuration only at ${path.join(args.cwd, relative)}`))
    assert.ok(args.prompt.includes('record-only session override'))
    assert.ok(fs.existsSync(path.join(args.cwd, relative)))
    task_edit(args); return result(args.attempt)
  } }), 0)
})

test('configuration collisions and legacy locations fail before claims or writes', async () => {
  const { root, repo } = fixture([['a.txt']])
  const canonical = path.join(repo, '.agentflow/ag.json'), legacy = path.join(repo, 'ag.json')
  const bytes = fs.readFileSync(canonical), queue = fs.readFileSync(path.join(root, 'queue.json'))
  fs.writeFileSync(legacy, bytes)
  await assert.rejects(L.run(root, { agent, checks }), /Configuration collision/)
  assert.deepEqual(fs.readFileSync(canonical), bytes)
  assert.deepEqual(fs.readFileSync(legacy), bytes)
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), queue)
  fs.renameSync(legacy, path.join(repo, 'saved-root.json'))
  const config = JSON.parse(bytes); config.switches = { 'ag-dir': 'notes' }; config['schema-version'] = 10
  fs.writeFileSync(canonical, JSON.stringify(config))
  await assert.rejects(L.run(root, { agent, checks }), /Legacy configuration.*relocate to <ag-dir>/)
  fs.mkdirSync(path.join(repo, 'notes'))
  config['schema-version'] = current_schema
  fs.writeFileSync(path.join(repo, 'notes/ag.json'), JSON.stringify(config))
  await assert.rejects(L.run(root, { agent, checks }), /Configuration collision/)
  config['schema-version'] = current_schema
  fs.writeFileSync(canonical, JSON.stringify(config))
  await assert.rejects(L.run(root, { agent, checks }), /Misplaced configuration.*owner reconciliation/)
  // Both canonical candidates also conflict even if each is valid independently.
  fs.writeFileSync(canonical, bytes)
  await assert.rejects(L.run(root, { agent, checks }), /Configuration collision/)
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), queue)
})

test('current config requires the bundled schema and safe ag-dir, without rewriting source', () => {
  const { repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json'), original = fs.readFileSync(file)
  for (const version of [9, 10, 11, 12, 'aglite-5', String(current_schema), current_schema + 1]) {
    const config = JSON.parse(original); config['schema-version'] = version
    const bytes = JSON.stringify(config); fs.writeFileSync(file, bytes)
    assert.throws(() => L.read_settings(repo), new RegExp(`migrate to integer ${current_schema}`))
    assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  }
  for (const value of ['../escape', '/absolute', '', null, 42]) {
    const config = JSON.parse(original); config.switches = { 'ag-dir': value }
    fs.writeFileSync(file, JSON.stringify(config))
    assert.throws(() => L.read_settings(repo), /relative path|Unsafe path/)
  }
  const config = JSON.parse(original); delete config['schema-version']
  fs.writeFileSync(file, JSON.stringify(config)); assert.doesNotThrow(() => L.read_settings(repo))
})

test('saving-mode accepts exact on/off and refuses missing or invalid values before claims', async () => {
  const { root, repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json'), original = fs.readFileSync(file)
  const queue = fs.readFileSync(path.join(root, 'queue.json'))
  for (const value of ['on', 'off']) {
    const config = JSON.parse(original); config.switches['saving-mode'] = value
    const bytes = JSON.stringify(config); fs.writeFileSync(file, bytes)
    assert.equal(L.read_settings(repo).config.switches['saving-mode'], value)
    assert.equal(fs.readFileSync(file, 'utf8'), bytes)
  }
  for (const value of [undefined, null, true, false, '', 'ON', 'auto', 0]) {
    const config = JSON.parse(original)
    if (value === undefined) delete config.switches['saving-mode']
    else config.switches['saving-mode'] = value
    const bytes = JSON.stringify(config); fs.writeFileSync(file, bytes)
    await assert.rejects(L.run(root, { agent: async () => assert.fail('must not dispatch'), checks }),
      value === undefined ? /saving-mode missing.*migrate/ : /saving-mode must be on or off/)
    assert.equal(fs.readFileSync(file, 'utf8'), bytes)
    assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), queue)
    assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
    assert.equal(fs.readdirSync(path.join(repo, '.git')).filter(name => /^aglite-target-.*\.owner$/.test(name)).length, 0)
    assert.equal(fs.existsSync(path.join(repo, '.wts')), false)
  }
})

test('canonical configuration refuses symlinked directories and files', t => {
  for (const directory of [true, false]) {
    const { repo } = fixture([['a.txt']])
    const file = path.join(repo, '.agentflow/ag.json')
    if (directory) {
      const saved = path.join(repo, 'saved-config')
      fs.renameSync(path.dirname(file), saved)
      if (!symlink_or_skip(t, saved, path.dirname(file), 'junction')) return
    } else {
      const saved = path.join(repo, '.agentflow/saved.json')
      fs.renameSync(file, saved)
      if (!symlink_or_skip(t, saved, file)) return
    }
    assert.throws(() => L.read_settings(repo), /Symlink path refused/)
  }
})

test('unresolved custom configs and symlinks never silently select defaults', t => {
  const { repo } = fixture([['a.txt']])
  const file = path.join(repo, '.agentflow/ag.json')
  fs.renameSync(file, path.join(repo, '.agentflow/saved.json'))
  fs.mkdirSync(path.join(repo, 'custom'))
  const custom = path.join(repo, 'custom/ag.json')
  fs.writeFileSync(custom, '{ invalid')
  assert.throws(() => L.read_settings(repo), /No canonical.*custom\/ag.json/)
  fs.renameSync(custom, path.join(repo, 'custom/saved.json'))
  if (!symlink_or_skip(t, path.join(repo, 'custom/saved.json'), custom)) return
  assert.throws(() => L.read_settings(repo), /Symlink path refused/)
})


test('CRLF task and closeout readers preserve original bytes and reject mixed duplicate headings', () => {
  const { root, repo } = fixture([['T-001', 'T-002']])
  const q = read(root), group = q.groups[0], task = group.tasks[0]
  const file = path.join(root, group.file)
  const source = fs.readFileSync(file, 'utf8').replace(/\r?\n/g, '\r\n')
  fs.writeFileSync(file, source)
  const hash = q.request_sha256
  L.validate(q, root)
  const expected = source.slice(source.indexOf(`## ${task.id}\r\n`)).split(/\r\n## /)[0]
  assert.equal(L.task_text(root, group, task), expected)
  assert.equal(q.request_sha256, hash)
  fs.appendFileSync(file, `\n## ${task.id}\nDuplicate\n`)
  assert.throws(() => L.validate(q, root), /duplicate task section/)
  assert.throws(() => L.task_text(root, group, task), /duplicate/)
  fs.mkdirSync(path.join(repo, '.aglite-records'))
  fs.writeFileSync(path.join(repo, '.aglite-records/devlog.md'), '# → Ask / A-001\r\n\r\n# → Reply / A-001\r\n\r\nClosed\r\n\r\n# → Ask / A-002\r\n')
  assert.equal(L.ordinary_closeout(repo, {}), 1)
})

test('reserved task directories are case insensitive while Unix filenames stay valid', () => {
  const S = require('./looper-state')
  for (const name of ['a:b', 'x.', 'x ', 'CON.txt', 'com¹.log', 'LPT9', 'CONIN$', 'bad?', 'bad\x01'])
    assert.equal(S.windows_component(name), false, name)
  for (const name of ['normal.txt', 'GIT~1', 'context', 'com10', '~1']) assert.equal(S.windows_component(name), true, name)
  const { root, repo } = fixture([['T-001']])
  const q = read(root)
  for (const name of ['.GIT/x', '.Wts/x', '.AGLITE-records/x']) {
    q.groups[0].tasks[0].allowed_paths = [name]
    assert.throws(() => L.validate(q, root), /Reserved task path/)
  }
  if (process.platform !== 'win32')
    for (const name of ['a:b', 'x.', 'x ', 'CON.txt', 'GIT~1']) assert.equal(S.safe_path(repo, name), path.join(repo, name))
})

test('Windows executable resolution preserves wrapper argv and refuses ambiguous logic/cwd lookup', () => {
  const { resolve_command } = require('./looper-agent')
  // Independent fixture for cmd-shim's generated template, not a fake native CLI.
  const wrapper = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n\r\nIF EXIST "%dp0%\\node.exe" (\r\n  SET "_prog=%dp0%\\node.exe"\r\n) ELSE (\r\n  SET "_prog=node"\r\n  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n)\r\n\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" "%dp0%\\node_modules\\tool\\cli.js" %*\r\n'
  const files = new Map([['C:\\bin\\tool.CMD', wrapper], ['C:\\bin\\node_modules\\tool\\cli.js', ''], ['C:\\node\\node.exe', ''], ['C:\\cwd\\planted.EXE', '']])
  const options = { platform: 'win32', env: { Path: '.;C:\\bin;C:\\node', PATHEXT: '.EXE;.CMD' }, cwd: 'C:\\work', exists: name => files.has(name), read: name => files.get(name), node: 'C:\\known\\node.exe' }
  const argv = ['a b', '"quoted"', '& echo bad', '%PATH%', '繁體\n😀']
  assert.deepEqual(resolve_command(['tool', ...argv], options), ['C:\\known\\node.exe', 'C:\\bin\\node_modules\\tool\\cli.js', ...argv])
  files.set('C:\\bin\\node.exe', '')
  assert.equal(resolve_command(['tool'], options)[0], 'C:\\bin\\node.exe')
  assert.deepEqual(resolve_command(['C:\\explicit\\entry.js', ...argv], options), ['C:\\known\\node.exe', 'C:\\explicit\\entry.js', ...argv])
  const local = wrapper.replace('node_modules\\tool\\cli.js', '..\\tool\\cli.js').replace('"%_prog%" "', '"%_prog%"  "')
  files.set('C:\\work\\node_modules\\.bin\\tool.cmd', local)
  files.set('C:\\work\\node_modules\\tool\\cli.js', '')
  assert.deepEqual(resolve_command(['./node_modules/.bin/tool.cmd', ...argv], options), ['C:\\known\\node.exe', 'C:\\work\\node_modules\\tool\\cli.js', ...argv])
  const current = local.replace('  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n', '')
    .replace('& "%_prog%"', '& set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"')
  files.set('C:\\work\\node_modules\\.bin\\tool.cmd', current)
  assert.equal(resolve_command(['./node_modules/.bin/tool.cmd'], options)[1], 'C:\\work\\node_modules\\tool\\cli.js')
  assert.deepEqual(resolve_command(['./verify.js', ...argv], options), ['C:\\known\\node.exe', 'C:\\work\\verify.js', ...argv])
  assert.throws(() => resolve_command(['C:verify.js'], options), /Drive-relative/)
  files.set('C:\\bin\\tool.CMD', wrapper.replace('%*', '--hidden %*'))
  assert.throws(() => resolve_command(['tool'], options), /Unsupported Windows wrapper.*native .exe/)
  files.set('C:\\bin\\npm.CMD', '@echo off\r\ncall npm-prefix.js\r\n')
  assert.throws(() => resolve_command(['npm'], options), /prefix\/custom wrapper logic is unsupported/)
  assert.throws(() => resolve_command(['planted'], options), /not found/)
  for (const name of ['C:\\bin\\custom.bat', 'C:\\bin\\custom.ps1', 'C:\\bin\\extensionless']) {
    files.set(name, 'echo surprise')
    assert.throws(() => resolve_command([name], options), /Unsupported Windows wrapper/)
  }
})

test('Windows ancestry compares full creation ticks and retains evidence on malformed enumeration', () => {
  const { observe_descendants } = require('./looper-agent')
  const tracked = new Map(), tick = '638000000000000001'
  const scan = snapshot => observe_descendants(10, tracked, `win32:${tick}`, { platform: 'win32', snapshot })
  const children = scan(`10 1 0 ${tick}\r\n11 10 0 638000000000000000\r\n12 10 0 ${tick}\r\n13 12 0 638000000000000002\r\n14 12 0 638000000000000000`)
  assert.deepEqual(children.map(child => child.pid), [12, 13])
  const before = [...tracked]
  assert.throws(() => scan(`10 1 0 ${tick}\nmalformed`), error => error.unsettled === true)
  assert.deepEqual([...tracked], before)
  assert.throws(() => scan(''), error => error.unsettled === true)
  assert.deepEqual([...tracked], before)
})

test('process enumeration failure makes execution unsettled and preserves recorded process evidence', async () => {
  const { execute } = require('./looper-agent')
  const S = require('./looper-state')
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-process-unknown-')))
  const claim_file = path.join(root, 'claim.json'), claim = S.acquire_claim(claim_file)
  const process_file = path.join(root, 'process.json')
  await assert.rejects(execute({ command: [process.execPath, '-e', 'setTimeout(() => {}, 150)'], cwd: root,
    log: path.join(root, 'transcript.log'), on_launch: identity => S.write_json(process_file, identity),
    observe: () => { throw Error('injected query timeout') } }), error => error.unsettled === true)
  assert.equal(S.read_json(claim_file).token, claim.token)
  const primary = S.read_json(process_file)
  assert.ok(primary.started_at)
  for (let i = 0; i < 100 && S.process_alive(primary) !== false; i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(S.process_alive(primary), false, 'test-owned child is proved stopped before test completion')
  assert.ok(fs.existsSync(path.join(root, 'transcript.log')))
})

test('directory junctions are refused as task paths', () => {
  const S = require('./looper-state')
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-junction-')))
  fs.mkdirSync(path.join(root, 'target'))
  fs.symlinkSync(path.join(root, 'target'), path.join(root, 'alias'), 'junction')
  assert.throws(() => S.safe_path(root, 'alias/file'), /Symlink path refused/)
})


test('unknown and reused descendant identities are never signalled', () => {
  const { signal_descendants } = require('./looper-agent')
  const tracked = new Map([1, 2, 3, 4].map(pid => [pid, { pid, started_at: pid === 4 ? null : 'win32:100' }]))
  const sent = []
  signal_descendants(tracked, 'SIGKILL', { identify: pid => pid === 1 ? null : pid === 2 ? 'win32:101' : 'win32:100', send: (...args) => sent.push(args) })
  assert.deepEqual(sent, [[3, 'SIGKILL']])
  assert.equal(tracked.size, 4, 'unknown identities remain recorded')
})


test('omitted known Windows processes require independent stop proof; closed root is handle evidence only', () => {
  const { observe_descendants } = require('./looper-agent')
  const item = { pid: 12, started_at: 'win32:638000000000000002' }
  const snapshot = '0 0 0 ?\r\n4 0 0 ?\r\n10 1 0 638000000000000001\r\n13 12 0 638000000000000003'
  const tracked = new Map([[12, item]])
  const base = { platform: 'win32', snapshot }
  assert.throws(() => observe_descendants(10, tracked, 'win32:638000000000000001', { ...base, alive: () => 'unknown' }), error => error.unsettled === true)
  assert.deepEqual([...tracked.values()], [item])
  assert.deepEqual(observe_descendants(10, tracked, 'win32:638000000000000001', { ...base, alive: () => true }).map(row => row.pid), [13])
  assert.equal(tracked.has(12), true)
  observe_descendants(10, tracked, 'win32:638000000000000001', { ...base, alive: () => false })
  assert.equal(tracked.has(12), false)
  assert.throws(() => observe_descendants(99, new Map(), null, { platform: 'win32', snapshot: '99 1 0 638000000000000001', alive: () => true }), error => error.unsettled === true)
  assert.deepEqual(observe_descendants(99, new Map(), null, { platform: 'win32', snapshot: '0 0 0 ?\n4 0 0 ?', root_stopped: true,
    alive: () => { throw Error('closed own root must not be mistaken for an unknown live PID') } }), [])
})


test('POSIX process group cleanup survives immediate leader exit before ancestry polling', { skip: process.platform === 'win32' ? 'POSIX process-group guarantee; Windows uses identified descendants' : false }, async () => {
  const { execute } = require('./looper-agent')
  const S = require('./looper-state')
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-orphan-group-')))
  const pid_file = path.join(root, 'child.json')
  const source = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); fs.writeFileSync(${JSON.stringify(pid_file)}, JSON.stringify({ pid: child.pid })); child.unref()`
  let observation
  try { observation = await execute({ command: [process.execPath, '-e', source], cwd: root, log: path.join(root, 'transcript.log') }) }
  catch (error) { assert.equal(error.unsettled, true) }
  const child = JSON.parse(fs.readFileSync(pid_file))
  for (let i = 0; i < 50 && S.process_identity(child.pid); i++) await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(S.process_identity(child.pid), null, 'orphan in the owned process group must be stopped')
  if (observation) assert.equal(observation.exit_code, 0)
})

test('CRLF Git exclude rules are recognized without rewriting or appending bytes', () => {
  const G = require('./looper-integration')
  const { q } = fixture([['a.txt']])
  q.expected_head = q.base_commit
  const group = q.groups[0], cwd = G.prepare_group(q, group, () => {})
  const exclude = path.resolve(cwd, G.git(cwd, ['rev-parse', '--git-path', 'info/exclude']))
  const original = Buffer.from('# owner excludes\r\n/.aglite-records/\r\n/.aglite-records/.devlog.md.owner\r\n')
  fs.writeFileSync(exclude, original)
  G.prepare_group(q, group, () => {})
  G.prepare_group(q, group, () => {})
  assert.deepEqual(fs.readFileSync(exclude), original)
})

test('ordinary closeout proves localized phase sequence without reading labels', () => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-locale-closeout-')))
  fs.mkdirSync(path.join(cwd, '.aglite-records'))
  const file = path.join(cwd, '.aglite-records/devlog.md')
  for (const [ask, reply] of [['Ask', 'Reply'], ['提問', '回覆'], ['質問', '回答']]) {
    const first = `# → ${ask} / A-001 (owner)`
    const answer = `# → ${reply} / A-001`
    const next = `# → ${ask} / A-002`
    const valid = [first, answer, next]
    for (const newline of ['\n', '\r\n']) {
      fs.writeFileSync(file, valid.join(newline + newline) + newline)
      assert.equal(L.ordinary_closeout(cwd, {}), 1)
      assert.throws(() => L.ordinary_closeout(cwd, { previous_round: 1 }))
    }
    for (const invalid of [
      [first, next], [first, answer], [first, first, next], [first, answer, answer, next],
      [first, answer, next, `# → ${ask} / A-3`],
      [first, answer, `# → ${ask} / A-003`],
      [first, next, answer], [first, answer, next, answer],
      [first, answer, `# → ${reply} / A-002`],
      [first, '```md', answer, '```', next],
      [first, '~~~', answer, '~~~', next],
      [first, `> ${answer}`, next], [first, `    ${answer}`, next]
    ]) {
      fs.writeFileSync(file, invalid.join('\n\n'))
      assert.throws(() => L.ordinary_closeout(cwd, {}), invalid.join(' | '))
    }
  }
})

test('real Git localized task host creates its notebook and receives exact ownership facts', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  const config = path.join(repo, '.agentflow/ag.json')
  const settings = JSON.parse(fs.readFileSync(config))
  settings.switches = { ...settings.switches, 'use-lang': 'zh-TW' }
  fs.writeFileSync(config, JSON.stringify(settings))
  git(repo, 'add', '.agentflow/ag.json'); git(repo, 'commit', '-m', 'locale fixture')
  const q = read(root); q.base_commit = git(repo, 'rev-parse', 'HEAD'); write(root, q)
  // Call the real runner directly: the fake task host performs its own rendering.
  assert.equal(await real_run(root, { checks, agent: async args => {
    if (args.role !== 'task') return result(args.attempt)
    const file = path.join(args.cwd, '.aglite-records/devlog.md')
    assert.equal(fs.existsSync(file), false, 'coordinator creates no English scaffold')
    assert.equal(args.attempt.previous_round, 0)
    assert.ok(args.prompt.includes(`UUID ${args.attempt.id}`))
    assert.ok(args.prompt.includes(`project fixture/G1; notebook .aglite-records/devlog.md`))
    assert.ok(args.prompt.includes(`checkout ${args.cwd}; branch ${git(args.cwd, 'branch', '--show-current')}.`))
    assert.match(args.prompt, /switches.use-lang/)
    fs.writeFileSync(file, `# 狀態\n\n專案：fixture/G1\n\n筆記本：.aglite-records/devlog.md\n\n工作目錄：${args.cwd}\n\n分支：${git(args.cwd, 'branch', '--show-current')}\n\n目前：A-002\n\n已證實：A-001\n\n下一步：等待任務\n\n已封存時期：無\n\n# → 提問 / A-001\n\n# → 回覆 / A-001\n\n已完成。\n\n# → 提問 / A-002\n`)
    fs.writeFileSync(path.join(args.cwd, '.aglite-records/.devlog.md.owner'), JSON.stringify({ session: args.attempt.id }))
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), '完成\n')
    return result(args.attempt)
  } }), 0)
  assert.equal(read(root).groups[0].tasks[0].round, 1)
})

test('saved task with a missing notebook blocks resume without recreating or dispatching', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    const response = result(args.attempt)
    fs.writeFileSync(path.join(args.attempt_dir, 'exit.json'), JSON.stringify({ exit_code: 0 }))
    fs.writeFileSync(path.join(args.attempt_dir, 'result.json'), JSON.stringify(response))
    fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'product completed\n')
    return response // Deliberately leaves ordinary closeout unfinished.
  } }), 2)
  const saved = read(root)
  const file = path.join(saved.groups[0].workspace.worktree, '.aglite-records/devlog.md')
  fs.renameSync(file, file + '.preserved')
  answer(root, saved.questions[0], 'host')
  let dispatched = false
  await assert.rejects(real_run(root, { checks, agent: async () => { dispatched = true; throw Error('must not dispatch') } }), /Active isolated notebook is missing/)
  assert.equal(dispatched, false)
  assert.equal(fs.existsSync(file), false)
  assert.equal(read(root).groups[0].attempt.id, saved.groups[0].attempt.id)
})

for (const native of [false, true]) test(`lost initialized ${native ? 'native' : 'CLI'} notebook cannot be recreated by an owner answer`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], native ? { task: { ...selection, kind: 'native' } } : {})
  let calls = 0
  const worker = async args => { calls++; return result(args.attempt, 'needs_owner') }
  assert.equal(await L.run(root, { checks, agent: worker }), 2)
  if (native) {
    const handoff = read(root).handoffs[0]
    render_notebook(handoff.cwd)
    fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
    fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }, 'needs_owner'), writer_stopped: true }))
    assert.equal(await L.run(root, { checks, agent: worker }), 2)
  }
  const saved = read(root)
  const file = path.join(saved.groups[0].workspace.worktree, '.aglite-records/devlog.md')
  fs.renameSync(file, file + '.preserved')
  if (!native) { delete saved.groups[0].notebook_initialized; write(root, saved) } // Existing CLI record without the new observation fact.
  answer(root, saved.questions[0]) // Omitted source follows the ordinary owner inbox path.
  await assert.rejects(real_run(root, { checks, agent: async () => { calls++; throw Error('must not redispatch') } }), /Active isolated notebook is missing/)
  assert.equal(calls, native ? 0 : 1)
  assert.equal(fs.existsSync(file), false)
  assert.equal(read(root).groups[0].attempt.id, saved.groups[0].attempt.id)
})

test('native initial pending absence is valid, but observed initialized notebook loss blocks waiting', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt'], ['b.txt']], { task: { ...selection, kind: 'native' }, max_workers: 1 })
  assert.equal(await real_run(root, { checks }), 2)
  const initial = read(root), handoff = initial.handoffs[0]
  const file = path.join(handoff.cwd, '.aglite-records/devlog.md')
  assert.equal(fs.existsSync(file), false)
  assert.equal(fs.statSync(path.dirname(file)).isDirectory(), true)
  assert.equal(await real_run(root, { checks }), 2)
  assert.equal(read(root).groups[0].state, 'native')
  render_notebook(handoff.cwd)
  assert.equal(await real_run(root, { checks }), 2) // Coordinator observes initialization.
  fs.renameSync(file, file + '.preserved')
  assert.equal(await real_run(root, { checks }), 2)
  assert.equal(read(root).groups[0].state, 'blocked')
  assert.match(read(root).questions.at(-1).question, /Active isolated notebook is missing/)
  assert.match(read(root).handoffs[0].error, /Active isolated notebook is missing/)
  assert.match(L.status(root), /Native .*Active isolated notebook is missing/)
  assert.equal(read(root).handoffs[0].completed, false)
  assert.equal(read(root).handoffs.length, 1)
  assert.equal(read(root).groups[1].workspace, undefined, 'unsettled native handoff keeps its worker slot while blocked')
  assert.equal(fs.existsSync(file), false)
  fs.renameSync(file + '.preserved', file)
  assert.equal(await real_run(root, { checks }), 2)
  assert.equal(read(root).groups[0].state, 'blocked', 'restoring bytes does not answer the recovery question')
  assert.equal(read(root).handoffs[0].error, null)
  answer(root, read(root).questions.at(-1), 'host')
  assert.equal(await real_run(root, { checks }), 2)
  assert.equal(read(root).groups[0].state, 'native', 'explicit recovery reuses its reserved slot')
  assert.equal(read(root).handoffs.length, 1)
  assert.equal(read(root).groups[1].workspace, undefined)
  task_edit({ cwd: handoff.cwd, prompt: fs.readFileSync(handoff.assignment, 'utf8') })
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox', `${handoff.id}.json`), JSON.stringify({ ...result({ id: handoff.id }), writer_stopped: true }))
  assert.equal(await real_run(root, { checks }), 2)
  assert.equal(read(root).groups[0].state, 'done')
  assert.equal(read(root).groups[0].tasks[0].result.attempt_id, handoff.id)
})

test('native saved completed round proves missing notebook even without initialization flag', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { task: { ...selection, kind: 'native' } })
  assert.equal(await real_run(root, { checks }), 2)
  const saved = read(root)
  saved.groups[0].attempt.previous_round = 1
  delete saved.groups[0].notebook_initialized
  write(root, saved)
  assert.equal(await real_run(root, { checks }), 2)
  const blocked = read(root)
  assert.equal(blocked.groups[0].state, 'blocked')
  assert.match(blocked.handoffs[0].error, /Active isolated notebook is missing/)
  assert.equal(blocked.handoffs[0].completed, false)
  assert.equal(blocked.handoffs.length, 1)
})

test('owner answer to a pre-workspace task blocker still permits first notebook creation', { timeout: 30000 }, async () => {
  const { root, q } = fixture([['a.txt']])
  const question = { id: crypto.randomUUID(), group_id: 'G1', kind: 'task', requires_owner: false, question: 'Worktree setup requires correction.' }
  q.groups[0].state = 'blocked'
  q.questions = [question]
  write(root, q)
  answer(root, question)
  assert.equal(await L.run(root, { checks, agent }), 0)
})

for (const replacement of [false, true]) test(`startup notebook inspection leaves ${replacement ? 'unrelated replacement' : 'missing recorded worktree'} untouched`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']])
  assert.equal(await L.run(root, { checks, agent: async args => result(args.attempt, 'needs_owner') }), 2)
  const cwd = read(root).groups[0].workspace.worktree
  fs.renameSync(cwd, cwd + '.preserved')
  if (replacement) {
    fs.mkdirSync(cwd)
    fs.writeFileSync(path.join(cwd, 'unrelated.txt'), 'preserve exactly\n')
  }
  let dispatched = false
  assert.equal(await real_run(root, { checks, agent: async () => { dispatched = true; throw Error('must not dispatch') } }), 2)
  assert.equal(dispatched, false)
  assert.equal(fs.existsSync(path.join(cwd, '.aglite-records')), false)
  if (replacement) {
    assert.deepEqual(fs.readdirSync(cwd), ['unrelated.txt'])
    assert.equal(fs.readFileSync(path.join(cwd, 'unrelated.txt'), 'utf8'), 'preserve exactly\n')
  } else assert.equal(fs.existsSync(cwd), false)
})

test('presentation observes a real checked integration without changing claims or queue authority', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['result.txt']])
  const R = require('./looper-report'), lines = []
  const observer = R.observer({ write: s => lines.push(s) })
  assert.equal(await L.run(root, { agent, checks, on_save: observer.update }), 0)
  const saved = read(root)
  assert.equal(saved.phase, 'complete')
  assert.equal(saved.groups[0].state, 'done')
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  assert.equal(fs.readdirSync(path.join(repo, '.git')).some(name => /^aglite-target-.*\.owner$/.test(name)), false)
  assert.ok(lines.some(line => /G1\/T1-1: checking/.test(line)))
  const before = fs.readFileSync(path.join(root, 'queue.json'))
  const report = R.save_report(root, observer.snapshot(), { code: 0 })
  assert.match(report.content, /Tasks completed: 1\/1; Groups integrated: 1\/1/)
  assert.match(report.content, /integrated target/)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), before)
})

test('expanded status is byte-read-only with invalid worker settings and request', () => {
  const { root, repo } = fixture([['result.txt']])
  const config = path.join(repo, '.agentflow/ag.json')
  fs.writeFileSync(config, '{invalid settings')
  fs.writeFileSync(path.join(root, 'request.md'), 'changed input')
  const inventory = directory => {
    const list = []
    const walk = base => {
      for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
        const file = path.join(base, entry.name)
        if (entry.isDirectory()) walk(file)
        else list.push([file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')])
      }
    }
    walk(directory); return list
  }
  const before = [inventory(root), inventory(repo)]
  const output = L.status(root)
  assert.match(output, /^Run fixture: planned\n\nTasks 0\/1; groups 0\/1\n\nTarget:/)
  assert.match(output, /Request input blocked: Original request changed/)
  assert.match(output, /Declared output paths/)
  assert.deepEqual([inventory(root), inventory(repo)], before)
})

test('CLI interrupt reports stopped only after coordinator settlement and clears signal listeners', { timeout: 30000 }, async () => {
  const { root } = fixture([['result.txt']])
  const { main } = require('./agf'), stdout = [], stderr = []
  const before = { interrupt: process.listenerCount('SIGINT'), terminate: process.listenerCount('SIGTERM') }
  let workerStopped = false
  const code = await main(['looper', 'run', root], {
    stdout: { write: s => stdout.push(s) }, stderr: { write: s => stderr.push(s) },
    run: (directory, options) => L.run(directory, { ...options, checks, agent: async args => {
      process.emit('SIGINT')
      assert.equal(args.signal.aborted, true)
      workerStopped = true
      return result(args.attempt, 'blocked')
    } })
  })
  assert.equal(code, 2); assert.ok(workerStopped)
  assert.equal(read(root).phase, 'stopped')
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
  assert.match(stdout.join(''), /STOPPED — work preserved/)
  assert.match(stderr.join(''), /Run phase: stopped/)
  assert.equal(process.listenerCount('SIGINT'), before.interrupt)
  assert.equal(process.listenerCount('SIGTERM'), before.terminate)
})

test('CLI reports the six-task blocked journey with preserved drafts and waiting ZIP', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['joke.md', 'joke.2.md'], ['poem.md', 'poem.story.md'], ['news.md'], ['all.zip']])
  const q = read(root); q.groups[3].depends_on = ['G1', 'G2', 'G3']; write(root, q)
  const { main } = require('./agf'), stdout = [], stderr = []
  const code = await main(['looper', 'run', root], {
    stdout: { write: s => stdout.push(s) }, stderr: { write: s => stderr.push(s) },
    run: (directory, options) => L.run(directory, { ...options, checks, agent: async args => {
      const news = args.prompt.includes('Group G3,')
      if (!news) {
        const file = args.prompt.includes('Group G1,') ? 'joke.md' : 'poem.md'
        fs.writeFileSync(path.join(args.cwd, file), 'draft awaiting review\n')
      }
      return { ...result(args.attempt, 'blocked'), summary: news
        ? 'Reliable source pages could not be retrieved.'
        : 'Required review startup: Operation not permitted.' }
    } })
  })
  assert.equal(code, 2)
  const saved = read(root)
  assert.equal(saved.groups[3].workspace, undefined)
  for (const [i, file] of [[0, 'joke.md'], [1, 'poem.md']]) {
    assert.ok(fs.existsSync(path.join(saved.groups[i].workspace.worktree, file)))
    assert.equal(fs.existsSync(path.join(repo, file)), false)
  }
  assert.match(stdout.join(''), /Tasks completed: 0\/6; Groups integrated: 0\/4/)
  assert.match(stdout.join(''), /G4: WAITING \(pending\)\n    Waiting for checked dependencies: G1, G2, G3/)
  assert.match(stdout.join(''), /Required review startup: Operation not permitted/)
  assert.match(stdout.join(''), /Reliable source pages could not be retrieved/)
  assert.match(stdout.join(''), /Saved report:/)
  assert.equal(fs.existsSync(path.join(root, '.queue.owner')), false)
})

for (const moment of ['checks', 'landing']) test(`forward target at ${moment} carries checked repaired result without task replay`, { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: selection })
  let tasks = 0, repairs = 0, combined = 0, moved = false
  const advance = () => {
    if (moved) return
    moved = true
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner forward\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'owner forward')
  }
  assert.equal(await L.run(root, { agent: async args => {
    if (args.role === 'task') { tasks++; return agent(args) }
    if (args.role === 'repair') { repairs++; fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'accepted repair\n') }
    return result(args.attempt)
  }, checks: async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-')) {
      combined++
      if (combined === 1) return args.ids.map(id => ({ id, passed: false }))
      if (moment === 'checks' && combined === 2) advance()
    }
    return checks(args)
  }, on_save: q => { if (moment === 'landing' && q.integration?.phase === 'landing') advance() } }), 0)
  const q = read(root), previous = q.groups[0].integration_history[0]
  assert.equal(tasks, 1); assert.equal(repairs, 1)
  assert.ok(combined >= 3)
  assert.equal(q.groups[0].integration.source, previous.result)
  assert.equal(fs.readFileSync(path.join(previous.worktree, 'a.txt'), 'utf8'), 'accepted repair\n')
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'accepted repair\n')
})

test('landing recovery recognizes result ancestor and refuses landed then removed history', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let image
  assert.equal(await L.run(root, { agent, checks, on_save: q => {
    if (q.integration?.phase !== 'landing' || image) return
    image = structuredClone(q)
    git(repo, 'merge', '--ff-only', q.integration.result)
    throw Error('crash after effect')
  } }), 2)
  fs.writeFileSync(path.join(repo, 'later.txt'), 'later\n')
  git(repo, 'add', 'later.txt'); git(repo, 'commit', '-m', 'later')
  write(root, image)
  assert.equal(await L.run(root, { checks, agent: async () => { throw Error('replay') } }), 0)
  git(repo, 'reset', '--hard', image.integration.base)
  fs.writeFileSync(path.join(repo, 'removed.txt'), 'owner\n')
  git(repo, 'add', 'removed.txt'); git(repo, 'commit', '-m', 'removed landed history')
  write(root, image)
  await assert.rejects(L.run(root, { agent, checks }), /uncertain|removed/)
})

test('changed contracts receive original/current context and independent review acceptance', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt']], { acceptance: selection })
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Original requirement.\n')
  git(repo, 'add', 'AGENTS.md'); git(repo, 'commit', '-m', 'original contract')
  q.base_commit = git(repo, 'rev-parse', 'HEAD'); write(root, q)
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'Compatible current requirement.\n')
  git(repo, 'add', 'AGENTS.md'); git(repo, 'commit', '-m', 'current contract')
  const roles = []
  let advanced = false
  assert.equal(await L.run(root, { checks, agent: async args => {
    roles.push(args.role)
    assert.match(args.prompt, /Original requirement/)
    assert.match(args.prompt, /Compatible current requirement/)
    return args.role === 'task' ? agent(args) : result(args.attempt)
  }, on_save: saved => {
    if (advanced || saved.integration?.phase !== 'verified' || !saved.integration.acceptance_result) return
    advanced = true
    fs.writeFileSync(path.join(repo, 'later.txt'), 'unrelated owner advance\n')
    git(repo, 'add', 'later.txt'); git(repo, 'commit', '-m', 'unrelated owner advance')
  } }), 0)
  assert.deepEqual(roles, ['task', 'review', 'acceptance'])
  const integrated = read(root).groups[0].integration
  assert.match(integrated.accepted_contracts_sha256, /^[a-f0-9]{64}$/)
  assert.equal(integrated.accepted_contracts, undefined)
  assert.ok(integrated.supersedes)
})

test('adoption refuses branch mismatch, rewrite and foreign operations; status stays read-only', () => {
  const G = require('./looper-integration')
  const { root, repo, q } = fixture([['a.txt']])
  q.expected_head = q.base_commit
  git(repo, 'checkout', '-b', 'other')
  assert.throws(() => G.adopt_target(q, () => {}, 'test'), /branch mismatch/)
  git(repo, 'checkout', 'main')
  fs.writeFileSync(path.join(repo, 'next.txt'), 'next\n')
  git(repo, 'add', 'next.txt'); git(repo, 'commit', '-m', 'next')
  q.expected_head = git(repo, 'rev-parse', 'HEAD')
  git(repo, 'reset', '--hard', q.base_commit)
  assert.throws(() => G.adopt_target(q, () => {}, 'test'), /history rewrite/)
  q.expected_head = q.base_commit
  const lock = path.join(repo, '.git', 'index.lock')
  fs.writeFileSync(lock, 'foreign')
  assert.throws(() => G.adopt_target(q, () => {}, 'test'), /Foreign Git operation/)
  fs.renameSync(lock, `${lock}.retained`)
  q.lane_error = 'one specific lane blocker'; write(root, q)
  const before = fs.readFileSync(path.join(root, 'queue.json'))
  const output = L.status(root)
  assert.match(output, /Target: expected main@/)
  assert.match(output, /Target actual:.*main/)
  assert.equal(output.split('one specific lane blocker').length - 1, 1)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), before)
})

test('adopted conflicting owner commit uses bounded repair review acceptance', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['shared.txt']], { repair: selection, acceptance: selection })
  const roles = []
  assert.equal(await L.run(root, { checks, agent: async args => {
    roles.push(args.role)
    if (args.role === 'task') {
      fs.writeFileSync(path.join(repo, 'shared.txt'), 'owner change\n')
      git(repo, 'add', 'shared.txt'); git(repo, 'commit', '-m', 'owner conflict')
      return agent(args)
    }
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'shared.txt'), 'owner change and task outcome\n')
    return result(args.attempt)
  } }), 0)
  assert.deepEqual(roles, ['task', 'repair', 'review', 'acceptance'])
  assert.equal(read(root).groups[0].repairs, 1)
})

test('unapplied landing intent carries forward with covering reflog; missing coverage blocks', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let image
  assert.equal(await L.run(root, { agent, checks, on_save: q => {
    if (q.integration?.phase !== 'landing' || image) return
    image = structuredClone(q)
    throw Error('crash before effect')
  } }), 2)
  fs.writeFileSync(path.join(repo, 'later.txt'), 'later\n')
  git(repo, 'add', 'later.txt'); git(repo, 'commit', '-m', 'owner later')
  const unknown = structuredClone(image)
  delete unknown.integration.landing_reflog
  write(root, unknown)
  await assert.rejects(L.run(root, { agent, checks }), /coverage missing/)
  write(root, image)
  assert.equal(await L.run(root, { checks, agent: async () => { throw Error('task replay') } }), 0)
  assert.equal(read(root).groups[0].integration.source, image.integration.result)
})

test('dirty contract changes at landing intent require fresh exact acceptance', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt']], { acceptance: selection })
  fs.writeFileSync(path.join(repo, 'contract.md'), 'original\n')
  git(repo, 'add', 'contract.md'); git(repo, 'commit', '-m', 'original contract')
  q.base_commit = git(repo, 'rev-parse', 'HEAD'); q.contracts = ['contract.md']; write(root, q)
  let changed = false
  const accepted = []
  assert.equal(await L.run(root, { checks, agent: async args => {
    if (args.role === 'acceptance') { accepted.push(args.prompt); assert.match(args.prompt, /owner dirty update/) }
    return args.role === 'task' ? agent(args) : result(args.attempt)
  }, on_save: saved => {
    if (changed || saved.integration?.phase !== 'landing') return
    changed = true
    fs.writeFileSync(path.join(repo, 'contract.md'), 'owner dirty update\n')
  } }), 0)
  assert.equal(accepted.length, 1)
  assert.equal(fs.readFileSync(path.join(repo, 'contract.md'), 'utf8'), 'owner dirty update\n')
})

test('repeated compatible advances while adoption is saved settle without a lane blocker', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let remaining = 2, tasks = 0
  const advance = () => {
    const file = `outside-${remaining}.txt`
    fs.writeFileSync(path.join(repo, file), 'owner forward\n')
    git(repo, 'add', file); git(repo, 'commit', '-m', file)
  }
  advance()
  assert.equal(await L.run(root, { checks, agent: async args => { tasks++; return agent(args) }, on_save: q => {
    if (remaining && q.target_adoptions?.length) { remaining--; advance() }
  } }), 0)
  assert.equal(tasks, 1)
  assert.equal(read(root).target_adoptions.length, 3)
  assert.equal(read(root).lane_error, null)
})

test('carry preparation target race retries before intent and archives previous attempt once', { timeout: 30000 }, async () => {
  const G = require('./looper-integration')
  const original = G.prepare_integration
  const { root, repo } = fixture([['a.txt']])
  let tasks = 0, advanced = false, raced = false
  const advance = file => {
    fs.writeFileSync(path.join(repo, file), 'owner forward\n')
    git(repo, 'add', file); git(repo, 'commit', '-m', file)
  }
  G.prepare_integration = (queue, group, save, previous) => {
    if (previous && !raced) { raced = true; advance('carry-race.txt') }
    return original(queue, group, save, previous)
  }
  try {
    assert.equal(await L.run(root, { agent: async args => { tasks++; return agent(args) }, checks: async args => {
      if (!advanced && path.basename(args.cwd).startsWith('aglite-merge-')) {
        advanced = true; advance('checked-race.txt')
      }
      return checks(args)
    } }), 0)
  } finally { G.prepare_integration = original }
  const group = read(root).groups[0]
  assert.equal(tasks, 1)
  assert.equal(raced, true)
  assert.equal(group.integration_history.length, 1)
  assert.equal(group.integration.supersedes, group.integration_history[0].id)
  assert.equal(group.integration.source, group.integration_history[0].result)
})

test('repair owner question survives compatible advance in integration error handler', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt'], ['b.txt']], { repair: selection, acceptance: selection })
  assert.equal(await L.run(root, { checks: async args => args.ids.map(id => ({ id, passed: !path.basename(args.cwd).includes('merge-fixture-G1') })), agent: async args => {
    if (args.role === 'task') return agent(args)
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'repair-time owner advance')
    return { ...result(args.attempt, 'needs_owner'), summary: 'Choose required behavior.' }
  } }), 2)
  const q = read(root)
  assert.equal(q.lane_error, null)
  assert.equal(q.questions[0].requires_owner, true)
  assert.match(q.questions[0].question, /Choose required behavior/)
  assert.equal(q.groups[1].state, 'done')
})

test('post-landing lock preserves saved checked completion and is lane-only', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  const lock = path.join(repo, '.git/index.lock')
  let locked = false
  try {
    assert.equal(await L.run(root, { agent, checks, on_save: q => {
      if (!locked && q.groups[0].state === 'done') { locked = true; fs.writeFileSync(lock, 'owner lock') }
    } }), 0)
    const q = read(root)
    assert.equal(q.groups[0].state, 'done')
    assert.match(q.lane_error, /Foreign Git operation/)
    assert.equal(q.questions.length, 0)
  } finally { if (fs.existsSync(lock)) fs.renameSync(lock, `${lock}.retained`) }
})

test('prepared carried merge recovery retains checked repair and never repeats task', { timeout: 30000 }, async () => {
  const G = require('./looper-integration'), original = G.prepare_integration
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: selection })
  let tasks = 0, combined = 0, crashed = false
  const worker = async args => {
    if (args.role === 'task') { tasks++; return agent(args) }
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'accepted repair\n')
    return result(args.attempt)
  }
  G.prepare_integration = (q, g, save, previous) => original(q, g, () => {
    save()
    if (previous && !crashed && q.integration.phase === 'prepared') { crashed = true; throw Error('prepared carry crash') }
  }, previous)
  try {
    assert.equal(await L.run(root, { agent: worker, checks: async args => {
      if (path.basename(args.cwd).startsWith('aglite-merge-')) {
        combined++
        if (combined === 1) return args.ids.map(id => ({ id, passed: false }))
        if (combined === 2) {
          fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner\n')
          git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'advance repaired result')
        }
      }
      return checks(args)
    } }), 2)
  } finally { G.prepare_integration = original }
  const stopped = read(root)
  assert.equal(stopped.groups[0].suspended_integration.phase, 'prepared')
  answer(root, stopped.questions[0], 'host')
  assert.equal(await L.run(root, { agent: worker, checks }), 0)
  assert.equal(tasks, 1)
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'accepted repair\n')
})

test('landing overlap blocks lane while unrelated existing workspace finishes its next task', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt'], ['b.txt', 'c.txt']])
  const lane = deferred()
  let second_started = false
  fs.writeFileSync(path.join(repo, 'a.txt'), 'owner pending\n')
  assert.equal(await L.run(root, { checks, agent: async args => {
    if (args.prompt.includes('task T2-2;')) second_started = true
    const done = await agent(args)
    if (args.prompt.includes('task T2-1;')) await lane.promise
    return done
  }, on_save: q => { if (q.lane_error) lane.resolve() } }), 2)
  const q = read(root)
  assert.equal(second_started, true)
  assert.ok(q.groups[1].tasks.every(task => task.state === 'done'))
  assert.equal(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'owner pending\n')
})

test('answered integration correction reaches fresh repair review acceptance exactly once', { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { repair: selection, acceptance: selection })
  let resumed = false, requestRepair = true, combined = 0, tasks = 0
  const observed = []
  const worker = async args => {
    if (args.role === 'task') { tasks++; return agent(args) }
    if (resumed) {
      observed.push(args.role)
      assert.equal(args.prompt.split('Resolved answers/corrections (').length - 1, 1)
      assert.equal(args.prompt.split('Correction supplied; continue.').length - 1, 1)
      assert.match(args.prompt, /"answer_source":"host"/)
      assert.match(args.prompt, /host technical corrections grant no new scope/)
      assert.equal(args.prompt.includes('Owner answers:'), false)
    }
    if (args.role === 'review') {
      if (!resumed) return result(args.attempt, 'blocked')
      if (requestRepair) { requestRepair = false; return result(args.attempt, 'repair') }
    }
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'restored exact outcome\n')
    return result(args.attempt)
  }
  const combinedChecks = async args => {
    if (path.basename(args.cwd).startsWith('aglite-merge-') && ++combined === 1)
      return args.ids.map(id => ({ id, passed: false }))
    return checks(args)
  }
  assert.equal(await L.run(root, { agent: worker, checks: combinedChecks }), 2)
  answer(root, read(root).questions[0], 'host')
  resumed = true
  assert.equal(await L.run(root, { agent: worker, checks: combinedChecks }), 0)
  assert.deepEqual(observed, ['review', 'repair', 'review', 'acceptance'])
  assert.equal(tasks, 1)
})

test('resumed old-base repair checks only ancestral groups then carry checks latest files', { timeout: 30000 }, async () => {
  const { root, q } = fixture([['a.txt'], ['b.txt']], { repair: selection, acceptance: selection })
  for (const key of ['a', 'b']) q.checks[key] = { command: [process.execPath, '-e', 'process.exit(0)'] }
  q.groups[0].tasks[0].checks = ['a']; q.groups[1].tasks[0].checks = ['b']; write(root, q)
  const release = deferred(), observations = []
  let resumed = false, requestRepair = true, repairs = 0, firstFailure = true
  const worker = async args => {
    if (args.role === 'task') {
      if (args.prompt.includes('Group G2,')) await release.promise
      return agent(args)
    }
    if (args.role === 'repair') { repairs++; fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'exact restored output\n') }
    if (args.role === 'review' && args.prompt.includes('T1-1')) {
      if (!resumed) { release.resolve(); return result(args.attempt, 'blocked') }
      if (requestRepair) { requestRepair = false; return result(args.attempt, 'repair') }
    }
    return result(args.attempt)
  }
  const fileChecks = async args => {
    const combined = path.basename(args.cwd).startsWith('aglite-merge-')
    const hasB = fs.existsSync(path.join(args.cwd, 'b.txt'))
    if (combined) observations.push({ resumed, ids: [...args.ids], hasB })
    return args.ids.map(id => {
      let passed = id === 'product' || fs.existsSync(path.join(args.cwd, `${id}.txt`))
      if (combined && args.ids.includes('a') && firstFailure) { firstFailure = false; passed = false }
      return { id, passed }
    })
  }
  assert.equal(await L.run(root, { agent: worker, checks: fileChecks }), 2)
  const stopped = read(root)
  assert.equal(stopped.groups[1].state, 'done')
  assert.equal(stopped.groups[0].suspended_integration.phase, 'review')
  answer(root, stopped.questions[0], 'host'); resumed = true
  assert.equal(await L.run(root, { agent: worker, checks: fileChecks }), 0)
  assert.equal(repairs, 2)
  assert.ok(observations.some(item => item.resumed && item.ids.includes('a') && !item.hasB && !item.ids.includes('b')))
  assert.ok(observations.some(item => item.resumed && item.ids.includes('a') && item.hasB && item.ids.includes('b')))
})

for (const corrected of [false, true]) test(`host technical correction rechecks at exhausted repair budget; checker passes=${corrected}`, { timeout: 30000 }, async () => {
  const { root } = fixture([['a.txt']], { max_repairs: 1, repair: selection, acceptance: selection })
  let passing = false, repairs = 0, combined = 0
  const worker = async args => {
    if (args.role === 'task') return agent(args)
    if (args.role === 'repair') { repairs++; fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'exact candidate\n') }
    return result(args.attempt)
  }
  const validator = async args => {
    const isCombined = path.basename(args.cwd).startsWith('aglite-merge-')
    if (isCombined) combined++
    return args.ids.map(id => ({ id, passed: !isCombined || passing }))
  }
  assert.equal(await L.run(root, { agent: worker, checks: validator }), 2)
  const stopped = read(root), before = combined
  assert.equal(stopped.groups[0].repairs, 1)
  assert.equal(stopped.groups[0].suspended_integration.reason, 'failed combined checks')
  answer(root, stopped.questions[0], 'host'); passing = corrected
  assert.equal(await L.run(root, { agent: worker, checks: validator }), corrected ? 0 : 2)
  assert.ok(combined > before, 'actual combined checks must rerun')
  assert.equal(repairs, 1, 'technical recheck does not spend or bypass repair budget')
  assert.equal(read(root).groups[0].state === 'done', corrected)
})

test('CLI grouped success reads summaries actually persisted by the coordinator', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['poem.md']])
  const { main } = require('./agf'), stdout = []
  const code = await main(['looper', 'run', root], {
    stdout: { write: value => stdout.push(value) }, stderr: { write() {} },
    run: (directory, options) => L.run(directory, { ...options, checks, agent: async args => ({
      ...await agent(args), summary: 'Created poem.md about the sea.'
    }) })
  })
  assert.equal(code, 0)
  assert.equal(read(root).groups[0].tasks[0].result.summary, 'Created poem.md about the sea.')
  assert.match(stdout.join(''), /G1: SUCCESS \(done\)\n    T1-1: SUCCESS — task checked \(done\); integrated target/)
  assert.match(stdout.join(''), /Created poem.md about the sea\./)
  assert.ok(stdout.join('').includes(path.join(repo, 'poem.md')))
  assert.equal(fs.existsSync(path.join(repo, 'poem.md')), true)
  const report = require('./looper-report')
  assert.match(fs.readFileSync(path.join(root, 'results.md'), 'utf8'), /Result: COMPLETE/)
  const disk = fs.readFileSync(path.join(root, 'queue.json'))
  report.save_report(root, read(root), { code: 0, locale: 'en-us' })
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), disk)
  fs.writeFileSync(path.join(root, '.results-leftover.tmp'), 'retained prepared report')
  const before_status = fs.readFileSync(path.join(root, 'queue.json'))
  assert.match(L.status(root), /Latest results:/)
  assert.deepEqual(fs.readFileSync(path.join(root, 'queue.json')), before_status)
  const target = git(repo, 'rev-parse', 'HEAD')
  assert.equal(await L.run(root, { checks, agent: () => assert.fail('completed task dispatched again') }), 0)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), target)
  assert.equal(fs.readFileSync(path.join(root, '.results-leftover.tmp'), 'utf8'), 'retained prepared report')
})
