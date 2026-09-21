'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const route = require('./delegation-route.js')
const settings = require('./ag-settings.js')
const external_runner = require('./external-runner.js')

const valid_record = () => ({
	executor_class: 'generic_external',
	substantive_delegated_capable: true,
	runner_id: 'external-runner-v1',
	shared_supervision: 'absent',
	clone_isolation: 'independent',
	os_confinement: 'not_proven',
	stage_id: 'coding',
	material_risks: ['provider-command'],
	reason: 'a trusted literal command runs in an independent clone',
})

const valid_brief = () => '# Brief\n\nOriginal Ask: 3ways\n\nEvidence: current plan\n\nNormal journey: owner trigger reaches the existing runner.\n\nMaterial uncertainties: one decision remains.\n\nForbidden scope: no new executor.\n'
const valid_resolution = () => '# Host resolution\n\nSelected design: existing runner operation.\n\nRejected alternatives: a new dispatcher service.\n\nEvidence: immutable worker report.\n\nModel-family limitation: recorded by worker selection.\n\nNext human decision: review the resolution.\n'

test('shared selector honors host choice of executor kind and exposes native actions without commands', () => {
	const base = {
		policy: { allowed_worker: ['external', 'internal', 'host'], review_policy: 'prefer-independent' },
		task: { task_id: 'task-1', attempt_id: 'attempt-1', role: 'implementation', delegation_worthy: true, requested_tier: 'basic', work_boundary: ['src/a.js'], interactive_host: true },
		host: { id: 'example-agent', family: null, source_identity: { source_kind: 'git', value: 'abc123' } },
		capabilities: { external: [], internal: { available: true, candidate_id: 'native-1', controls: {}, model: 'inherited', effort: 'inherited' }, host: { available: true, candidate_id: 'host-1' } },
		attempts: [],
	}
	const selected = route.select_executor_action({ ...base, task: { ...base.task, executor_choice: { kind: 'internal', reason: 'Use the native interface for this bounded task' } } })
	assert.equal(selected.status, 'selected')
	assert.equal(selected.kind, 'internal')
	assert.equal(selected.action.type, 'native-tool')
	assert.equal(Object.hasOwn(selected.action, 'command'), false)
	const host_only = route.select_executor_action({ ...base, policy: { allowed_worker: ['host'], review_policy: 'prefer-independent' }, task: { ...base.task, delegation_worthy: false } })
	assert.equal(host_only.kind, 'host')
	assert.match(host_only.reason, /small|host|direct/i)
})

test('shared selector enforces exact controls and finite availability fallback', () => {
	const facts = {
		policy: { allowed_worker: ['external', 'internal', 'host'], review_policy: 'prefer-independent' },
		task: { task_id: 'task-2', attempt_id: 'attempt-1', role: 'implementation', delegation_worthy: true, requested_tier: 'basic', exact_model: 'gpt-exact', exact_effort: 'high', work_boundary: ['src/a.js'], interactive_host: true },
		host: { id: 'codex', family: 'codex', source_identity: { source_kind: 'git', value: 'abc123' } },
		capabilities: {
			external: [{ candidate_id: 'ext-1', id: 'ext-1', priority: 5, family: 'codex', available: true, recipe_checked: true, model: 'gpt-other', effort: 'low', command: ['codex', 'exec'] }],
			internal: { available: true, candidate_id: 'native-1', controls: { models: ['gpt-other'], efforts: ['low'] } },
			host: { available: true, candidate_id: 'host-1' },
		},
		attempts: [],
	}
	const unsatisfied = route.select_executor_action(facts)
	assert.equal(unsatisfied.status, 'unsatisfied')
	assert.match(unsatisfied.requirement, /exact model|gpt-exact/i)
	const fallback = route.next_executor_action({ ...facts, task: { ...facts.task, exact_model: undefined, exact_effort: undefined, executor_choice: { kind: 'internal', reason: 'Native execution can continue after the quota failure' } } }, { candidate_id: 'ext-1', kind: 'external', state: 'unavailable', worker_started: false, reason: 'quota' })
	assert.equal(fallback.status, 'selected')
	assert.equal(fallback.candidate_id, 'native-1')
	assert.equal(route.next_executor_action(facts, { candidate_id: 'ext-1', kind: 'external', state: 'task-failed' }).status, 'unsatisfied')
})

