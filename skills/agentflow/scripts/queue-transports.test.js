'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const looper = require('./looper')
const settings = require('./ag-settings')
const queue = require('./queue-contract')

const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const fixture_directory = (t, prefix) => {
  const directory = fs.realpathSync(fs.mkdtempSync(prefix))
  const identity = fs.lstatSync(directory)
  t.after(() => {
    const current = fs.lstatSync(directory)
    assert.ok(current.isDirectory() && !current.isSymbolicLink(), 'fixture directory must remain a real directory')
    assert.equal(current.dev, identity.dev, 'fixture directory device changed; retaining it')
    assert.equal(current.ino, identity.ino, 'fixture directory was replaced; retaining it')
    // These fixtures use synthetic host/native claims and never start a worker.
    // Keep their unresolved-claim evidence until all test assertions have run.
    execFileSync('trash', [directory], { stdio: 'pipe' })
    assert.equal(fs.existsSync(directory), false, 'fixture must leave its scratch location')
  })
  return directory
}

const fixture = (t, generated = false) => {
  const root = fixture_directory(t, path.join(os.tmpdir(), 'agf-queue-transports-'))
  const scratch = path.join(os.homedir(), 'tmp')
  fs.mkdirSync(scratch, { recursive: true })
  assert.ok(!fs.lstatSync(scratch).isSymbolicLink(), 'home scratch directory must not be a symlink')
  const state_root = fixture_directory(t, path.join(scratch, '.agf-queue-transport-state-'))
  const tasks_dir = path.join(root, 'planned')
  fs.mkdirSync(tasks_dir)
  const notebook = 'devlog.md'
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n')
  if (generated) {
    queue.plan_jobs({ operation: 'make-plans', allow_ag: 'off', tasks_dir, generation_id: 'transport-fixture', created_at: '2026-09-19T07:40:00.000Z', completion_path: notebook,
      jobs: [{ job_id: 'product', request_text: 'Create product.txt containing done and a newline.', repository_evidence: [{ path: notebook, sha256: hash(fs.readFileSync(path.join(root, notebook))) }], dependencies: [], complexity_reasons: [] }] })
  } else fs.writeFileSync(path.join(tasks_dir, 'plan-001.md'), '# Plan\n\nCreate product.txt containing done and a newline.\n')
  const config = settings.make_template('codex')
  config.switches['allowed-worker'] = ['external', 'internal', 'host']
  config.switches['review-policy'] = 'prefer-independent'
  const events = []
  return { root, tasks_dir, state_root, notebook, config, events, options: { root, tasks_dir, state_root, completion_path: notebook, host: 'portable', session: 'queue-fixture', worker_config: config, executable_available: () => false, log: () => {}, on_event: value => events.push(value) } }
}

test('standalone unavailable or forbidden external execution hands off before taking queue ownership', async t => {
  for (const allowed of [['host'], ['internal'], ['external']]) {
    const f = fixture(t)
    f.config.switches['allowed-worker'] = allowed
    const before = fs.readFileSync(path.join(f.tasks_dir, 'plan-001.md'))
    const result = await looper.run_looper(f.options)
    assert.equal(result.handoff, true, result.message)
    assert.match(result.message, /interactive host/i)
    assert.deepEqual(result.pending, ['plan-001.md'])
    assert.equal(f.events.some(event => event.event === 'ownership-acquired'), false)
    assert.deepEqual(fs.readFileSync(path.join(f.tasks_dir, 'plan-001.md')), before)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done')), false)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, '.stop.txt')), false)
  }
})

const selection = kind => ({
  policy: { allowed_worker: [kind], review_policy: 'prefer-independent', cli_provider: 'on' },
  host: { id: 'example-agent' },
  task: { role: 'implementation', interactive_host: true, delegation_worthy: true, work_boundary: ['product.txt'] },
  capabilities: { [kind]: { candidate_id: kind + ':fixture', available: true, tool: kind === 'internal' ? 'fixture_spawn' : undefined, model: 'fixture', effort: 'low' } },
})

const execution = (claim, kind, state = 'completed') => ({
  record_version: 1, task_id: claim.task.name, attempt_id: claim.owner_token,
  candidate_id: claim.selection.candidate_id, kind, role: 'implementation',
  source_identity: claim.source_identity,
  requested: {}, actual: { model: 'fixture', effort: 'low' }, state,
  outputs: { completion_line: 'devlog.md updated' }, changed_paths: ['product.txt', 'devlog.md'],
  acceptance: { checks_run: state === 'completed', coordinator_inspected: true, accepted: state === 'completed' }, limitations: [],
  transport: kind === 'internal' ? { thread_handle: 'fixture-thread', tool: 'fixture_spawn', worker_started: true, stop_verified: state === 'cancelled' } : { session_id: 'fixture-host' },
})

