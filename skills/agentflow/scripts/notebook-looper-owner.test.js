'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn, spawnSync } = require('node:child_process')
const test = require('node:test')
const looper = require('./looper')
const owner = require('./notebook-owner')
const writer = require('./notebook-write')
const settings = require('./ag-settings')
const make_temp_directory = require('./fixtures/temp-directory')

// Retain disposable fixtures, including failed launch evidence, for inspection.
const fixture = () => {
  const root = fs.realpathSync(make_temp_directory('agf-looper-owner-'))
  const state_root = make_temp_directory('.agf-looper-owner-state-')
  const tasks_dir = path.join(root, 'planned')
  const notebook = 'devlog.md'
  fs.mkdirSync(tasks_dir)
  fs.writeFileSync(path.join(tasks_dir, 'plan-001.md'), '# Plan\n\nComplete one notebook round.\n')
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n')
  const state = path.join(state_root, 'agentflow', 'looper', crypto.createHash('sha256').update(tasks_dir).digest('hex'))
  const options = { root, tasks_dir, state_root, completion_path: notebook, silent: true,
    executable: process.execPath, build_args: () => ['-e', 'console.log("devlog.md updated")'] }
  return { root, state_root, tasks_dir, notebook, state, options }
}

const locked = (f, action) => {
  const lock = writer.acquire_close_round_lock(`${path.join(f.root, f.notebook)}.close-round.lock`)
  try { return action() } finally { writer.release_close_round_lock(lock) }
}
const inspect = f => owner.inspect({ root: f.root, notebook: f.notebook })
const claim = (f, session = 'other') => locked(f, () => owner.guard({ root: f.root, notebook: f.notebook, host: 'portable', session }))
const read = f => fs.readFileSync(path.join(f.root, f.notebook), 'utf8')
const complete = f => fs.appendFileSync(path.join(f.root, f.notebook), '\n# ← Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n\n+\n')
const attempt = f => JSON.parse(fs.readFileSync(path.join(f.state, '.looper-attempt.json'), 'utf8'))

test('standalone refuses a notebook owned by another session before launching or changing notebook evidence', async () => {
  const f = fixture()
  const config = settings.make_template('codex')
  config['schema-version'] = 7
  config.switches['target-doc'] = f.notebook
  const config_before = JSON.stringify(config)
  fs.writeFileSync(path.join(f.root, 'ag.json'), config_before)
  const held = claim(f)
  const before = read(f)
  const evidence = fs.readFileSync(held.file)
  let launches = 0
  const result = await looper.run_looper({ ...f.options, build_args: undefined, executable_available: () => true, spawn: (...args) => { launches += 1; complete(f); return spawn(...args) } })
  assert.equal(launches, 0, 'foreign ownership must refuse before the worker launches')
  assert.notEqual(result.code, 0)
  assert.match(result.message, /owner|session/i)
  assert.equal(read(f), before)
  assert.deepEqual(fs.readFileSync(held.file), evidence)
  assert.equal(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'), config_before)
  assert.equal(fs.existsSync(path.join(f.state, '.looper-attempt.json')), false)
  assert.equal(fs.existsSync(path.join(f.tasks_dir, '.stop.txt')), false)
})

test('standalone refuses an unresolved legacy or same-session Ask without a launch', async () => {
  for (const owned of [false, true]) {
    const f = fixture()
    if (owned) claim(f)
    fs.writeFileSync(path.join(f.root, f.notebook), '# → Ask / A-001\n\n+ unresolved work\n')
    const before = read(f)
    const evidence = inspect(f)
    let launches = 0
    const result = await looper.run_looper({ ...f.options, spawn: (...args) => { launches += 1; return spawn(...args) } })
    assert.notEqual(result.code, 0)
    assert.match(result.message, /empty.*Ask|unresolved/)
    assert.equal(launches, 0)
    assert.equal(read(f), before)
    assert.deepEqual(inspect(f), evidence)
    assert.equal(fs.existsSync(path.join(f.state, '.looper-attempt.json')), false)
  }
})

test('standalone reservation fences normal writers, skips child prompt hooks, and releases after archive proof', async () => {
  const f = fixture()
  let held
  const result = await looper.run_looper({ ...f.options, spawn: (executable, args, options) => {
    held = inspect(f).owner
    assert.equal(held.state, 'active')
    assert.equal(held.host, 'looper')
    assert.equal(attempt(f).notebook_ownership.token, held.token)
    assert.equal(fs.existsSync(`${path.join(f.root, f.notebook)}.close-round.lock`), false, 'model call cannot hold the notebook lock')
    const before = read(f)
    const foreign = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).append_input({root:process.cwd(),notebook:"devlog.md",host:"portable",session:"foreign",text:"foreign input"})', path.join(__dirname, 'notebook-write.js')], { cwd: f.root, encoding: 'utf8' })
    assert.notEqual(foreign.status, 0)
    assert.match(foreign.stderr, /belongs to looper session/)
    const hook = spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], { cwd: f.root, env: options.env, encoding: 'utf8',
      input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', cwd: f.root, session_id: 'worker-native-session', prompt: 'model task prompt' }) })
    assert.equal(hook.status, 0, hook.stderr)
    assert.match(options.env.AGENTFLOW_EXTERNAL_DELEGATE, /^looper-[a-f0-9]{64}$/)
    assert.equal(read(f), before)
    complete(f)
    return spawn(executable, args, options)
  } })
  assert.equal(result.code, 0, result.message)
  assert.equal(inspect(f).owner.state, 'released')
  assert.equal(inspect(f).owner.token, held.token)
  assert.equal(attempt(f).phase, 'completed')
  assert.equal(attempt(f).notebook_ownership.token, held.token)
  assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), true)
  assert.equal(claim(f, 'next').record.ask, 'A-002')
})