const selection_fixture = () => ({
	policy: { allowed_worker: ['external', 'internal', 'host'], review_policy: 'prefer-independent' },
	task: { task_id: 'matrix', role: 'implementation', delegation_worthy: true, interactive_host: true },
	host: { id: 'codex', family: 'codex' },
	capabilities: {
		external: [{ candidate_id: 'ext', priority: 5, family: 'codex', available: true, recipe_checked: true, command: ['codex', 'exec'], model: 'gpt-x', effort: 'low' }],
		internal: { candidate_id: 'native', available: true, model: 'gpt-y', effort: 'low', controls: {} },
		host: { candidate_id: 'host', available: true },
	},
})
const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest])) : [[]]

test('every permission subset and permutation permits host choice without kind precedence', () => {
	const base = selection_fixture()
	for (let mask = 1; mask < 8; mask++) {
		const subset = base.policy.allowed_worker.filter((_, i) => mask & (1 << i))
		for (const allowed_worker of permutations(subset)) {
			const facts = { ...base, policy: { ...base.policy, allowed_worker } }
			const undecided = route.select_executor_action(facts)
			assert.equal(undecided.status, subset.length === 1 ? 'selected' : 'selection-required')
			if (subset.length > 1) assert.deepEqual(new Set(undecided.alternatives.map(item => item.kind)), new Set(subset))
			for (const kind of subset) {
				const reason = 'The host chose ' + kind + ' for the task context and handoff cost'
				const result = route.select_executor_action({ ...facts, task: { ...base.task, executor_choice: { kind, reason } } })
				assert.equal(result.status, 'selected')
				assert.equal(result.kind, kind)
				assert.equal(result.reason, reason)
			}
		}
	}
	const unknown_off = route.select_executor_action({ ...base, policy: { ...base.policy, allowed_worker: ['external', 'internal'], cli_provider: 'off' }, host: { id: 'example-agent', family: null } })
	assert.equal(unknown_off.kind, 'internal')
	const unchecked = route.select_executor_action({ ...base, policy: { ...base.policy, allowed_worker: ['external'] }, capabilities: { external: [{ candidate_id: 'custom', available: true, command: ['custom-agent'], recipe_checked: false }] } })
	assert.equal(unchecked.status, 'unsatisfied')
	assert.match(unchecked.skipped[0].reason, /checked.*recipe/i)
})

test('host choice cannot bypass permissions, requirements or separate review preference', () => {
	const base = selection_fixture()
	const choose = (kind, extra = {}) => ({ ...base.task, executor_choice: { kind, reason: 'Use this available route' }, ...extra })
	for (const facts of [
		{ ...base, policy: { ...base.policy, allowed_worker: ['external'] }, task: choose('host') },
		{ ...base, task: choose('internal', { exact_model: 'absent' }) },
		{ ...base, task: choose('internal', { require_read_only: true }) },
		{ ...base, task: choose('internal', { require_fresh_context: true }) },
		{ ...base, task: choose('host', { review: true, role: 'cross-check' }) },
		{ ...base, task: { ...base.task, executor_choice: { kind: 'internal', reason: '' } } },
		{ ...base, task: { ...base.task, executor_choice: { kind: 'internal', reason: 'Bounded task', candidate_id: 'missing' } } },
	]) assert.equal(route.select_executor_action(facts).status, 'unsatisfied')
	const ordinary_host = route.select_executor_action({ ...base, task: choose('host') })
	assert.equal(ordinary_host.kind, 'host')
	assert.equal(ordinary_host.fallback_reason, undefined)
})

test('host can choose an external candidate without changing profile defaults', () => {
	const base = selection_fixture()
	base.capabilities.external.push({ ...base.capabilities.external[0], candidate_id: 'other-external', priority: 1 })
	const result = route.select_executor_action({ ...base, task: { ...base.task, executor_choice: { kind: 'external', candidate_id: 'other-external', reason: 'This worker already has the relevant task context' } } })
	assert.equal(result.candidate_id, 'other-external')
	const default_profile = route.select_executor_action({ ...base, task: { ...base.task, executor_choice: { kind: 'external', reason: 'Use the configured external profile default' } } })
	assert.equal(default_profile.candidate_id, 'ext')
})