test('interactive native and host plans reuse frozen queue identity, exclusive ownership and archive proof', t => {
  for (const kind of ['internal', 'host']) {
    const f = fixture(t, true)
    const plan_before = fs.readFileSync(path.join(f.tasks_dir, 'plan-001.md'))
    const envelope_before = fs.readFileSync(path.join(f.tasks_dir, '.queue-generation.json'))
    const claim = looper.claim_host_plan({ ...f.options, selection_facts: selection(kind) })
    assert.equal(claim.selection.kind, kind)
    assert.throws(() => looper.claim_host_plan({ ...f.options, selection_facts: selection(kind) }), /ownership|attempt/i)
    fs.writeFileSync(path.join(f.root, 'product.txt'), 'done\n')
    fs.appendFileSync(path.join(f.root, f.notebook), '\n# ← Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n\n+\n')
    const result = looper.finish_host_plan(claim, execution(claim, kind))
    assert.equal(result.completed, true)
    assert.deepEqual(fs.readFileSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), plan_before)
    assert.deepEqual(fs.readFileSync(path.join(f.tasks_dir, '.queue-generation.json')), envelope_before)
    assert.equal(queue.select_host_ready_plans(f.tasks_dir).completed_plan_names.includes('plan-001.md'), true)
    assert.equal(looper.claim_host_plan({ ...f.options, selection_facts: selection(kind) }).completed, true)
  }
})

test('interactive cancellation, failed acceptance and changed frozen plans remain pending', t => {
  for (const failure of ['cancelled', 'task-failed', 'changed-plan']) {
    const f = fixture(t, true)
    const claim = looper.claim_host_plan({ ...f.options, selection_facts: selection('internal') })
    if (failure === 'changed-plan') fs.appendFileSync(path.join(f.tasks_dir, 'plan-001.md'), '\nUnexpected change.\n')
    const record = execution(claim, 'internal', failure === 'changed-plan' ? 'completed' : failure)
    assert.throws(() => looper.finish_host_plan(claim, record), /cancelled|failed|changed|completion|Reply/i)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), false)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, '.stop.txt')), true)
  }
})

test('reset cannot forget an unresolved native writer after the claim helper exits', async t => {
  const f = fixture(t, true)
  const claim = looper.claim_host_plan({ ...f.options, selection_facts: selection('internal') })
  const reset_options = { ...f.options, reset: true, process_is_alive: () => false }
  const unresolved = await looper.run_looper(reset_options)
  assert.notEqual(unresolved.code, 0)
  assert.match(unresolved.message, /interactive.*stop|unresolved.*interactive/i)
  assert.throws(() => looper.finish_host_plan(claim, execution(claim, 'internal', 'cancelled')), /cancelled/)
  const resolved = await looper.run_looper(reset_options)
  assert.equal(resolved.code, 0, resolved.message)
  assert.equal(fs.existsSync(path.join(f.tasks_dir, 'plan-001.md')), true)
})

test('interactive completion preserves hard permission and context requirements from its claim', t => {
  for (const control of ['enforced_read_only', 'fresh_context']) {
    const f = fixture(t, true)
    const facts = selection('internal')
    facts.task[control === 'fresh_context' ? 'require_fresh_context' : control] = true
    facts.capabilities.internal.controls = { [control]: true }
    const claim = looper.claim_host_plan({ ...f.options, selection_facts: facts })
    fs.appendFileSync(path.join(f.root, f.notebook), '\n# ← Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n\n+\n')
    const record = execution(claim, 'internal')
    assert.throws(() => looper.finish_host_plan(claim, record), /read-only|fresh.*context/)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'plan-001.md')), true)
    assert.equal(fs.existsSync(path.join(f.tasks_dir, 'done', 'plan-001.md')), false)
    record.transport[control === 'enforced_read_only' ? 'read_only' : 'fresh_context'] = true
    assert.equal(require('./delegation-route').validate_execution_record(record, { controls: claim.selection.requested }), null)
  }
})

test('interactive queue requests host choice before ownership and accepts either permitted kind', t => {
  for (const kind of ['internal', 'host']) {
    const f = fixture(t)
    const facts = selection('internal')
    delete facts.policy
    const pending = looper.claim_host_plan({ ...f.options, selection_facts: facts })
    assert.equal(pending.status, 'selection-required')
    assert.deepEqual(new Set(pending.alternatives.map(item => item.kind)), new Set(['internal', 'host']))
    assert.equal(f.events.some(event => event.event === 'ownership-acquired'), false)
    facts.task.executor_choice = { kind, reason: 'Host chose this route for the current plan' }
    const claim = looper.claim_host_plan({ ...f.options, selection_facts: facts })
    assert.equal(claim.selection.kind, kind)
    assert.equal(claim.selection.reason, facts.task.executor_choice.reason)
    fs.appendFileSync(path.join(f.root, f.notebook), '\n# ← Reply / A-001\n\nCompleted.\n\n# → Ask / A-002\n\n+\n')
    assert.equal(looper.finish_host_plan(claim, execution(claim, kind)).completed, true)
  }
})
