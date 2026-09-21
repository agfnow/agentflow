'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { PassThrough } = require('node:stream')
const test = require('node:test')

const { HELP, notebook_round_state, parse_cli, queue_view, render_help, run_looper, workspace_defaults, write_all_sync } = require('./looper')
const agentflow_settings = require('./ag-settings')
const queue_contract = require('./queue-contract')
const make_temp_directory = require('./fixtures/temp-directory')

const completion_path = 'devlog.md'
const completion_line = `${completion_path} updated`

test('CLI defaults to the current planned directory and rejects malformed options', () => {
	assert.deepEqual(parse_cli([]), workspace_defaults(process.cwd()))
  assert.equal(parse_cli(['planned/custom']).tasks_dir, 'planned/custom')
  assert.equal(parse_cli(['--show-output']).show_output, true)
  assert.equal(parse_cli(['--reset']).reset, true)
  assert.throws(() => parse_cli(['--tasks-dir']), /requires a value/i)
  assert.throws(() => parse_cli(['--unknown']), /unknown option/i)
  assert.throws(() => parse_cli(['one', 'two']), /one task directory/i)
})

test('help wraps descriptions to a narrow terminal width with hanging indentation', () => {
  const rendered = render_help(40)
  for (const line of rendered.split('\n')) {
    const words = line.trim().split(/\s+/u)
    assert.ok(line.length <= 40 || (words.length === 1 && words[0].length > 40), `${line.length}: ${line}`)
  }
  assert.match(rendered, /--completion-path <path>\n {4}Notebook/)
  assert.match(rendered, /\n {4}updated" reply proves completion\./)
  assert.match(rendered, /--reset/)
  assert.match(rendered, /exit without running[\s\S]*plan/i)
})

test('the host instructions explain both looper queue types, progress, and hang recovery', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8')
  const reference = fs.readFileSync(path.join(__dirname, '..', 'references', 'looper.md'), 'utf8')
  assert.match(skill, /references\/looper\.md/)
  assert.match(reference, /agf-looper/)
  assert.match(reference, /handwritten/i)
  assert.match(reference, /make-plans/i)
  assert.match(reference, /progress/i)
  assert.match(reference, /hang/i)
  assert.match(reference, /--reset/)
})

test('notebook completion proof requires exact Reply and next empty Ask headings', () => {
  assert.deepEqual(notebook_round_state('# ← Reply / A-001\n\n---\n\n# → Ask / A-002\n\n+\n'), {
    reply_ids: [1],
    next_ask_id: 2,
  })
  assert.deepEqual(notebook_round_state('## [FINAL REPORT]\n\nDone.\n\ndevlog.md updated\n'), {
    reply_ids: [],
    next_ask_id: 0,
  })
  assert.deepEqual(notebook_round_state('# ← Reply / A-001 (owner)\r\n\r\n---\r\n\r\n# → Ask / A-002 (owner)\r\n\r\n+\r\n'), {
    reply_ids: [1],
    next_ask_id: 2,
  })
})