test('settled unavailability returns alternatives for host choice instead of ordered fallback', () => {
	const base = selection_fixture()
	base.task.executor_choice = { kind: 'external', reason: 'Isolate the task edits' }
	const unavailable = { candidate_id: 'ext', kind: 'external', state: 'unavailable', worker_started: false, reason: 'Quota unavailable' }
	const next = route.next_executor_action(base, unavailable)
	assert.equal(next.status, 'selection-required')
	assert.deepEqual(new Set(next.alternatives.map(item => item.kind)), new Set(['internal', 'host']))
	const host = route.next_executor_action({ ...base, task: { ...base.task, executor_choice: { kind: 'host', reason: 'Continue directly using current context' } } }, unavailable)
	assert.equal(host.kind, 'host')
	assert.equal(host.reason, 'Continue directly using current context')
	assert.equal(host.fallback_reason, 'Quota unavailable')
})

test('focused correction prefers separate review and honors disabled pipeline roles', () => {
	const facts = {
		policy: { allowed_worker: ['host', 'internal', 'external'], review_policy: 'prefer-independent' },
		config: { 'pipeline-roles': { 'cross-check': 'off' } },
		task: { task_id: 'review-1', role: 'cross-check', review: true, small: true, delegation_worthy: false, interactive_host: true },
		capabilities: { internal: { candidate_id: 'native-review', available: true, tool: 'review', controls: {} }, host: { candidate_id: 'host-1', available: true } },
	}
	const disabled = route.select_executor_action(facts)
	assert.equal(disabled.status, 'unsatisfied')
	assert.match(disabled.requirement, /disabled/i)

	const separate = route.select_executor_action({ ...facts, config: { 'pipeline-roles': { 'cross-check': 'better' } } })
	assert.equal(separate.kind, 'internal')
	assert.notEqual(separate.kind, 'host')

	const fallback = route.select_executor_action({
		...facts,
		config: { 'pipeline-roles': { 'cross-check': 'better' } },
		capabilities: { host: { candidate_id: 'host-1', available: true } },
	})
	assert.equal(fallback.kind, 'host')
	assert.match(`${fallback.fallback_reason} ${fallback.limitations.join(' ')}`, /separate|review|unavailable/i)

	const required = route.select_executor_action({ ...facts, config: { 'pipeline-roles': { 'cross-check': 'better' } }, capabilities: { host: { candidate_id: 'host-1', available: true } }, policy: { allowed_worker: ['host', 'internal'], review_policy: 'require-independent' } })
	assert.equal(required.status, 'unsatisfied')
})

test('focused correction prevents fallback while workers may still own changes', () => {
	const facts = {
		policy: { allowed_worker: ['external', 'internal'], review_policy: 'prefer-independent' },
		task: { task_id: 'lifecycle-1', role: 'implementation', delegation_worthy: true },
		capabilities: { internal: { candidate_id: 'native-1', available: true, tool: 'native', controls: {} } },
		attempts: [],
	}
	assert.equal(route.next_executor_action(facts, { candidate_id: 'ext-1', state: 'unavailable', worker_started: true }).status, 'unsatisfied')
	assert.equal(route.next_executor_action(facts, { candidate_id: 'ext-1', state: 'unavailable', worker_started: false, changed_paths: ['src/a.js'] }).status, 'unsatisfied')
	assert.equal(route.select_executor_action({ ...facts, attempts: [{ candidate_id: 'old', state: 'task-failed' }] }).status, 'unsatisfied')
	const settled = route.next_executor_action(facts, { candidate_id: 'ext-1', state: 'unavailable', worker_started: false, changed_paths: ['src/a.js'], coordinator_inspected: true, reconciled: true })
	assert.equal(settled.status, 'selected')
})

