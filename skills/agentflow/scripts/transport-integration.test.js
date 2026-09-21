'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const route = require('./delegation-route')
const settings = require('./ag-settings')

const native_facts = () => ({
  policy: { allowed_worker: ['internal', 'host'], review_policy: 'prefer-independent' },
  host: { id: 'codex', family: 'codex' },
  task: { task_id: 'partial-work', role: 'implementation', delegation_worthy: true, interactive_host: true, executor_choice: { kind: 'internal', reason: 'Native execution suits the bounded task' } },
  capabilities: { internal: { candidate_id: 'native-current', available: true, tool: 'spawn_agent', model: 'inherited', effort: 'inherited' } },
})

test('shared unavailable records cannot replace a writer before stop and partial-file reconciliation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-partial-transport-'))
  fs.writeFileSync(path.join(root, 'owner.txt'), 'owner bytes\n')
  fs.writeFileSync(path.join(root, 'product.txt'), 'partial work\n')
  const facts = native_facts()
  const first = route.select_executor_action(facts)
  assert.equal(first.kind, 'internal')
  const unavailable = { candidate_id: first.candidate_id, state: 'unavailable', changed_paths: ['product.txt'],
    acceptance: { coordinator_inspected: false, accepted: false }, transport: { worker_started: true, stop_verified: false } }
  assert.equal(route.next_executor_action(facts, unavailable).status, 'unsatisfied')
  unavailable.transport.stop_verified = true
  assert.equal(route.next_executor_action(facts, unavailable).status, 'unsatisfied')
  assert.equal(fs.readFileSync(path.join(root, 'product.txt'), 'utf8'), 'partial work\n')
  unavailable.acceptance.coordinator_inspected = true
  unavailable.reconciliation = { completed: true, retained_paths: ['product.txt'] }
  const next = route.next_executor_action({ ...facts, task: { ...facts.task, executor_choice: { kind: 'host', reason: 'Continue using the reconciled work in current context' } } }, unavailable)
  assert.equal(next.kind, 'host', next.requirement)
  fs.appendFileSync(path.join(root, 'product.txt'), 'continued by host\n')
  assert.equal(fs.readFileSync(path.join(root, 'product.txt'), 'utf8'), 'partial work\ncontinued by host\n')
  assert.equal(fs.readFileSync(path.join(root, 'owner.txt'), 'utf8'), 'owner bytes\n')
})

test('native tier preferences require actual exposed controls and exact choices override ordinary preferences', () => {
  const facts = native_facts()
  facts.task.requested_tier = 'cheap'
  facts.capabilities.internal.tiers = { cheap: 'configured/low' }
  const defaults = route.select_executor_action(facts)
  assert.equal(defaults.actual.model, 'inherited')
  assert.ok(defaults.limitations.length)
  facts.capabilities.internal.controls = { models: ['configured', 'explicit'], efforts: ['low', 'high'] }
  facts.task.exact_model = 'explicit'
  facts.task.exact_effort = 'high'
  const exact = route.select_executor_action(facts)
  assert.equal(exact.kind, 'internal', exact.requirement)
  assert.deepEqual(exact.actual, { model: 'explicit', effort: 'high' })
  assert.equal(exact.action.controls.model, 'explicit')
  assert.equal(exact.action.controls.effort, 'high')
})

test('migration preserves unrelated valid extension data while generic identity has one grammar', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-migration-transport-'))
  const config = settings.make_template('codex')
  config['schema-version'] = 7
  delete config.switches['allowed-worker']
  delete config.switches['review-policy']
  config['owner-note'] = { keep: 'unchanged' }
  const file = path.join(root, 'ag.json')
  fs.writeFileSync(file, JSON.stringify(config))
  settings.read_json_config(file, { active_host: 'example-agent', repo_root: root, check_executables: false })
  assert.deepEqual(JSON.parse(fs.readFileSync(file))['owner-note'], { keep: 'unchanged' })
  for (const value of ['Example-Agent', 'example.agent', ' example-agent ']) assert.throws(() => settings.normalise_host(value))
  assert.equal(settings.normalise_host('example-agent'), 'example-agent')
})

