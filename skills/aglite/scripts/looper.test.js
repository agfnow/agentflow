'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
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
  const config = { 'pipeline-roles': { implementation: 'basic', acceptance: 'better' }, 'model-family': {}, 'looper-routes': {}, 'looper-limits': { 'max-workers': max_workers, 'max-repairs': max_repairs } }
  for (const [role, value] of Object.entries({ task, repair, acceptance })) if (value) {
    config['looper-routes'][role] = { kind: value.kind, provider: value.provider, 'model-family': role }
    if (value.executable) config['looper-routes'][role].executable = value.executable
    config['model-family'][role] = { [role === 'acceptance' ? 'better' : 'basic']: `${value.model}/${value.effort}` }
  }
  fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(config))
  git(repo, 'add', '.gitignore', 'owner.txt', 'shared.txt', 'ag.json'); git(repo, 'commit', '-m', 'baseline')
  const q = { schema_version: 2, run_id: 'fixture', repo, target_branch: 'main', base_commit: git(repo, 'rev-parse', 'HEAD'), request: 'request.md', request_sha256: crypto.createHash('sha256').update('Implement every registered task while preserving owner content.').digest('hex'), authorization: { execute: true, worktrees: true, local_commits: true }, checks: { product: { command: [process.execPath, '-e', 'process.exit(0)'] } }, integration_checks: ['product'], groups: groups.map((tasks, i) => ({ id: `G${i + 1}`, file: `group-${String(i + 1).padStart(3, '0')}.md`, tasks: tasks.map((file, j) => ({ id: `T${i + 1}-${j + 1}`, allowed_paths: [file], checks: ['product'] })) })), ...queue_options }
  for (const group of q.groups) fs.writeFileSync(path.join(root, group.file), group.tasks.map(t => `## ${t.id}\n\nWrite ${t.allowed_paths[0]}.\n`).join('\n'))
  fs.writeFileSync(path.join(root, 'request.md'), 'Implement every registered task while preserving owner content.')
  write(root, q)
  return { root, repo, q }
}
const result = (attempt, outcome = 'pass') => ({ attempt_id: attempt.id, outcome, summary: outcome === 'pass' ? 'Completed assigned work.' : 'Which value should be used?', evidence: [] })
function closeout(cwd) {
  const file = path.join(cwd, '.aglite-records/devlog.md')
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

test('external target movement stops integration and preserves that target commit', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']])
  let moved
  assert.equal(await L.run(root, { checks, agent: async args => {
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner commit\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'outside lane')
    moved = git(repo, 'rev-parse', 'HEAD')
    return agent(args)
  } }), 2)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), moved)
  assert.match(read(root).lane_error, /Target moved/)
  assert.notEqual(read(root).groups[0].state, 'done')
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
  fs.writeFileSync(file, '# Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n')
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
  assert.equal(death.signal, 'SIGKILL', stderr)
  assert.equal(death.code, null)
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
    assert.equal(repairs.length, 2, 'moved target requires newly checked repair against its latest base')
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

test('startup target movement blocks only the lane while independent tasks finish', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt'], ['b.txt']])
  fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner change\n')
  git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'owner moved target')
  const actual = git(repo, 'rev-parse', 'HEAD')
  assert.equal(await L.run(root, { agent, checks }), 2)
  const q = read(root)
  assert.match(q.lane_error, /Target moved/)
  assert.ok(q.groups.every(group => group.tasks.every(task => task.state === 'done')))
  assert.ok(q.groups.every(group => group.state !== 'done'))
  assert.equal(git(repo, 'rev-parse', 'HEAD'), actual)
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
  const file = path.join(repo, 'ag.json')
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
  assert.ok(!Object.hasOwn(L.load(root), 'task_worker'))
})