test('focused correction applies provider, tier, and native control boundaries', () => {
	const task = { task_id: 'controls-1', role: 'implementation', requested_tier: 'better', delegation_worthy: true }
	const capabilities = {
		external: [{ candidate_id: 'paid', id: 'paid', available: true, recipe_checked: true, command: ['codex', 'exec'], tiers: { basic: 'gpt-basic/low' } }],
		internal: { candidate_id: 'native', available: true, tool: 'native', tiers: { better: 'gpt-tier/high' }, controls: { models: ['gpt-other'], efforts: ['low'] } },
	}
	const off = route.select_executor_action({ policy: { allowed_worker: ['external'], review_policy: 'prefer-independent', cli_provider: 'off' }, task, capabilities })
	assert.equal(off.status, 'unsatisfied')
	const native = route.select_executor_action({ policy: { allowed_worker: ['internal'], review_policy: 'prefer-independent' }, task, capabilities })
	assert.equal(native.kind, 'internal')
	assert.equal(native.actual.model, 'inherited')
	assert.match(native.limitations.join(' '), /tier|inherited|control/i)
	const configured = route.select_executor_action({ config: { switches: { 'allowed-worker': ['internal'], 'review-policy': 'prefer-independent' } }, task, capabilities })
	assert.equal(configured.kind, 'internal')
	const fresh = route.select_executor_action({ policy: { allowed_worker: ['internal'], review_policy: 'prefer-independent' }, task: { ...task, require_fresh_context: true }, capabilities })
	assert.equal(fresh.status, 'unsatisfied')
})