test('an old empty Ask cannot be reused as proof of a newly completed round', async () => {
  const dir = make_temp_dir('agentflow-looper-reused-ask')
  const queue = path.join(dir, 'planned')
  try {
    fs.mkdirSync(queue)
    fs.mkdirSync(path.join(queue, 'done'))
    fs.writeFileSync(path.join(dir, 'devlog.md'), '# → Ask / A-001\n\n+\n')
    write_plan(queue, 'plan-001.md')
    const fake_child = make_fake_child(dir)
    const result = await run_looper(base_options(queue, fake_child, {}, {
      root: dir,
      verify_notebook_round: true,
      spawn: () => {
        fs.appendFileSync(path.join(dir, 'devlog.md'), '\n# ← Reply / A-001\n')
        return spawn(process.execPath, [fake_child, JSON.stringify({ mode: 'success', marker: completion_line })], { stdio: ['ignore', 'pipe', 'pipe'] })
      },
    }))
    assert.notEqual(result.code, 0)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('a completion signal cannot archive a plan without a new notebook round', async () => {
  const dir = make_temp_dir('agentflow-looper-notebook-proof')
  const queue = path.join(dir, 'planned')
  try {
    fs.mkdirSync(queue)
    fs.mkdirSync(path.join(queue, 'done'))
    fs.writeFileSync(path.join(dir, 'devlog.md'), '# → Ask / A-001\n\n+\n')
    write_plan(queue, 'plan-001.md')
    const fake_child = make_fake_child(dir)
    const result = await run_looper(base_options(queue, fake_child, {}, {
      root: dir,
      verify_notebook_round: true,
    }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /did not add exactly one.*Reply.*Ask/is)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

const module_path = path.join(__dirname, 'looper.js')
const test_state_root = make_temp_directory('.agentflow-looper-state-')

process.once('exit', () => {
  fs.rmSync(test_state_root, { recursive: true, force: true })
})

const fake_child_source = String.raw`'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const config = JSON.parse(process.argv[2])

const append_json = (file, value) => {
  if (!file) return
  fs.appendFileSync(file, JSON.stringify(value) + '\n')
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const write_chunks = async (stream, chunks) => {
  for (const chunk of chunks) {
    stream.write(chunk)
    await wait(8)
  }
}

const output = async () => {
  const marker = config.marker || 'devlog.md updated'
  const stream = config.stream === 'stderr' ? process.stderr : process.stdout

  if (config.mode === 'success') {
    if (config.chunks) await write_chunks(stream, config.chunks)
    else stream.write(marker + '\n')
    return
  }

  if (config.mode === 'prefix-suffix') {
    stream.write('prefix ' + marker + ' suffix\n')
    return
  }

  if (config.mode === 'logical-split') {
    stream.write(marker.slice(0, Math.max(1, marker.length - 2)) + '\n')
    stream.write(marker.slice(-2) + '\n')
    return
  }

  if (config.mode === 'duplicate') {
    process.stdout.write(marker + '\n')
    process.stderr.write(marker + '\n')
    return
  }

  if (config.mode === 'duplicate-stream') {
    stream.write(marker + '\n')
    stream.write(marker + '\n')
    return
  }

  if (config.mode === 'large-success') {
    stream.write('x'.repeat(1024 * 1024) + '\n' + marker + '\n')
    return
  }

  if (config.mode === 'both-output') {
    process.stdout.write(config.stdout || 'arbitrary stdout\n')
    process.stderr.write(config.stderr || 'arbitrary stderr\n')
    process.stderr.write(marker + '\n')
    return
  }

  if (config.mode === 'slow-output') {
    stream.write((config.output || 'implementation milestone reached') + '\n')
    await wait(config.delay || 80)
    stream.write(marker + '\n')
    return
  }

  if (config.mode === 'nested') {
    const nested = spawn(config.nested_executable || process.execPath, [__filename, JSON.stringify({ mode: 'nested-child' })], { stdio: 'ignore' })
    stream.write('nested child ' + nested.pid + '\n')
    await wait(300)
    stream.write(marker + '\n')
    return
  }

  if (config.mode === 'nested-child') {
    setInterval(() => {}, 50)
    return
  }

  if (config.mode === 'stop') {
    stream.write(marker + '\n')
    fs.writeFileSync(path.join(config.tasks_dir, '.stop.txt'), 'child stop\n', { flag: 'wx' })
    return
  }

  if (config.mode === 'add-plan') {
    stream.write(marker + '\n')
    fs.writeFileSync(path.join(config.tasks_dir, config.add_name || 'plan-002.md'), 'added\n')
    return
  }

  if (config.mode === 'mutate') {
    stream.write(marker + '\n')
    const current = fs.existsSync(config.plan_path) ? fs.readFileSync(config.plan_path, 'utf8') : ''
    if (config.mutation === 'edit') fs.writeFileSync(config.plan_path, current + 'changed\n')
    if (config.mutation === 'replace') {
      fs.renameSync(config.plan_path, config.plan_path + '.old')
      fs.writeFileSync(config.plan_path, 'replacement\n')
    }
    if (config.mutation === 'same-content') {
      fs.renameSync(config.plan_path, config.plan_path + '.old')
      fs.writeFileSync(config.plan_path, current)
    }
    if (config.mutation === 'symlink') {
      fs.renameSync(config.plan_path, config.plan_path + '.old')
      fs.symlinkSync(config.plan_path + '.old', config.plan_path)
    }
    if (config.mutation === 'rename') fs.renameSync(config.plan_path, config.plan_path + '.renamed')
    if (config.mutation === 'remove') fs.unlinkSync(config.plan_path)
    return
  }

  if (config.mode === 'remove-task-state') {
    const local_lock = path.join(config.tasks_dir, '.looper.lock')
    const local_attempt = path.join(config.tasks_dir, '.looper-attempt.json')
    if (fs.existsSync(local_lock)) fs.rmSync(local_lock, { recursive: true, force: true })
    if (fs.existsSync(local_attempt)) fs.unlinkSync(local_attempt)
    if (config.local_action === 'replace') {
      fs.mkdirSync(local_lock)
      fs.writeFileSync(path.join(local_lock, 'owner.json'), 'task-local replacement\n')
      fs.writeFileSync(local_attempt, 'task-local replacement\n')
    }
    stream.write(marker + '\n')
    return
  }

  if (config.mode === 'signal-tree') {
    const signal_file = config.signal_file
    const heartbeat_file = config.heartbeat_file
    const log_signal = (who, signal) => append_json(signal_file, { who, signal, at: Date.now(), pid: process.pid })
    const on_signal = (signal) => {
      log_signal('parent', signal)
      if (config.ignore_first && !config.first_signal_seen) {
        config.first_signal_seen = true
        append_json(config.event_file, { event: 'ignored-first-signal', signal, at: Date.now() })
        return
      }
      process.exitCode = 0
    }
    process.on('SIGINT', () => on_signal('SIGINT'))
    process.on('SIGTERM', () => on_signal('SIGTERM'))
    const grandchild = spawn(process.execPath, [__filename, JSON.stringify({
      mode: 'grandchild',
      signal_file,
      heartbeat_file,
      event_file: config.event_file,
    })], { stdio: 'ignore' })
    append_json(config.event_file, { event: 'child-started', pid: process.pid, grandchild: grandchild.pid, at: Date.now() })
    setInterval(() => fs.appendFileSync(heartbeat_file, Date.now() + '\n'), 20)
    return
  }

  if (config.mode === 'grandchild') {
    const log_signal = (signal) => append_json(config.signal_file, { who: 'grandchild', signal, at: Date.now(), pid: process.pid })
    process.on('SIGINT', () => log_signal('SIGINT'))
    process.on('SIGTERM', () => log_signal('SIGTERM'))
    fs.writeFileSync(config.heartbeat_file + '.ready', 'ready')
    setInterval(() => fs.appendFileSync(config.heartbeat_file, Date.now() + '\n'), 20)
    return
  }

  if (config.mode === 'no-marker') return

  stream.write(config.output || '')
}

append_json(config.launch_log, {
  event: 'launch',
  pid: process.pid,
  task: config.task,
  prompt: config.prompt,
  plan_path: config.plan_path,
  argv: process.argv.slice(2),
  at: Date.now(),
})

const main = async () => {
  if (config.delay) await wait(config.delay)
  await output()
  if (config.mode === 'signal-tree') return
  if (config.mode === 'exit') process.exitCode = config.exit_code || 7
  else process.exitCode = config.exit_code || 0
}

main().catch((error) => {
  append_json(config.error_log, { message: error.message, stack: error.stack })
  process.exitCode = 91
})
`

const make_temp_dir = (prefix) => make_temp_directory(`${prefix}-`)

const remove_temp_dir = (dir) => {
  fs.rmSync(dir, { recursive: true, force: true })
}

const make_fake_child = (dir) => {
  const file = path.join(dir, 'fake-child.js')
  fs.writeFileSync(file, fake_child_source)
  return file
}

const make_queue = () => {
  const dir = make_temp_dir('agentflow-looper-queue')
  fs.mkdirSync(path.join(dir, 'done'))
  return dir
}

const write_plan = (queue, name, content = name) => fs.writeFileSync(path.join(queue, name), `${content}\n`)

const write_generated_queue = (queue, overrides = {}) => {
  const digest = value => crypto.createHash('sha256').update(value).digest('hex')
  const built = queue_contract.build_queue({
    tasks_dir: queue,
    schema_version: 2,
    authorities: [
      { id: 'work', route: 'complex', original_request_sha256: digest('looper generated request'), requirements_sha256: digest('looper generated requirements'), specification_sha256: digest('looper generated specification') },
      { id: 'integration', route: 'integration', included_authority_ids: ['work'] },
    ],
    allow_ag: 'on',
    contract: {
      original_request_sha256: digest('looper generated request'),
      requirements_sha256: digest('looper generated requirements'),
      specification_sha256: digest('looper generated specification'),
      requirements: { accepted: true },
      specification: { accepted: true },
      brownfield: false,
      mandatory_stages: ['requirements', 'specification'],
      stage_records: [],
      unresolved_decisions: [],
    },
    plans: [
      {
        order: 1,
        contract_part: 'utility',
        outcome: 'Implement the generated utility.',
        dependencies: [],
        required_work: ['Implement the utility.'],
        constraints: ['Keep scope bounded.'],
        tests_and_evidence: ['Run focused tests.'],
        completion_conditions: ['The utility passes.'],
        final_integration: false,
      },
      {
        order: 2,
        contract_part: 'documentation',
        outcome: 'Document the generated utility.',
        dependencies: ['plan-001.md'],
        required_work: ['Document the utility.'],
        constraints: ['Change documentation only.'],
        tests_and_evidence: ['Check the example.'],
        completion_conditions: ['The example matches behavior.'],
        final_integration: false,
      },
      {
        order: 3,
        contract_part: 'final-integration',
        outcome: 'Verify the complete generated request.',
        dependencies: ['plan-002.md'],
        required_work: ['Run the integration suite.'],
        constraints: ['Change integration tests only.'],
        tests_and_evidence: ['Run the complete suite.'],
        completion_conditions: ['All generated work passes together.'],
        final_integration: true,
      },
    ].map(plan => ({ ...plan, route: plan.final_integration ? 'integration' : 'complex', authority_id: plan.final_integration ? 'integration' : 'work' })),
    completion_path: overrides.completion_path || 'records/work.devlog.md',
    generation_id: 'looper-generated-001',
    created_at: '2026-08-30T14:00:00.000Z',
  })
  for (const [name, bytes] of Object.entries(built.plan_bytes)) fs.writeFileSync(path.join(queue, name), bytes)
  fs.writeFileSync(path.join(queue, queue_contract.ENVELOPE_NAME), `${JSON.stringify(built.envelope)}\n`)
  return built
}

const read_json_lines = (file) => {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

const read_json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

const protected_state_dir = (queue) => path.join(
  test_state_root,
  'agentflow',
  'looper',
  crypto.createHash('sha256').update(fs.realpathSync(queue)).digest('hex'),
)

const attempt_path = (queue) => path.join(protected_state_dir(queue), '.looper-attempt.json')
const lock_path = (queue) => path.join(protected_state_dir(queue), '.looper.lock')
const local_lock_path = (queue) => path.join(queue, '.looper.lock')
const local_attempt_path = (queue) => path.join(queue, '.looper-attempt.json')
const stop_path = (queue) => path.join(queue, '.stop.txt')
const file_sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

const make_completed_record = (queue, task = 'plan-001.md') => {
  const canonical_queue = fs.realpathSync(queue)
  const archive_path = path.join(canonical_queue, 'done', task)
  fs.writeFileSync(archive_path, 'archived completed plan\n')
  const stat = fs.statSync(archive_path)
  const sha256 = file_sha256(archive_path)
  return {
    version: 1,
    phase: 'completed',
    task,
    selected_path: path.join(canonical_queue, task),
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    sha256,
    completion_line,
    exit_code: 0,
    signal: null,
    completion_matches: 1,
    rechecked_sha256: sha256,
    rechecked_dev: stat.dev,
    rechecked_ino: stat.ino,
    rechecked_size: stat.size,
    archived_path: archive_path,
    archived: true,
    archived_sha256: sha256,
    archived_dev: stat.dev,
    archived_ino: stat.ino,
    archived_size: stat.size,
  }
}

const write_completed_fixture = (mutate = () => {}) => {
  const dir = make_temp_dir('agentflow-looper-completed-record')
  const queue = path.join(dir, 'queue')
  fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
  const fake_child = make_fake_child(dir)
  write_plan(queue, 'plan-002.md', 'later plan')
  const record = make_completed_record(queue)
  mutate({ dir, queue, record })
  fs.mkdirSync(protected_state_dir(queue), { recursive: true, mode: 0o700 })
  fs.writeFileSync(attempt_path(queue), `${JSON.stringify(record)}\n`)
  return { dir, queue, fake_child, before: fs.readFileSync(attempt_path(queue)) }
}

const write_attempt_replacement_fixture = () => {
  const dir = make_temp_dir('agentflow-looper-attempt-replacement')
  const queue = path.join(dir, 'queue')
  fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
  const fake_child = make_fake_child(dir)
  write_plan(queue, 'plan-002.md', 'later plan')
  const replacement_record = make_completed_record(queue)
  const original_bytes = Buffer.from(JSON.stringify({
    phase: 'launch-intent',
    task: 'plan-001.md',
  }) + '\n')
  fs.mkdirSync(protected_state_dir(queue), { recursive: true, mode: 0o700 })
  fs.writeFileSync(attempt_path(queue), original_bytes)
  return {
    dir,
    queue,
    fake_child,
    original_bytes,
    replacement_bytes: Buffer.from(JSON.stringify(replacement_record) + '\n'),
  }
}

const write_attempt_input_fixture = (content = '{"phase":"launch-intent"}\n') => {
  const dir = make_temp_dir('agentflow-looper-attempt-input')
  const queue = make_queue()
  const fake_child = make_fake_child(dir)
  write_plan(queue, 'plan-001.md')
  fs.mkdirSync(protected_state_dir(queue), { recursive: true, mode: 0o700 })
  fs.writeFileSync(attempt_path(queue), content)
  return { dir, queue, fake_child }
}

const assert_untrustworthy_completed_record_blocks = async (fixture) => {
  const launch_log = path.join(fixture.dir, 'launch.jsonl')
  const events = []
  const result = await run_looper(base_options(fixture.queue, fixture.fake_child, { launch_log }, {
    on_event: ({ event }) => events.push(event),
  }))
  assert.notEqual(result.code, 0)
  assert.match(result.message, /completed|human review|incomplete|archive|identity/i)
  assert.deepEqual(result.launched, [])
  assert.deepEqual(read_json_lines(launch_log), [])
  assert.equal(fs.existsSync(path.join(fixture.queue, 'plan-002.md')), true)
  assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-002.md')), false)
  assert.deepEqual(fs.readFileSync(attempt_path(fixture.queue)), fixture.before)
  assert.deepEqual(events.filter((event) => event === 'ownership-acquired' || event === 'ownership-released'), [])
}

const is_within = (candidate, parent) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const base_options = (queue, fake_child, config = {}, overrides = {}) => ({
  tasks_dir: queue,
  state_root: test_state_root,
  completion_path,
  executable: process.execPath,
  build_args: ({ task, plan_path, prompt }) => [fake_child, JSON.stringify({
    mode: 'success',
    ...config,
    marker: completion_line,
    task,
    plan_path,
    prompt,
    tasks_dir: queue,
  })],
  silent: true,
  verify_notebook_round: false,
  ...overrides,
})

test('help is accepted and describes installation, progress, and recovery', () => {
  assert.equal(parse_cli(['--help']).help, true)
  assert.equal(parse_cli(['-h']).help, true)
  assert.match(HELP, /Usage: agf-looper/)
  assert.match(HELP, /setup\.js --fix/)
  assert.match(HELP, /planned\/done/)
  assert.match(HELP, /--dump/)
  assert.equal(parse_cli(['--dump']).dump, true)
  assert.equal(parse_cli([]).dump, undefined)
})

test('queue view shows completed, active, failed, and pending plans with current progress', () => {
  const queue = make_queue()
  try {
    write_plan(path.join(queue, 'done'), 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    write_plan(queue, 'plan-003.md')
    const context = { tasks_dir: queue, done_dir: path.join(queue, 'done'), file_system: fs }
    assert.deepEqual(queue_view(context, 'plan-002.md').lines, [
      'Progress: 2/3',
      '[x] plan-001.md',
      '[*] plan-002.md',
      '[ ] plan-003.md',
    ])
    assert.equal(queue_view(context, null, 'plan-002.md').lines[2], '[-] plan-002.md')
  } finally {
    remove_temp_dir(queue)
  }
})

test('visible mode stays quiet while it prints startup and plan progress', async () => {
  const dir = make_temp_dir('agentflow-looper-visible')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const stdout = []
    const stderr = []
    const stream = target => ({ write: chunk => target.push(String(chunk)) })
    const result = await run_looper(base_options(queue, fake_child, { mode: 'both-output' }, {
      silent: false,
      stdout: stream(stdout),
      stderr: stream(stderr),
    }))
    assert.equal(result.code, 0)
    assert.match(stderr.join(''), /Working directory:/)
    assert.match(stderr.join(''), /Progress: 0\/1/)
    assert.match(stderr.join(''), /Starting 1\/1 — plan-001\.md/)
    assert.match(stderr.join(''), /Worker: model\/effort use CLI defaults/)
    assert.match(stderr.join(''), /Completed 1\/1 — plan-001\.md/)
    assert.doesNotMatch(stdout.join(''), /arbitrary stdout/)
    assert.doesNotMatch(stderr.join(''), /arbitrary stderr/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('configured implementation model and effort are shown and passed to Codex', async (t) => {
  const dir = make_temp_dir('agentflow-looper-model')
  const queue = make_queue()
  t.after(() => { remove_temp_dir(dir); remove_temp_dir(queue) })
  const fake_child = make_fake_child(dir)
  write_plan(queue, 'plan-001.md')
  const stderr = []
  const calls = []
  const config = agentflow_settings.make_template('codex')
  const result = await run_looper(base_options(queue, fake_child, {}, {
    executable: undefined,
    build_args: undefined,
    worker_config: config,
    executable_available: command => command === 'codex',
    silent: false,
    stderr: { write: chunk => stderr.push(String(chunk)) },
    spawn: (executable, args, options) => {
      calls.push({ executable, args })
      fs.ftruncateSync(options.stdio[3], 0)
      fs.writeSync(options.stdio[3], `${completion_line}\n`, 0, 'utf8')
      return spawn(process.execPath, [fake_child, JSON.stringify({ mode: 'success', marker: completion_line })], { stdio: ['ignore', 'pipe', 'pipe'] })
    },
  }))
  assert.equal(result.code, 0)
  const selection = agentflow_settings.resolve_worker_tier(config, { role: 'implementation' }, {
    executable_available: command => command === 'codex',
  })
  assert.match(stderr.join(''), new RegExp(`Worker: ${selection.model}/${selection.effort}`))
  assert.deepEqual(calls[0].args.slice(0, 5), [
    'exec',
    '-m', selection.model,
    '-c', `model_reasoning_effort=${selection.effort}`,
  ])
})

test('a running plan periodically shows elapsed time and bounded latest worker detail, then stops its timer', async () => {
  const dir = make_temp_dir('agentflow-looper-milestone')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const stderr = []
    const detail = 'x'.repeat(300)
    const result = await run_looper(base_options(queue, fake_child, {
      mode: 'slow-output',
      output: detail,
      // Leave several progress polls after child startup even on a loaded full-suite run.
      delay: 500,
    }, {
      silent: false,
      milestone_interval_ms: 15,
      stderr: { write: chunk => stderr.push(String(chunk)) },
    }))
    assert.equal(result.code, 0)
    const completed_output = stderr.join('')
    assert.match(completed_output, /Still running — plan-001\.md — \d+s elapsed — latest: x+/)
    assert.doesNotMatch(completed_output, new RegExp('x'.repeat(241)))
    await new Promise(resolve => setTimeout(resolve, 35))
    assert.equal(stderr.join(''), completed_output)
  } finally {
    remove_temp_dir(dir)
  }
})

test('show-output pages bounded worker details without streaming them normally', async () => {
  const dir = make_temp_dir('agentflow-looper-page-output')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const pages = []
    const result = await run_looper(base_options(queue, fake_child, { mode: 'both-output' }, {
      show_output: true,
      page_output: page => pages.push(page),
    }))
    assert.equal(result.code, 0)
    assert.equal(pages.length, 1)
    assert.equal(pages[0].task, 'plan-001.md')
    assert.match(pages[0].output, /arbitrary stdout/)
    assert.match(pages[0].output, /arbitrary stderr/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('dump saves complete stdout and stderr while default mode writes no dump', async () => {
  const dir = make_temp_dir('agentflow-looper-dump')
  try {
    const root = fs.realpathSync(dir)
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    const dump_dir = path.join(root, 'artifacts', 'looper-output', 'test-run')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'both-output' }, { root, dump: true, dump_dir }))
    assert.equal(result.code, 0, result.message)
    assert.equal(fs.readFileSync(path.join(dump_dir, 'plan-001.stdout.log'), 'utf8'), 'arbitrary stdout\n')
    assert.equal(fs.readFileSync(path.join(dump_dir, 'plan-001.stderr.log'), 'utf8'), `arbitrary stderr\n${completion_line}\n`)
    assert.equal(fs.readFileSync(path.join(dump_dir, 'plan-002.stdout.log'), 'utf8'), 'arbitrary stdout\n')
    assert.equal(fs.readFileSync(path.join(dump_dir, 'plan-002.stderr.log'), 'utf8'), `arbitrary stderr\n${completion_line}\n`)

    const second_queue = make_queue()
    write_plan(second_queue, 'plan-001.md')
    const no_dump = path.join(root, 'no-dump')
    const default_result = await run_looper(base_options(second_queue, fake_child, { mode: 'both-output' }, { root, dump_dir: no_dump }))
    assert.equal(default_result.code, 0)
    assert.equal(fs.existsSync(no_dump), false)

    const failed_queue = make_queue()
    write_plan(failed_queue, 'plan-001.md')
    const failed_dump = path.join(root, 'artifacts', 'looper-output', 'failed-dump')
    const failed_result = await run_looper(base_options(failed_queue, fake_child, { mode: 'prefix-suffix' }, { root, dump: true, dump_dir: failed_dump }))
    assert.notEqual(failed_result.code, 0)
    assert.equal(fs.readFileSync(path.join(failed_dump, 'plan-001.stdout.log'), 'utf8'), `prefix ${completion_line} suffix\n`)
  } finally {
    remove_temp_dir(dir)
  }
})

test('dump writes every byte across short writes and rejects zero progress', () => {
  const written = []
  const partial_file_system = {
    writeSync: (_descriptor, buffer, offset, length) => {
      const count = Math.min(2, length)
      written.push(buffer.subarray(offset, offset + count))
      return count
    },
  }
  write_all_sync(partial_file_system, 1, Buffer.from('complete output'))
  assert.equal(Buffer.concat(written).toString('utf8'), 'complete output')
  assert.throws(() => write_all_sync({ writeSync: () => 0 }, 1, Buffer.from('x')), /no valid write progress/)
})

test('dump refuses an outside or symlinked directory before the worker starts', async () => {
  const dir = make_temp_dir('agentflow-looper-dump-boundary')
  const outside = make_temp_dir('agentflow-looper-dump-outside')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    let starts = 0
    const outside_result = await run_looper(base_options(queue, fake_child, {}, {
      root: dir,
      dump: true,
      dump_dir: outside,
      spawn: () => { starts += 1 },
    }))
    assert.notEqual(outside_result.code, 0)
    assert.equal(starts, 0)

    const second_queue = make_queue()
    write_plan(second_queue, 'plan-001.md')
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true })
    fs.symlinkSync(outside, path.join(dir, 'artifacts', 'looper-output'))
    const symlink_result = await run_looper(base_options(second_queue, fake_child, {}, {
      root: dir,
      dump: true,
      spawn: () => { starts += 1 },
    }))
    assert.notEqual(symlink_result.code, 0)
    assert.equal(starts, 0)
    assert.equal(fs.readdirSync(outside).length, 0)
  } finally {
    remove_temp_dir(dir)
    remove_temp_dir(outside)
  }
})

test('failure result gives a concrete review checklist and paths', async () => {
  const dir = make_temp_dir('agentflow-looper-recovery-message')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'no-marker' }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /What to do next:/)
    assert.match(result.message, /\.stop\.txt/)
    assert.match(result.message, /\.looper-attempt\.json/)
    assert.match(result.message, /move that reviewed plan/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('nested worker violations preserve the plan and produce a recovery warning', async () => {
  const dir = make_temp_dir('agentflow-looper-nested-worker')
  const queue = make_queue()
  const nested_executable = path.join(dir, 'codex')
  fs.symlinkSync(process.execPath, nested_executable)
  try {
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'nested', nested_executable }, { nested_poll_ms: 20 }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /nested worker|quarantined|fresh coordinator-controlled review/i)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    const attempt = JSON.parse(fs.readFileSync(attempt_path(queue), 'utf8'))
    assert.equal(attempt.nested_worker.detected, true)
    assert.equal(attempt.nested_worker.recovery.evidence_status, 'quarantined')
    assert.equal(attempt.nested_worker.processes.some(process_info => process_info.executable === nested_executable), true)
  } finally {
    remove_temp_dir(dir)
    remove_temp_dir(queue)
  }
})

test('default launch selects and preserves the literal external-workers command', async (t) => {
  const dir = make_temp_dir('agentflow-looper-worker-profile')
  const queue = make_queue()
  t.after(() => { remove_temp_dir(dir); remove_temp_dir(queue) })
  const fake_child = make_fake_child(dir)
  write_plan(queue, 'plan-001.md')
  const calls = []
  const config = {
    switches: { 'cli-provider': 'on' },
    'external-workers': [
      { id: 'lower', command: ['unused-worker', '--quiet'], priority: 2, family: 'unused' },
      { id: 'chosen', command: ['claude', '-p', '--literal-flag'], priority: 5, family: 'claude', tiers: { basic: 'fixture/low' } },
    ],
  }
  const result = await run_looper(base_options(queue, fake_child, {}, {
    executable: undefined,
    build_args: undefined,
    worker_config: config,
    executable_available: command => command === 'claude',
    spawn: (executable, args) => {
      calls.push({ executable, args })
      return spawn(process.execPath, [fake_child, JSON.stringify({ mode: 'success', marker: completion_line })], { stdio: ['ignore', 'pipe', 'pipe'] })
    },
  }))
  assert.equal(result.code, 0)
  assert.equal(calls[0].executable, 'claude')
  assert.deepEqual(calls[0].args.slice(0, 2), ['-p', '--literal-flag'])
  assert.match(calls[0].args.at(-1), /^Execute the frozen plan directly: /)
  assert.match(calls[0].args.at(-1), /already launched by agf-looper/i)
  assert.match(calls[0].args.at(-1), /execute the named plan directly/i)
  assert.match(calls[0].args.at(-1), /do not invoke agf-looper/i)
  assert.match(calls[0].args.at(-1), /complete the Agentflow notebook record/i)
  assert.match(calls[0].args.at(-1), /# ← Reply \/ A-NNN/)
  assert.match(calls[0].args.at(-1), /# → Ask \/ A-NNN/)
  assert.match(calls[0].args.at(-1), /bare plus line/i)
  assert.match(calls[0].args.at(-1), /without the Reply heading/i)
  assert.match(calls[0].args.at(-1), /entire final response must be exactly/i)
  assert.match(calls[0].args.at(-1), new RegExp(completion_line.replace('.', '\\.')))
})

const run_case = async (config = {}, overrides = {}) => {
  const dir = make_temp_dir('agentflow-looper-case')
  const queue = path.join(dir, 'queue')
  fs.mkdirSync(queue)
  fs.mkdirSync(path.join(queue, 'done'))
  const fake_child = make_fake_child(dir)
  const launch_log = path.join(dir, 'launch.jsonl')
  const result = await run_looper(base_options(queue, fake_child, {
    ...config,
    launch_log,
  }, overrides))
  return { dir, queue, fake_child, launch_log, result }
}

test('queue discovery is exact, numeric, fresh, and ignores control files', async () => {
  const dir = make_temp_dir('agentflow-looper-order')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-010.md')
    write_plan(queue, 'plan-002.md')
    write_plan(queue, 'plan-001.md')
    for (const name of ['plan-1.md', 'plan-0000.md', 'plan-001.txt', 'notes-plan-003.md', '.looper-temp.json'])
      fs.writeFileSync(path.join(queue, name), 'ignore\n')
    write_plan(path.join(queue, 'done'), 'plan-999.md', 'already done')

    const result = await run_looper(base_options(queue, fake_child, { launch_log }))

    assert.equal(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md', 'plan-002.md', 'plan-010.md'])
    assert.notEqual(read_json_lines(launch_log)[0].pid, read_json_lines(launch_log)[1].pid)
    for (const name of ['plan-001.md', 'plan-002.md', 'plan-010.md']) assert.ok(fs.existsSync(path.join(queue, 'done', name)))
    assert.ok(fs.existsSync(path.join(queue, 'plan-1.md')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('a generated queue derives completion and dependency authority from its frozen envelope', async () => {
  const dir = make_temp_dir('agentflow-looper-generated')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_generated_queue(queue)

    const result = await run_looper(base_options(queue, fake_child, { launch_log }, {
      completion_path: undefined,
      build_args: ({ task, plan_path, prompt }) => [fake_child, JSON.stringify({
        mode: 'success', marker: 'records/work.devlog.md updated', task, plan_path, prompt, launch_log,
      })],
    }))

    assert.equal(result.code, 0)
    assert.deepEqual(result.launched, ['plan-001.md', 'plan-002.md', 'plan-003.md'])
    assert.deepEqual(read_json_lines(launch_log).map(entry => entry.task), result.launched)
    assert.match(read_json_lines(launch_log)[0].prompt, /owned by looper/i)
    assert.match(read_json_lines(launch_log)[0].prompt, /do not move, rename, delete, or archive/i)
    for (const name of result.launched) assert.ok(fs.existsSync(path.join(queue, 'done', name)))
    assert.equal(fs.existsSync(path.join(queue, queue_contract.ENVELOPE_NAME)), true)
    assert.equal(queue_contract.validate_frozen_queue(queue).valid, true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('incomplete generated plans refuse the handwritten fallback before launch', async () => {
  const dir = make_temp_dir('agentflow-looper-incomplete-generated')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_generated_queue(queue)
    fs.unlinkSync(path.join(queue, queue_contract.ENVELOPE_NAME))
    const result = await run_looper(base_options(queue, fake_child, { launch_log }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /generated|authority|envelope/i)
    assert.deepEqual(read_json_lines(launch_log), [])
    remove_temp_dir(queue)
  } finally {
    remove_temp_dir(dir)
  }
})

test('a generated stream queue derives its worker configuration from the envelope completion path', async () => {
  const dir = make_temp_dir('agentflow-looper-generated-stream-config')
  try {
    const queue = path.join(dir, 'artifacts', 'stream', 'planned')
    fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
	const fake_child = make_fake_child(dir)
	write_generated_queue(queue, { completion_path: 'artifacts/stream/devlog.md' })
	const config = command => {
		const value = agentflow_settings.make_template('codex')
		value.switches['allow-ag'] = 'on'
		value['external-workers'] = [{
			...value['external-workers'].find(profile => profile.family === 'claude'),
        id: command,
        command: ['claude', '-p', '--profile', command],
        priority: 1,
        family: 'claude',
      }]
      return JSON.stringify(value)
    }
    fs.writeFileSync(path.join(dir, 'ag.json'), config('root-worker'))
    fs.writeFileSync(path.join(dir, 'artifacts', 'stream', 'ag.json'), config('stream-worker'))
    const calls = []

    const result = await run_looper(base_options(queue, fake_child, {}, {
      root: dir,
      completion_path: undefined,
      executable: undefined,
      build_args: undefined,
      executable_available: command => command === 'claude',
      spawn: (executable, args, options) => {
        calls.push({ executable, args })
        return spawn(process.execPath, [fake_child, JSON.stringify({
          mode: 'success', marker: 'artifacts/stream/devlog.md updated',
        })], { stdio: ['ignore', 'pipe', 'pipe'] })
      },
    }))

    assert.equal(result.code, 0)
    assert.equal(calls.length, 3)
    assert.deepEqual(calls.map(call => call.executable), ['claude', 'claude', 'claude'])
    assert.ok(calls.every(call => call.args.includes('stream-worker') && !call.args.includes('root-worker')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('a generated queue refuses completion overrides and mutated or unbound plan bytes before launch', async (t) => {
  for (const scenario of ['completion override', 'mutated plan', 'unbound plan']) {
    await t.test(scenario, async () => {
      const dir = make_temp_dir('agentflow-looper-generated-refusal')
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        write_generated_queue(queue)
        const overrides = {}
        if (scenario === 'completion override') overrides.completion_path = 'wrong.devlog.md'
        if (scenario === 'mutated plan') fs.appendFileSync(path.join(queue, 'plan-002.md'), 'mutation\n')
        if (scenario === 'unbound plan') write_plan(queue, 'plan-004.md', 'not in envelope')

        const result = await run_looper(base_options(queue, fake_child, { launch_log }, overrides))

        assert.notEqual(result.code, 0)
        assert.match(result.message, /completion|frozen|digest|bound|queue|plan/i)
        assert.deepEqual(result.launched, [])
        assert.deepEqual(read_json_lines(launch_log), [])
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('a handwritten Codex queue binds completion to the final-message channel instead of its normal report', async () => {
  const dir = make_temp_dir('agentflow-looper-handwritten-codex-final')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    write_plan(queue, 'plan-003.md')
    const config = {
      switches: { 'cli-provider': 'on' },
      'external-workers': [
        { id: 'codex-test', command: ['codex', 'exec'], priority: 1, family: 'codex' },
      ],
    }
    const result = await run_looper(base_options(queue, fake_child, {}, {
      executable: undefined,
      build_args: undefined,
      worker_config: config,
      executable_available: command => command === 'codex',
      spawn: (executable, args, options) => {
        const output_index = args.indexOf('--output-last-message')
        assert.equal(executable, 'codex')
        assert.notEqual(output_index, -1)
        assert.equal(args[output_index + 1], '/dev/fd/3')
        fs.ftruncateSync(options.stdio[3], 0)
        fs.writeSync(options.stdio[3], `${completion_line}\n`, 0, 'utf8')
        return spawn(process.execPath, [fake_child, JSON.stringify({
          mode: 'success', marker: 'ordinary human-readable report without the protocol marker',
        })], { stdio: ['ignore', 'pipe', 'pipe'] })
      },
    }))

    assert.equal(result.code, 0, result.message)
    assert.deepEqual(result.launched, ['plan-001.md', 'plan-002.md', 'plan-003.md'])
  } finally {
    remove_temp_dir(dir)
  }
})

test('a generated Codex queue binds completion to the final-message channel instead of streamed duplicates', async () => {
  const dir = make_temp_dir('agentflow-looper-generated-codex-final')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_generated_queue(queue)
    const config = {
      switches: { 'cli-provider': 'on' },
      'external-workers': [
        { id: 'codex-test', command: ['codex', 'exec'], priority: 1, family: 'codex' },
      ],
    }
    const result = await run_looper(base_options(queue, fake_child, {}, {
      completion_path: undefined,
      executable: undefined,
      build_args: undefined,
      worker_config: config,
      executable_available: command => command === 'codex',
      spawn: (executable, args, options) => {
        const output_index = args.indexOf('--output-last-message')
        assert.equal(executable, 'codex')
        assert.notEqual(output_index, -1)
        assert.equal(args[output_index + 1], '/dev/fd/3')
        fs.ftruncateSync(options.stdio[3], 0)
        fs.writeSync(options.stdio[3], 'records/work.devlog.md updated\n', 0, 'utf8')
        return spawn(process.execPath, [fake_child, JSON.stringify({
          mode: 'duplicate', marker: 'records/work.devlog.md updated',
        })], { stdio: ['ignore', 'pipe', 'pipe'] })
      },
    }))

    assert.equal(result.code, 0, result.message)
    assert.deepEqual(result.launched, ['plan-001.md', 'plan-002.md', 'plan-003.md'])
  } finally {
    remove_temp_dir(dir)
  }
})

test('a generated Codex queue rejects invalid anonymous final-message bytes', async (t) => {
  for (const scenario of ['oversize', 'invalid-utf8', 'growth', 'truncation']) {
    await t.test(scenario, async () => {
      const dir = make_temp_dir(`agentflow-looper-generated-final-${scenario}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        write_generated_queue(queue)
        const config = {
          switches: { 'cli-provider': 'on' },
          'external-workers': [{ id: 'codex-test', command: ['codex', 'exec'], priority: 1, family: 'codex' }],
        }
        let output_descriptor = null
        let read_mutated = false
        const file_system = new Proxy(fs, {
          get(target, property) {
            if (property !== 'readSync') return target[property]
            return (...args) => {
              if (output_descriptor !== null && !read_mutated && (scenario === 'growth' || scenario === 'truncation')) {
                read_mutated = true
                if (scenario === 'growth') fs.writeSync(output_descriptor, 'x', 0, 'utf8')
                else fs.ftruncateSync(output_descriptor, 0)
              }
              return fs.readSync(...args)
            }
          },
        })
        const result = await run_looper(base_options(queue, fake_child, {}, {
          fs: file_system,
          completion_path: undefined,
          executable: undefined,
          build_args: undefined,
          worker_config: config,
          executable_available: command => command === 'codex',
          spawn: (_executable, args, options) => {
            const output = args[args.indexOf('--output-last-message') + 1]
            assert.equal(output, '/dev/fd/3')
            output_descriptor = options.stdio[3]
            fs.ftruncateSync(output_descriptor, 0)
            if (scenario === 'oversize') {
              fs.writeSync(output_descriptor, 'x'.repeat(8194), 0, 'utf8')
            } else if (scenario === 'invalid-utf8') {
              fs.writeSync(output_descriptor, Buffer.from([0xff]), 0, 1, 0)
            } else {
              fs.writeSync(output_descriptor, 'records/work.devlog.md updated\n', 0, 'utf8')
            }
            return spawn(process.execPath, [fake_child, JSON.stringify({
              mode: 'success', marker: 'records/work.devlog.md updated',
            })], { stdio: ['ignore', 'pipe', 'pipe'] })
          },
        }))

        assert.notEqual(result.code, 0)
        assert.match(result.message, /final-message|identity|unique|unreadable|limit|completion evidence/i)
        assert.deepEqual(result.launched, ['plan-001.md'])
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('a generated Codex queue refuses reservation replacement before making the descriptor anonymous', async (t) => {
  for (const scenario of ['reservation replacement']) {
    await t.test(scenario, async () => {
      const dir = make_temp_dir(`agentflow-looper-generated-final-race-${scenario.replaceAll(' ', '-')}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        write_generated_queue(queue)
        const config = {
          switches: { 'cli-provider': 'on' },
          'external-workers': [{ id: 'codex-test', command: ['codex', 'exec'], priority: 1, family: 'codex' }],
        }
        let output_path = null
        let substituted_path = null
        let spawned = false
        let mutated = false
        const file_system = new Proxy(fs, {
          get(target, property) {
            if (property === 'lstatSync') return file => {
              if (!mutated && scenario === 'reservation replacement' && path.basename(file).startsWith('.last-message-')) {
                mutated = true
                substituted_path = file
                fs.unlinkSync(file)
                fs.writeFileSync(file, 'records/work.devlog.md updated\n')
              }
              return fs.lstatSync(file)
            }
            return target[property]
          },
        })
        const result = await run_looper(base_options(queue, fake_child, {}, {
          fs: file_system,
          completion_path: undefined,
          executable: undefined,
          build_args: undefined,
          worker_config: config,
          executable_available: command => command === 'codex',
          spawn: (_executable, args) => {
            output_path = args[args.indexOf('--output-last-message') + 1]
            spawned = true
            return spawn(process.execPath, [fake_child, JSON.stringify({ mode: 'success', marker: 'not completion' })], {
              stdio: ['ignore', 'pipe', 'pipe'],
            })
          },
        }))

        assert.notEqual(result.code, 0)
        assert.equal(mutated, true)
        assert.equal(fs.existsSync(substituted_path), true)
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
        assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
        assert.deepEqual(result.launched, [])
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('an empty queue completes without launching or moving a plan', async () => {
  const dir = make_temp_dir('agentflow-looper-empty')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const result = await run_looper(base_options(queue, fake_child))
    assert.equal(result.code, 0)
    assert.match(result.message, /all plans are complete/i)
    assert.deepEqual(read_json_lines(path.join(dir, 'missing.json')), [])
    assert.deepEqual(fs.readdirSync(path.join(queue, 'done')), [])
  } finally {
    remove_temp_dir(dir)
  }
})

test('.break.txt is inert while the exact plan still completes', async () => {
  const dir = make_temp_dir('agentflow-looper-break-inert')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md')
    fs.writeFileSync(path.join(queue, '.break.txt'), 'ignored break marker\n')

    const result = await run_looper(base_options(queue, fake_child, { launch_log }))

    assert.equal(result.code, 0)
    assert.deepEqual(result.launched, ['plan-001.md'])
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-001.md')))
    assert.ok(fs.existsSync(path.join(queue, '.break.txt')))
    assert.equal(fs.existsSync(stop_path(queue)), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('a pre-existing stop blocks work', async () => {
  const dir = make_temp_dir('agentflow-looper-stop-before')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    fs.writeFileSync(stop_path(queue), 'human stop\n')
    const result = await run_looper(base_options(queue, fake_child))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /stop marker/i)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    assert.equal(fs.readFileSync(stop_path(queue), 'utf8'), 'human stop\n')
  } finally {
    remove_temp_dir(dir)
  }
})

test('the queue rescans after each archive and accepts new lower-numbered plans', async () => {
  const dir = make_temp_dir('agentflow-looper-rescan')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, {
      launch_log,
      mode: 'add-plan',
      add_name: 'plan-000.md',
    }))
    assert.equal(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md', 'plan-000.md'])
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-000.md')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('completion accepts chunk-split exact evidence from either stream', async (t) => {
  for (const stream of ['stdout', 'stderr']) {
    await t.test(stream, async () => {
      const dir = make_temp_dir(`agentflow-looper-chunks-${stream}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        write_plan(queue, 'plan-001.md')
        const result = await run_looper(base_options(queue, fake_child, {
          mode: 'success',
          stream,
          chunks: ['dev', 'log.md up', 'dated\n'],
        }))
        assert.equal(result.code, 0)
        assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-001.md')))
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('completion failures are safe and do not start later plans', async (t) => {
  const cases = [
    ['prefix and suffix', { mode: 'prefix-suffix' }, /exactly one|completion/i],
    ['line split across logical lines', { mode: 'logical-split' }, /exactly one|completion/i],
    ['missing marker', { mode: 'no-marker' }, /exactly one|completion/i],
    ['hook replacement', { mode: 'success', chunks: ['hook replaced\n'] }, /exactly one|completion/i],
    ['duplicate markers in one stream', { mode: 'duplicate-stream' }, /exactly one|duplicate/i],
    ['non-zero exit', { mode: 'exit', exit_code: 7 }, /exit|completion/i],
  ]

  for (const [name, config, error_pattern] of cases) {
    await t.test(name, async () => {
      const dir = make_temp_dir(`agentflow-looper-failure-${name.replaceAll(' ', '-')}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        write_plan(queue, 'plan-001.md')
        write_plan(queue, 'plan-002.md')
        const result = await run_looper(base_options(queue, fake_child, { ...config, launch_log }))
        assert.notEqual(result.code, 0)
        assert.match(result.message, error_pattern)
        assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
        assert.ok(fs.existsSync(path.join(queue, 'plan-001.md')))
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('one exact completion line copied to stdout and stderr counts as one worker completion', async () => {
  const dir = make_temp_dir('agentflow-looper-duplicated-transport')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'duplicate' }))
    assert.equal(result.code, 0)
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-001.md')))
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-002.md')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('a child-created stop prevents archive and all later launches without interrupting the child', async () => {
  const dir = make_temp_dir('agentflow-looper-stop-during')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'stop', launch_log }))
    assert.notEqual(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
    assert.ok(fs.existsSync(stop_path(queue)))
    assert.ok(fs.existsSync(path.join(queue, 'plan-001.md')))
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('large output retains only a bounded diagnostic tail', async () => {
  const dir = make_temp_dir('agentflow-looper-large')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, { mode: 'large-success' }))
    assert.equal(result.code, 0)
    const record = read_json(attempt_path(queue))
    assert.equal(Object.hasOwn(record, 'diagnostic_tail'), false)
    assert.equal(Object.hasOwn(record, 'stdout'), false)
    assert.equal(Object.hasOwn(record, 'stderr'), false)
    assert.equal(Object.hasOwn(record, 'raw_output'), false)
    assert.equal(fs.readdirSync(queue).some((name) => name.includes('.tmp')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('failed and uncertain output retains only the bounded diagnostic tail', async () => {
  const dir = make_temp_dir('agentflow-looper-large-failure')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, {
      mode: 'large-success',
      exit_code: 7,
    }))
    assert.notEqual(result.code, 0)
    const record = read_json(attempt_path(queue))
    assert.ok(Buffer.byteLength(record.diagnostic_tail || '', 'utf8') <= 4096)
    assert.match(record.diagnostic_tail, /devlog\.md updated/)
    assert.equal(Object.hasOwn(record, 'stdout'), false)
    assert.equal(Object.hasOwn(record, 'stderr'), false)
    assert.equal(Object.hasOwn(record, 'raw_output'), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('successful stdout and stderr are absent from the final completed record', async () => {
  const dir = make_temp_dir('agentflow-looper-success-output')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, {
      mode: 'both-output',
    }))
    assert.equal(result.code, 0)
    const record = read_json(attempt_path(queue))
    assert.equal(record.phase, 'completed')
    assert.equal(Object.hasOwn(record, 'diagnostic_tail'), false)
    assert.doesNotMatch(JSON.stringify(record), /arbitrary stdout|arbitrary stderr/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('existing ownership is never stolen or changed', async () => {
  const dir = make_temp_dir('agentflow-looper-stale-lock')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    fs.mkdirSync(protected_state_dir(queue), { recursive: true, mode: 0o700 })
    fs.mkdirSync(lock_path(queue))
    fs.writeFileSync(path.join(lock_path(queue), 'owner.json'), '{"pid":999999,"stale":true}\n')
    const before = fs.readFileSync(path.join(lock_path(queue), 'owner.json'))
    const result = await run_looper(base_options(queue, fake_child))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /human review|ownership/i)
    assert.deepEqual(fs.readFileSync(path.join(lock_path(queue), 'owner.json')), before)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('an incomplete attempt blocks recovery without launching a child', async () => {
  const dir = make_temp_dir('agentflow-looper-attempt-block')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    fs.mkdirSync(protected_state_dir(queue), { recursive: true, mode: 0o700 })
    fs.writeFileSync(attempt_path(queue), JSON.stringify({ phase: 'launch-intent', selected_path: path.join(queue, 'plan-001.md') }) + '\n')
    const before = fs.readFileSync(attempt_path(queue))
    const result = await run_looper(base_options(queue, fake_child))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /incomplete attempt|human review/i)
    assert.deepEqual(fs.readFileSync(attempt_path(queue)), before)
    assert.equal(fs.existsSync(lock_path(queue)), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('--reset retires reviewed stale attempt, stop, and ownership records without running the queue', async () => {
  const dir = make_temp_dir('agentflow-looper-reset')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const failed = await run_looper(base_options(queue, fake_child, { mode: 'no-marker' }))
    assert.notEqual(failed.code, 0)
    const state_dir = protected_state_dir(queue)
    assert.equal(fs.existsSync(attempt_path(queue)), true)
    assert.equal(fs.existsSync(lock_path(queue)), true)
    assert.equal(fs.existsSync(path.join(queue, '.stop.txt')), true)

    const stderr = []
    const reset = await run_looper(base_options(queue, fake_child, { mode: 'success' }, {
      reset: true,
      silent: false,
      stderr: { write: chunk => stderr.push(String(chunk)) },
      process_is_alive: () => false,
    }))
    assert.equal(reset.code, 0, reset.message)
    assert.deepEqual(reset.launched, [])
    assert.equal(reset.message, 'Reset complete. No plans were started.')
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    assert.equal(fs.existsSync(attempt_path(queue)), false)
    assert.equal(fs.existsSync(lock_path(queue)), false)
    assert.equal(fs.existsSync(path.join(queue, '.stop.txt')), false)
    assert.equal(fs.readdirSync(state_dir).some(name => name.startsWith('.looper-reset-attempt-')), true)
    assert.equal(fs.readdirSync(state_dir).some(name => name.startsWith('.looper-reset-owner-')), true)
    assert.equal(fs.readdirSync(queue).some(name => name.startsWith('.looper-reset-stop-')), true)
    assert.match(stderr.join(''), /Reset retired:/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('--reset refuses live ownership without moving its evidence or launching work', async () => {
  const dir = make_temp_dir('agentflow-looper-reset-live')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    await run_looper(base_options(queue, fake_child, { mode: 'no-marker' }))
    let spawn_calls = 0
    const reset = await run_looper(base_options(queue, fake_child, {}, {
      reset: true,
      process_is_alive: () => true,
      spawn: () => { spawn_calls += 1 },
    }))
    assert.notEqual(reset.code, 0)
    assert.match(reset.message, /reset refused.*live/i)
    assert.equal(spawn_calls, 0)
    assert.equal(fs.existsSync(attempt_path(queue)), true)
    assert.equal(fs.existsSync(lock_path(queue)), true)
    assert.equal(fs.existsSync(path.join(queue, '.stop.txt')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('--reset keeps stop recovery inside the queue and does not inspect an unrelated done symlink', async () => {
  const dir = make_temp_dir('agentflow-looper-reset-symlink')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    await run_looper(base_options(queue, fake_child, { mode: 'no-marker' }))
    const outside = path.join(dir, 'outside')
    fs.mkdirSync(outside)
    fs.renameSync(path.join(queue, 'done'), path.join(queue, 'done-original'))
    fs.symlinkSync(outside, path.join(queue, 'done'))
    let done_reads = 0
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'readdirSync') return (directory, ...args) => {
          if (path.resolve(String(directory)) === path.resolve(queue, 'done')) done_reads += 1
          return fs.readdirSync(directory, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const reset = await run_looper(base_options(queue, fake_child, {}, {
      reset: true,
      fs: injected_fs,
      process_is_alive: () => false,
    }))
    assert.equal(reset.code, 0, reset.message)
    assert.equal(reset.message, 'Reset complete. No plans were started.')
    assert.deepEqual(reset.launched, [])
    assert.equal(done_reads, 0)
    assert.deepEqual(fs.readdirSync(outside), [])
    assert.equal(fs.readdirSync(queue).some(name => name.startsWith('.looper-reset-stop-')), true)
    assert.equal(fs.existsSync(path.join(queue, '.stop.txt')), false)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('a complete completed record permits only the later queued plan', async () => {
  const fixture = write_completed_fixture()
  try {
    const launch_log = path.join(fixture.dir, 'launch.jsonl')
    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, { launch_log }))
    assert.equal(result.code, 0)
    assert.deepEqual(result.launched, ['plan-002.md'])
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-002.md'])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-002.md')), true)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('attempt record pathname replacement is rejected before substituted completion can launch later work', async () => {
  const fixture = write_attempt_replacement_fixture()
  try {
    const launch_log = path.join(fixture.dir, 'launch.jsonl')
    let replaced = false
    const real_lstat = fs.lstatSync.bind(fs)
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'lstatSync') return (file, ...args) => {
          const stat = real_lstat(file, ...args)
          if (!replaced && path.resolve(String(file)) === path.resolve(attempt_path(fixture.queue))) {
            replaced = true
            fs.renameSync(attempt_path(fixture.queue), `${attempt_path(fixture.queue)}.original`)
            fs.writeFileSync(attempt_path(fixture.queue), fixture.replacement_bytes)
          }
          return stat
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, { launch_log }, {
      fs: injected_fs,
    }))

    assert.equal(replaced, true)
    assert.notEqual(result.code, 0)
    assert.match(result.message, /attempt|identity|human review|regular/i)
    assert.deepEqual(result.launched, [])
    assert.deepEqual(read_json_lines(launch_log), [])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'plan-002.md')), true)
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-002.md')), false)
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), true)
    assert.deepEqual(fs.readFileSync(attempt_path(fixture.queue)), fixture.replacement_bytes)
    assert.deepEqual(fs.readFileSync(`${attempt_path(fixture.queue)}.original`), fixture.original_bytes)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('attempt record one byte over 1 MiB stops before whole-file read or launch', async () => {
  const dir = make_temp_dir('agentflow-looper-attempt-over-ceiling')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const attempt = attempt_path(queue)
    const target_bytes = 1024 * 1024 + 1
    const prefix = '{"phase":"launch-intent","padding":"'
    const suffix = '"}'
    const padding_bytes = target_bytes - Buffer.byteLength(prefix + suffix, 'utf8')
    assert.ok(padding_bytes > 0)
    const attempt_bytes = Buffer.from(prefix + 'x'.repeat(padding_bytes) + suffix)
    assert.equal(attempt_bytes.length, target_bytes)
    fs.mkdirSync(path.dirname(attempt), { recursive: true, mode: 0o700 })
    fs.writeFileSync(attempt, attempt_bytes)

    let read_file_calls = 0
    let open_calls = 0
    let spawn_calls = 0
    const real_read_file = fs.readFileSync.bind(fs)
    const real_open = fs.openSync.bind(fs)
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') return (file, ...args) => {
          if (path.resolve(String(file)) === path.resolve(attempt)) read_file_calls += 1
          return real_read_file(file, ...args)
        }
        if (property === 'openSync') return (file, ...args) => {
          if (path.resolve(String(file)) === path.resolve(attempt)) open_calls += 1
          return real_open(file, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const result = await run_looper(base_options(queue, fake_child, {}, {
      fs: injected_fs,
      spawn: () => {
        spawn_calls += 1
        throw new Error('spawn must not be reached')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.match(result.message, /attempt|1,048,576|1048576|size|large/i)
    assert.equal(read_file_calls, 0)
    assert.equal(open_calls, 1)
    assert.equal(spawn_calls, 0)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('attempt record exactly 1 MiB reaches parsing without a size rejection', async () => {
  const dir = make_temp_dir('agentflow-looper-attempt-ceiling')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const attempt = attempt_path(queue)
    const attempt_bytes = Buffer.alloc(1024 * 1024, 0x78)
    fs.mkdirSync(path.dirname(attempt), { recursive: true, mode: 0o700 })
    fs.writeFileSync(attempt, attempt_bytes)

    let read_file_calls = 0
    let open_calls = 0
    let read_calls = 0
    let attempt_fd = null
    const real_read_file = fs.readFileSync.bind(fs)
    const real_open = fs.openSync.bind(fs)
    const real_read = fs.readSync.bind(fs)
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') return (file, ...args) => {
          if (path.resolve(String(file)) === path.resolve(attempt)) read_file_calls += 1
          return real_read_file(file, ...args)
        }
        if (property === 'openSync') return (file, ...args) => {
          const fd = real_open(file, ...args)
          if (path.resolve(String(file)) === path.resolve(attempt)) {
            open_calls += 1
            attempt_fd = fd
          }
          return fd
        }
        if (property === 'readSync') return (fd, ...args) => {
          if (fd === attempt_fd) read_calls += 1
          return real_read(fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const result = await run_looper(base_options(queue, fake_child, {}, { fs: injected_fs }))

    assert.notEqual(result.code, 0)
    assert.match(result.message, /invalid durable attempt evidence|JSON|Unexpected token/i)
    assert.doesNotMatch(result.message, /exceeds|1,048,576|1048576/i)
    assert.equal(read_file_calls, 0)
    assert.equal(open_calls, 1)
    assert.ok(read_calls > 0)
    assert.deepEqual(result.launched, [])
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('attempt record descriptor identity mismatch closes the descriptor and stops safely', async () => {
  const fixture = write_attempt_input_fixture()
  try {
    const attempt = attempt_path(fixture.queue)
    const real_open = fs.openSync.bind(fs)
    const real_fstat = fs.fstatSync.bind(fs)
    const real_close = fs.closeSync.bind(fs)
    let attempt_fd = null
    let close_calls = 0
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'openSync') return (file, ...args) => {
          const fd = real_open(file, ...args)
          if (path.resolve(String(file)) === path.resolve(attempt)) attempt_fd = fd
          return fd
        }
        if (property === 'fstatSync') return (fd, ...args) => {
          const stat = real_fstat(fd, ...args)
          if (fd !== attempt_fd) return stat
          return new Proxy(stat, {
            get(stat_target, stat_property, receiver) {
              if (stat_property === 'ino') return stat_target.ino + 1
              return Reflect.get(stat_target, stat_property, receiver)
            },
          })
        }
        if (property === 'closeSync') return (fd, ...args) => {
          if (fd === attempt_fd) close_calls += 1
          return real_close(fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, {}, { fs: injected_fs }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /identity|attempt|human review/i)
    assert.equal(attempt_fd !== null, true)
    assert.equal(close_calls, 1)
    assert.deepEqual(result.launched, [])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('attempt record growth after the descriptor read stops before parsing or launch', async () => {
  const fixture = write_attempt_input_fixture()
  try {
    const attempt = attempt_path(fixture.queue)
    const real_open = fs.openSync.bind(fs)
    const real_fstat = fs.fstatSync.bind(fs)
    const real_close = fs.closeSync.bind(fs)
    let attempt_fd = null
    let attempt_fstat_calls = 0
    let close_calls = 0
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'openSync') return (file, ...args) => {
          const fd = real_open(file, ...args)
          if (path.resolve(String(file)) === path.resolve(attempt)) attempt_fd = fd
          return fd
        }
        if (property === 'fstatSync') return (fd, ...args) => {
          const stat = real_fstat(fd, ...args)
          if (fd !== attempt_fd) return stat
          attempt_fstat_calls += 1
          if (attempt_fstat_calls < 2) return stat
          return new Proxy(stat, {
            get(stat_target, stat_property, receiver) {
              if (stat_property === 'size') return stat_target.size + 1
              return Reflect.get(stat_target, stat_property, receiver)
            },
          })
        }
        if (property === 'closeSync') return (fd, ...args) => {
          if (fd === attempt_fd) close_calls += 1
          return real_close(fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, {}, { fs: injected_fs }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /changed|identity|size|attempt|human review/i)
    assert.equal(attempt_fstat_calls, 2)
    assert.equal(close_calls, 1)
    assert.deepEqual(result.launched, [])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('attempt record short descriptor read stops safely and closes the descriptor', async () => {
  const fixture = write_attempt_input_fixture()
  try {
    const attempt = attempt_path(fixture.queue)
    const real_open = fs.openSync.bind(fs)
    const real_fstat = fs.fstatSync.bind(fs)
    const real_read = fs.readSync.bind(fs)
    const real_close = fs.closeSync.bind(fs)
    let attempt_fd = null
    let close_calls = 0
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'openSync') return (file, ...args) => {
          const fd = real_open(file, ...args)
          if (path.resolve(String(file)) === path.resolve(attempt)) attempt_fd = fd
          return fd
        }
        if (property === 'readSync') return (fd, ...args) => {
          if (fd === attempt_fd) return 0
          return real_read(fd, ...args)
        }
        if (property === 'closeSync') return (fd, ...args) => {
          if (fd === attempt_fd) close_calls += 1
          return real_close(fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, {}, { fs: injected_fs }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /read|attempt|human review/i)
    assert.equal(attempt_fd !== null, true)
    assert.equal(close_calls, 1)
    assert.deepEqual(result.launched, [])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('attempt record close failure is conservative and does not launch work', async () => {
  const fixture = write_attempt_input_fixture()
  try {
    const attempt = attempt_path(fixture.queue)
    const real_open = fs.openSync.bind(fs)
    const real_close = fs.closeSync.bind(fs)
    let attempt_fd = null
    let close_calls = 0
    const injected_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'openSync') return (file, ...args) => {
          const fd = real_open(file, ...args)
          if (path.resolve(String(file)) === path.resolve(attempt)) attempt_fd = fd
          return fd
        }
        if (property === 'closeSync') return (fd, ...args) => {
          if (fd === attempt_fd) {
            close_calls += 1
            throw new Error('attempt descriptor close denied')
          }
          return real_close(fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(fixture.queue, fixture.fake_child, {}, { fs: injected_fs }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /close denied|close|attempt|human review/i)
    assert.equal(attempt_fd !== null, true)
    assert.equal(close_calls, 1)
    assert.deepEqual(result.launched, [])
    assert.equal(fs.existsSync(path.join(fixture.queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(fixture.dir)
  }
})

test('every missing or malformed completed fact blocks recovery before ownership or later launch', async (t) => {
  const cases = [
    ['version missing', (record) => { delete record.version }],
    ['version malformed', (record) => { record.version = 2 }],
    ['task missing', (record) => { delete record.task }],
    ['task malformed', (record) => { record.task = 'not-a-plan' }],
    ['selected path missing', (record) => { delete record.selected_path }],
    ['selected path malformed', (record, queue) => { record.selected_path = path.join(fs.realpathSync(queue), 'plan-999.md') }],
    ['selected sha256 missing', (record) => { delete record.sha256 }],
    ['selected sha256 malformed', (record) => { record.sha256 = 'not-a-sha256' }],
    ['selected dev missing', (record) => { delete record.dev }],
    ['selected dev malformed', (record) => { record.dev = 'not-a-device' }],
    ['selected inode missing', (record) => { delete record.ino }],
    ['selected inode malformed', (record) => { record.ino = 'not-an-inode' }],
    ['selected size missing', (record) => { delete record.size }],
    ['selected size malformed', (record) => { record.size = -1 }],
    ['exit code missing', (record) => { delete record.exit_code }],
    ['exit code malformed', (record) => { record.exit_code = 1 }],
    ['signal missing', (record) => { delete record.signal }],
    ['signal malformed', (record) => { record.signal = 'SIGTERM' }],
    ['completion match count missing', (record) => { delete record.completion_matches }],
    ['completion match count malformed', (record) => { record.completion_matches = 2 }],
    ['completion line missing', (record) => { delete record.completion_line }],
    ['completion line malformed', (record) => { record.completion_line = 'wrong.md updated' }],
    ['rechecked sha256 missing', (record) => { delete record.rechecked_sha256 }],
    ['rechecked sha256 malformed', (record) => { record.rechecked_sha256 = '0'.repeat(64) }],
    ['rechecked dev missing', (record) => { delete record.rechecked_dev }],
    ['rechecked dev malformed', (record) => { record.rechecked_dev += 1 }],
    ['rechecked inode missing', (record) => { delete record.rechecked_ino }],
    ['rechecked inode malformed', (record) => { record.rechecked_ino += 1 }],
    ['rechecked size missing', (record) => { delete record.rechecked_size }],
    ['rechecked size malformed', (record) => { record.rechecked_size += 1 }],
    ['archived flag missing', (record) => { delete record.archived }],
    ['archived flag malformed', (record) => { record.archived = false }],
    ['archive path missing', (record) => { delete record.archived_path }],
    ['archive path malformed', (record, queue) => {
      record.archived_path = path.join(fs.realpathSync(queue), 'done', 'plan-999.md')
      fs.writeFileSync(record.archived_path, 'wrong archive name\n')
    }],
    ['archive sha256 missing', (record) => { delete record.archived_sha256 }],
    ['archive sha256 malformed', (record) => { record.archived_sha256 = 'not-a-sha256' }],
    ['archive dev missing', (record) => { delete record.archived_dev }],
    ['archive dev malformed', (record) => { record.archived_dev += 1 }],
    ['archive inode missing', (record) => { delete record.archived_ino }],
    ['archive inode malformed', (record) => { record.archived_ino += 1 }],
    ['archive size missing', (record) => { delete record.archived_size }],
    ['archive size malformed', (record) => { record.archived_size += 1 }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const fixture = write_completed_fixture(({ record, queue }) => mutate(record, queue))
      try {
        await assert_untrustworthy_completed_record_blocks(fixture)
      } finally {
        remove_temp_dir(fixture.dir)
      }
    })
  }
})

test('completed records reject noncanonical paths and every unsafe archive object', async (t) => {
  const cases = [
    ['selected path outside canonical queue', ({ record, dir }) => {
      record.selected_path = path.join(dir, 'outside', 'plan-001.md')
    }],
    ['selected path is not the recorded task basename', ({ record, queue }) => {
      record.selected_path = path.join(fs.realpathSync(queue), 'plan-999.md')
    }],
    ['archive path outside canonical done directory', ({ record, dir }) => {
      const outside_done = path.join(dir, 'outside-done')
      fs.mkdirSync(outside_done)
      record.archived_path = path.join(outside_done, 'plan-001.md')
      fs.writeFileSync(record.archived_path, 'outside archive\n')
    }],
    ['archive path is not the recorded task basename', ({ record, queue }) => {
      record.archived_path = path.join(fs.realpathSync(queue), 'done', 'plan-999.md')
      fs.writeFileSync(record.archived_path, 'wrong basename archive\n')
    }],
    ['source is still present', ({ record, queue }) => {
      fs.writeFileSync(record.selected_path, 'source returned\n')
    }],
    ['archive is missing', ({ record }) => {
      fs.unlinkSync(record.archived_path)
    }],
    ['archive is symlinked', ({ record, dir }) => {
      const target = path.join(dir, 'symlink-target.md')
      fs.writeFileSync(target, 'symlink archive\n')
      fs.unlinkSync(record.archived_path)
      fs.symlinkSync(target, record.archived_path)
    }],
    ['archive is non-regular', ({ record }) => {
      fs.unlinkSync(record.archived_path)
      fs.mkdirSync(record.archived_path)
    }],
    ['archive is replaced with the same content', ({ record }) => {
      const original = `${record.archived_path}.original`
      fs.renameSync(record.archived_path, original)
      fs.writeFileSync(record.archived_path, 'archived completed plan\n')
    }],
    ['archive content is corrupted', ({ record }) => {
      fs.writeFileSync(record.archived_path, 'corrupted archive\n')
    }],
    ['archive identity is inconsistent', ({ record }) => {
      record.archived_ino += 1
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const fixture = write_completed_fixture(mutate)
      try {
        await assert_untrustworthy_completed_record_blocks(fixture)
      } finally {
        remove_temp_dir(fixture.dir)
      }
    })
  }
})

test('authoritative state is protected outside the repository and task tree', async (t) => {
  for (const local_action of ['delete', 'replace']) {
    await t.test(local_action, async () => {
      const dir = make_temp_dir(`agentflow-looper-protected-state-${local_action}`)
      try {
        const root = path.join(dir, 'repo')
        const queue = path.join(root, 'tasks')
        fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
        const fake_child = make_fake_child(dir)
        write_plan(queue, 'plan-001.md')
        fs.mkdirSync(local_lock_path(queue))
        fs.writeFileSync(path.join(local_lock_path(queue), 'owner.json'), 'task-local decoy\n')
        fs.writeFileSync(local_attempt_path(queue), 'task-local decoy\n')
        const result = await run_looper(base_options(queue, fake_child, {
          mode: 'remove-task-state',
          local_action,
        }, { root }))
        assert.equal(result.code, 0)
        assert.equal(is_within(test_state_root, root), false)
        assert.equal(is_within(test_state_root, queue), false)
        assert.equal(is_within(test_state_root, os.tmpdir()), false)
        assert.equal(read_json(attempt_path(queue)).phase, 'completed')
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), true)
        assert.equal(fs.existsSync(local_attempt_path(queue)), local_action === 'replace')
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('unsafe authoritative state roots stop before child launch', async () => {
  const dir = make_temp_dir('agentflow-looper-unsafe-state')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md')
    for (const state_root of [queue, process.cwd(), os.tmpdir()]) {
      const result = await run_looper(base_options(queue, fake_child, { launch_log }, { state_root }))
      assert.notEqual(result.code, 0)
      assert.match(result.message, /protected state|unsafe|temporary|repository|task/i)
      assert.deepEqual(read_json_lines(launch_log), [])
      assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
      if (fs.existsSync(stop_path(queue))) fs.unlinkSync(stop_path(queue))
    }
  } finally {
    remove_temp_dir(dir)
  }
})

test('canonical queue authority survives a task-directory symlink retarget', async () => {
  const dir = make_temp_dir('agentflow-looper-canonical-queue')
  try {
    const root = path.join(dir, 'root')
    const queue_a = path.join(root, 'queue-a')
    const queue_b = path.join(root, 'queue-b')
    const lexical_tasks = path.join(root, 'tasks')
    fs.mkdirSync(path.join(queue_a, 'done'), { recursive: true })
    fs.mkdirSync(path.join(queue_b, 'done'), { recursive: true })
    write_plan(queue_a, 'plan-001.md', 'canonical queue A')
    write_plan(queue_b, 'plan-001.md', 'retargeted queue B')
    fs.symlinkSync(queue_a, lexical_tasks, 'dir')
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    let prompt_context
    let spawn_options
    const result = await run_looper(base_options(lexical_tasks, fake_child, { launch_log }, {
      root,
      prompt_builder: (value) => {
        prompt_context = value
        return `canonical prompt ${value.relative_task}`
      },
      spawn: (executable, args, options) => {
        spawn_options = options
        return spawn(executable, args, options)
      },
      on_event: (event) => {
        if (event.event !== 'ownership-acquired') return
        fs.unlinkSync(lexical_tasks)
        fs.symlinkSync(queue_b, lexical_tasks, 'dir')
      },
    }))

    assert.equal(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
    assert.ok(fs.existsSync(path.join(queue_a, 'done', 'plan-001.md')))
    assert.equal(fs.existsSync(path.join(queue_b, 'done', 'plan-001.md')), false)
    assert.equal(fs.existsSync(path.join(queue_b, 'plan-001.md')), true)
    assert.equal(prompt_context.tasks_dir, fs.realpathSync(queue_a))
    assert.equal(prompt_context.root, fs.realpathSync(root))
    assert.equal(prompt_context.plan_path, path.join(fs.realpathSync(queue_a), 'plan-001.md'))
    assert.equal(spawn_options.cwd, fs.realpathSync(root))
  } finally {
    remove_temp_dir(dir)
  }
})

test('canonical queue replacement after acquisition stops before spawn', async () => {
  const dir = make_temp_dir('agentflow-looper-canonical-queue-replacement')
  try {
    const root = path.join(dir, 'root')
    const queue = path.join(root, 'tasks')
    fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
    write_plan(queue, 'plan-001.md', 'original queue')
    const original_queue = `${queue}.original`
    const replacement_plan = path.join(queue, 'plan-001.md')
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    const result = await run_looper(base_options(queue, fake_child, { launch_log }, {
      root,
      on_event: (event) => {
        if (event.event !== 'ownership-acquired') return
        fs.renameSync(queue, original_queue)
        fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
        write_plan(queue, 'plan-001.md', 'replacement queue')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log), [])
    assert.equal(fs.existsSync(path.join(original_queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(replacement_plan), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('canonical root replacement after acquisition stops before spawn', async () => {
  const dir = make_temp_dir('agentflow-looper-canonical-root-replacement')
  try {
    const root = path.join(dir, 'root')
    const queue = path.join(root, 'tasks')
    fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
    write_plan(queue, 'plan-001.md', 'original root')
    const original_root = `${root}.original`
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    const result = await run_looper(base_options(queue, fake_child, { launch_log }, {
      root,
      on_event: (event) => {
        if (event.event !== 'ownership-acquired') return
        fs.renameSync(root, original_root)
        fs.mkdirSync(path.join(root, 'tasks', 'done'), { recursive: true })
        write_plan(path.join(root, 'tasks'), 'plan-001.md', 'replacement root')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.deepEqual(read_json_lines(launch_log), [])
    assert.equal(fs.existsSync(path.join(original_root, 'tasks', 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(root, 'tasks', 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(root, 'tasks', 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('canonical queue replacement before archive stops without moving either plan object', async () => {
  const dir = make_temp_dir('agentflow-looper-canonical-archive-replacement')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md', 'original queue')
    const original_queue = `${queue}.original`
    const result = await run_looper(base_options(queue, fake_child, {}, {
      before_archive_source_move: ({ source }) => {
        fs.renameSync(queue, original_queue)
        fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
        write_plan(queue, path.basename(source), 'replacement queue')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.equal(fs.existsSync(path.join(original_queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('pre-existing protected state requires a real directory, matching owner, and no group or other permission bit', async (t) => {
  await t.test('wrong owner is refused', async () => {
    const dir = make_temp_dir('agentflow-looper-state-owner')
    try {
      const queue = make_queue()
      const fake_child = make_fake_child(dir)
      const state_dir = protected_state_dir(queue)
      fs.mkdirSync(state_dir, { recursive: true, mode: 0o700 })
      const real_lstat = fs.lstatSync.bind(fs)
      const injected_fs = new Proxy(fs, {
        get(target, property) {
          if (property === 'lstatSync') return (file, ...args) => {
            const stat = real_lstat(file, ...args)
            if (path.resolve(String(file)) !== path.resolve(state_dir)) return stat
            return new Proxy(stat, {
              get(stat_target, stat_property, receiver) {
                if (stat_property === 'uid') return stat_target.uid + 1
                return Reflect.get(stat_target, stat_property, receiver)
              },
            })
          }
          const value = target[property]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      write_plan(queue, 'plan-001.md')
      const result = await run_looper(base_options(queue, fake_child, {}, { fs: injected_fs }))
      assert.notEqual(result.code, 0)
      assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    } finally {
      remove_temp_dir(dir)
    }
  })

  for (const mode of [0o720, 0o702, 0o704, 0o740, 0o755]) {
    await t.test(`mode ${mode.toString(8)} is refused`, async () => {
      const dir = make_temp_dir(`agentflow-looper-state-mode-${mode.toString(8)}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const state_dir = protected_state_dir(queue)
        fs.mkdirSync(state_dir, { recursive: true, mode: 0o700 })
        fs.chmodSync(state_dir, mode)
        write_plan(queue, 'plan-001.md')
        const result = await run_looper(base_options(queue, fake_child))
        assert.notEqual(result.code, 0)
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }

  await t.test('symlink state is refused', async () => {
    const dir = make_temp_dir('agentflow-looper-state-symlink')
    try {
      const queue = make_queue()
      const fake_child = make_fake_child(dir)
      const state_dir = protected_state_dir(queue)
      const state_target = path.join(dir, 'state-target')
      fs.mkdirSync(state_target, { recursive: true, mode: 0o700 })
      fs.mkdirSync(path.dirname(state_dir), { recursive: true })
      fs.symlinkSync(state_target, state_dir, 'dir')
      write_plan(queue, 'plan-001.md')
      const result = await run_looper(base_options(queue, fake_child))
      assert.notEqual(result.code, 0)
      assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    } finally {
      remove_temp_dir(dir)
    }
  })
})

test('replacing active authoritative lock or owner evidence stops without deleting the replacement', async (t) => {
  for (const target of ['owner', 'owner-token', 'lock']) {
    await t.test(target, async () => {
      const dir = make_temp_dir(`agentflow-looper-replaced-${target}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        write_plan(queue, 'plan-001.md')
        let replacement_bytes
        const result = await run_looper(base_options(queue, fake_child, { launch_log }, {
          on_event: (event) => {
            if (event.event !== 'ownership-acquired') return
            const owner_file = path.join(event.lock_dir, 'owner.json')
            replacement_bytes = Buffer.from(JSON.stringify({ owner_token: 'replacement-owner', pid: 1 }) + '\n')
            if (target === 'owner') {
              fs.renameSync(owner_file, owner_file + '.original')
              fs.writeFileSync(owner_file, replacement_bytes)
            } else if (target === 'owner-token') {
              fs.writeFileSync(owner_file, replacement_bytes)
            } else {
              fs.renameSync(event.lock_dir, event.lock_dir + '.original')
              fs.mkdirSync(event.lock_dir)
              fs.writeFileSync(path.join(event.lock_dir, 'owner.json'), replacement_bytes)
            }
          },
        }))
        assert.notEqual(result.code, 0)
        assert.deepEqual(read_json_lines(launch_log), [])
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.ok(replacement_bytes)
        assert.deepEqual(fs.readFileSync(path.join(lock_path(queue), 'owner.json')), replacement_bytes)
        assert.equal(fs.existsSync(lock_path(queue)), true)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('release verifies the acquiring owner and preserves a replacement', async () => {
  const dir = make_temp_dir('agentflow-looper-release-replacement')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const replacement = Buffer.from('{"owner_token":"replacement-owner","pid":1}\n')
    let replacement_path
    const result = await run_looper(base_options(queue, fake_child, {}, {
      on_event: (event) => {
        if (event.event !== 'plan-completed') return
        const owner_file = path.join(lock_path(queue), 'owner.json')
        replacement_path = owner_file
        fs.renameSync(owner_file, owner_file + '.original')
        fs.writeFileSync(owner_file, replacement)
      },
    }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /release|ownership|owner/i)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), true)
    assert.deepEqual(fs.readFileSync(replacement_path), replacement)
    assert.equal(fs.existsSync(lock_path(queue)), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('clean ownership release retains a verified retired owner directory', async () => {
  const dir = make_temp_dir('agentflow-looper-retired-owner')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child))
    const state_dir = protected_state_dir(queue)
    const retired = fs.readdirSync(state_dir).filter((name) => name.startsWith('.looper-retired-'))

    assert.equal(result.code, 0)
    assert.equal(fs.existsSync(lock_path(queue)), false)
    assert.equal(retired.length, 1)
    const retired_owner = path.join(state_dir, retired[0], 'owner.json')
    assert.equal(fs.lstatSync(path.join(state_dir, retired[0])).isDirectory(), true)
    assert.match(read_json(retired_owner).owner_token, /^[0-9a-f]{64}$/)
  } finally {
    remove_temp_dir(dir)
  }
})

test('owner release quarantines a replacement after the final verification and reports the retired path', async () => {
  const dir = make_temp_dir('agentflow-looper-retired-replacement')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    const replacement = Buffer.from('{"owner_token":"replacement-owner","pid":1}\n')
    let retired_path
    const result = await run_looper(base_options(queue, fake_child, {}, {
      before_release_move: ({ source, destination }) => {
        retired_path = destination
        fs.renameSync(source, `${source}.original`)
        fs.mkdirSync(source)
        fs.writeFileSync(path.join(source, 'owner.json'), replacement)
      },
    }))

    assert.notEqual(result.code, 0)
    assert.match(result.message, /retired|recovery|ownership/i)
    assert.ok(retired_path)
    assert.equal(fs.existsSync(lock_path(queue)), false)
    assert.deepEqual(fs.readFileSync(path.join(retired_path, 'owner.json')), replacement)
    assert.equal(fs.existsSync(`${lock_path(queue)}.original`), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('archive retains a hidden recovery hard link beside the final destination', async () => {
  const dir = make_temp_dir('agentflow-looper-archive-recovery')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md', 'recoverable plan')
    const result = await run_looper(base_options(queue, fake_child))
    const destination = path.join(queue, 'done', 'plan-001.md')
    const recovery_entries = fs.readdirSync(path.join(queue, 'done')).filter((name) => name.startsWith('.looper-recovery-'))
    const attempt = read_json(attempt_path(queue))

    assert.equal(result.code, 0)
    assert.equal(recovery_entries.length, 1)
    assert.equal(attempt.recovery_path, path.join(fs.realpathSync(queue), 'done', recovery_entries[0]))
    assert.equal(fs.statSync(attempt.recovery_path).ino, fs.statSync(destination).ino)
    assert.equal(fs.readFileSync(attempt.recovery_path, 'utf8'), 'recoverable plan\n')
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('archive moves a source replacement to recovery and stops without discarding it', async () => {
  const dir = make_temp_dir('agentflow-looper-archive-source-replacement')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md', 'original plan')
    let recovery_path
    const result = await run_looper(base_options(queue, fake_child, {}, {
      before_archive_source_move: ({ source, recovery_path: selected_recovery }) => {
        recovery_path = selected_recovery
        fs.renameSync(source, `${source}.original`)
        fs.writeFileSync(source, 'replacement plan\n')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.match(result.message, /recovery evidence/i)
    assert.ok(recovery_path)
    assert.equal(fs.existsSync(recovery_path), true)
    assert.equal(fs.readFileSync(recovery_path, 'utf8'), 'replacement plan\n')
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md.original')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    assert.equal(read_json(attempt_path(queue)).recovery_path, recovery_path)
  } finally {
    remove_temp_dir(dir)
  }
})

test('archive preserves a destination replacement at the cleanup boundary', async () => {
  const dir = make_temp_dir('agentflow-looper-archive-destination-replacement')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md', 'original plan')
    let recovery_path
    const destination = path.join(queue, 'done', 'plan-001.md')
    const result = await run_looper(base_options(queue, fake_child, {}, {
      before_destination_cleanup: ({ recovery_path: selected_recovery, destination: selected_destination }) => {
        recovery_path = selected_recovery
        fs.renameSync(selected_destination, `${selected_destination}.original`)
        fs.writeFileSync(selected_destination, 'replacement destination\n')
      },
    }))

    assert.notEqual(result.code, 0)
    assert.match(result.message, /recovery evidence/i)
    assert.ok(recovery_path)
    assert.equal(fs.readFileSync(destination, 'utf8'), 'replacement destination\n')
    assert.equal(fs.existsSync(`${destination}.original`), true)
    assert.equal(fs.existsSync(recovery_path), true)
    assert.equal(fs.statSync(`${destination}.original`).ino, fs.statSync(recovery_path).ino)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), false)
  } finally {
    remove_temp_dir(dir)
  }
})

test('two concurrent runners start at most one child', async () => {
  const dir = make_temp_dir('agentflow-looper-race')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md')
    const options = base_options(queue, fake_child, { delay: 120, launch_log })
    const [first, second] = await Promise.all([run_looper(options), run_looper(options)])
    assert.equal([first.code, second.code].filter((code) => code === 0).length, 1)
    assert.equal(read_json_lines(launch_log).length, 1)
  } finally {
    remove_temp_dir(dir)
  }
})

test('all nine lifecycle crash boundaries preserve conservative recovery', async () => {
  const phases = [
    'ownership-acquired',
    'identity-recorded',
    'launch-intent-recorded',
    'child-started',
    'child-exited',
    'completion-verified',
    'identity-rechecked',
    'archive-moved',
    'completed-state-written',
  ]

  for (const phase of phases) {
    const dir = make_temp_dir(`agentflow-looper-crash-${phase}`)
    try {
      const queue = make_queue()
      const fake_child = make_fake_child(dir)
      const launch_log = path.join(dir, 'launch.jsonl')
      write_plan(queue, 'plan-001.md')
      const options = base_options(queue, fake_child, { launch_log }, { crash_at: phase })
      const crashed = await run_looper(options)
      assert.notEqual(crashed.code, 0, phase)
      assert.equal(fs.existsSync(lock_path(queue)), true, phase)
      if (phase === 'ownership-acquired') {
        const owner = read_json(path.join(lock_path(queue), 'owner.json'))
        assert.match(owner.owner_token, /^[0-9a-f]{64}$/)
        assert.equal(owner.canonical_queue, fs.realpathSync(queue))
        assert.equal(owner.protected_state_path, protected_state_dir(queue))
      }
      const launches_before_restart = read_json_lines(launch_log).length
      const restarted = await run_looper(base_options(queue, fake_child, { launch_log }))
      assert.notEqual(restarted.code, 0, phase)
      assert.equal(read_json_lines(launch_log).length, launches_before_restart, phase)
      assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), phase === 'archive-moved' || phase === 'completed-state-written')
    } finally {
      remove_temp_dir(dir)
    }
  }
})

test('selected plan edit, replacement, rename, and removal stop safely', async (t) => {
  for (const mutation of ['edit', 'replace', 'rename', 'remove']) {
    await t.test(mutation, async () => {
      const dir = make_temp_dir(`agentflow-looper-mutation-${mutation}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        write_plan(queue, 'plan-001.md', 'original')
        write_plan(queue, 'plan-002.md', 'later')
        const result = await run_looper(base_options(queue, fake_child, { mode: 'mutate', mutation, launch_log }))
        assert.notEqual(result.code, 0)
        assert.match(result.message, /identity|selected plan|changed/i)
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.equal(read_json_lines(launch_log).length, 1)
        assert.ok(fs.existsSync(stop_path(queue)))
        const restarted = await run_looper(base_options(queue, fake_child, { launch_log }))
        assert.notEqual(restarted.code, 0)
        assert.equal(read_json_lines(launch_log).length, 1)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('selected plan same-content replacement and symlink substitution stop safely', async (t) => {
  for (const mutation of ['same-content', 'symlink']) {
    await t.test(mutation, async () => {
      const dir = make_temp_dir(`agentflow-looper-object-${mutation}`)
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        write_plan(queue, 'plan-001.md', 'unchanged bytes')
        write_plan(queue, 'plan-002.md', 'later')
        const result = await run_looper(base_options(queue, fake_child, {
          mode: 'mutate',
          mutation,
          launch_log,
        }))
        assert.notEqual(result.code, 0)
        assert.match(result.message, /identity|regular|symlink|selected plan/i)
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
        assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
        assert.ok(fs.existsSync(stop_path(queue)))
        const record = read_json(attempt_path(queue))
        assert.equal(record.phase, 'failed')
        assert.equal(typeof record.sha256, 'string')
        assert.equal(typeof record.dev, 'number')
        assert.equal(typeof record.ino, 'number')
        assert.equal(typeof record.size, 'number')
        assert.ok(fs.existsSync(path.join(queue, 'plan-001.md.old')))
        if (mutation === 'symlink') assert.equal(fs.lstatSync(path.join(queue, 'plan-001.md')).isSymbolicLink(), true)
        else assert.equal(fs.lstatSync(path.join(queue, 'plan-001.md')).isFile(), true)
      } finally {
        remove_temp_dir(dir)
      }
    })
  }
})

test('destination collision preserves both files and starts no later plan', async () => {
  const dir = make_temp_dir('agentflow-looper-collision')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    write_plan(queue, 'plan-001.md', 'source')
    write_plan(queue, 'plan-002.md', 'later')
    fs.writeFileSync(path.join(queue, 'done', 'plan-001.md'), 'destination\n')
    const result = await run_looper(base_options(queue, fake_child, { launch_log }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /collision|destination/i)
    assert.equal(fs.readFileSync(path.join(queue, 'plan-001.md'), 'utf8'), 'source\n')
    assert.equal(fs.readFileSync(path.join(queue, 'done', 'plan-001.md'), 'utf8'), 'destination\n')
    assert.deepEqual(read_json_lines(launch_log).map((entry) => entry.task), ['plan-001.md'])
    assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('injected move failure preserves the source and primary reason', async () => {
  const dir = make_temp_dir('agentflow-looper-move-failure')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    const result = await run_looper(base_options(queue, fake_child, {}, {
      move_plan: () => {
        throw new Error('injected move denied')
      },
    }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /injected move denied/)
    assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
  } finally {
    remove_temp_dir(dir)
  }
})

test('primary failures remain visible when secondary evidence writing fails', async (t) => {
  await t.test('stop marker failure', async () => {
    const dir = make_temp_dir('agentflow-looper-secondary-stop')
    try {
      const queue = make_queue()
      const fake_child = make_fake_child(dir)
      write_plan(queue, 'plan-001.md')
      const result = await run_looper(base_options(queue, fake_child, { mode: 'no-marker' }, {
        write_stop_marker: () => {
          throw new Error('stop evidence denied')
        },
      }))
      assert.notEqual(result.code, 0)
      assert.match(result.message, /exactly one|completion/i)
      assert.match(result.message, /stop evidence denied/)
      assert.doesNotMatch(result.message, /TypeError|undefined is not/i)
    } finally {
      remove_temp_dir(dir)
    }
  })

  await t.test('attempt record failure', async () => {
    const dir = make_temp_dir('agentflow-looper-secondary-attempt')
    try {
      const queue = make_queue()
      const fake_child = make_fake_child(dir)
      write_plan(queue, 'plan-001.md')
      const result = await run_looper(base_options(queue, fake_child, {}, {
        write_attempt_record: () => {
          throw new Error('attempt evidence denied')
        },
      }))
      assert.notEqual(result.code, 0)
      assert.match(result.message, /attempt evidence denied/)
      assert.doesNotMatch(result.message, /TypeError|undefined is not/i)
      assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    } finally {
      remove_temp_dir(dir)
    }
  })
})

test('missing directories, non-directories, and unavailable executables fail concisely', async (t) => {
  await t.test('missing directory', async () => {
    const dir = make_temp_dir('agentflow-looper-missing')
    try {
      const result = await run_looper({ tasks_dir: path.join(dir, 'missing'), state_root: test_state_root, silent: true })
      assert.notEqual(result.code, 0)
      assert.match(result.message, /missing|directory|ENOENT/i)
      assert.doesNotMatch(result.message, /uncaught|TypeError/i)
    } finally {
      remove_temp_dir(dir)
    }
  })

  await t.test('not a directory', async () => {
    const dir = make_temp_dir('agentflow-looper-not-dir')
    try {
      const file = path.join(dir, 'tasks')
      fs.writeFileSync(file, 'not a directory\n')
      const result = await run_looper({ tasks_dir: file, state_root: test_state_root, silent: true })
      assert.notEqual(result.code, 0)
      assert.match(result.message, /directory|ENOTDIR/i)
    } finally {
      remove_temp_dir(dir)
    }
  })

	await t.test('unavailable executable', async () => {
		const dir = make_temp_dir('agentflow-looper-no-exec')
		try {
			const queue = path.join(dir, 'planned')
			fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
			fs.writeFileSync(path.join(dir, 'ag.json'), JSON.stringify(agentflow_settings.make_template('codex')))
			write_plan(queue, 'plan-001.md')
			const result = await run_looper({
				tasks_dir: queue,
				root: dir,
        state_root: test_state_root,
        completion_path,
        executable: path.join(dir, 'missing-executable'),
        silent: true,
      })
      assert.notEqual(result.code, 0)
      assert.equal(result.handoff, true)
      assert.match(result.message, /interactive host/i)
      assert.equal(fs.existsSync(stop_path(queue)), false)
		} finally {
			remove_temp_dir(dir)
		}
  })

  await t.test('inaccessible directory', async () => {
    const dir = make_temp_dir('agentflow-looper-inaccessible')
    try {
      const queue = make_queue()
      const denied_fs = new Proxy(fs, {
        get(target, property) {
          if (property === 'readdirSync') return () => {
            const error = new Error('permission denied')
            error.code = 'EACCES'
            throw error
          }
          const value = target[property]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
      const result = await run_looper({ tasks_dir: queue, state_root: test_state_root, fs: denied_fs, silent: true })
      assert.notEqual(result.code, 0)
      assert.match(result.message, /permission denied|EACCES/i)
      assert.doesNotMatch(result.message, /uncaught|TypeError/i)
    } finally {
      remove_temp_dir(dir)
    }
  })

	await t.test('ownership evidence permission failure', async () => {
		const dir = make_temp_dir('agentflow-looper-owner-permission')
		try {
			const queue = path.join(dir, 'planned')
			fs.mkdirSync(path.join(queue, 'done'), { recursive: true })
			fs.writeFileSync(path.join(dir, 'ag.json'), JSON.stringify(agentflow_settings.make_template('codex')))
      const denied_fs = new Proxy(fs, {
        get(target, property) {
          if (property === 'writeFileSync') return (file, ...args) => {
            if (String(file).includes('.looper.lock')) {
              const error = new Error('owner permission denied')
              error.code = 'EACCES'
              throw error
            }
            return target.writeFileSync.call(target, file, ...args)
          }
          const value = target[property]
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
		write_plan(queue, 'plan-001.md')
		const result = await run_looper({ tasks_dir: queue, root: dir, state_root: test_state_root, fs: denied_fs, silent: true })
      assert.notEqual(result.code, 0)
      assert.match(result.message, /owner permission denied|ownership evidence/i)
      assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
    } finally {
      remove_temp_dir(dir)
    }
  })
})

test('hostile data stays literal and does not create commands or files', async () => {
  const dir = make_temp_dir('agentflow-looper-hostile')
  const hostile_dir = path.join(dir, 'queue ; $(touch injected)')
  try {
    fs.mkdirSync(hostile_dir)
    fs.mkdirSync(path.join(hostile_dir, 'done'))
    const fake_child = make_fake_child(dir)
    const launch_log = path.join(dir, 'launch.jsonl')
    const hostile_prompt = 'prompt; $(touch prompt-created) && "quoted" > redirected'
    const hostile_marker = 'notebook;$(touch marker-created) updated'
    write_plan(hostile_dir, 'plan-001.md', 'name;$(touch content-created)\n"quoted" > redirected')
    const result = await run_looper({
      ...base_options(hostile_dir, fake_child, { launch_log }),
      completion_line: hostile_marker,
      prompt_builder: () => hostile_prompt,
      build_args: ({ task, plan_path, prompt }) => [fake_child, JSON.stringify({
        mode: 'success',
        marker: hostile_marker,
        launch_log,
        task,
        plan_path,
        prompt,
        tasks_dir: hostile_dir,
      })],
    })
    assert.equal(result.code, 0)
    const launch = read_json_lines(launch_log)[0]
    assert.equal(launch.prompt, hostile_prompt)
    assert.equal(fs.existsSync(path.join(dir, 'injected')), false)
    assert.equal(fs.existsSync(path.join(dir, 'prompt-created')), false)
    assert.equal(fs.existsSync(path.join(dir, 'marker-created')), false)
    assert.equal(fs.existsSync(path.join(dir, 'content-created')), false)
    assert.ok(fs.existsSync(path.join(hostile_dir, 'done', 'plan-001.md')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('the default child boundary is injected, ephemeral, shell-free, and fresh per plan', async () => {
  const dir = make_temp_dir('agentflow-looper-default-spawn')
  try {
    const queue = make_queue()
    write_plan(queue, 'plan-001.md')
    write_plan(queue, 'plan-002.md')
    const calls = []
    const children = []
    let next_pid = 7001
    const injected_spawn = (executable, args, options) => {
      const child = new EventEmitter()
      child.stdout = new PassThrough()
      child.stderr = new PassThrough()
      child.pid = next_pid++
      child.kill = () => true
      calls.push({ executable, args, options })
      children.push(child)
      fs.ftruncateSync(options.stdio[3], 0)
      fs.writeSync(options.stdio[3], `${completion_line}\n`, 0, 'utf8')
      setImmediate(() => {
        child.stdout.end('fake child diagnostic\n')
        child.stderr.end('fake child report\n')
        child.emit('close', 0, null)
      })
      return child
    }

    const result = await run_looper({
      root: dir,
      tasks_dir: queue,
      state_root: test_state_root,
      completion_path,
      executable: 'codex',
      worker_config: { switches: { 'allowed-worker': ['external'], 'cli-provider': 'on' }, 'external-workers': [{ id: 'codex', command: ['codex', 'exec'], family: 'codex', priority: 1, tiers: { basic: 'fixture/low' } }] },
      executable_available: () => true,
      spawn: injected_spawn,
      silent: true,
      verify_notebook_round: false,
    })

    assert.equal(result.code, 0)
    assert.deepEqual(result.launched, ['plan-001.md', 'plan-002.md'])
    assert.equal(calls.length, 2)
    assert.notEqual(children[0], children[1])
    for (const [index, call] of calls.entries()) {
      const task = `plan-${String(index + 1).padStart(3, '0')}.md`
      const prompt = `Execute the frozen plan directly: ${path.relative(dir, path.join(queue, task))}\n\nYou are the plan worker already launched by agf-looper. Execute the named plan directly and complete the product work yourself. Do not invoke agf-looper or start another plan worker. Do not invoke Agentflow, codex, claude, another model CLI, a subagent, a delegate, or an independent review process. Complete the Agentflow notebook record for this plan. A completed round must contain its exact \`# ← Reply / A-NNN\` heading and must end with the next sequential scaffold in exactly this form, including the bare plus line: \`# → Ask / A-NNN\n\n+\`. Do not treat a summary, final report, commit, or bare completion signal as a completed notebook round without the Reply heading and that full next-Ask scaffold. When the plan and its record are safely complete, your entire final response must be exactly: ${completion_line}`
      assert.equal(call.executable, 'codex')
      assert.deepEqual(call.args, ['exec', '--sandbox', 'workspace-write', '--ephemeral', '-m', 'fixture', '-c', 'model_reasoning_effort=low', '--output-last-message', '/dev/fd/3', prompt])
      assert.equal(call.options.shell, false)
      assert.equal(call.options.cwd, fs.realpathSync(dir))
    }
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-001.md')))
    assert.ok(fs.existsSync(path.join(queue, 'done', 'plan-002.md')))
  } finally {
    remove_temp_dir(dir)
  }
})

test('plan hashing uses bounded descriptor reads and accepts exactly 1 MiB', async () => {
  const dir = make_temp_dir('agentflow-looper-plan-ceiling')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const plan = path.join(queue, 'plan-001.md')
    fs.writeFileSync(plan, Buffer.alloc(1024 * 1024, 0x61))
    let plan_read_file_calls = 0
    let plan_read_calls = 0
    const tracked_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') return (file, ...args) => {
          if (path.resolve(String(file)) === path.resolve(plan)) plan_read_file_calls += 1
          return target.readFileSync.call(target, file, ...args)
        }
        if (property === 'readSync') return (fd, ...args) => {
          plan_read_calls += 1
          return target.readSync.call(target, fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(queue, fake_child, {}, { fs: tracked_fs }))
    assert.equal(result.code, 0)
    assert.equal(plan_read_file_calls, 0)
    assert.ok(plan_read_calls > 0)
    const record = read_json(attempt_path(queue))
    assert.equal(record.size, 1024 * 1024)
    assert.equal(typeof record.sha256, 'string')
    assert.equal(typeof record.dev, 'number')
    assert.equal(typeof record.ino, 'number')
  } finally {
    remove_temp_dir(dir)
  }
})

test('a plan one byte over 1 MiB stops before spawn or whole-file read', async () => {
  const dir = make_temp_dir('agentflow-looper-plan-over-ceiling')
  try {
    const queue = make_queue()
    const fake_child = make_fake_child(dir)
    const plan = path.join(queue, 'plan-001.md')
    fs.writeFileSync(plan, Buffer.alloc(1024 * 1024 + 1, 0x62))
    let plan_read_file_calls = 0
    let plan_read_calls = 0
    let spawn_calls = 0
    const tracked_fs = new Proxy(fs, {
      get(target, property) {
        if (property === 'readFileSync') return (file, ...args) => {
          if (path.resolve(String(file)) === path.resolve(plan)) plan_read_file_calls += 1
          return target.readFileSync.call(target, file, ...args)
        }
        if (property === 'readSync') return (fd, ...args) => {
          plan_read_calls += 1
          return target.readSync.call(target, fd, ...args)
        }
        const value = target[property]
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    const result = await run_looper(base_options(queue, fake_child, {}, {
      fs: tracked_fs,
      spawn: () => {
        spawn_calls += 1
        throw new Error('spawn must not be reached')
      },
    }))
    assert.notEqual(result.code, 0)
    assert.match(result.message, /1,048,576|1048576|size|large/i)
    assert.equal(spawn_calls, 0)
    assert.equal(plan_read_file_calls, 0)
    assert.equal(plan_read_calls, 0)
    assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
    assert.equal(read_json(attempt_path(queue)).phase, 'failed')
  } finally {
    remove_temp_dir(dir)
  }
})

const spawn_runner_process = ({ queue, fake_child, config, result_file, signal_file, completion = completion_path }) => {
  const script = `const { run_looper } = require(${JSON.stringify(module_path)})
const fs = require('node:fs')
const path = require('node:path')
const queue = ${JSON.stringify(queue)}
const fake_child = ${JSON.stringify(fake_child)}
const config = ${JSON.stringify(config)}
const result_file = ${JSON.stringify(result_file)}
const state_root = ${JSON.stringify(test_state_root)}
const runner_event_file = ${JSON.stringify(config.runner_event_file || '')}
const run = run_looper({
  tasks_dir: queue,
  root: path.dirname(fake_child),
  state_root,
  completion_path: ${JSON.stringify(completion)},
  executable: process.execPath,
  build_args: ({ task, plan_path, prompt }) => [fake_child, JSON.stringify({ ...config, marker: ${JSON.stringify(`${completion} updated`)}, task, plan_path, prompt, tasks_dir: queue })],
  on_event: (event) => { if (runner_event_file) fs.appendFileSync(runner_event_file, JSON.stringify({ ...event, at: Date.now() }) + '\\n') },
  silent: true,
})
run.then((result) => { fs.writeFileSync(result_file, JSON.stringify(result)); process.exitCode = result.code })
`
  return spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
}

const wait_for_file = async (file, timeout = 5000) => {
  const started = Date.now()
  while (!fs.existsSync(file)) {
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${file}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('SIGINT and SIGTERM record interruption before forwarding and stop the detached fake group', async (t) => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    await t.test(signal, async () => {
      const dir = make_temp_dir(`agentflow-looper-${signal}`)
      let runner
      try {
        const queue = make_queue()
        const fake_child = make_fake_child(dir)
        const launch_log = path.join(dir, 'launch.jsonl')
        const signal_log = path.join(dir, 'signals.jsonl')
        const event_file = path.join(dir, 'events.jsonl')
        const runner_event_file = path.join(dir, 'runner-events.jsonl')
        const heartbeat_file = path.join(dir, 'heartbeat.log')
        const result_file = path.join(dir, 'result.json')
        fs.writeFileSync(path.join(dir, 'devlog.md'), '# → Ask / A-001\n\n+ \n')
        write_plan(queue, 'plan-001.md')
        write_plan(queue, 'plan-002.md')
        runner = spawn_runner_process({
          queue,
          fake_child,
          result_file,
          config: {
            mode: 'signal-tree',
            launch_log,
            signal_file: signal_log,
            event_file,
            runner_event_file,
            heartbeat_file,
            ignore_first: true,
          },
        })
        await wait_for_file(launch_log)
        await wait_for_file(heartbeat_file + '.ready')
        const before_signal = Date.now()
        runner.kill(signal)
        runner.kill(signal)
        await new Promise((resolve, reject) => {
          runner.once('exit', resolve)
          runner.once('error', reject)
        })
        await wait_for_file(result_file)
        const result = read_json(result_file)
        assert.equal(result.code, signal === 'SIGINT' ? 130 : 143)
        assert.ok(fs.existsSync(stop_path(queue)))
        const attempt = read_json(attempt_path(queue))
        assert.equal(attempt.phase, 'interrupted')
        assert.equal(fs.existsSync(path.join(queue, 'plan-001.md')), true)
        assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
        assert.equal(fs.existsSync(path.join(queue, 'plan-002.md')), true)
        const signals = read_json_lines(signal_log)
        assert.ok(signals.some((entry) => entry.who === 'parent' && entry.signal === signal))
        assert.ok(signals.some((entry) => entry.who === 'grandchild' && entry.signal === signal))
        const runner_events = read_json_lines(runner_event_file)
        const interrupted_at = runner_events.find((entry) => entry.event === 'interruption-recorded').at
        const forwarded_at = runner_events.find((entry) => entry.event === 'signal-forwarded').at
        const forced_at = runner_events.find((entry) => entry.event === 'signal-force-forwarded').at
        assert.ok(interrupted_at <= forwarded_at)
        assert.ok(forwarded_at - interrupted_at < 500)
        assert.ok(forced_at - forwarded_at >= 450)
        assert.ok(Date.now() - before_signal >= 450)
        assert.equal(fs.readFileSync(heartbeat_file, 'utf8').length > 0, true)
      } finally {
        if (runner && runner.exitCode === null) runner.kill('SIGKILL')
        remove_temp_dir(dir)
      }
    })
  }
})