test('invalid selected settings fail before claims; status remains read-only without valid settings', async () => {
  const { root, repo } = fixture([['a.txt']])
  const file = path.join(repo, 'ag.json'), original = fs.readFileSync(file, 'utf8')
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
  const first = read(root).handoffs
  assert.equal(first.length, 2)
  const file = path.join(repo, 'ag.json'), config = JSON.parse(fs.readFileSync(file))
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
  }
  const next = q.handoffs.find(x => !x.completed)
  assert.ok(next)
  assert.equal(next.selection.model, 'changed-model')
  assert.equal(next.selection.effort, 'high')
  assert.notEqual(next.selection.source.digest, first[0].selection.source.digest)
  assert.deepEqual(q.groups[0].attempt.selection, next.selection)
  task_edit({ cwd: next.cwd, prompt: fs.readFileSync(next.assignment, 'utf8') })
  fs.writeFileSync(path.join(root, 'inbox', `${next.id}.json`), JSON.stringify({ ...result({ id: next.id }), writer_stopped: true }))
  assert.equal(await L.run(root, { checks, agent: noCli }), 0)
  assert.equal(read(root).handoffs.length, 3, 'no completed task replayed')
})

test('a restarted repair cannot select its own CLI provider for a fresh review', { timeout: 30000 }, async () => {
  const { root, repo } = fixture([['a.txt']], { repair: selection, acceptance: { ...selection, provider: 'claude' } })
  let combined = 0, reviews = 0
  const perform = async args => {
    fs.mkdirSync(args.attempt_dir, { recursive: true })
    if (args.role === 'task') task_edit(args)
    if (args.role === 'repair') fs.writeFileSync(path.join(args.cwd, 'a.txt'), 'fixed\n')
    if (args.role === 'review') reviews++
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
  const file = path.join(repo, 'ag.json'), config = JSON.parse(fs.readFileSync(file))
  config['looper-routes'].acceptance.provider = 'codex'
  fs.writeFileSync(file, JSON.stringify(config))
  fs.mkdirSync(path.join(root, 'inbox'), { recursive: true })
  fs.writeFileSync(path.join(root, 'inbox/answers.json'), JSON.stringify([{ id: q.questions[0].id, answer: 'Recheck the preserved candidate.', source: 'host' }]))
  assert.equal(await L.run(root, { agent: perform, checks }), 2)
  q = read(root)
  assert.equal(reviews, 0)
  assert.ok(q.questions.some(x => /counterpart review/.test(x.question) && !x.answer))
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
  const file = path.join(repo, 'ag.json'), config = JSON.parse(fs.readFileSync(file))
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
  for (const [name, change] of Object.entries(cases)) await t.test(name, async () => {
    const f = fixture([['a.txt']])
    fs.mkdirSync(path.join(f.root, 'directory'))
    change(f); write(f.root, f.q)
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
  const file = path.join(repo, 'ag.json'), config = JSON.parse(fs.readFileSync(file))
  for (const version of ['aglite-5', 8, '9', 10]) {
    config['schema-version'] = version; fs.writeFileSync(file, JSON.stringify(config))
    const before = fs.readFileSync(file)
    assert.throws(() => L.read_settings(repo), /migrate to integer 9 via the host/)
    assert.deepEqual(fs.readFileSync(file), before)
  }
  config['schema-version'] = 9; fs.writeFileSync(file, JSON.stringify(config))
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
  assert.match(L.status(root), /G2: pending;.*unmet dependencies G1;.*not started/)
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

test('dependent does not start against moved target after its ancestor integrates', { timeout: 30000 }, async () => {
  const { root, repo, q } = fixture([['a.txt'], ['archive.txt']])
  q.groups[1].depends_on = ['G1']; write(root, q)
  let moved = false
  assert.equal(await L.run(root, { agent, checks, on_save: saved => {
    if (moved || saved.groups[0].state !== 'done') return
    moved = true
    fs.writeFileSync(path.join(repo, 'outside.txt'), 'owner history\n')
    git(repo, 'add', 'outside.txt'); git(repo, 'commit', '-m', 'owner move')
  } }), 2)
  assert.equal(read(root).groups[1].workspace, undefined)
  assert.match(read(root).lane_error, /Target moved/)
  const unproved = read(root); delete unproved.groups[0].integration; write(root, unproved)
  await assert.rejects(L.run(root, { agent, checks }), /Completed group lacks checked integration proof/)
  assert.equal(read(root).groups[1].workspace, undefined)
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