test('focused correction validates strict execution evidence without inventing identity', () => {
	const base = {
		record_version: 1, task_id: 'task-strict', attempt_id: 'attempt-1', candidate_id: 'native-1', kind: 'internal', role: 'implementation',
		source_identity: { source_kind: 'no-git', digest: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' },
		requested: {}, actual: { model: 'unknown', effort: 'inherited' }, state: 'completed', outputs: { result: 'ok' }, changed_paths: [],
		acceptance: { checks_run: true, coordinator_inspected: true, accepted: true }, limitations: [],
		transport: { tool: 'native', thread_handle: 'thread-1' },
	}
	assert.equal(route.validate_execution_record(base), null)
	assert.match(route.validate_execution_record({ ...base, record_version: 2 }), /version/i)
	assert.match(route.validate_execution_record({ ...base, source_identity: { source_kind: 'git', value: 'abc123' } }), /source_identity|lowercase hexadecimal/i)
	assert.match(route.validate_execution_record({ ...base, transport: { tool: 'native' } }), /handle/i)
	assert.match(route.validate_execution_record({ ...base, kind: 'external', transport: { runner_id: 'external-runner-v1' } }), /runner|process|clone/i)
	assert.match(route.validate_execution_record({ ...base, state: 'unavailable', acceptance: { accepted: true }, outputs: {} }), /acceptance/i)
})

test('transport-neutral execution records validate and legacy external records stay readable', () => {
	const record = {
		record_version: 1, task_id: 'task-3', attempt_id: 'attempt-1', candidate_id: 'host-1', kind: 'host', role: 'implementation',
		source_identity: { source_kind: 'git', value: '0123456789abcdef0123456789abcdef01234567' }, requested: {}, actual: { model: 'inherited', effort: 'inherited' },
		state: 'completed', outputs: { result: 'ok' }, changed_paths: [], acceptance: { checks_run: true, coordinator_inspected: true, accepted: true },
		limitations: ['host review'], transport: { session_id: 'session-1' },
	}
	assert.equal(route.validate_execution_record(record, { review_policy: 'prefer-independent' }), null)
	assert.match(route.validate_execution_record({ ...record, kind: 'external', transport: { session_id: 'bad' } }), /transport/i)
	assert.match(route.validate_execution_record({ ...record, kind: 'internal', transport: { tool: 'native', thread_handle: 'thread-1', command: ['node', 'fake'] } }), /fabricated command/i)
	assert.equal(route.validate_execution_record(valid_record()), null)
})

test('generic external records remain strict non-executable evidence', () => {
	assert.equal(route.validate_generic_external_record(valid_record()), null)
	assert.equal(route.select_delegation_route, undefined)
	assert.equal(route.validate_native_host_record, undefined)
})

test('generic external records reject removed supervision and malformed facts', () => {
	for (const [field, value] of [
		['runner_id', 'shared-supervisor'],
		['substantive_delegated_capable', 'true'],
		['shared_supervision', 'present'],
		['clone_isolation', 'shared'],
		['os_confinement', 'proven'],
		['stage_id', ''],
		['material_risks', []],
		['reason', ''],
	]) {
		const record = valid_record()
		record[field] = value
		assert.ok(route.validate_generic_external_record(record), field)
	}
})

test('threeways accepts only the exact owner trigger and never authorizes implementation', () => {
	for (const ask of ['3ways', 'threeways']) {
		const result = route.parse_threeways_trigger(ask)
		assert.equal(result.triggered, true)
		assert.equal(result.stage_id, 'threeways')
		assert.equal(result.runner_id, 'external-runner-v1')
		assert.equal(result.permits_one_review_when_allow_ag_off, true)
		assert.equal(result.permits_implementation, false)
	}
	for (const ask of ['my threeways preference', '3ways later', '3ways: debate the plan', 'threeways-review', 'three ways', '3WAYS', 'context\n3ways']) {
		assert.deepEqual(route.parse_threeways_trigger(ask), { triggered: false })
	}
})

test('threeways preserves one stable stage, immutable artifact names, and the three-start unresolved ceiling', () => {
	const first = route.plan_threeways_debate({ ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0 })
	assert.equal(first.valid, true)
	assert.equal(first.stage_id, 'threeways')
	assert.equal(first.permits_launch, true)
	assert.equal(first.round, 1)
	assert.deepEqual(first.artifacts, {
		brief: '.agentflow/artifacts/A-001-plan/threeways-brief-r1.md',
		report: '.agentflow/artifacts/A-001-plan/threeways-report-r1.md',
		resolution: '.agentflow/artifacts/A-001-plan/threeways-resolution-r1.md'
	})
	const ceiling = route.plan_threeways_debate({ ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 3 })
	assert.equal(ceiling.permits_launch, false)
	assert.equal(ceiling.consensus, 'UNRESOLVED')
	assert.match(ceiling.reason, /ceiling/)
	const owner = route.plan_threeways_debate({ ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0, owner_only_choice: true })
	assert.equal(owner.consensus, 'UNRESOLVED')
	assert.equal(route.plan_threeways_debate({ ask_text: '3ways', work_root: '../escape', worker_starts: 0 }).valid, false)
})

test('threeways launches only through the supplied unified external runner and configured better worker', async () => {
	const calls = []
	const result = await route.launch_threeways_debate({
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0,
		worker_selection: { active_host: 'codex' }, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, {
		resolve_worker: selection => ({ tier: 'better', recipe_checked: true, executable: 'codex', args: ['--safe'], profile: { id: 'reviewer' }, selection }),
		run_external_command: async options => { calls.push(options); return { process: { exit_code: 0 } } }
	})
	assert.equal(result.stage_id, 'threeways')
	assert.equal(result.worker.tier, 'better')
	assert.equal(result.runner_id, 'external-runner-v1')
	assert.deepEqual(calls, [{ source_directory: '/repo', command: ['codex', '--safe', 'exec', 'review'] }])
	const no_launch = await route.launch_threeways_debate({ ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 3 }, {})
	assert.equal(no_launch.permits_launch, false)
	assert.equal(no_launch.consensus, 'UNRESOLVED')
})

test('threeways launch obeys shared allowlist and returns native or host handoff without CLI invocation', async () => {
	const config = settings.make_template('codex')
	config.switches['allowed-worker'] = ['host']
	config.switches['review-policy'] = 'prefer-independent'
	let calls = 0
	const result = await route.launch_threeways_debate({
		ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0,
		config, worker_selection: { active_host: 'codex' }, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review'],
	}, { run_external_command: async () => { calls += 1; return { status: 'completed' } } })
	assert.equal(result.selection.kind, 'host')
	assert.equal(result.action.type, 'host-direct')
	assert.equal(result.review, 'UNRESOLVED')
	assert.equal(calls, 0)
})

test('threeways default path binds the imported worker resolver to the imported unified runner command', async () => {
	const original_resolver = settings.resolve_threeways_worker
	const original_runner = external_runner.run_external_command
	const calls = []
	settings.resolve_threeways_worker = (config, selection) => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: ['--profile', 'better'], config, selection })
	external_runner.run_external_command = async options => { calls.push(options); return { process: { exit_code: 0 } } }
	try {
		const result = await route.launch_threeways_debate({
			ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0,
			config: { approved: true }, worker_selection: { active_host: 'codex' }, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
		})
		assert.equal(result.worker.executable, 'brain-two')
		assert.deepEqual(calls, [{ source_directory: '/repo', command: ['brain-two', '--profile', 'better', 'exec', 'review'] }])
	} finally {
		settings.resolve_threeways_worker = original_resolver
		external_runner.run_external_command = original_runner
	}
})

