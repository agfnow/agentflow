'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const settings = require('./ag-settings.js')

const make_repo = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ag-settings-')))
require('./fixtures/notebook-owner').configure()
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })
const no_executables = { executables: [], path_value: '' }
const all_executables = { executables: ['codex', 'claude'] }
const git = (repo, args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const repo_root = path.resolve(__dirname, '../../..')
const current_public_instruction_files = Object.freeze([
	'skills/agentflow/SKILL.md',
	'skills/agentflow/references/ag.md',
	'skills/agentflow/references/streams.md',
])

const canonical_public_syntax = Object.freeze([
	['new-feature:', /(?:^|[^A-Za-z0-9_-])new-feature\s*:/],
	['merge-back', /(?:^|[^A-Za-z0-9_-])merge-back(?:$|[^A-Za-z0-9_-])/],
	['target-doc:', /(?:^|[^A-Za-z0-9_-])target-doc\s*:/],
	['cli-provider:', /(?:^|[^A-Za-z0-9_-])cli-provider\s*:/],
	['auto-reply:', /(?:^|[^A-Za-z0-9_-])auto-reply\s*:/],
	['ask-names:', /(?:^|[^A-Za-z0-9_-])ask-names\s*:/],
	['allow-ag:', /(?:^|[^A-Za-z0-9_-])allow-ag\s*:/],
	['large-work-minutes:', /(?:^|[^A-Za-z0-9_-])large-work-minutes\s*:/],
	['keep-going', /(?:^|[^A-Za-z0-9_-])keep-going(?:$|[^A-Za-z0-9_-])/],
	['all-in', /(?:^|[^A-Za-z0-9_-])all-in(?:$|[^A-Za-z0-9_-])/],
])

const legacy_public_syntax = Object.freeze([
	['feature:', /(?:^|[`])feature\s*:/],
	['new_feature:', /(?:^|[^A-Za-z0-9_-])new_feature\s*:/],
	['merge_back', /(?:^|[^A-Za-z0-9_-])merge_back(?:$|[^A-Za-z0-9_-])/],
	['target_doc', /(?:^|[^$A-Za-z0-9-])target_doc(?:\b|:)/],
	['cli_provider', /(?:^|[^$A-Za-z0-9-])cli_provider\b/],
	['auto_reply', /(?:^|[^A-Za-z0-9-])auto_reply\b/],
	['ask_names', /(?:^|[^$A-Za-z0-9-])ask_names\b/],
	['keep_going', /(?:^|[^A-Za-z0-9_-])keep_going(?:$|[^A-Za-z0-9_-])/],
	['all_in', /(?:^|[^A-Za-z0-9_-])all_in(?:$|[^A-Za-z0-9_-])/],
	['internal_worker.<tier>', /(?:^|[^A-Za-z0-9_-])internal_worker\.(?:best|better|basic)\b/],
	['external_worker.<tier>', /(?:^|[^A-Za-z0-9_-])external_worker\.(?:best|better|basic)\b/],
	['security_scan', /(?:^|[^A-Za-z0-9_-])security_scan(?:$|[^A-Za-z0-9_-])/],
	['high_risk_review', /(?:^|[^A-Za-z0-9_-])high_risk_review(?:$|[^A-Za-z0-9_-])/],
	['three_way_review', /(?:^|[^A-Za-z0-9_-])three_way_review(?:$|[^A-Za-z0-9_-])/],
	['main_coordinator', /(?:^|[^A-Za-z0-9_-])main_coordinator(?:$|[^A-Za-z0-9_-])/],
	['mechanical_edit', /(?:^|[^A-Za-z0-9_-])mechanical_edit(?:$|[^A-Za-z0-9_-])/],
	['routine_scan', /(?:^|[^A-Za-z0-9_-])routine_scan(?:$|[^A-Za-z0-9_-])/],
])

const is_explicitly_rejected_migration_example = line =>
	/\b(?:rejected|obsolete|legacy)\b/i.test(line) && /\b(?:use|instead|replacement|not accepted)\b/i.test(line)

const is_private_protocol_label = line => /^\s*Active mode:\s+auto_reply=/.test(line)

const public_instruction_inventory = () => {
	const paths = current_public_instruction_files
	const files = paths.map(relative_path => ({
		relative_path,
		text: fs.readFileSync(path.join(repo_root, relative_path), 'utf8'),
	}))
	const legacy_occurrences = []

	for (const file of files) {
		file.text.split(/\r?\n/).forEach((line, index) => {
			if (is_explicitly_rejected_migration_example(line) || is_private_protocol_label(line)) return
			for (const [label, pattern] of legacy_public_syntax) {
				if (pattern.test(line)) legacy_occurrences.push(`${file.relative_path}:${index + 1}: ${label}`)
			}
		})
	}

	return { files, combined: files.map(file => file.text).join('\n'), legacy_occurrences }
}

test('schema-v8 policy templates and safe generic hosts are available', () => {
	const config = settings.make_template('codex')
	assert.equal(config['schema-version'], 8)
	assert.deepEqual(config.switches['allowed-worker'], ['external', 'internal', 'host'])
	assert.equal(config.switches['review-policy'], 'prefer-independent')
	assert.throws(() => settings.normalise_host(' example-agent '), /safe lowercase/)
	assert.equal(settings.family_for_host('example-agent'), '')
	const generic = settings.make_template('example-agent')
	assert.deepEqual(generic['external-workers'], [])
	assert.equal(settings.validate_config(generic, { active_host: 'example-agent', executables: [] }).valid, true)
	for (const invalid of [[], ['external', 'external'], ['external', 'sidecar'], 'external']) {
		const copy = JSON.parse(JSON.stringify(config))
		copy.switches['allowed-worker'] = invalid
		assert.equal(settings.validate_config(copy, { active_host: 'codex', ...all_executables }).valid, false)
	}
	const bad_review = JSON.parse(JSON.stringify(config))
	bad_review.switches['review-policy'] = 'maybe'
	assert.equal(settings.validate_config(bad_review, { active_host: 'codex', ...all_executables }).valid, false)
	const external = settings.make_template('codex')
	external.switches['cli-provider'] = 'off'
	assert.equal(settings.select_profile(external, { active_host: 'example-agent', executables: ['codex', 'claude'] }), null)
})

test('v7 settings migrate atomically and preserve custom values', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		const old = settings.make_template('codex')
		old['schema-version'] = 7
		old.switches.lang = 'zh-tw'
		old['pipeline-roles'].requirements = 'custom-tier'
		old['external-workers'][0].tiers['custom-tier'] = 'gpt-custom/high'
		const before = JSON.stringify(old, null, 2) + '\n'
		fs.writeFileSync(config_path, before)
		const migrated = settings.read_json_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(migrated['schema-version'], 8)
		assert.equal(migrated.switches.lang, 'zh-tw')
		assert.equal(migrated['pipeline-roles'].requirements, 'custom-tier')
		assert.equal(migrated['external-workers'][0].tiers['custom-tier'], 'gpt-custom/high')
		const once = fs.readFileSync(config_path, 'utf8')
		settings.read_json_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(fs.readFileSync(config_path, 'utf8'), once)
		assert.notEqual(once, before)
	} finally {
		drop(repo)
	}
})

const expect_invalid = (config, pattern, options = {}) => {
	const result = settings.validate_config(config, { ...all_executables, ...options })
	assert.equal(result.valid, false)
	assert.match(result.errors.join('; '), pattern)
}

const make_v5_fixture = host => {
	return JSON.parse(JSON.stringify(settings.make_template(host)))
}

const make_removed_schema_fixture = (host, schema) => {
	const template = settings.make_template(host)
	const host_profile = template['external-workers'].find(profile => profile.family === host)
	const other_profile = template['external-workers'].find(profile => profile.family !== host)
	const switches = JSON.parse(JSON.stringify(template.switches))
	delete switches['native-host']
	if (schema === 1) {
		delete switches['allow-ag']
		delete switches.metrics
	}
	if (schema === 1 || schema === 2) delete switches['native-host']
	return {
		'schema-version': schema,
		switches,
		'pipeline-roles': JSON.parse(JSON.stringify(template['pipeline-roles'])),
		'external-workers': [host_profile, other_profile],
	}
}

const custom_notebook_config = host => {
	const config = settings.make_template(host)
	config.switches['target-doc'] = 'devlog.md'
	return config
}

test('version-8 templates contain the exact switches and defaults', () => {
	for (const host of ['codex', 'claude']) {
		const config = settings.make_template(host)
		assert.equal(config['schema-version'], 8)
		assert.deepEqual(Object.keys(config.switches), [
		'target-doc', 'workspace-dir', 'cli-provider', 'auto-reply', 'log-verbosity', 'inline-reply', 'lang', 'streams', 'ask-names', 'allow-ag', 'large-work-minutes', 'git-timeout-ms', 'allowed-worker', 'review-policy', 'completion-cleanup', 'completion-cleanup-interval-days',
		])
		assert.equal(config.switches['allow-ag'], 'on')
		assert.equal(config.switches['large-work-minutes'], 120)
		assert.equal(config.switches['git-timeout-ms'], 30000)
		assert.deepEqual(config.switches['allowed-worker'], ['external', 'internal', 'host'])
		assert.equal(config.switches['review-policy'], 'prefer-independent')
		assert.equal(config.switches['completion-cleanup'], 'off')
		assert.equal(config.switches['completion-cleanup-interval-days'], 7)
		assert.equal(config['external-workers'].length, 2)
		assert.equal(settings.validate_config(config, { active_host: host, ...all_executables }).valid, true)
	}
})

test('schema-8 configs may omit optional cleanup switches and changes/help expose them', () => {
	const config = settings.make_template('codex')
	delete config.switches['completion-cleanup']
	delete config.switches['completion-cleanup-interval-days']
	const validation = settings.validate_config(config, { active_host: 'codex', ...all_executables })
	assert.equal(validation.valid, true)
	assert.equal(settings.canonical_config(config).switches['completion-cleanup'], undefined)
	assert.equal(settings.canonical_config(config).switches['completion-cleanup-interval-days'], undefined)
	const changed = settings.apply_changes(config, ['completion-cleanup: on', 'completion-cleanup-interval-days: 14'], { active_host: 'codex', ...all_executables })
	assert.equal(changed.config.switches['completion-cleanup'], 'on')
	assert.equal(changed.config.switches['completion-cleanup-interval-days'], 14)
	assert.deepEqual(changed.changes, ['completion-cleanup: undefined → on', 'completion-cleanup-interval-days: undefined → 14'])
	const display = settings.format_settings_display(settings.make_template('codex'), all_executables)
	assert.match(display, /completion-cleanup: off/)
	assert.match(display, /completion-cleanup-interval-days: 7/)
	assert.match(display, /completion-cleanup: off or on/)
	assert.match(display, /completion-cleanup-interval-days: integer from 1 through 365/)
	let help_text = ''
	assert.equal(settings.cli_main(['help'], { output: value => { help_text = value }, error: () => {} }), 0)
	assert.match(help_text, /completion-cleanup-interval-days/)
})

test('profile validation accepts the exact v8 shape and diagnoses legacy worker keys', () => {
	const config = make_v5_fixture('codex')
	assert.equal(config['schema-version'], 8)
	assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, true)

	for (const key of ['internal_worker', 'external_worker']) {
		const invalid = JSON.parse(JSON.stringify(config))
		invalid[key] = { best: 'gpt-5.6-sol/low', better: 'gpt-5.6-terra/high', basic: 'gpt-5.6-luna/max' }
		const result = settings.validate_config(invalid, { active_host: 'codex', ...all_executables })
		assert.equal(result.valid, true)
		assert.match(result.warnings.join('; '), new RegExp(`unknown top-level key '${key}'.*ignored`))
	}

	const missing = JSON.parse(JSON.stringify(config))
	delete missing['external-workers']
	expect_invalid(missing, /external-workers/)
})

test('profile validation rejects unsafe entry data', () => {
	const base = make_v5_fixture('codex')
	const cases = [
		['duplicate id', config => { config['external-workers'][1].id = config['external-workers'][0].id }, /Invalid external-workers\[1\]\.id: duplicate profile id/],
		['empty id', config => { config['external-workers'][0].id = '' }, /Invalid external-workers\[0\]\.id:/],
		['empty command', config => { config['external-workers'][0].command = [] }, /Invalid external-workers\[0\]\.command:/],
		['empty command element', config => { config['external-workers'][0].command = [''] }, /Invalid external-workers\[0\]\.command(?:\[0\])?:/],
		['forbidden command character', config => { config['external-workers'][0].command = ['codex', '$(touch owned)'] }, /Invalid external-workers\[0\]\.command(?:\[1\])?:/],
		['absolute executable', config => { config['external-workers'][0].command = ['/usr/bin/codex'] }, /must be an executable basename/],
		['slash executable', config => { config['external-workers'][0].command = ['bin/codex'] }, /must be an executable basename/],
		['dot executable', config => { config['external-workers'][0].command = ['.'] }, /must be an executable basename/],
		['dot-dot executable', config => { config['external-workers'][0].command = ['..'] }, /must be an executable basename/],
		['non-integer priority', config => { config['external-workers'][0].priority = 1.5 }, /Invalid external-workers\[0\]\.priority:/],
		['out-of-range priority', config => { config['external-workers'][0].priority = 6 }, /Invalid external-workers\[0\]\.priority:/],
		['missing tier', config => { delete config['external-workers'][0].tiers.best }, /Invalid external-workers\[0\]\.tiers\.best:/],
		['malformed tier', config => { config['external-workers'][0].tiers.best = 'not-a-tier' }, /Invalid external-workers\[0\]\.tiers\.best:/],
		['invalid family', config => { config['external-workers'][0].family = 'bad family' }, /Invalid external-workers\[0\]\.family:/],
	]

	for (const [name, mutate, pattern] of cases) {
		const invalid = JSON.parse(JSON.stringify(base))
		mutate(invalid)
		assert.throws(() => settings.assert_valid_config(invalid, { active_host: 'codex', ...all_executables }), pattern, name)
	}
	const unknown_profile_field = JSON.parse(JSON.stringify(base))
	unknown_profile_field['external-workers'][0].unexpected = true
	const diagnostic = settings.validate_config(unknown_profile_field, { active_host: 'codex', ...all_executables })
	assert.equal(diagnostic.valid, true)
	assert.match(diagnostic.warnings.join('; '), /unexpected.*unknown.*ignored/)

	const empty = JSON.parse(JSON.stringify(base))
	empty['external-workers'] = []
	assert.equal(settings.assert_valid_config(empty, { active_host: 'codex', ...all_executables }).valid, true)

	const literal_argument = JSON.parse(JSON.stringify(base))
	literal_argument['external-workers'][0].command = ['codex', 'nested/report.md']
	assert.equal(settings.validate_config(literal_argument, { active_host: 'codex', ...all_executables }).valid, true)
})

test('profile selection chooses the highest available priority and preserves tie order', () => {
	const config = make_v5_fixture('codex')
	config['external-workers'] = [
		{ ...config['external-workers'][0], id: 'unavailable-high', command: ['missing-high'], priority: 5 },
		{ ...config['external-workers'][0], id: 'first-tie', command: ['available-first'], priority: 4 },
		{ ...config['external-workers'][1], id: 'second-tie', command: ['available-second'], priority: 4 },
	]
	const executable_available = command => ['available-first', 'available-second'].includes(command)
	const options = { cli_provider: 'on', host_family: 'codex', executable_available }

	assert.equal(settings.select_profile(config, options).id, 'first-tie')
	assert.equal(settings.select_profile({ ...config, 'external-workers': [config['external-workers'][2]] }, options).id, 'second-tie')
	assert.equal(settings.select_profile({ ...config, 'external-workers': [config['external-workers'][0]] }, options), null)
})

test('cli-provider selection uses explicit family first and infers only uniform model prefixes', () => {
	const config = make_v5_fixture('codex')
	const make_profile = (id, tiers, extra = {}) => ({
		id,
		command: [id],
		priority: 3,
		tiers: { best: tiers[0], better: tiers[1], basic: tiers[2], cheap: tiers[3] || tiers[2] },
		...extra,
	})
	const available = { executable_available: () => true, host_family: 'codex' }

	const explicit_codex = make_profile('explicit-codex', ['claude-opus-5/high', 'claude-opus-4-6/high', 'claude-sonnet-5/high'], { family: 'codex' })
	const explicit_claude = make_profile('explicit-claude', ['gpt-5.6-sol/low', 'gpt-5.6-terra/high', 'gpt-5.6-luna/max'], { family: 'claude' })
	const inferred_codex = make_profile('inferred-codex', ['gpt-a/low', 'gpt-b/high', 'gpt-c/max'])
	const inferred_claude = make_profile('inferred-claude', ['claude-a/low', 'claude-b/high', 'claude-c/max'])
	const mixed = make_profile('mixed', ['gpt-a/low', 'claude-b/high', 'gpt-c/max'])
	const unknown = make_profile('unknown', ['other-a/low', 'other-b/high', 'other-c/max'])

	assert.equal(settings.select_profile({ ...config, 'external-workers': [explicit_codex] }, { ...available, cli_provider: 'off' }).id, 'explicit-codex')
	assert.equal(settings.select_profile({ ...config, 'external-workers': [explicit_claude] }, { ...available, cli_provider: 'off' }), null)
	assert.equal(settings.select_profile({ ...config, 'external-workers': [inferred_codex] }, { ...available, cli_provider: 'off' }).id, 'inferred-codex')
	assert.equal(settings.select_profile({ ...config, 'external-workers': [inferred_claude] }, { ...available, cli_provider: 'off' }), null)
	assert.equal(settings.select_profile({ ...config, 'external-workers': [mixed] }, { ...available, cli_provider: 'off' }), null)
	assert.equal(settings.select_profile({ ...config, 'external-workers': [unknown] }, { ...available, cli_provider: 'off' }), null)
	assert.equal(settings.select_profile({ ...config, 'external-workers': [mixed, unknown] }, { ...available, cli_provider: 'on' }).id, 'mixed')
})

test('model family validation accepts cross-family identifiers but still rejects malformed tiers', () => {
	const config = make_v5_fixture('codex')
	config['external-workers'][0].tiers.best = 'claude-opus-5/high'
	assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, true)
	config['external-workers'][0].tiers.best = 'not-a-tier'
	expect_invalid(config, /external-workers\[0\]\.tiers\.best/)
})

test('tier resolution returns the selected literal command and dispatch failure is fail-closed', () => {
	const config = make_v5_fixture('codex')
	const selection = settings.resolve_worker_tier(config, { role: 'acceptance' }, { active_host: 'codex', executables: ['codex'] })
	assert.deepEqual(Object.keys(selection).sort(), ['args', 'effort', 'executable', 'model', 'profile', 'tier'])
	assert.equal(selection.profile.id, 'codex-default')
	assert.equal(selection.executable, 'codex')
	assert.deepEqual(selection.args, ['exec'])
	assert.notEqual(selection.args, selection.profile.command.slice(1))
	assert.equal(selection.tier, 'better')
	const claude_selection = settings.resolve_worker_tier(make_v5_fixture('claude'), { role: 'coding' }, { active_host: 'claude', executables: ['claude'] })
	assert.equal(claude_selection.executable, 'claude')
	assert.deepEqual(claude_selection.args, ['-p'])

	const unavailable = make_v5_fixture('codex')
	unavailable['external-workers'] = [unavailable['external-workers'][0]]
	unavailable['external-workers'][0].command = ['missing']
	assert.throws(() => settings.resolve_dispatch_failure(unavailable, null, { active_host: 'codex', executables: [], cli_provider: 'off' }), /No eligible external-worker profile: no configured profile has an available executable compatible with cli-provider 'off'\./)
})

test('host templates provide the exact ordered codex and claude profiles', () => {
	for (const host of ['codex', 'claude']) {
		const config = settings.make_template(host)
		assert.equal(config['schema-version'], 8)
		assert.deepEqual(config['external-workers'].map(profile => ({ id: profile.id, command: profile.command, priority: profile.priority, family: profile.family })), host === 'codex'
			? [
				{ id: 'codex-default', command: ['codex', 'exec'], priority: 3, family: 'codex' },
				{ id: 'claude-default', command: ['claude', '-p'], priority: 3, family: 'claude' },
			]
			: [
				{ id: 'claude-default', command: ['claude', '-p'], priority: 3, family: 'claude' },
				{ id: 'codex-default', command: ['codex', 'exec'], priority: 3, family: 'codex' },
			])
		assert.equal(config['external-workers'][0].tiers.best, host === 'codex' ? 'gpt-6-astra/xhigh' : 'claude-opus-5/high')
	}
})

test('profile public setting changes use ids and reject removed worker paths', () => {
	const config = make_v5_fixture('codex')
	const changed = settings.apply_changes(config, ['codex-default.best: gpt-5.6-terra/high'], { active_host: 'codex', ...all_executables })
	assert.equal(changed.config['external-workers'][0].tiers.best, 'gpt-5.6-terra/high')
	assert.deepEqual(changed.changes, ['codex-default.best: gpt-6-astra/xhigh → gpt-5.6-terra/high'])
	assert.throws(() => settings.parse_change_lines(['internal-worker.best: gpt-5.6-terra/high']), /unsupported setting change: internal-worker\.best/)
	assert.throws(() => settings.parse_change_lines(['external-worker.best: claude-opus-5/high']), /unsupported setting change: external-worker\.best/)
})

test('malformed current configuration bytes are preserved without replacement', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		const malformed = settings.make_template('codex')
		delete malformed.switches['ask-names']
		const malformed_text = JSON.stringify(malformed, null, 2) + '\n'
		fs.writeFileSync(config_path, malformed_text)
		let rename_count = 0
		const tracking_fs = {
			...fs,
			renameSync: (...args) => {
				rename_count += 1
				return fs.renameSync(...args)
			},
		}

		assert.throws(() => settings.load_config(config_path, { repo_root: repo, active_host: 'codex', fs: tracking_fs, ...all_executables }), /ask-names/)
		assert.equal(fs.readFileSync(config_path, 'utf8'), malformed_text)
		assert.equal(rename_count, 0)
	} finally {
		drop(repo)
	}
})

test('exposes allow-ag and Git timeout in display and public changes', () => {
	const config = settings.make_template('codex')
	const display = settings.format_settings_display(config, all_executables)
	assert.match(display, /- allow-ag: on/)
	assert.match(display, /- git-timeout-ms: 30000/)
	assert.match(display, /allow-ag: on, off, or ask; use allow-ag: <value>/)
	assert.match(display, /git-timeout-ms: positive integer milliseconds/)

	const changed = settings.apply_changes(config, ['allow-ag: ask', 'git-timeout-ms: 45000'], { active_host: 'codex', ...all_executables })
	assert.equal(changed.config.switches['allow-ag'], 'ask')
	assert.equal(changed.config.switches['git-timeout-ms'], 45000)
	assert.deepEqual(changed.changes, ['allow-ag: on → ask', 'git-timeout-ms: 30000 → 45000'])
})

test('Git timeout lookup uses the stream configuration before the project configuration', () => {
	const repo = make_repo()
	try {
		const root = settings.make_template('codex')
		root.switches['git-timeout-ms'] = 11000
		fs.mkdirSync(path.join(repo, '.git'))
		fs.writeFileSync(path.join(repo, 'ag.json'), `${JSON.stringify(root, null, 2)}\n`)
		assert.equal(settings.configured_git_timeout_ms(repo), 11000)
		const nested = path.join(repo, 'nested', 'folder')
		fs.mkdirSync(nested, { recursive: true })
		assert.equal(settings.configured_git_timeout_ms(nested), 11000)
		const ordinary_nested = path.join(repo, '.worktrees', 'ordinary', 'nested')
		fs.mkdirSync(path.join(repo, '.worktrees', 'ordinary', '.git'), { recursive: true })
		fs.mkdirSync(ordinary_nested, { recursive: true })
		const ordinary = settings.make_template('codex')
		ordinary.switches['git-timeout-ms'] = 44000
		fs.writeFileSync(path.join(repo, '.worktrees', 'ordinary', 'ag.json'), `${JSON.stringify(ordinary, null, 2)}\n`)
		assert.equal(settings.configured_git_timeout_ms(ordinary_nested), 44000)

		const stream = path.join(repo, '.worktrees', 'search-page')
		const stream_config_path = path.join(stream, '.agentflow', 'features', 'search-page', 'ag.json')
		fs.mkdirSync(path.dirname(stream_config_path), { recursive: true })
		fs.writeFileSync(path.join(stream, '.git'), 'gitdir: ../.git/worktrees/search-page\n')
		fs.writeFileSync(path.join(stream, 'ag.json'), `${JSON.stringify(root, null, 2)}\n`)
		const stream_config = settings.make_template('codex')
		stream_config.switches['git-timeout-ms'] = 22000
		fs.writeFileSync(stream_config_path, `${JSON.stringify(stream_config, null, 2)}\n`)
		assert.equal(settings.configured_git_timeout_ms(stream), 22000)
		delete stream_config.switches['git-timeout-ms']
		fs.writeFileSync(stream_config_path, `${JSON.stringify(stream_config, null, 2)}\n`)
		assert.equal(settings.configured_git_timeout_ms(stream), null)
	} finally {
		drop(repo)
	}
})

test('schema-8 legacy metrics values are removed during read without becoming a setting', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		const legacy = settings.make_template('codex')
		legacy.switches.metrics = 'on'
		fs.writeFileSync(config_path, `${JSON.stringify(legacy, null, 2)}\n`)
		const loaded = settings.load_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(loaded.switches.metrics, undefined)
		assert.equal(settings.switch_names.includes('metrics'), false)
		assert.doesNotMatch(fs.readFileSync(config_path, 'utf8'), /metrics/)
	} finally {
		drop(repo)
	}
})

test('keeps the evidence window outside ag.json settings', () => {
	const config = settings.make_template('codex')
	const display = settings.format_settings_display(config, all_executables)

	assert.equal(settings.switch_names.includes('window'), false)
	assert.doesNotMatch(JSON.stringify(config), /window/)
	assert.doesNotMatch(display, /evidence window|--window/i)
})

test('rejects invalid new switch values and missing current fields', () => {
	const config = settings.make_template('codex')
	for (const [key, value, pattern] of [['allow-ag', 'maybe', /switches\.allow-ag.*one of/], ['git-timeout-ms', 0, /switches\.git-timeout-ms.*positive integer/]]) {
		const invalid = JSON.parse(JSON.stringify(config))
		invalid.switches[key] = value
		expect_invalid(invalid, pattern)
	}
	const missing = JSON.parse(JSON.stringify(config))
	delete missing.switches['allow-ag']
	expect_invalid(missing, /configuration\.switches\.allow-ag is required/)
})

test('host templates are exact, valid, and use the owner-approved defaults', () => {
	const codex = settings.make_template('codex')
	const claude = settings.make_template('claude')

	assert.equal(codex['external-workers'][0].tiers.best, 'gpt-6-astra/xhigh')
	assert.equal(codex['external-workers'][0].tiers.better, 'gpt-5.6-sol/low')
	assert.equal(codex['external-workers'][0].tiers.basic, 'gpt-5.6-luna/xhigh')
	assert.equal(codex['external-workers'][1].tiers.best, 'claude-opus-5/high')
	assert.equal(claude['external-workers'][0].tiers.best, 'claude-opus-5/high')
	assert.equal(claude['external-workers'][1].tiers.best, 'gpt-6-astra/xhigh')
	assert.equal(claude['external-workers'][1].tiers.basic, 'gpt-5.6-luna/xhigh')
	assert.deepEqual(settings.validate_config(codex, { active_host: 'codex', ...all_executables }).errors, [])
	assert.deepEqual(settings.validate_config(claude, { active_host: 'claude', ...all_executables }).errors, [])
})

test('missing recognized properties fail while unknown properties warn and are ignored', () => {
	const config = settings.make_template('codex')
	for (const key of ['schema-version', 'switches', 'pipeline-roles', 'external-workers']) {
		const copy = JSON.parse(JSON.stringify(config))
		delete copy[key]
		expect_invalid(copy, new RegExp(`(?:${key}|top-level key)`))
	}

	for (const location of [
		['top_level', config, 'extra'],
		['switches', config.switches, 'extra'],
		['external-workers', config['external-workers'][0], 'extra'],
	]) {
		const copy = JSON.parse(JSON.stringify(config))
		const target = location[0] === 'top_level' ? copy : location[0] === 'external-workers' ? copy['external-workers'][0] : copy[location[0]]
		target[location[2]] = 'unexpected'
		const result = settings.validate_config(copy, { active_host: 'codex', ...all_executables })
		assert.equal(result.valid, true)
		assert.match(result.warnings.join('; '), /(?:extra.*ignored|unknown.*extra)/)
	}

	for (const [location, keys] of Object.entries({
		switches: settings.switch_names,
	})) {
		for (const key of keys) {
			if (key === 'workspace-dir' || settings.optional_switch_names.includes(key)) continue
			const copy = JSON.parse(JSON.stringify(config))
			delete copy[location][key]
			expect_invalid(copy, new RegExp(`configuration\\.${location}\\.${key} is required`))
		}
	}
	for (const key of ['id', 'command', 'priority', 'tiers']) {
		const copy = JSON.parse(JSON.stringify(config))
		delete copy['external-workers'][0][key]
		expect_invalid(copy, new RegExp(`external-workers\\[0\\]\\.${key}`))
	}
})

test('schema types, every current switch value, and language text are enforced', () => {
	const config = settings.make_template('codex')
	assert.match(settings.validate_config(null, { active_host: 'codex', ...all_executables }).errors.join('; '), /configuration must be an object/)
	for (const location of ['switches']) {
		const copy = JSON.parse(JSON.stringify(config))
		copy[location] = []
		expect_invalid(copy, new RegExp(`configuration\\.${location} must be an object`))
	}
	const workers_array = JSON.parse(JSON.stringify(config))
	workers_array['external-workers'] = {}
	expect_invalid(workers_array, /Invalid external-workers: must be an array/)
	for (const [key, value] of Object.entries({
		'schema-version': '1',
	})) {
		const copy = JSON.parse(JSON.stringify(config))
		copy[key] = value
		expect_invalid(copy, key === 'schema-version' ? /schema-version/ : new RegExp(`configuration\\.${key}`))
	}
	const bad_values = {
		'cli-provider': 'shell',
		'auto-reply': 'yes',
		streams: 'sometimes',
		'ask-names': 'sometimes',
	}
	for (const [key, value] of Object.entries(bad_values)) {
		const copy = JSON.parse(JSON.stringify(config))
		copy.switches[key] = value
		expect_invalid(copy, new RegExp(`switches\\.${key}`))
	}
	for (const [key, values] of Object.entries({
		'cli-provider': ['off', 'on'],
		'auto-reply': ['on', 'off'],
		streams: ['ask', 'always', 'off'],
		'ask-names': ['on', 'off'],
	})) {
		for (const value of values) {
			const copy = JSON.parse(JSON.stringify(config))
			copy.switches[key] = value
			assert.equal(settings.validate_config(copy, { active_host: 'codex', ...all_executables }).valid, true)
		}
	}
	const language_bad = JSON.parse(JSON.stringify(config))
	language_bad.switches.lang = 'English\u0000'
	expect_invalid(language_bad, /lang.*control characters/)
	const target_bad = JSON.parse(JSON.stringify(config))
	target_bad.switches['target-doc'] = 'notes\n.md'
	expect_invalid(target_bad, /target-doc.*control characters/)

	assert.throws(() => settings.parse_change_lines(['runlog: off']), /unsupported setting change: runlog/)
})

test('public setting paths use kebab-case and address profile ids', () => {
	const config = settings.make_template('codex')
	const changes = settings.apply_changes(config, [
		'cli-provider: on',
		'auto-reply: off',
		'ask-names: off',
		'codex-default.best: gpt-5.6-terra/high',
		'claude-default.basic: claude-opus-5/high',
	], { active_host: 'codex', ...all_executables })

	assert.equal(changes.config.switches['cli-provider'], 'on')
	assert.equal(changes.config.switches['auto-reply'], 'off')
	assert.equal(changes.config.switches['ask-names'], 'off')
	assert.equal(changes.config['external-workers'][0].tiers.best, 'gpt-5.6-terra/high')
	assert.equal(changes.config['external-workers'][1].tiers.basic, 'claude-opus-5/high')
	assert.deepEqual(changes.changes, [
		'ask-names: on → off',
		'codex-default.best: gpt-6-astra/xhigh → gpt-5.6-terra/high',
		'claude-default.basic: claude-sonnet-5/high → claude-opus-5/high',
	])

	const display = settings.format_settings_display(config, { ...all_executables })
	for (const key of ['target-doc', 'cli-provider', 'auto-reply', 'ask-names']) assert.match(display, new RegExp(`- ${key}:`))
	for (const worker of ['codex-default', 'claude-default']) for (const tier of settings.tier_names) assert.match(display, new RegExp(`- ${worker}\\.${tier}:`))
	assert.match(display, /target-doc: <path>/)
	assert.match(display, /<profile-id>\.best: <value>/)
	assert.match(display, /dedicated rename-target-document/)
	for (const [worker, value] of [['codex-default', 'gpt-5.6-terra/high'], ['claude-default', 'claude-opus-5/high']]) for (const tier of settings.tier_names) {
		const changed = settings.apply_changes(config, [`${worker}.${tier}: ${value}`], { active_host: 'codex', ...all_executables })
			const profile = changed.config['external-workers'].find(candidate => candidate.id === worker)
		assert.equal(profile.tiers[tier], value)
	}

	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		settings.write_config_atomic(config_path, config, { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.deepEqual(settings.load_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables }), config)
	} finally {
		drop(repo)
	}
})

test('current public instructions use canonical syntax while private names and rejected examples stay distinguishable', () => {
	const inventory = public_instruction_inventory()

	assert.deepEqual(inventory.legacy_occurrences, [], `obsolete public syntax remains:\n${inventory.legacy_occurrences.join('\n')}`)
	for (const [label, pattern] of canonical_public_syntax) {
		if (label.endsWith(':')) assert.match(inventory.combined, new RegExp(`\\b${label.slice(0, -1)}\\b`), `missing public setting: ${label}`)
		else assert.match(inventory.combined, pattern, `missing canonical public syntax: ${label}`)
	}
	const settings_display = settings.format_settings_display(settings.make_template('codex'), all_executables)
	for (const worker of ['codex-default', 'claude-default']) {
		for (const tier of settings.tier_names) assert.match(settings_display, new RegExp(`${worker}\\.${tier}`), `missing canonical worker setting: ${worker}.${tier}`)
	}

})

test('obsolete public setting paths and role values are rejected without translation', () => {
	const obsolete_settings = [
		['target_doc', 'target-doc', 'notes.md'],
		['cli_provider', 'cli-provider', 'claude'],
		['auto_reply', 'auto-reply', 'off'],
		['ask_names', 'ask-names', 'on'],
		['native_host', 'native-host', 'on'],
		...['internal_worker', 'external_worker'].flatMap((worker, index) => settings.tier_names.map(tier => [
			`${worker}.${tier}`,
			`${worker.replace('_', '-')}.${tier}`,
			index === 0 ? 'gpt-5.6-terra/high' : 'claude-opus-5/high',
		])),
	]
	for (const [old_name, replacement, value] of obsolete_settings) {
		assert.throws(() => settings.parse_change_lines([`${old_name}: ${value}`]), error => {
			assert.match(error.message, new RegExp(old_name.replace('.', '\\.')))
			if (old_name !== 'target_doc') assert.doesNotMatch(error.message, new RegExp(`use ${replacement.replace('.', '\\.')}`))
			return true
		})
	}

	const roles = [
		['security_scan', 'security-scan'],
		['high_risk_review', 'high-risk-review'],
		['three_way_review', 'three-way-review'],
		['main_coordinator', 'main-coordinator'],
		['mechanical_edit', 'mechanical-edit'],
		['routine_scan', 'routine-scan'],
	]
	for (const [old_name, replacement] of roles) {
		assert.throws(() => settings.tier_for_role(old_name), /unsupported public role value/)
		const expected_tier = { security_scan: 'best', high_risk_review: 'best', three_way_review: 'better', main_coordinator: 'better', mechanical_edit: 'basic', routine_scan: 'basic' }[old_name]
		assert.equal(settings.tier_for_role(replacement), expected_tier)
	}

	const unchanged = settings.make_template('codex')
	assert.equal(settings.validate_config(unchanged, { active_host: 'codex', ...all_executables }).valid, true)
})

test('the command-line change boundary rejects obsolete public setting paths', () => {
	const repo = make_repo()
	try {
		settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.throws(() => settings.cli_main(['change', '--repo', repo, '--host', 'codex', '--set', 'auto_reply: off']), /unsupported setting change: auto_reply/)
		assert.equal(settings.load_config(path.join(repo, 'ag.json'), { repo_root: repo, active_host: 'codex', ...all_executables }).switches['auto-reply'], 'off')
	} finally {
		drop(repo)
	}
})

test('target document validation rejects traversal, absolute paths, bad extensions, and outside symlinks', () => {
	const repo = make_repo()
	const outside = make_repo()
	try {
		const config = settings.make_template('codex')
		for (const target of ['devlog.md', 'notes/next.md', 'features/search/search.devlog.md']) {
			const copy = JSON.parse(JSON.stringify(config))
			copy.switches['target-doc'] = target
			assert.equal(settings.validate_config(copy, { repo_root: repo, active_host: 'codex', ...all_executables }).valid, true)
		}
		for (const target of ['/tmp/devlog.md', '../devlog.md', 'notes.txt', 'a/../../devlog.md', 'a\\devlog.md']) {
			const copy = JSON.parse(JSON.stringify(config))
			copy.switches['target-doc'] = target
			expect_invalid(copy, /target-doc/, { repo_root: repo })
		}
		fs.symlinkSync(path.join(outside, 'secret.md'), path.join(repo, 'linked.md'))
		const linked = JSON.parse(JSON.stringify(config))
		linked.switches['target-doc'] = 'linked.md'
		expect_invalid(linked, /symlink outside/, { repo_root: repo })
	} finally {
		drop(repo)
		drop(outside)
	}
})

test('model values use parser syntax, independent efforts, and no per-profile family restriction', () => {
	const config = settings.make_template('codex')
	for (const host of ['codex', 'claude']) {
		const template = settings.make_template(host)
		for (const profile of template['external-workers']) for (const tier of settings.tier_names) {
			const parsed = settings.parse_model_value(profile.tiers[tier])
			assert.ok(parsed)
			assert.equal(settings.validate_config(template, { active_host: host, ...all_executables }).valid, true)
		}
	}

	for (const [host, profile_index, values] of [
		['codex', 0, ['gpt-arbitrary.preview-1/low_latency', 'gpt-next-2/max_effort']],
		['codex', 1, ['claude-arbitrary.preview-1/xhigh_2']],
		['claude', 0, ['claude-arbitrary.preview-1/low_latency', 'claude-next-2/max_effort']],
		['claude', 1, ['gpt-arbitrary.preview-1/xhigh_2']],
	]) {
		for (const value of values) {
			const copy = settings.make_template(host)
			copy['external-workers'][profile_index].tiers.best = value
			assert.equal(settings.validate_config(copy, { active_host: host, ...all_executables }).valid, true)
		}
	}

	assert.deepEqual(settings.parse_model_value('gpt-special/high_latency'), {
		model: 'gpt-special',
		effort: 'high_latency',
		value: 'gpt-special/high_latency',
	})
	assert.equal(settings.parse_model_value('gpt-special/high/extra'), null)

	for (const value of [
		'',
		null,
		'gpt-5.6-luna',
		'gpt-5.6-sol/',
		'/high',
		'.gpt-model/high',
		'-gpt-model/high',
		'gpt-model/1high',
		'gpt-model/_high',
		'gpt-model/-high',
		'gpt-model/A/B',
		'$(touch /tmp/owned)/high',
	]) {
		const copy = JSON.parse(JSON.stringify(config))
		copy['external-workers'][0].tiers.best = value
		expect_invalid(copy, /external-workers\[0\]\.tiers\.best/)
	}
})

test('model and effort metadata are non-empty single-line values within their exact limits', () => {
	const config = settings.make_template('codex')
	const max_model = `gpt-${'m'.repeat(124)}`
	const max_effort = 'e'.repeat(32)
	const maximum = `${max_model}/${max_effort}`

	assert.equal(max_model.length, 128)
	assert.equal(max_effort.length, 32)
	assert.ok(settings.parse_model_value(maximum))
	const valid = JSON.parse(JSON.stringify(config))
	valid['external-workers'][0].tiers.best = maximum
	assert.equal(settings.validate_config(valid, { active_host: 'codex', ...all_executables }).valid, true)

	for (const value of [
		`${`gpt-${'m'.repeat(125)}`}/high`,
		`gpt-model/${'e'.repeat(33)}`,
		'gpt-model\nextra/high',
		'gpt-model/high\nextra',
	]) {
		assert.equal(settings.parse_model_value(value), null)
		const invalid = JSON.parse(JSON.stringify(config))
		invalid['external-workers'][0].tiers.best = value
		expect_invalid(invalid, /external-workers\[0\]\.tiers\.best/)
	}
})

test('host detection uses explicit identity or unique host markers, never executable presence', () => {
	assert.equal(settings.detect_host({ explicit_host: 'codex', env: { CLAUDE_CODE: '1' } }), 'codex')
	assert.equal(settings.detect_host({ env: { CODEX_SESSION_ID: 'x' } }), 'codex')
	assert.equal(settings.detect_host({ env: { CLAUDE_CODE: '1' } }), 'claude')
	assert.throws(() => settings.detect_host({ env: { CODEX_SESSION_ID: 'x', CLAUDE_CODE: '1' } }), /ambiguous/)
	assert.throws(() => settings.detect_host({ env: {} }), /unknown/)
	assert.throws(() => settings.detect_host({ env: {}, executables: ['claude', 'codex'] }), /unknown/, 'executable presence is not consulted')
})

test('every supported runtime marker is independently the sole positive marker', () => {
	for (const [host, markers] of Object.entries(settings.host_markers)) {
		const other_markers = Object.values(settings.host_markers).flat()
		for (const marker of markers) {
			const env = Object.fromEntries(other_markers.map(name => [name, undefined]))
			env[marker] = '1'
			assert.equal(settings.detect_host({ env }), host)

			const removed = { ...env }
			delete removed[marker]
			assert.throws(() => settings.detect_host({ env: removed }), /unknown/)

			const corrupted = { ...env, [marker]: '0' }
			assert.throws(() => settings.detect_host({ env: corrupted }), /unknown/)
		}
	}
})

test('installed-host identity fallback remains separate from runtime marker detection', () => {
	assert.equal(settings.detect_host({ explicit_host: 'codex', env: {} }), 'codex')
	assert.equal(settings.detect_host({ explicit_host: 'claude', env: {} }), 'claude')
})

test('runtime host and executable requirements are checked with safe, fixed command names', () => {
	const config = settings.make_template('codex')
	assert.equal(Object.prototype.hasOwnProperty.call(config, 'host'), false)
	assert.equal(settings.validate_config(config, { active_host: 'claude', ...all_executables }).valid, true)

	const unsupported_provider = JSON.parse(JSON.stringify(config))
	unsupported_provider.switches['cli-provider'] = 'claude'
	const required = settings.validate_config(unsupported_provider, { active_host: 'codex', executables: ['codex'] })
	assert.match(required.errors.join('; '), /cli-provider.*off, on/)

	const dormant_config = JSON.parse(JSON.stringify(config))
	dormant_config.switches['cli-provider'] = 'off'
	const dormant = settings.validate_config(dormant_config, { active_host: 'codex', ...no_executables })
	assert.equal(dormant.valid, true)
	assert.match(dormant.warnings.join('; '), /dormant claude executable/)
})

test('first-run initialization creates an adjacent configuration and is idempotent', () => {
	const repo = make_repo()
	try {
		const first = settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(first.created, true)
		assert.equal(first.config_path, path.join(repo, 'ag.json'))
		assert.equal(Object.prototype.hasOwnProperty.call(JSON.parse(fs.readFileSync(first.config_path, 'utf8')), 'host'), false)
		const before = fs.readFileSync(first.config_path, 'utf8')
		const second = settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(second.created, false)
		assert.equal(fs.readFileSync(first.config_path, 'utf8'), before)
	} finally {
		drop(repo)
	}
})

test('initial language normalizes locale tags and falls back without requiring locale tools', () => {
	for (const [raw, expected] of [
		['zh_TW.UTF-8', 'zh-tw'], ['zh-Hant-US', 'zh-tw'], ['zh_HK', 'zh-tw'], ['zh_MO', 'zh-tw'],
		['zh-Hans-TW', 'zh-cn'], ['zh_CN.UTF-8', 'zh-cn'], ['zh_SG', 'zh-cn'], ['zh', 'zh-cn'],
		['ja_JP.UTF-8', 'ja-jp'], ['pt_BR.UTF-8', 'pt-br'], ['en_US.UTF-8', 'en-us'],
	]) {
		assert.equal(settings.detect_initial_language({ platform: 'linux', env: { LANG: raw } }), expected, raw)
	}
	const options = { platform: 'linux', intl_locale: () => 'fr-FR' }
	assert.equal(settings.detect_initial_language({ ...options, env: { LC_ALL: 'ja_JP', LC_MESSAGES: 'zh_TW', LANG: 'en_US' } }), 'ja-jp')
	assert.equal(settings.detect_initial_language({ ...options, env: { LC_ALL: 'C.UTF-8', LC_MESSAGES: 'zh_TW', LANG: 'en_US' } }), 'zh-tw')
	assert.equal(settings.detect_initial_language({ ...options, env: { LANG: 'POSIX' } }), 'fr-fr')
	assert.equal(settings.detect_initial_language({ ...options, platform: 'win32', env: {} }), 'fr-fr')
	assert.equal(settings.detect_initial_language({ ...options, env: { LANG: 'not a locale' }, intl_locale: () => 'und' }), 'en')
	assert.equal(settings.detect_initial_language({ ...options, env: {}, intl_locale: () => { throw new Error('unavailable') } }), 'en')
})

test('initial language prefers the first macOS UI language over terminal formatting', () => {
	const calls = []
	const options = {
		platform: 'darwin', env: { LC_ALL: 'C.UTF-8', LANG: 'en_US.UTF-8' },
		exec_file_sync: (file, args, opts) => {
			calls.push(args[2])
			assert.equal(file, '/usr/bin/defaults')
			assert.deepEqual(args.slice(0, 2), ['read', '-g'])
			assert.equal(opts.timeout, 1000)
			assert.equal(opts.maxBuffer, 4096)
			return '(\n    "zh-Hant-TW",\n    "en-US"\n)\n'
		},
	}
	assert.equal(settings.detect_initial_language(options), 'zh-tw')
	assert.deepEqual(calls, ['AppleLanguages'])
	assert.equal(settings.detect_initial_language({ ...options, exec_file_sync: () => '(en, "zh-Hant-TW")' }), 'en')
	assert.equal(settings.detect_initial_language({ ...options, exec_file_sync: (file, args) => args[2] === 'AppleLanguages' ? '()' : 'zh_TW' }), 'zh-tw')
	assert.equal(settings.detect_initial_language({ ...options, exec_file_sync: () => { throw new Error('unavailable') } }), 'en-us')
})

test('new configuration detects Traditional Chinese and preserves an existing language', () => {
	for (const initialize of [settings.ensure_configuration, settings.initialize_project]) for (const active_host of ['codex', 'claude']) {
		const repo = make_repo()
		try {
			const options = { repo_root: repo, active_host, ...all_executables, platform: 'linux', env: { LANG: 'zh_TW.UTF-8' } }
			const first = initialize(options)
			assert.equal(first.config.switches.lang, 'zh-tw')
			const before = fs.readFileSync(first.config_path, 'utf8')
			const second = initialize({ ...options, env: { LANG: 'en_US.UTF-8' } })
			assert.equal(second.created, false)
			assert.equal(fs.readFileSync(first.config_path, 'utf8'), before)
			const custom = { ...second.config, switches: { ...second.config.switches, lang: '日本語' } }
			fs.writeFileSync(first.config_path, JSON.stringify(custom))
			assert.equal(initialize(options).config.switches.lang, '日本語')
		} finally {
			drop(repo)
		}
	}
})

test('project initialization creates the validated configuration and fixed notebook together', () => {
	const repo = make_repo()
	try {
		const result = settings.initialize_project({ repo_root: repo, active_host: 'claude', ...all_executables, project: 'demo — project' })
		assert.equal(result.created, true)
		assert.ok(fs.existsSync(path.join(repo, 'ag.json')))
		assert.ok(fs.existsSync(path.join(repo, '.agentflow/devlog.md')))
		const notebook = fs.readFileSync(path.join(repo, '.agentflow/devlog.md'), 'utf8')
	assert.match(notebook, /^Configuration: ag\.json — schema v8; validated for claude this round\./m)
		assert.match(notebook, /# → Ask \/ A-001(?: \([^\r\n)]+\))?\n\n\+ /)
		assert.equal(notebook.includes('Settings:'), false)
	} finally {
		drop(repo)
	}
})

test('a deleted established configuration is not recreated from fixed STATUS', () => {
	const repo = make_repo()
	try {
		settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		fs.unlinkSync(path.join(repo, 'ag.json'))
		assert.throws(() => settings.ensure_configuration({ repo_root: repo, notebook_path: '.agentflow/devlog.md', active_host: 'codex', ...all_executables }), /restore its recorded Git version/)
		assert.equal(fs.existsSync(path.join(repo, 'ag.json')), false)
	} finally {
		drop(repo)
	}
})

test('missing and malformed established configurations stop without replacement', () => {
	const repo = make_repo()
	try {
		const config = settings.make_template('codex')
		fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(config))
		fs.writeFileSync(path.join(repo, 'devlog.md'), '# STATUS\n')
		fs.writeFileSync(path.join(repo, 'ag.json'), '{')
		assert.throws(() => settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables }), /malformed JSON/)
		assert.equal(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'), '{')
	} finally {
		drop(repo)
	}
})

test('reload reads the current file again and does not use a prior in-memory value', () => {
	const repo = make_repo()
	try {
		settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables })
		const first = settings.load_config(path.join(repo, 'ag.json'), { repo_root: repo, active_host: 'codex', ...all_executables })
		const changed = settings.apply_changes(first, ['auto-reply: on'], { repo_root: repo, active_host: 'codex', ...all_executables })
		settings.write_config_atomic(path.join(repo, 'ag.json'), changed.config, { repo_root: repo, active_host: 'codex', ...all_executables })
		const second = settings.load_config(path.join(repo, 'ag.json'), { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(first.switches['auto-reply'], 'off')
		assert.equal(second.switches['auto-reply'], 'on')
	} finally {
		drop(repo)
	}
})

test('settings changes validate the complete batch before one atomic write', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		settings.write_config_atomic(config_path, custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		const before = fs.readFileSync(config_path, 'utf8')
		assert.throws(() => settings.change_configuration(config_path, ['auto-reply: on', 'streams: invalid'], { repo_root: repo, active_host: 'codex', ...all_executables }), /streams/)
		assert.equal(fs.readFileSync(config_path, 'utf8'), before)
		const result = settings.change_configuration(config_path, ['auto-reply: on', 'codex-default.best: gpt-5.6-terra/high'], { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.deepEqual(result.changes, ['auto-reply: off → on', 'codex-default.best: gpt-6-astra/xhigh → gpt-5.6-terra/high'])
	} finally {
		drop(repo)
	}
})

test('atomic write failure keeps the old bytes and does not execute hostile strings', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		settings.write_config_atomic(config_path, custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		const before = fs.readFileSync(config_path, 'utf8')
		const failing_fs = { ...fs, renameSync: () => { throw new Error('injected failure') } }
		assert.throws(() => settings.write_config_atomic(config_path, settings.make_template('codex'), { repo_root: repo, active_host: 'codex', fs: failing_fs, ...all_executables }), /could not be written atomically/)
		assert.equal(fs.readFileSync(config_path, 'utf8'), before)
		assert.equal(fs.existsSync(path.join(repo, 'owned')), false)
		const denied_fs = { ...fs, openSync: () => { throw Object.assign(new Error('private detail'), { code: 'EPERM' }) } }
		assert.throws(() => settings.write_text_atomic(path.join(repo, '.codex', 'hooks.json'), '{}', { fs: denied_fs }), /EPERM.*permission.*Do not retry/)
	} finally {
		drop(repo)
	}
})

test('stream configuration copies are adjacent and independent', () => {
	const repo = make_repo()
	try {
		const root_config = settings.make_template('codex')
		const stream_path = 'features/search/search.devlog.md'
		const stream_config = settings.copy_for_notebook(root_config, stream_path, { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(stream_config.switches['target-doc'], stream_path)
		assert.equal(root_config.switches['target-doc'], '.agentflow/devlog.md')
		assert.equal(settings.resolve_config_path(repo, stream_path), path.join(repo, 'features/search/ag.json'))
		fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify({ switches: { 'target-doc': '.agentflow/devlog.md', 'workspace-dir': '.agentflow' } }))
		assert.equal(settings.active_config_path(repo, '.agentflow/devlog.md'), path.join(repo, 'ag.json'))
		const stream_changed = settings.apply_changes(stream_config, ['auto-reply: on'], { repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(stream_changed.config.switches['auto-reply'], 'on')
		assert.equal(root_config.switches['auto-reply'], 'off')
	} finally {
		drop(repo)
	}
})

test('stream resolution loads its own configuration instead of the worktree root configuration', () => {
	const repo = make_repo()
	try {
		const stream_path = 'features/search/search.devlog.md'
		fs.mkdirSync(path.join(repo, 'features/search'), { recursive: true })
		fs.writeFileSync(path.join(repo, stream_path), settings.format_status({ project: 'demo', notebook: stream_path, notebook_kind: 'stream', current_commit: 'initial', tests_scenarios: 'none', config_path: 'features/search/ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' }))
		settings.write_config_atomic(path.join(repo, 'ag.json'), custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		const stream_config = settings.copy_for_notebook(settings.make_template('codex'), stream_path, { repo_root: repo, active_host: 'codex', ...all_executables })
		stream_config.switches['auto-reply'] = 'on'
		settings.write_config_atomic(path.join(repo, 'features/search/ag.json'), stream_config, { repo_root: repo, active_host: 'codex', ...all_executables })
		const resolved = settings.ensure_configuration({ repo_root: repo, notebook_path: stream_path, active_host: 'codex', ...all_executables })
		assert.equal(resolved.config_path, path.join(repo, 'features/search/ag.json'))
		assert.equal(resolved.config.switches['auto-reply'], 'on')
		assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8')).switches['auto-reply'], 'off')
	} finally {
		drop(repo)
	}
})

test('target-document configuration relocation updates the adjacent source of truth', () => {
	const repo = make_repo()
	try {
		const old_config_path = path.join(repo, 'ag.json')
		settings.write_config_atomic(old_config_path, settings.make_template('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		const moved = settings.relocate_configuration({
			repo_root: repo,
			old_notebook: 'devlog.md',
			new_notebook: 'features/ag/ag.devlog.md',
			options: { active_host: 'codex', ...all_executables },
		})
		assert.equal(moved.new_config_path, path.join(repo, 'features/ag/ag.json'))
		assert.equal(JSON.parse(fs.readFileSync(moved.new_config_path, 'utf8')).switches['target-doc'], 'features/ag/ag.devlog.md')
		assert.equal(fs.existsSync(old_config_path), false)
	} finally {
		drop(repo)
	}
})

test('fixed STATUS projection has the accepted field order and no Settings line', () => {
	const status = settings.format_status({
		project: 'ag — the skill',
		notebook: 'devlog.md',
		notebook_kind: 'root',
		current_commit: 'abc123',
		tests_scenarios: '10/10 green',
		config_path: 'ag.json',
		host: 'codex',
		validation: 'validated',
		proven: 'configuration loaded',
		open: 'none',
		next: 'await the owner',
		artifacts: 'none',
		archived_eras: 'none',
		streams: [{ taskkey: 'search', state: 'active', path: 'features/search/search.devlog.md' }],
	})
	assert.equal(settings.validate_status_projection(status).valid, true)
	assert.equal(status.includes('Settings:'), false)
	assert.match(status, /Configuration: ag\.json — schema v8; validated for codex this round\./)
	assert.match(status, /stream: search — active — features\/search\/search\.devlog\.md/)
})

test('STATUS Archived eras accepts only none or the adjacent archive pointer', () => {
	const base = {
		project: 'ag — the skill',
		notebook: 'devlog.md',
		notebook_kind: 'root',
		current_commit: 'abc123',
		tests_scenarios: '10/10 green',
		config_path: 'ag.json',
		host: 'codex',
		validation: 'validated',
		proven: 'configuration loaded',
		open: 'none',
		next: 'await the owner',
		artifacts: 'none',
	}
	const pointer = settings.format_status({ ...base, archived_eras: 'devlog.archive.md' })
	assert.equal(settings.validate_status_projection(pointer).valid, true)
	const stream_pointer = settings.format_status({ ...base, notebook: 'features/search/search.devlog.md', notebook_kind: 'stream', config_path: 'features/search/ag.json', archived_eras: 'features/search/search.archive.md' })
	assert.equal(settings.validate_status_projection(stream_pointer).valid, true)
	for (const value of ['A-001–A-004', 'features/other/other.archive.md']) {
		const result = settings.validate_status_projection(settings.format_status({ ...base, archived_eras: value }))
		assert.equal(result.valid, false)
		assert.match(result.errors.join('; '), /archive pointer|Archived eras/i)
	}
})

test('tier routing resolves roles through configured tiers and exposes ordered fallbacks', () => {
	const config = settings.make_template('codex')
	const acceptance = settings.resolve_worker_tier(config, { role: 'acceptance' }, { active_host: 'codex', ...all_executables })
	assert.equal(acceptance.tier, 'better')
	assert.equal(acceptance.model, 'gpt-5.6-sol')
	assert.equal(acceptance.effort, 'low')
	const coding = settings.resolve_worker_tier(config, { role: 'coding' }, { active_host: 'codex', ...all_executables })
	assert.equal(coding.tier, 'basic')
	assert.deepEqual(settings.fallback_tiers('better'), ['basic', 'best', 'cheap'])
	const substitution = settings.resolve_dispatch_failure(config, acceptance, { reason: 'model unavailable' })
	assert.equal(substitution.fallback.tier, 'basic')
	assert.throws(() => settings.resolve_dispatch_failure(config, acceptance, { owner_override: true }), /owner-selected model/)
})

test('templates expose cheap models and session exhaustion falls through to the next eligible profile', () => {
	const config = settings.make_template('codex')
	assert.equal(config['external-workers'].find(profile => profile.family === 'codex').tiers.cheap, 'gpt-5.6-luna/low')
	assert.equal(config['external-workers'].find(profile => profile.family === 'claude').tiers.cheap, 'haiku/high')
	const first = settings.resolve_worker_tier(config, { role: 'acceptance' }, { active_host: 'codex', ...all_executables, cli_provider: 'on' })
	const failure = settings.resolve_dispatch_failure(config, first, {
		active_host: 'codex',
		...all_executables,
		cli_provider: 'on',
		stderr: "You've hit your session limit · resets 6:20pm (Asia/Taipei)",
	})
	assert.equal(failure.kind, 'session_limit')
	assert.deepEqual(failure.disabled_profile_ids, ['codex-default'])
	assert.equal(failure.fallback.profile.id, 'claude-default')
	assert.equal(failure.fallback.tier, 'better')
	assert.equal(settings.resolve_worker_tier(config, { role: 'acceptance', disabled_profile_ids: failure.disabled_profile_ids }, { active_host: 'codex', ...all_executables, cli_provider: 'on' }).profile.id, 'claude-default')
	const ordinary = settings.resolve_dispatch_failure(config, first, { active_host: 'codex', ...all_executables, cli_provider: 'on', reason: 'temporary transport error' })
	assert.notEqual(ordinary.kind, 'session_limit')

	const single_profile = settings.make_template('codex')
	single_profile['external-workers'] = [single_profile['external-workers'][0]]
	const single_selection = settings.resolve_worker_tier(single_profile, { role: 'acceptance' }, { active_host: 'codex', executables: ['codex'] })
	assert.throws(() => settings.resolve_dispatch_failure(single_profile, single_selection, {
		active_host: 'codex',
		executables: ['codex'],
		stderr: "You've hit your session limit · resets 6:20pm (Asia/Taipei)",
	}), /No eligible external-worker profile/)
})

test('settings display includes all switches, tiers, executable results, legal values, and syntax', () => {
	const display = settings.format_settings_display(settings.make_template('codex'), { ...all_executables })
	for (const key of ['target-doc', 'cli-provider', 'auto-reply', 'lang', 'streams', 'ask-names']) assert.match(display, new RegExp(`- ${key}:`))
	assert.doesNotMatch(display, /- runlog:/)
	for (const worker of ['codex-default', 'claude-default']) for (const tier of settings.tier_names) assert.match(display, new RegExp(`- ${worker}\\.${tier}:`))
	assert.match(display, /codex: available/)
	assert.match(display, /target-doc: <path>/)
	assert.match(display, /<profile-id>\.best: <value>/)
	assert.match(display, /profile model\/effort values: parser-valid/)
	assert.match(display, /large-work-minutes: 120/)
	assert.match(display, /streams: ask, always, or off; use streams: <value>/)
	assert.doesNotMatch(display, /(?:target_doc|cli_provider|auto_reply|ask_names|internal_worker|external_worker)/)
	assert.match(display, /dedicated rename-target-document/)
})

test('large-work-minutes is configurable and bounded', () => {
	const config = settings.make_template('codex')
	const changed = settings.apply_changes(config, ['large-work-minutes: 180'], { active_host: 'codex', ...all_executables })
	assert.equal(changed.config.switches['large-work-minutes'], 180)
	assert.deepEqual(changed.changes, ['large-work-minutes: 120 → 180'])
	assert.throws(() => settings.apply_changes(config, ['large-work-minutes: 0'], { active_host: 'codex', ...all_executables }), /large-work-minutes/)
})

test('first activation in a non-Git folder creates files without silently running git init', () => {
	const repo = make_repo()
	try {
		const result = settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(result.created, true)
		assert.equal(fs.existsSync(path.join(repo, '.git')), false)
		assert.match(fs.readFileSync(path.join(repo, '.agentflow/devlog.md'), 'utf8'), /# → Ask \/ A-001/)
	} finally {
		drop(repo)
	}
})

test('established configuration failures stop before setting-dependent work and preserve bytes', () => {
	const repo = make_repo()
	try {
		settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		const config_path = path.join(repo, 'ag.json')
		const original = fs.readFileSync(config_path, 'utf8')
		const malformed = ['empty', 'truncated', 'wrong-version', 'wrong-type']
		for (const kind of malformed) {
			const values = {
				empty: '',
				truncated: '{',
				'wrong-version': { ...settings.make_template('codex'), 'schema-version': 4 },
				'wrong-type': [],
			}
			const value = typeof values[kind] === 'string' ? values[kind] : JSON.stringify(values[kind])
			fs.writeFileSync(config_path, value)
			const sentinel = path.join(repo, 'work-started')
			fs.rmSync(sentinel, { force: true })
			assert.throws(() => settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables }), error => {
				assert.match(error.message, /ag\.json|configuration/)
				assert.match(error.message, /restore its recorded Git version/)
				return true
			})
			assert.equal(fs.existsSync(sentinel), false)
			assert.equal(fs.readFileSync(config_path, 'utf8'), value)
		}
		fs.writeFileSync(config_path, original)
		assert.doesNotThrow(() => settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables }))
	} finally {
		drop(repo)
	}
})

test('invalid configuration on the next round is revalidated before requested work', () => {
	const repo = make_repo()
	try {
		settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		const config_path = path.join(repo, 'ag.json')
		const first = settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.equal(first.config.switches['auto-reply'], 'off')
		fs.writeFileSync(config_path, JSON.stringify({ ...settings.make_template('codex'), switches: { ...settings.make_template('codex').switches, 'auto-reply': 'invalid' } }))
		assert.throws(() => settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables }), /auto-reply/)
		assert.equal(fs.existsSync(path.join(repo, 'work-started')), false)
	} finally {
		drop(repo)
	}
})

test('malformed schema is diagnosed before ambiguous runtime host detection', () => {
	const repo = make_repo()
	try {
		fs.writeFileSync(path.join(repo, 'ag.json'), '{')
		assert.throws(() => settings.ensure_configuration({ repo_root: repo, env: { CODEX_SESSION_ID: 'x', CLAUDE_CODE: '1' }, ...all_executables }), /malformed JSON/)
		fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify({ ...settings.make_template('codex'), 'schema-version': 4 }))
	assert.throws(() => settings.ensure_configuration({ repo_root: repo, env: { CODEX_SESSION_ID: 'x', CLAUDE_CODE: '1' }, ...all_executables }), /schema-version must be integer 8/)
	} finally {
		drop(repo)
	}
})

test('generic changes reject target-doc and dedicated rename preserves both commits and history', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		const status = settings.format_status({ project: 'demo', notebook: 'devlog.md', notebook_kind: 'root', current_commit: 'initial', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'devlog.archive.md' })
		fs.writeFileSync(path.join(repo, 'devlog.md'), status)
		fs.writeFileSync(path.join(repo, 'devlog.archive.md'), 'archive\n')
		settings.write_config_atomic(config_path, custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		git(repo, ['init', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-m', 'initial'])
		assert.throws(() => settings.change_configuration(config_path, ['target-doc: features/demo/demo.devlog.md'], { repo_root: repo, active_host: 'codex', ...all_executables }), /dedicated rename-target-document/)
		const result = settings.rename_target_document({ repo_root: repo, old_notebook: 'devlog.md', new_notebook: 'features/demo/demo.devlog.md', active_host: 'codex', ...all_executables, date: '2026-08-21' })
		assert.equal(result.first_commit, true)
		assert.equal(result.second_commit, true)
		assert.match(git(repo, ['show', '--format=', '--name-only', 'HEAD^']), /features\/demo\/demo\.devlog\.md/)
		assert.match(git(repo, ['show', '--format=', '--name-only', 'HEAD^']), /features\/demo\/demo\.archive\.md/)
		assert.doesNotMatch(git(repo, ['show', '--format=', '--name-only', 'HEAD^']), /ag\.json/)
		assert.match(git(repo, ['show', '--format=', '--name-only', 'HEAD']), /features\/demo\/ag\.json/)
		assert.match(fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8'), /Moved to: features\/demo\/demo\.devlog\.md/)
		const renamed = fs.readFileSync(path.join(repo, 'features/demo/demo.devlog.md'), 'utf8')
		assert.match(renamed, /Renamed: devlog\.md → features\/demo\/demo\.devlog\.md/)
		assert.match(renamed, /Notebook: features\/demo\/demo\.devlog\.md — root\./)
		assert.match(renamed, /Archived eras: features\/demo\/demo\.archive\.md\./)
		assert.equal(settings.validate_status_projection(renamed).valid, true)
		assert.match(git(repo, ['log', '--follow', '--oneline', '--', 'features/demo/demo.devlog.md']), /initial/)
			assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'features/demo/ag.json'), 'utf8')).switches['target-doc'], 'features/demo/demo.devlog.md')
	} finally {
		drop(repo)
	}
})

test('dedicated rename refuses before mutation when detached completion evidence exists', () => {
	const repo = make_repo()
	try {
		const notebook = '.agentflow/devlog.md'
		fs.mkdirSync(path.join(repo, '.agentflow'), { recursive: true })
		const config = settings.make_template('codex')
		config.switches['target-doc'] = notebook
		fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(config))
		const status = settings.format_status({ project: 'record-bearing rename', notebook, notebook_kind: 'root', current_commit: 'fixture', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'rename', artifacts: 'none', archived_eras: 'none', streams: [] })
		fs.writeFileSync(path.join(repo, notebook), `${status}\n---\n\n# → Ask / A-001\n\n+ finish this\n\n# ← Reply / A-001\n\nDone.\n\n---\n\n# → Ask / A-002\n\n+\n`)
		fs.mkdirSync(path.join(repo, '.agentflow', '.tmp', 'A-001'), { recursive: true })
		fs.writeFileSync(path.join(repo, '.agentflow', '.tmp', 'A-001', 'completion.json'), '{"version":1}\n')
		git(repo, ['init', '-q', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-qm', 'initial'])
		const before = fs.readdirSync(repo, { withFileTypes: true }).map(entry => entry.name).sort()
		assert.throws(() => settings.rename_target_document({ repo_root: repo, old_notebook: notebook, new_notebook: 'notes.devlog.md', active_host: 'codex', ...all_executables }), /completion|record|rename/i)
		assert.deepEqual(fs.readdirSync(repo, { withFileTypes: true }).map(entry => entry.name).sort(), before)
		assert.ok(fs.existsSync(path.join(repo, notebook)))
		assert.equal(fs.existsSync(path.join(repo, 'notes.devlog.md')), false)
	} finally {
		drop(repo)
	}
})

test('dedicated rename refuses records bound to a round already moved into the archive', () => {
	const repo = make_repo()
	try {
		const notebook = '.agentflow/devlog.md'
		const archive = '.agentflow/devlog.archive.md'
		fs.mkdirSync(path.join(repo, '.agentflow'), { recursive: true })
		const config = settings.make_template('codex')
		config.switches['target-doc'] = notebook
		fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(config))
		const status = settings.format_status({ project: 'archived record rename', notebook, notebook_kind: 'root', current_commit: 'fixture', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'rename', artifacts: 'none', archived_eras: archive, streams: [] })
		fs.writeFileSync(path.join(repo, notebook), `${status}\n---\n\n# → Ask / A-002\n\n+\n`)
		fs.writeFileSync(path.join(repo, archive), '# → Ask / A-001\n\n+ finish this\n\n# ← Reply / A-001\n\nDone.\n\n---\n\n')
		fs.mkdirSync(path.join(repo, '.agentflow', '.tmp', 'A-001'), { recursive: true })
		fs.writeFileSync(path.join(repo, '.agentflow', '.tmp', 'A-001', 'completion.json'), '{"version":1}\n')
		git(repo, ['init', '-q', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-qm', 'initial'])
		const head = git(repo, ['rev-parse', 'HEAD'])

		assert.throws(() => settings.rename_target_document({ repo_root: repo, old_notebook: notebook, new_notebook: 'notes.devlog.md', active_host: 'codex', ...all_executables }), /completion|record|rename/i)
		assert.equal(git(repo, ['rev-parse', 'HEAD']), head)
		assert.equal(git(repo, ['status', '--porcelain']), '')
		assert.ok(fs.existsSync(path.join(repo, notebook)))
		assert.ok(fs.existsSync(path.join(repo, archive)))
		assert.equal(fs.existsSync(path.join(repo, 'notes.devlog.md')), false)
	} finally {
		drop(repo)
	}
})

test('dedicated rename finishes the canonical root-config layout without a nonexistent commit path', () => {
	const repo = make_repo()
	try {
		const notebook = '.agentflow/devlog.md'
		fs.mkdirSync(path.join(repo, '.agentflow'))
		const status = settings.format_status({ project: 'demo', notebook, notebook_kind: 'root', current_commit: 'initial', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' })
		fs.writeFileSync(path.join(repo, notebook), status)
		settings.write_config_atomic(path.join(repo, 'ag.json'), settings.make_template('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		git(repo, ['init', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-m', 'initial'])

		const result = settings.rename_target_document({ repo_root: repo, old_notebook: notebook, new_notebook: 'notes.md', active_host: 'codex', ...all_executables })

		assert.equal(result.second_commit, true)
		assert.equal(git(repo, ['rev-list', '--count', 'HEAD']).trim(), '3')
		assert.equal(git(repo, ['show', 'HEAD^:notes.md']), status)
		assert.doesNotMatch(git(repo, ['show', '--format=', '--name-only', 'HEAD^']), /ag\.json/)
		assert.match(git(repo, ['log', '--follow', '--oneline', '--', 'notes.md']), /initial/)
		assert.equal(fs.readFileSync(path.join(repo, notebook), 'utf8'), 'Moved to: notes.md — write your asks there.\n')
		assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'))).switches['target-doc'], 'notes.md')
		assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
	} finally {
		drop(repo)
	}
})

test('dedicated rename updates a shared adjacent ag.json when both notebooks are in one directory', () => {
	const repo = make_repo()
	try {
		const status = settings.format_status({ project: 'demo', notebook: 'devlog.md', notebook_kind: 'root', current_commit: 'initial', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' })
		fs.writeFileSync(path.join(repo, 'devlog.md'), status)
		settings.write_config_atomic(path.join(repo, 'ag.json'), custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		git(repo, ['init', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-m', 'initial'])

		settings.rename_target_document({ repo_root: repo, old_notebook: 'devlog.md', new_notebook: 'notes.devlog.md', active_host: 'codex', ...all_executables, date: '2026-08-21' })

			assert.equal(JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8')).switches['target-doc'], 'notes.devlog.md')
		assert.match(fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8'), /Moved to: notes\.devlog\.md/)
		const renamed = fs.readFileSync(path.join(repo, 'notes.devlog.md'), 'utf8')
		assert.equal(settings.validate_status_projection(renamed).valid, true)
		assert.match(renamed, /Notebook: notes\.devlog\.md — root\./)
		assert.equal(git(repo, ['rev-list', '--count', 'HEAD']).trim(), '3')
	} finally {
		drop(repo)
	}
})

test('dedicated rename preserves stream identity and refuses malformed STATUS before the move commit', () => {
	const repo = make_repo()
	try {
		fs.mkdirSync(path.join(repo, 'features/x'), { recursive: true })
		const notebook = 'features/x/x.devlog.md'
		const status = settings.format_status({ project: 'demo', notebook, notebook_kind: 'stream', current_commit: 'initial', tests_scenarios: 'none', config_path: 'features/x/ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' })
		fs.writeFileSync(path.join(repo, notebook), status)
		settings.write_config_atomic(path.join(repo, 'features/x/ag.json'), settings.copy_for_notebook(settings.make_template('codex'), notebook, { repo_root: repo, active_host: 'codex', ...all_executables }), { repo_root: repo, active_host: 'codex', ...all_executables })
		git(repo, ['init', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-m', 'initial'])

		settings.rename_target_document({ repo_root: repo, old_notebook: notebook, new_notebook: 'features/y/y.devlog.md', active_host: 'codex', ...all_executables, date: '2026-08-21' })
		assert.match(fs.readFileSync(path.join(repo, 'features/y/y.devlog.md'), 'utf8'), /Notebook: features\/y\/y\.devlog\.md — stream\./)

		const malformed_repo = make_repo()
		try {
			const malformed_status = status.replace('Open: none.\n\n', '')
			fs.writeFileSync(path.join(malformed_repo, 'devlog.md'), malformed_status)
			settings.write_config_atomic(path.join(malformed_repo, 'ag.json'), custom_notebook_config('codex'), { repo_root: malformed_repo, active_host: 'codex', ...all_executables })
			git(malformed_repo, ['init', '-b', 'main'])
			git(malformed_repo, ['config', 'user.email', 'test@example.com'])
			git(malformed_repo, ['config', 'user.name', 'Test'])
			git(malformed_repo, ['add', '-A'])
			git(malformed_repo, ['commit', '-m', 'initial'])
			const before = git(malformed_repo, ['rev-parse', 'HEAD']).trim()
			assert.throws(() => settings.rename_target_document({ repo_root: malformed_repo, old_notebook: 'devlog.md', new_notebook: 'notes.devlog.md', active_host: 'codex', ...all_executables }), /valid original STATUS/)
			assert.equal(git(malformed_repo, ['rev-parse', 'HEAD']).trim(), before)
			assert.equal(git(malformed_repo, ['status', '--porcelain']).trim(), '')
		} finally {
			drop(malformed_repo)
		}
	} finally {
		drop(repo)
	}
})

test('dedicated rename resumes its confined second commit and carries asks exactly once', () => {
	const repo = make_repo()
	try {
		const status = settings.format_status({ project: 'demo', notebook: 'devlog.md', notebook_kind: 'root', current_commit: 'initial', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' })
		fs.writeFileSync(path.join(repo, 'devlog.md'), status)
		settings.write_config_atomic(path.join(repo, 'ag.json'), custom_notebook_config('codex'), { repo_root: repo, active_host: 'codex', ...all_executables })
		git(repo, ['init', '-b', 'main'])
		git(repo, ['config', 'user.email', 'test@example.com'])
		git(repo, ['config', 'user.name', 'Test'])
		git(repo, ['add', '-A'])
		git(repo, ['commit', '-m', 'initial'])
		let fail_finish = true
		const git_runner = args => {
			if (fail_finish && args[0] === 'commit' && args.includes('devlog: finish target notebook rename')) {
				fail_finish = false
				throw new Error('injected second-commit failure')
			}
			return git(repo, args)
		}
		assert.throws(() => settings.rename_target_document({ repo_root: repo, old_notebook: 'devlog.md', new_notebook: 'features/demo/demo.devlog.md', active_host: 'codex', ...all_executables, git_runner, date: '2026-08-21' }), /between commits/)
		fs.appendFileSync(path.join(repo, 'devlog.md'), '\n# → Ask / A-002\n\n+ continue after interruption\n')

		const resumed = settings.rename_target_document({ repo_root: repo, old_notebook: 'devlog.md', new_notebook: 'features/demo/demo.devlog.md', active_host: 'codex', ...all_executables, date: '2026-08-21' })

		assert.equal(resumed.second_commit, true)
		const renamed = fs.readFileSync(path.join(repo, 'features/demo/demo.devlog.md'), 'utf8')
		assert.equal((renamed.match(/continue after interruption/g) || []).length, 1)
		assert.doesNotMatch(fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8'), /continue after interruption/)
		assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
		assert.equal(git(repo, ['rev-list', '--count', 'HEAD']).trim(), '3')
	} finally {
		drop(repo)
	}
})

test('forwarding cards carry an ask into the renamed notebook during resolution', () => {
	const repo = make_repo()
	try {
		const new_notebook = 'features/demo/demo.devlog.md'
		fs.mkdirSync(path.join(repo, 'features/demo'), { recursive: true })
		fs.writeFileSync(path.join(repo, 'devlog.md'), `Moved to: ${new_notebook} — write your asks there.\n\n# → Ask / A-002\n\n+ continue here\n`)
		fs.writeFileSync(path.join(repo, new_notebook), settings.format_status({ project: 'demo', notebook: new_notebook, notebook_kind: 'stream', current_commit: 'initial', tests_scenarios: 'none', config_path: 'features/demo/ag.json', host: 'codex', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none' }))
		settings.write_config_atomic(path.join(repo, 'features/demo/ag.json'), settings.copy_for_notebook(settings.make_template('codex'), new_notebook, { repo_root: repo, active_host: 'codex', ...all_executables }), { repo_root: repo, active_host: 'codex', ...all_executables })
		const result = settings.ensure_configuration({ repo_root: repo, notebook_path: 'devlog.md', active_host: 'codex', ...all_executables })
		assert.equal(result.forwarded_from, 'devlog.md')
		assert.equal(result.carried, true)
		assert.match(fs.readFileSync(path.join(repo, new_notebook), 'utf8'), /continue here/)
		const second = settings.ensure_configuration({ repo_root: repo, notebook_path: 'devlog.md', active_host: 'codex', ...all_executables })
		assert.equal(second.carried, false)
		assert.equal((fs.readFileSync(path.join(repo, new_notebook), 'utf8').match(/continue here/g) || []).length, 1)
	} finally {
		drop(repo)
	}
})

test('exact STATUS fixtures accept valid contexts and reject authoritative extras and malformed streams', () => {
	const base = {
		project: 'demo', current_commit: 'abc', tests_scenarios: 'none', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none',
	}
	const fixtures = [
		settings.format_status({ ...base, notebook: 'devlog.md', notebook_kind: 'root', config_path: 'ag.json', host: 'codex', validation: 'validated' }),
		settings.format_status({ ...base, notebook: 'devlog.md', notebook_kind: 'root', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'requirements and specification complete' }),
		settings.format_status({ ...base, notebook: 'devlog.md', notebook_kind: 'root', config_path: 'ag.json', host: 'codex', validation: 'validated', streams: [{ taskkey: 'x', state: 'closed', path: 'features/x/x.devlog.md' }] }),
		settings.format_status({ ...base, notebook: 'features/x/x.devlog.md', notebook_kind: 'stream', config_path: 'features/x/ag.json', host: 'claude', validation: 'validated', streams: [{ taskkey: 'x', state: 'active', path: 'features/x/x.devlog.md' }] }),
		settings.format_status({ ...base, notebook: 'devlog.md', notebook_kind: 'root', config_path: 'ag.json', host: 'codex', validation: 'blocked', open: 'repair required' }),
		settings.format_status({ ...base, notebook: '.agentflow/devlog.md', notebook_kind: 'root', config_path: 'ag.json', host: 'codex', validation: 'validated', streams: [{ taskkey: 'x', state: 'active', path: '.agentflow/features/x/x.devlog.md' }] }),
	]
	for (const fixture of fixtures) assert.deepEqual(settings.validate_status_projection(fixture), { valid: true, errors: [] })
	assert.match(fixtures[2], /Streams: none\./)
	const renamed = fixtures[0].replace('Notebook: devlog.md — root.', 'Notebook: demo.devlog.md — root.').replace('Proven:', 'Renamed: devlog.md → demo.devlog.md (2026-08-21).\n\nProven:')
	assert.equal(settings.validate_status_projection(renamed).valid, true)
	for (const bad of [
		fixtures[0].replace('Open: none.', ''),
		fixtures[0].replace('Open:', 'Unexpected: x\n\nOpen:'),
		fixtures[0].replace('Open:', 'Open: first\n\nOpen:'),
		fixtures[0].replace('Configuration: ag.json — schema v8; validated for codex this round.', 'Configuration: ag.json — schema v8; validated for codex this round; auto_reply=on.'),
		fixtures[0].replace('Streams: none.', 'Streams:\n\nstream: X — active — features/X/X.devlog.md'),
		fixtures[0].replace('Streams: none.', 'Streams:\n\nstream: x — active — elsewhere/x.devlog.md'),
		fixtures[0].replace('Streams: none.', 'Streams:\n\nstream: x — active — .agentflow/features/x/y.devlog.md'),
		fixtures[5].replace('.agentflow/features/x/x.devlog.md', '../../features/x/x.devlog.md'),
		fixtures[5].replace('.agentflow/features/x/x.devlog.md', 'unrelated/features/x/x.devlog.md'),
		fixtures[0].replace('Streams: none.', 'Streams:\n\nstream: x — closed — features/x/x.devlog.md'),
		fixtures[0].replace('Next:', 'Settings: target_doc=devlog.md\n\nNext:'),
	]) assert.equal(settings.validate_status_projection(bad).valid, false)
})

test('STATUS accepts canonical stream Backlink/Feature metadata and dot-prefixed workspace configuration paths', () => {
	const stream_status = (config_path, notebook = 'features/fast-closeout/fast-closeout.devlog.md') => settings.format_status({
		project: 'demo', notebook, notebook_kind: 'stream', current_commit: 'abc', tests_scenarios: 'none', config_path, host: 'claude', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none',
	})
	const closed = `${stream_status('.agentflow/features/fast-closeout/ag.json')}\nBacklink: main notebook \`.agentflow/devlog.md\` (main checkout)\n\nFeature: fast-closeout — closed\n\n---\n\n# → Ask / A-001\n\n+ \n`
	const active = `${stream_status('features/fast-closeout/ag.json')}\nBacklink: main notebook \`devlog.md\` (main checkout)\n\nFeature: fast-closeout — active — Fast closeout\n\n---\n\n# → Ask / A-001\n\n+ \n`
	assert.deepEqual(settings.validate_status_projection(closed), { valid: true, errors: [] })
	assert.deepEqual(settings.validate_status_projection(active), { valid: true, errors: [] })

	const root_status = settings.format_status({
		project: 'demo', notebook: '.agentflow/devlog.md', notebook_kind: 'root', current_commit: 'abc', tests_scenarios: 'none', config_path: '.agentflow/ag.json', host: 'claude', validation: 'validated', proven: 'none', open: 'none', next: 'await', artifacts: 'none', archived_eras: 'none', streams: [],
	})
	assert.deepEqual(settings.validate_status_projection(root_status), { valid: true, errors: [] })

	const reordered = closed.replace('Backlink: main notebook `.agentflow/devlog.md` (main checkout)\n\nFeature: fast-closeout — closed', 'Feature: fast-closeout — closed\n\nBacklink: main notebook `.agentflow/devlog.md` (main checkout)')
	assert.equal(settings.validate_status_projection(reordered).valid, true)
	assert.ok(settings.validate_status_projection(reordered).warnings.length)
	for (const bad of [
		closed.replace('Feature: fast-closeout — closed\n\n', 'Backlink: main notebook `.agentflow/devlog.md` (main checkout)\n\n'),
		closed.replace('Feature: fast-closeout — closed', 'Feature: fast-closeout is closed'),
		root_status.replace('Streams: none.', 'Streams: none.\n\nBacklink: main notebook `.agentflow/devlog.md` (main checkout)\n\nFeature: fast-closeout — closed'),
		closed.replace('.agentflow/features/fast-closeout/ag.json', '..agentflow/features/fast-closeout/ag.json'),
		closed.replace('.agentflow/features/fast-closeout/ag.json', './agentflow/features/fast-closeout/ag.json'),
	]) assert.equal(settings.validate_status_projection(bad).valid, false)
})

test('dispatch fallback skips failed duplicate values and renders the substitution record', () => {
	const claude = settings.make_template('claude')
	const selection = settings.resolve_worker_tier(claude, { role: 'acceptance' }, { active_host: 'claude', ...all_executables })
	const substitution = settings.resolve_dispatch_failure(claude, selection, { reason: 'model not found' })
	assert.equal(substitution.fallback.tier, 'basic')
	assert.notEqual(`${substitution.fallback.model}/${substitution.fallback.effort}`, `${selection.model}/${selection.effort}`)
	assert.match(substitution.record, /model substitution: .* → .*; reason: model not found/)
	const better = settings.resolve_worker_tier(claude, { role: 'coordinator' }, { active_host: 'claude', ...all_executables })
	assert.equal(settings.resolve_dispatch_failure(claude, better).fallback.tier, 'basic')
	const codex = settings.make_template('codex')
	const basic = settings.resolve_worker_tier(codex, { role: 'coding' }, { active_host: 'codex', ...all_executables })
	assert.equal(settings.resolve_dispatch_failure(codex, basic).fallback.tier, 'cheap')
	assert.throws(() => settings.resolve_dispatch_failure(claude, selection, { failed_values: ['claude-opus-5/high', 'claude-sonnet-5/high', 'haiku/high'] }), /no distinct configured worker value/)
	assert.throws(() => settings.resolve_dispatch_failure(claude, selection, { owner_override: true }), /owner-selected model/)
})

test('every operational role resolves to its configured tier in both worker families', () => {
	const config = settings.make_template('codex')
	const roles_by_tier = {
		best: ['security-scan', 'security', 'high-risk-review'],
		better: ['requirements', 'codewalk', 'exploration', 'spike', 'specification', 'acceptance', 'cross-check', 'architecture', 'review', 'three-way-review', 'threeways', 'coordinator', 'main-coordinator'],
		basic: ['coding', 'implementation', 'mechanical-edit', 'routine-scan', 'scan'],
	}
	for (const [tier, roles] of Object.entries(roles_by_tier)) for (const role of roles) assert.equal(settings.resolve_worker_tier(config, { role }, { active_host: 'codex', ...all_executables }).tier, tier, `${role} should resolve to ${tier}`)
})

test('threeways discloses unknown host or worker family without claiming diversity', () => {
	const config = settings.make_template('codex')
	config.switches['cli-provider'] = 'on'
	const options = { active_host: 'example-agent', executable_available: () => true }
	const unknown_host = settings.resolve_threeways_worker(config, options)
	assert.equal(unknown_host.profile.id, 'codex-default')
	assert.equal(unknown_host.family_diversity, 'unknown')
	assert.match(unknown_host.limitation, /unknown.*family|family.*unknown/i)
	config['external-workers'] = [{ ...config['external-workers'][0], tiers: { basic: 'custom/low', better: 'custom/low', best: 'custom/low', cheap: 'custom/low' } }]
	delete config['external-workers'][0].family
	const unknown_worker = settings.resolve_threeways_worker(config, { ...options, active_host: 'codex' })
	assert.equal(unknown_worker.family_diversity, 'unknown')
	config.switches['cli-provider'] = 'off'
	assert.throws(() => settings.resolve_threeways_worker(config, options), /No eligible/)
})

test('threeways selects a different-family better worker only when allowed and records its fallback', () => {
	const config = settings.make_template('codex')
	config.switches['cli-provider'] = 'on'
	config['external-workers'].push({
		id: 'claude-reviewer', command: ['claude'], priority: 5, family: 'claude',
		tiers: { best: 'claude-opus-5/high', better: 'claude-sonnet-5/high', basic: 'claude-haiku-5/medium', cheap: 'claude-haiku-5/low' },
	})
	const different = settings.resolve_threeways_worker(config, { active_host: 'codex', ...all_executables })
	assert.equal(different.profile.id, 'claude-reviewer')
	assert.equal(different.tier, 'better')
	assert.equal(different.family_diversity, 'different-family')
	config.switches['cli-provider'] = 'off'
	const fallback = settings.resolve_threeways_worker(config, { active_host: 'codex', ...all_executables })
	assert.equal(fallback.family_diversity, 'same-family-fallback')
	assert.match(fallback.limitation, /same-family fallback/i)
	assert.throws(() => settings.resolve_threeways_worker(config, { active_host: 'codex', ...all_executables, owner_exact_model: true }), /owner-selected exact model/i)
	config['external-workers'] = config['external-workers'].filter(profile => profile.family !== 'codex')
	assert.throws(() => settings.resolve_threeways_worker(config, { active_host: 'codex', ...all_executables }), /No eligible external-worker profile|configuration\.pipeline-roles/i)
})

test('role aliases contain only reachable public spellings and one canonical name per meaning', () => {
	assert.equal(settings.role_tiers.coding, undefined)
	assert.equal(settings.role_aliases.coding, 'implementation')
	assert.deepEqual(Object.keys(settings.role_aliases).filter(name => name.includes('_')), [])
})

test('templates expose one canonical configurable pipeline role map', () => {
	const config = settings.make_template('codex')
	assert.deepEqual(config['pipeline-roles'], {
		requirements: 'better',
		codewalk: 'better',
		explore: 'better',
		spike: 'better',
		spec: 'better',
		implementation: 'basic',
		'security-scan': 'best',
		acceptance: 'better',
		'cross-check': 'better',
		learn: 'basic',
	})
	assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, true)
})

test('pipeline role changes validate optional skips and warn when a required stage is off', () => {
	const config = settings.make_template('codex')
	config['external-workers'][0].tiers['custom-2'] = 'gpt-custom/high'
	config['external-workers'][1].tiers['custom-2'] = 'claude-custom/high'
	const changed = settings.apply_changes(config, [
		'pipeline-roles.codewalk: off',
		'pipeline-roles.security-scan: custom-2',
	], { active_host: 'codex', ...all_executables })
	assert.equal(changed.config['pipeline-roles'].codewalk, 'off')
	assert.equal(changed.config['pipeline-roles']['security-scan'], 'custom-2')
	assert.deepEqual(changed.changes, [
		'pipeline-roles.codewalk: better → off',
		'pipeline-roles.security-scan: best → custom-2',
	])

	const required_off = settings.make_template('codex')
	required_off['pipeline-roles'].spec = 'off'
	const validation = settings.validate_config(required_off, { active_host: 'codex', ...all_executables })
	assert.equal(validation.valid, true)
	assert.match(validation.warnings.join('; '), /pipeline-roles\.spec=off.*full pipeline is unavailable/)
	assert.throws(() => settings.resolve_worker_tier(required_off, { role: 'spec' }, { active_host: 'codex', ...all_executables }), /pipeline stage spec is disabled.*full pipeline is unavailable/)
})

test('cross-check uses its configured tier to select the designated provider', () => {
	const config = settings.make_template('codex')
	config.switches['cli-provider'] = 'on'
	config['pipeline-roles']['cross-check'] = 'use-claude'
	config['external-workers'][1].tiers['use-claude'] = 'claude-opus-4-6/medium'
	const selection = settings.resolve_worker_tier(config, { role: 'cross-check' }, { active_host: 'codex', ...all_executables })
	assert.equal(selection.profile.id, 'claude-default')
	assert.equal(selection.tier, 'use-claude')
	assert.equal(selection.model, 'claude-opus-4-6')
	assert.equal(selection.effort, 'medium')
})

test('custom tiers are accepted, route to a supporting profile, and fall back to basic when necessary', () => {
	const config = settings.make_template('codex')
	config['pipeline-roles'].requirements = 'deep-review'
	config['external-workers'][0].tiers['deep-review'] = 'gpt-deep/high'
	assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, true)

	const first = settings.resolve_worker_tier(config, { role: 'requirements' }, { active_host: 'codex', ...all_executables, cli_provider: 'on' })
	assert.equal(first.profile.id, 'codex-default')
	assert.equal(first.tier, 'deep-review')

	const second = settings.resolve_worker_tier(config, { role: 'requirements' }, { active_host: 'codex', executables: ['claude'], cli_provider: 'on' })
	assert.equal(second.profile.id, 'claude-default')
	assert.equal(second.tier, 'basic')
	assert.equal(second.fallback.requested_tier, 'deep-review')
	assert.match(second.record, /deep-review → basic/)

	config['external-workers'][1].tiers['deep-review'] = 'claude-deep/high'
	const fallback = settings.resolve_worker_tier(config, { role: 'requirements' }, { active_host: 'codex', ...all_executables, cli_provider: 'on' })
	assert.equal(fallback.profile.id, 'codex-default')
	assert.equal(fallback.tier, 'deep-review')
})

test('custom tier names follow the lowercase ASCII boundary and reserve off', () => {
	const base = settings.make_template('codex')
	for (const name of ['fast2', '2fast', 'fast-tier']) {
		const config = JSON.parse(JSON.stringify(base))
		config['external-workers'][0].tiers[name] = 'gpt-custom/high'
		assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, true, name)
	}
	for (const name of ['Fast', 'fast tier', 'off', '']) {
		const config = JSON.parse(JSON.stringify(base))
		config['external-workers'][0].tiers[name] = 'gpt-custom/high'
		const result = settings.validate_config(config, { active_host: 'codex', ...all_executables })
		assert.equal(result.valid, true, name)
		assert.match(result.warnings.join('; '), new RegExp(`${name || 'non-empty'}|ignored`))
	}
})

test('duplicate JSON object keys are rejected before configuration parsing', () => {
	const repo = make_repo()
	try {
		const config_path = path.join(repo, 'ag.json')
		const valid = JSON.stringify(settings.make_template('codex'), null, 2)
		const duplicate = valid.replace('"schema-version": 8,', '"schema-version": 8,\n  "schema-version": 8,')
		fs.writeFileSync(config_path, duplicate)
		assert.equal(settings.duplicate_json_key(duplicate), 'schema-version')
		assert.throws(() => settings.read_json_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables }), /duplicate JSON object key 'schema-version'/)
		assert.equal(fs.readFileSync(config_path, 'utf8'), duplicate)
	} finally {
		drop(repo)
	}
})

test('refresh rejects every removed configuration without rewriting bytes or exposing migration APIs', () => {
	assert.equal(settings.version_2_schema_version, undefined)
	assert.equal(settings.version_3_schema_version, undefined)
	assert.equal(settings.validate_version_3_config, undefined)
	assert.equal(settings.migrate_legacy_project, undefined)
	assert.equal(settings.migrate_legacy_status, undefined)

	for (const schema of [1, 2, 3]) {
		const repo = make_repo()
		try {
			const config_path = path.join(repo, 'ag.json')
			const before = JSON.stringify(make_removed_schema_fixture('codex', schema), null, 2) + '\n'
			fs.writeFileSync(config_path, before)
			assert.throws(() => settings.read_json_config(config_path, { repo_root: repo, active_host: 'codex', ...all_executables }), /schema-version.*8|unsupported/i)
			assert.equal(fs.readFileSync(config_path, 'utf8'), before)
		} finally {
			drop(repo)
		}
	}
})

test('refresh refuses to create missing configuration from a STATUS settings line', () => {
	const repo = make_repo()
	try {
		const status = settings.format_status({
			project: 'demo',
			notebook: 'devlog.md',
			notebook_kind: 'root',
			current_commit: 'initial',
			tests_scenarios: 'none',
			config_path: 'ag.json',
			host: 'codex',
			validation: 'missing',
			proven: 'none',
			open: 'none',
			next: 'repair',
			artifacts: 'none',
			archived_eras: 'none',
		})
			const notebook = `${status}Settings: target-doc=devlog.md, cli-provider=off, auto-reply=on, lang=en, runlog=on, streams=always, ask-names=off\n---\n`
		fs.writeFileSync(path.join(repo, 'devlog.md'), notebook)
		const before = fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8')
		assert.throws(() => settings.ensure_configuration({ repo_root: repo, active_host: 'codex', ...all_executables }), /ag\.json.*missing|STATUS.*configuration|no files changed/i)
		assert.equal(fs.existsSync(path.join(repo, 'ag.json')), false)
		assert.equal(fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8'), before)
		assert.equal(settings.validate_status_projection(status).valid, true)
	} finally {
		drop(repo)
	}
})

test('refresh rejects removed public aliases, provider values, and worker selection inputs without translation', () => {
	for (const line of ['internal-worker.best: gpt-5.6-terra/high', 'external_worker.basic: claude-sonnet-5/high', 'native-host: on', 'runlog: true']) {
		assert.throws(() => settings.parse_change_lines([line]), error => {
			assert.match(error.message, /unsupported|obsolete/i)
			assert.doesNotMatch(error.message, /use (?:codex-default|claude-default|native-host|runlog)/i)
			return true
		}, line)
	}
	for (const provider of ['any', 'codex', 'claude']) {
		const config = settings.make_template('codex')
			config.switches['cli-provider'] = provider
			expect_invalid(config, /cli-provider.*off, on/)
	}
	assert.throws(() => settings.tier_for_role('security_scan'), /unsupported|obsolete/i)
	assert.throws(() => settings.resolve_worker_tier(settings.make_template('codex'), { role: 'coding', worker_kind: 'internal_worker' }, { active_host: 'codex', ...all_executables }), /worker.*selection.*unsupported|worker.*kind/i)
	assert.throws(() => settings.resolve_worker_tier(settings.make_template('codex'), 'coding', 'internal_worker', { active_host: 'codex', ...all_executables }), /worker.*selection.*unsupported|worker.*kind/i)

	const repo = make_repo()
	try {
		settings.initialize_project({ repo_root: repo, active_host: 'codex', ...all_executables })
		assert.throws(() => settings.cli_main(['tier', '--repo', repo, '--host', 'codex', 'coding', 'internal_worker']), /worker.*selection.*unsupported|worker.*kind/i)
	} finally {
		drop(repo)
	}
})

test('refresh removes native-host from current settings, display, and public change syntax', () => {
	assert.equal(settings.switch_names.includes('native_host'), false)
	for (const host of ['codex', 'claude']) {
		const config = settings.make_template(host)
		assert.equal(Object.prototype.hasOwnProperty.call(config.switches, 'native_host'), false)
		assert.doesNotMatch(settings.format_settings_display(config, all_executables), /native-host|native_host/)
		const unknown = { ...config, switches: { ...config.switches, 'native-host': 'off' } }
		const result = settings.validate_config(unknown, { active_host: host, ...all_executables })
		assert.equal(result.valid, true)
		assert.match(result.warnings.join('; '), /native-host.*ignored/)
	}
	assert.throws(() => settings.parse_change_lines(['native-host: on']), /unsupported|obsolete/i)
})

test('refresh active-guide scan contains only the supported current contract', () => {
	const repo_root = path.resolve(__dirname, '../../..')
	const active_guides = [
			'skills/agentflow/SKILL.md',
			'skills/agentflow/references/ag.md',
			'skills/agentflow/references/delegation.md',
			'skills/agentflow/scripts/README.md',
			'skills/agentflow/docs/AG_GUIDE.md',
			'skills/agentflow/docs/AG_GUIDE.zh-tw.md',
		]
	const removed = /schema version 3|schema_version.{0,8}3|version-[123] configuration\b|six worker tiers|all six worker tiers|cli-provider:\s*(?:any|codex|claude)\b|native[_-]host|worker[_-]kind|(?:^|[^A-Za-z0-9_])internal_worker(?:$|[^A-Za-z0-9_])|(?:^|[^A-Za-z0-9_])external_worker(?:$|[^A-Za-z0-9_])|legacy STATUS|runlog:\s*(?:true|false)\b|readable for compatibility|既有檔案仍可讀取|遷移前/u
	const findings = []
	for (const relative_path of active_guides) {
		const text = fs.readFileSync(path.join(repo_root, relative_path), 'utf8')
		text.split(/\r?\n/).forEach((line, index) => {
			const supported = line.replace(/built-in (?:subagents?|workers?) are not a fallback/gu, 'unsupported fallback')
			if (removed.test(supported)) findings.push(`${relative_path}:${index + 1}: ${line}`)
		})
	}
	assert.deepEqual(findings, [], findings.join('\n'))
})

test('current configuration requires workspace-dir and never generates root fallback paths', () => {
  const config = settings.make_template('codex')
  delete config.switches['workspace-dir']
  assert.equal(settings.validate_config(config, { active_host: 'codex', ...all_executables }).valid, false)
  assert.throws(() => settings.workspace_paths(config), /workspace-dir/)
  assert.equal(settings.migrate_workspace, undefined)
})