test('failed child and archive collision retain the reservation and attempt evidence', async () => {
  for (const failure of ['child', 'archive']) {
    const f = fixture()
    const result = await looper.run_looper({ ...f.options, build_args: () => ['-e', failure === 'child' ? 'process.exit(4)' : 'console.log("devlog.md updated")'], spawn: (...args) => {
      if (failure === 'archive') {
        complete(f)
        fs.writeFileSync(path.join(f.tasks_dir, 'done', 'plan-001.md'), 'preexisting archive\n')
      }
      return spawn(...args)
    } })
    assert.notEqual(result.code, 0)
    assert.match(result.message, failure === 'child' ? /code 4/ : /collision/)
    const held = inspect(f).owner
    assert.equal(held.state, 'active')
    assert.equal(attempt(f).notebook_ownership.token, held.token)
    assert.equal(attempt(f).phase, 'failed')
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'plan-001.md')), true)
    assert.throws(() => claim(f, 'foreign'), /belongs to|still owned/)
  }
})

const selection = {
  policy: { allowed_worker: ['host'], review_policy: 'prefer-independent', cli_provider: 'on' },
  host: { id: 'portable' }, task: { role: 'implementation', interactive_host: true, executor_choice: { kind: 'host', reason: 'fixture' } },
  capabilities: { host: { candidate_id: 'host:fixture', available: true } },
}
const interactive_options = f => ({ ...f.options, host: 'portable', session: 'interactive', worker_config: settings.make_template('codex'), selection_facts: selection })
const execution = c => ({ record_version: 1, task_id: c.task.name, attempt_id: c.owner_token, candidate_id: c.selection.candidate_id,
  kind: 'host', role: 'implementation', source_identity: c.source_identity, requested: {}, actual: { model: 'unknown', effort: 'unknown' }, state: 'completed',
  outputs: { completion_line: 'devlog.md updated' }, changed_paths: ['devlog.md'],
  acceptance: { checks_run: true, coordinator_inspected: true, accepted: true }, limitations: [], transport: { session_id: 'interactive' } })

test('interactive launch refuses a foreign owner or populated Ask and preserves notebook evidence', () => {
  for (const populated of [false, true]) {
    const f = fixture()
    const held = claim(f, populated ? 'interactive' : 'foreign')
    if (populated) fs.writeFileSync(path.join(f.root, f.notebook), '# → Ask / A-001\n\n+ unresolved interactive work\n')
    const before = read(f)
    const evidence = fs.readFileSync(held.file)
    assert.throws(() => looper.claim_host_plan(interactive_options(f)), /belongs to|empty.*Ask/)
    assert.equal(read(f), before)
    assert.deepEqual(fs.readFileSync(held.file), evidence)
    assert.equal(fs.existsSync(path.join(f.state, '.looper-attempt.json')), false)
  }
})