test('threeways executes one immutable brief-report-resolution journey through the existing runner', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const calls = []
	const facts = {
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0,
		repo_root, brief_text: valid_brief(), host_resolution: valid_resolution(),
		worker_selection: { active_host: 'codex' }, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review'], host_disagreement: false
	}
	const result = await route.execute_threeways_debate(facts, {
		resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: ['--review'] }),
		run_external_command: async options => {
			calls.push(options)
			return { status: 'completed', result: { value: '* _2026-09-02 12:00:00 (brain-two)_\n\nEvidence: brief reviewed.\n\nConsensus: AGREE\n\nSelf-check: I cited the brief and stated one conclusion.\n' } }
		}
	})
	assert.equal(result.consensus, 'AGREE')
	assert.equal(result.retry_required, false)
	assert.deepEqual(calls, [{ source_directory: '/repo', command: ['brain-two', '--review', 'exec', 'review'] }])
	const artifact_root = path.join(repo_root, '.agentflow/artifacts/A-001-plan')
	assert.match(fs.readFileSync(path.join(artifact_root, 'threeways-brief-r1.md'), 'utf8'), /Normal journey/)
	assert.match(fs.readFileSync(path.join(artifact_root, 'threeways-report-r1.md'), 'utf8'), /^\* _2026/m)
	assert.match(fs.readFileSync(path.join(artifact_root, 'threeways-resolution-r1.md'), 'utf8'), /Consensus: AGREE/)
	const repeat = await route.execute_threeways_debate(facts, {})
	assert.equal(repeat.valid, false)
	assert.match(repeat.error, /already exists/)
})

test('threeways records the selected worker family fallback even if host prose understates it', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const understated_resolution = valid_resolution().replace('Model-family limitation: recorded by worker selection.', 'Model-family limitation: none.')
	const result = await route.execute_threeways_debate({
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0, repo_root,
		brief_text: valid_brief(), host_resolution: understated_resolution, worker_selection: {}, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, {
		resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: [], family_diversity: 'same-family-fallback', limitation: 'different-family unavailable' }),
		run_external_command: async () => ({ status: 'completed', result: { value: '* _2026-09-02 12:00:00 (brain-two)_\n\nConsensus: AGREE\n\nSelf-check: Evidence was checked.\n' } })
	})
	assert.equal(result.consensus, 'AGREE')
	const resolution = fs.readFileSync(path.join(repo_root, '.agentflow/artifacts/A-001-plan/threeways-resolution-r1.md'), 'utf8')
	assert.match(resolution, /Worker family diversity: same-family-fallback/)
	assert.match(resolution, /Worker family limitation: different-family unavailable/)
})

test('threeways preserves an honest diagnostic and requires retry when a worker report is malformed', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const result = await route.execute_threeways_debate({
		ask_text: 'threeways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 1,
		repo_root, brief_text: valid_brief(), host_resolution: valid_resolution(), worker_selection: {},
		runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, {
		resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: [] }),
		run_external_command: async () => ({ status: 'completed', result: { value: 'not a stamped worker report' } })
	})
	assert.equal(result.consensus, 'UNRESOLVED')
	assert.equal(result.retry_required, true)
	const report = fs.readFileSync(path.join(repo_root, '.agentflow/artifacts/A-001-plan/threeways-report-r2.md'), 'utf8')
	assert.match(report, /worker diagnostic/)
	assert.doesNotMatch(report, /^\* _/m)
	assert.match(report, /HOST-DIAGNOSTIC/)
})