test('the real threeways caller hands unavailable external work to native without inventing a recipe', async () => {
  const config = settings.make_template('codex')
  config.switches['cli-provider'] = 'on'
  const facts = { ask_text: 'threeways', work_root: '.agentflow/artifacts/review', worker_starts: 0,
    config, worker_selection: { active_host: 'codex', executable_available: () => false },
    runner_options: {}, runner_arguments: [], host: { id: 'codex', family: 'codex' },
    capabilities: { internal: { candidate_id: 'native-reviewer', available: true, tool: 'spawn_agent' } } }
  let calls = 0
  const dependencies = { run_external_command: async () => { calls++; throw Error('unexpected external launch') } }
  const fallback = await route.launch_threeways_debate(facts, dependencies)
  assert.equal(fallback.selection.kind, 'internal')
  assert.equal(calls, 0)
  const malformed = await route.launch_threeways_debate({ ...facts, policy: { allowed_worker: 'external', review_policy: 'prefer-independent' } }, dependencies)
  assert.equal(malformed.selection.status, 'unsatisfied')
  config['external-workers'] = [{ ...config['external-workers'][0], command: ['custom-unchecked'] }]
  facts.worker_selection.executable_available = () => true
  const unchecked = await route.launch_threeways_debate(facts, dependencies)
  assert.equal(unchecked.selection.kind, 'internal')
  assert.equal(calls, 0)
})

test('direct selection preserves cancellation and unresolved unavailable ownership', () => {
  const facts = native_facts()
  for (const prior of [
    { candidate_id: 'native-current', state: 'running' },
    { candidate_id: 'native-current' },
    { candidate_id: 'native-current', state: 'unavailable', transport: { worker_started: true, stop_verified: false } },
    { candidate_id: 'native-current', state: 'cancelled', settled: true, transport: { worker_started: true, stop_verified: true } },
    { candidate_id: 'native-current', state: 'uncertain', resolved: true },
  ]) assert.equal(route.select_executor_action({ ...facts, attempts: [prior] }).status, 'unsatisfied')
})

test('threeways skips an unchecked external recipe before choosing an eligible profile', async () => {
  const config = settings.make_template('codex')
  config.switches['cli-provider'] = 'on'
  config['external-workers'].unshift({ ...config['external-workers'][1], id: 'unchecked', priority: 5, command: ['custom-unchecked'] })
  const facts = { ask_text: 'threeways', work_root: '.agentflow/artifacts/review', worker_starts: 0,
    config, worker_selection: { active_host: 'codex', executable_available: () => true },
    runner_options: {}, runner_arguments: [], host: { id: 'codex', family: 'codex' },
    capabilities: { internal: { candidate_id: 'native-reviewer', available: true, tool: 'spawn_agent' } } }
  let command
  facts.task = { executor_choice: { kind: 'external', reason: 'Use a separate external review context' } }
  const result = await route.launch_threeways_debate(facts, { run_external_command: async options => { command = options.command; return { status: 'completed' } } })
  assert.equal(result.selection.kind, 'external')
  assert.equal(result.selection.candidate_id, 'claude-default')
  assert.deepEqual(command, ['claude', '-p'])
})

test('threeways honors task-specific native selection even with an available external reviewer', async () => {
  const config = settings.make_template('codex')
  config.switches['cli-provider'] = 'on'
  let calls = 0
  const facts = { ask_text: 'threeways', work_root: '.agentflow/artifacts/review', worker_starts: 0,
    config, worker_selection: { active_host: 'codex', executable_available: () => true }, runner_options: {}, runner_arguments: [],
    capabilities: { internal: { candidate_id: 'native-reviewer', available: true, tool: 'spawn_agent' } } }
  const dependencies = { run_external_command: async () => { calls++; throw Error('unexpected external launch') } }
  const pending = await route.launch_threeways_debate(facts, dependencies)
  assert.equal(pending.selection.status, 'selection-required')
  const selected = await route.launch_threeways_debate({ ...facts, task: { executor_choice: { kind: 'internal', reason: 'Use the available native reviewer for lower handoff cost' } } }, dependencies)
  assert.equal(selected.selection.kind, 'internal')
  assert.equal(selected.action.type, 'native-tool')
  assert.equal(calls, 0)
})