test('interactive host uses its retained identity and accepts an already verified host close', () => {
  const f = fixture()
  const status = { project: 'test', notebook: f.notebook, notebook_kind: 'root', current_commit: 'implementation pending', tests_scenarios: 'focused tests',
    config_path: 'ag.json', host: 'portable', validation: 'validated', proven: 'host completion checked', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] }
  fs.writeFileSync(path.join(f.root, 'ag.json'), JSON.stringify(settings.make_template('portable')) + '\n')
  fs.writeFileSync(path.join(f.root, f.notebook), `${settings.format_status(status)}---\n\n# → Ask / A-001 (Jeremy Lu)\n\n+\n`)
  const c = looper.claim_host_plan(interactive_options(f))
  assert.equal(c.notebook_ownership.host, 'portable')
  assert.equal(c.notebook_ownership.session, 'interactive')
  writer.append_input({ root: f.root, notebook: f.notebook, host: 'portable', session: 'interactive', text: 'Complete this plan.' })
  writer.close_round({ root: f.root, notebook: f.notebook, host: 'portable', session: 'interactive', input: { ask: 'A-001', run_events: [], status,
    reply: '# ← Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- The saved round is complete.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n' } })
  assert.equal(inspect(f).owner.state, 'released')
  assert.equal(looper.finish_host_plan(c, execution(c)).completed, true)
  assert.equal(inspect(f).owner.token, c.notebook_ownership.token)
})

test('interactive completion rejects a later owner even after a matching round was closed', () => {
  const f = fixture()
  const c = looper.claim_host_plan(interactive_options(f))
  complete(f)
  locked(f, () => owner.release(owner.guard({ root: f.root, notebook: f.notebook, host: 'portable', session: 'interactive', ask: 'A-001', allow_closed: true }), read(f)))
  const next = claim(f, 'later')
  assert.throws(() => looper.finish_host_plan(c, execution(c)), /owner changed/)
  assert.equal(inspect(f).owner.token, next.record.token)
  assert.equal(inspect(f).owner.state, 'active')
  assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), false)
})

test('different notebooks can be reserved independently', () => {
  const f = fixture()
  const first = looper.claim_host_plan(interactive_options(f))
  const other_tasks = path.join(f.root, 'other-planned')
  fs.mkdirSync(other_tasks)
  fs.writeFileSync(path.join(other_tasks, 'plan-001.md'), '# Other plan\n')
  fs.writeFileSync(path.join(f.root, 'other.md'), '# → Ask / A-001\n\n+\n')
  const second = looper.claim_host_plan({ ...interactive_options(f), tasks_dir: other_tasks, completion_path: 'other.md', session: 'another' })
  assert.notEqual(first.notebook_ownership.token, second.notebook_ownership.token)
  assert.equal(inspect(f).owner.token, first.notebook_ownership.token)
  assert.equal(owner.inspect({ root: f.root, notebook: 'other.md' }).owner.token, second.notebook_ownership.token)
})

test('interrupted and uncertain launches retain the reserved notebook identity', async () => {
  for (const interrupted of [false, true]) {
    const f = fixture()
    const result = await looper.run_looper({ ...f.options,
      ...(interrupted ? { build_args: () => ['-e', 'setInterval(() => {}, 1000)'], on_event: event => {
        if (event.event === 'child-started') setImmediate(() => process.emit('SIGTERM', 'SIGTERM'))
      } } : { crash_at: 'launch-intent-recorded' }),
    })
    assert.equal(result.code, interrupted ? 143 : 90, result.message)
    assert.equal(inspect(f).owner.state, 'active')
    assert.equal(attempt(f).notebook_ownership.token, inspect(f).owner.token)
    assert.equal(attempt(f).phase, interrupted ? 'interrupted' : 'launch-intent')
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'plan-001.md')), true)
    assert.throws(() => claim(f), /belongs to/)
  }
})

test('interactive named headings still require exactly one complete round', () => {
  const f = fixture()
  const c = looper.claim_host_plan(interactive_options(f))
  complete(f)
  fs.appendFileSync(path.join(f.root, f.notebook), '\n# ← Reply / A-002\n\nExtra round.\n\n# → Ask / A-003 (Jeremy Lu)\n\n+\n')
  assert.throws(() => looper.finish_host_plan(c, execution(c)), /exactly one/)
  assert.equal(inspect(f).owner.state, 'active')
  assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), false)
})