test('threeways refuses false agreement after a failed runner and still records an unresolved result', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const result = await route.execute_threeways_debate({
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0, repo_root,
		brief_text: valid_brief(), host_resolution: valid_resolution(), worker_selection: {}, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, {
		resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: [] }),
		run_external_command: async () => ({ status: 'failed', result: { value: '* _2026-09-02 12:00:00 (brain-two)_\n\nConsensus: AGREE\n\nSelf-check: It looks valid but did not complete.\n' } })
	})
	assert.equal(result.consensus, 'UNRESOLVED')
	assert.equal(result.retry_required, true)
})

test('threeways persists an unresolved diagnostic when the existing runner throws', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const result = await route.execute_threeways_debate({
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0, repo_root,
		brief_text: valid_brief(), host_resolution: valid_resolution(), worker_selection: {}, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, { resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: [] }), run_external_command: async () => { throw new Error('network unavailable') } })
	assert.equal(result.consensus, 'UNRESOLVED')
	assert.match(fs.readFileSync(path.join(repo_root, '.agentflow/artifacts/A-001-plan/threeways-resolution-r1.md'), 'utf8'), /Consensus: UNRESOLVED/)
})

test('threeways refuses a symlinked work root before writing an artifact', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-outside-'))
	fs.symlinkSync(outside, path.join(repo_root, 'link'))
	const result = await route.execute_threeways_debate({
		ask_text: '3ways', work_root: 'link', worker_starts: 0, repo_root,
		brief_text: valid_brief(), host_resolution: valid_resolution(), worker_selection: {}, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}, {})
	assert.equal(result.valid, false)
	assert.match(result.error, /symbolic link/)
	assert.equal(fs.readdirSync(outside).length, 0)
})

test('the production threeways host command invokes the existing debate operation from frozen facts', async () => {
	const repo_root = fs.mkdtempSync(path.join(os.tmpdir(), 'threeways-route-'))
	const facts_path = path.join(repo_root, 'facts.json')
	fs.writeFileSync(facts_path, JSON.stringify({
		ask_text: '3ways', work_root: '.agentflow/artifacts/A-001-plan', worker_starts: 0, repo_root,
		brief_text: valid_brief(), host_resolution: valid_resolution(), worker_selection: {}, runner_options: { source_directory: '/repo' }, runner_arguments: ['exec', 'review']
	}))
	const original_write = process.stdout.write
	const output = []
	process.stdout.write = text => { output.push(text); return true }
	try {
		const result = await route.main(['threeways', facts_path], {
			resolve_worker: () => ({ tier: 'better', recipe_checked: true, executable: 'brain-two', args: [] }),
			run_external_command: async () => ({ status: 'completed', result: { value: '* _2026-09-02 12:00:00 (brain-two)_\n\nConsensus: AGREE\n\nSelf-check: Evidence was checked.\n' } })
		})
		assert.equal(result.consensus, 'AGREE')
		assert.match(output.join(''), /"runner_id":"external-runner-v1"/)
	} finally {
		process.stdout.write = original_write
	}
})

test('availability recovery accepts legacy attempts without kind and missing facts without throwing', () => {
	const unavailable = { candidate_id: 'native', state: 'unavailable', worker_started: false }
	assert.equal(route.next_executor_action(undefined, unavailable).status, 'unsatisfied')
	assert.equal(route.next_executor_action(null, unavailable).status, 'unsatisfied')
	const base = selection_fixture()
	base.policy.allowed_worker = ['internal', 'host']
	base.task.executor_choice = { kind: 'internal', reason: 'Use the native worker' }
	const next = route.next_executor_action(base, unavailable)
	assert.equal(next.kind, 'host')
	assert.match(next.fallback_reason, /native.*unavailable/)
	const other_choice = { ...base, task: { ...base.task, executor_choice: { kind: 'host', candidate_id: 'missing-host', reason: 'An explicit different host candidate' } } }
	assert.equal(route.next_executor_action(other_choice, unavailable).status, 'unsatisfied')
})
