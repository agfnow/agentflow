'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

const agf = require('./agf.js')
const ag_settings = require('./ag-settings.js')
const setup = require('./setup.js')
const ownership_fixture = require('./fixtures/notebook-owner')
ownership_fixture.configure()
process.env.AGF_TEST_CONTEXT = '1'
const install_hook = require('./install-hook.js')
const { format_local_timestamp } = require('./local-time.js')

test('complete output retries when a write accepts only part of the text', () => {
	const accepted = []
	const write = (_descriptor, bytes, offset, length) => {
		const count = Math.min(7, length)
		accepted.push(bytes.subarray(offset, offset + count))
		return count
	}
	const message = 'root stream pointer not written — the next `godev` in the main project folder adds it\n'

	agf.write_all_sync(2, message, write)

	assert.equal(Buffer.concat(accepted).toString('utf8'), message)
})

test('parse_close_args requires one manifest stdin and keeps push authority separate', () => {
	assert.deepEqual(agf.parse_close_args(['--manifest-stdin']), { help: false, manifest_stdin: true, push_authorized: false })
	assert.deepEqual(agf.parse_close_args(['--manifest-stdin', '--push-authorized']), { help: false, manifest_stdin: true, push_authorized: true })
	assert.match(agf.parse_close_args([]).error, /manifest-stdin/)
	assert.match(agf.parse_close_args(['--manifest-stdin', '--push-authorized', '--push-authorized']).error, /duplicate/)
})

// ---------- dispatch ----------

test('main prints usage on a missing or unknown subcommand', () => {
	let logs = []
	assert.equal(agf.main([], '/tmp', (m) => logs.push(m)), 1)
	assert.ok(logs.join('\n').startsWith('usage:'))
	logs = []
	assert.equal(agf.main(['frobnicate'], '/tmp', (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('unknown subcommand "frobnicate"')))
	assert.ok(logs.some((l) => l.startsWith('usage:')))
})

test('main accepts clean as an alias of cleanup', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const r = agf.main(['clean', 'login-page'], dir, () => {})
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	drop(dir)
})

test('main accepts merge as a second alias of cleanup', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const r = agf.main(['merge', 'login-page'], dir, () => {})
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	drop(dir)
})

test('render_usage wraps descriptions without splitting command labels', () => {
	const rendered = agf.render_usage(40)
	const lines = rendered.split('\n')
	const command_line = lines.findIndex((line) => line.includes('  finish'))

	assert.ok(command_line >= 0)
	assert.ok(lines.some((line) => line.includes('agf finish --prep')))
	assert.ok(lines.some((line) => line.includes('prepare')))
	assert.doesNotMatch(rendered, /agf\s+fi\nsh/)

	const description_start = lines[command_line].indexOf('prepare')
	assert.ok(description_start > 0)
	const continuation = lines[command_line + 1]
	assert.equal(continuation.slice(0, description_start), ' '.repeat(description_start))
	for (const line of lines) {
		if (line && !/^\s+agf /.test(line)) assert.ok(line.length <= 40, `ordinary help prose exceeds width: ${line}`)
	}
	assert.match(rendered, /Commands that change\s+stream state do not write the configured\s+main\s+notebook/)
	assert.match(rendered, /notebook — type "godev"\s+there/)
	assert.ok(rendered.includes('afterwards.'))
})

test('render_usage keeps the usage heading intact at width 5', () => {
	const lines = agf.render_usage(5).split('\n')

	assert.equal(lines.filter((line) => line === 'usage:').length, 1)
})

test('render_usage keeps an overlong description token byte-intact at a narrow width', () => {
	const lines = agf.render_usage(5).split('\n')
	const integrating_lines = lines.filter((line) => line.trim() === 'integrating')

	assert.deepEqual(integrating_lines, ['    integrating'])
})

test('render_usage handles invalid and very narrow widths without looping or duplicating syntax', () => {
	assert.equal(agf.render_usage(0), agf.render_usage(80))
	const narrow = agf.render_usage(1)

	assert.ok(narrow.includes('finish'))
	assert.equal((narrow.match(/agf finish --prep/g) || []).length, 1)
	assert.equal((narrow.match(/agf finish --deliver/g) || []).length, 1)
})

test('help keeps stdout empty and writes the complete usage text to stderr', () => {
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), '--help'], { encoding: 'utf8' })

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /agf finish --prep/)
})

test('uninstall help is focused and keeps stdout empty', () => {
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall', '--help'], { encoding: 'utf8' })

	assert.equal(result.status, 0)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /agf uninstall/)
	assert.match(result.stderr, /--skills/)
})

test('setup, hooks, and settings have focused help and looper stays standalone', () => {
	for (const command of ['setup', 'hooks', 'settings']) {
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), command, '--help'], { encoding: 'utf8' })

		assert.equal(result.status, 0, `${command}: ${result.stderr}`)
		assert.equal(result.stdout, '')
		assert.match(result.stderr, new RegExp(`agf ${command}`))
	}
	assert.doesNotMatch(agf.render_usage(80), /agf looper/)
	assert.match(agf.render_usage(80), /standalone agf-looper/is)
})

test('start argument parsing requires an explicit host, repository, and message stdin', () => {

	assert.deepEqual(agf.parse_start_args(['--repo', '/tmp/repo', '--host', 'codex', '--message-stdin', '--json']), {
		repo: '/tmp/repo', host: 'codex', message_stdin: true, json: true,
	})
	assert.match(agf.parse_start_args(['--host', 'codex']).error, /repo/i)
	assert.match(agf.parse_start_args(['--repo', '/tmp/repo', '--host', 'codex']).error, /message-stdin/i)
	assert.deepEqual(agf.parse_start_args(['--repo', '/tmp/repo', '--host', 'example-agent', '--message-stdin']), {
		repo: '/tmp/repo', host: 'example-agent', message_stdin: true, json: false,
	})
	assert.match(agf.parse_start_args(['--repo', '/tmp/repo', '--host', 'not safe!', '--message-stdin']).error, /host/i)
})

test('start combines initialization, exact owner input, intake, and structured JSON', () => {

	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	try {
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ build the thing\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		assert.doesNotMatch(result.stderr, /Error:/)
		const output = JSON.parse(result.stdout)
		assert.equal(output.repository, dir)
		assert.equal(output.notebook, '.agentflow/devlog.md')
		assert.equal(output.active_host, 'codex')
		assert.equal(output.setup_created, true)
		assert.equal(output.message.inserted, true)
		assert.equal(output.current_ask_identifier, 'A-001')
		assert.deepEqual(output.git, { branch: 'main', head: null, state: 'unborn' })
		assert.equal(output.next_run_id, 'RUN-001')
		assert.deepEqual(output.changed_paths.sort(), ['.agentflow/devlog.md', '.gitignore', 'ag.json'])
		assert.equal(output.configuration.path, 'ag.json')
		assert.equal(output.configuration.language, ag_settings.detect_initial_language() || 'en-us')
		assert.match(output.local_timestamp, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}$/u)
		assert.deepEqual(output.stream_decision.reason, 'bootstrap_files_only')
		assert.equal(Object.hasOwn(output, 'setup'), false)
		assert.equal(Object.hasOwn(output, 'current_ask'), false)
		assert.ok(result.stdout.length < 2500, `public startup output is ${result.stdout.length} bytes`)
		assert.match(fs.readFileSync(path.join(dir, '.agentflow/devlog.md'), 'utf8'), /\+ build the thing/)
		fs.appendFileSync(path.join(dir, '.agentflow/devlog.md'), `\n---\n\n## [RUN-001] Event — ${close_stamp()} (during round A-001)\n\n- Startup remains active.\n`)

		const second = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ build the thing\n', encoding: 'utf8',
		})
		assert.equal(second.status, 0, second.stderr)
		const second_output = JSON.parse(second.stdout)
		assert.equal(second_output.setup_created, false)
		assert.equal(second_output.message.inserted, false)
		assert.equal(second_output.next_run_id, 'RUN-002')
		assert.equal((fs.readFileSync(path.join(dir, '.agentflow/devlog.md'), 'utf8').match(/\+ build the thing/g) || []).length, 1)
		assert.equal(second_output.stream_decision.reason, 'foreign_or_parallel_work')
		const plain = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin'], {
			cwd: dir, input: '+ build the thing\n', encoding: 'utf8',
		})
		assert.equal(plain.status, 0, plain.stderr)
		assert.equal(plain.stdout.trim(), dir)
		assert.match(plain.stderr, /ready:|notebook:|stream decision:/i)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start rejects detached HEAD instead of treating it as unborn', () => {
	const { dir } = make_repo()
	try {
		execFileSync('git', ['checkout', '--detach', '-q'], { cwd: dir })
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ request\n', encoding: 'utf8',
		})
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /reading repository branch failed/i)
	} finally {
		drop(dir)
	}
})

test('start reports owner input only for an established clean project', () => {

	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-established-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		agf.update_ignore_file(dir)
		install_hook.install({ cwd: dir, quiet: true, say: () => {} })
		execFileSync('git', ['add', '-A'], { cwd: dir })
		execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: dir })
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: 'continue the work\n\n# → Ask / A-999\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.equal(output.setup_created, false)
		assert.equal(output.message.inserted, true)
		assert.equal(Object.hasOwn(output.message, 'text'), false)
		assert.equal(output.git.state, 'committed')
		assert.match(output.git.head, /^[0-9a-f]{40}$/u)
		assert.equal(output.next_run_id, 'RUN-001')
		assert.equal(output.stream_decision.reason, 'owner_input_only')
		const saved = fs.readFileSync(path.join(dir, '.agentflow/devlog.md'), 'utf8')
		assert.ok(saved.endsWith('+ continue the work\n\n+ # → Ask / A-999\n'))
		assert.deepEqual(require('./round-linter').parse_devlog(saved).ask_ids, ['A-001'])
		fs.writeFileSync(path.join(dir, 'foreign.txt'), 'owned by another session\n')
		const foreign = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ continue the work\n', encoding: 'utf8',
		})
		assert.equal(foreign.status, 0, foreign.stderr)
		assert.equal(JSON.parse(foreign.stdout).stream_decision.reason, 'foreign_or_parallel_work')
		assert.match(execFileSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' }), /\?\? foreign\.txt/u)
		assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' }).trim(), 'fixture')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

for (const host of ['codex', 'claude']) test(`start treats bare godev as activation only and leaves an empty Ask (${host})`, () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-activation-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', host, '--session', ownership_fixture.session, '--message-stdin', '--json'], {
			cwd: dir, input: 'godev\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.deepEqual(output.message, { inserted: false, reason: 'activation_only' })
		assert.equal(output.configuration?.language, ag_settings.detect_initial_language() || 'en-us')
		assert.deepEqual(Object.keys(output).sort(), ['active_host', 'configuration', 'git', 'hooks_restart_required', 'message', 'notebook', 'repository', 'setup_created', 'setup_created_files'])
		assert.match(fs.readFileSync(path.join(dir, '.agentflow/devlog.md'), 'utf8'), /# → Ask \/ A-001(?: \([^\r\n)]+\))?\n\n\+ ?\n$/u)
		assert.ok(Buffer.byteLength(result.stdout) < 1024, `startup output was ${Buffer.byteLength(result.stdout)} bytes`)
		const config_path = path.join(dir, 'ag.json')
		const config = JSON.parse(fs.readFileSync(config_path, 'utf8'))
		config.switches.lang = 'zh-tw'
		fs.writeFileSync(config_path, JSON.stringify(config, null, 2) + '\n')
		const repeated = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', host, '--session', ownership_fixture.session, '--message-stdin', '--json'], {
			cwd: dir, input: 'godev\n', encoding: 'utf8',
		})
		assert.equal(repeated.status, 0, repeated.stderr)
		assert.equal(JSON.parse(repeated.stdout).configuration.language, 'zh-tw')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start reports an existing Ask when bare godev resumes written owner content', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-resume-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		const notebook = path.join(dir, '.agentflow/devlog.md')
		fs.writeFileSync(notebook, fs.readFileSync(notebook, 'utf8').replace(/\n\+ ?\n$/u, '\n+ written owner request\n'))
		ownership_fixture.adopt(dir, '.agentflow/devlog.md')
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: 'godev\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.deepEqual(output.message, { inserted: false, reason: 'already_present' })
		assert.equal(output.current_ask_identifier, 'A-001')
		assert.equal(output.git.state, 'unborn')
		assert.equal(output.stream_decision.reason, 'owner_input_only')
		assert.equal(output.required_next_rulebook, null)
		assert.match(fs.readFileSync(notebook, 'utf8'), /\+ written owner request/u)

		const config_path = path.join(dir, 'ag.json')
		const changed_config = JSON.parse(fs.readFileSync(config_path, 'utf8'))
		changed_config.switches['allow-ag'] = changed_config.switches['allow-ag'] === 'on' ? 'off' : 'on'
		fs.writeFileSync(config_path, `${JSON.stringify(changed_config, null, 2)}\n`)
		const changed = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: 'godev\n', encoding: 'utf8',
		})
		assert.equal(changed.status, 0, changed.stderr)
		assert.equal(JSON.parse(changed.stdout).stream_decision.reason, 'foreign_or_parallel_work')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start preserves the first scope baseline when bare godev resumes an existing Ask', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-scope-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		agf.update_ignore_file(dir)
		install_hook.install({ cwd: dir, quiet: true, say: () => {} })
		execFileSync('git', ['add', '-A'], { cwd: dir })
		execFileSync('git', ['commit', '-qm', 'scope baseline'], { cwd: dir })
		fs.writeFileSync(path.join(dir, 'owner.js'), 'module.exports = "owner";\n')
		const start_args = [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json']
		const first = spawnSync(process.execPath, start_args, { cwd: dir, input: 'continue the work\n', encoding: 'utf8' })
		assert.equal(first.status, 0, first.stderr)
		const receipt_name = fs.readdirSync(path.join(dir, '.agentflow', '.tmp')).find(name => name.startsWith('agentflow-input-'))
		const receipt_path = path.join(dir, '.agentflow', '.tmp', receipt_name)
		const first_scope = JSON.parse(fs.readFileSync(receipt_path, 'utf8')).scope
		assert.ok(first_scope.paths['owner.js'])
		fs.writeFileSync(path.join(dir, 'later.js'), 'module.exports = "later";\n')
		const second = spawnSync(process.execPath, start_args, { cwd: dir, input: 'godev\n', encoding: 'utf8' })
		assert.equal(second.status, 0, second.stderr)
		assert.deepEqual(JSON.parse(fs.readFileSync(receipt_path, 'utf8')).scope, first_scope)
		assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(receipt_path, 'utf8')).scope.paths, 'later.js'), false)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start repairs a heading-only final Ask without exposing notebook contents', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-empty-ask-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		const notebook = path.join(dir, '.agentflow/devlog.md')
		fs.writeFileSync(notebook, fs.readFileSync(notebook, 'utf8').replace(/\n\+\n$/u, '\n'))
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: 'repair request\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.equal(Object.hasOwn(output.message, 'text'), false)
		assert.match(fs.readFileSync(notebook, 'utf8'), /# → Ask \/ A-001(?: \([^\r\n)]+\))?\n\n\+ repair request\n$/u)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start respects an explicitly configured custom root notebook', () => {

	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-legacy-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, explicit_host: 'codex', notebook_path: 'devlog.md' })
		agf.update_ignore_file(dir)
		install_hook.install({ cwd: dir, quiet: true, say: () => {} })
		execFileSync('git', ['add', '-A'], { cwd: dir })
		execFileSync('git', ['commit', '-qm', 'legacy fixture'], { cwd: dir })
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ continue the legacy work\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.equal(output.notebook, 'devlog.md')
		assert.equal(output.message.inserted, true)
		assert.equal(output.stream_decision.reason, 'owner_input_only')
		assert.match(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), /\+ continue the legacy work/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('start refuses an invalid established configuration and a missing established notebook', () => {
	const invalid = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-invalid-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: invalid })
	fs.writeFileSync(path.join(invalid, 'ag.json'), '{ malformed\n')
	const invalid_result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', invalid, '--host', 'codex', '--message-stdin', '--json'], {
		cwd: invalid, input: '+ request\n', encoding: 'utf8',
	})
	assert.notEqual(invalid_result.status, 0)
	assert.match(invalid_result.stderr, /malformed|must not be replaced|configuration/i)
	assert.equal(fs.readFileSync(path.join(invalid, 'ag.json'), 'utf8'), '{ malformed\n')
	fs.rmSync(invalid, { recursive: true, force: true })

	const missing = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-missing-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: missing })
	const config = ag_settings.make_template('codex')
	config.switches['target-doc'] = '.agentflow/devlog.md'
	config.switches['workspace-dir'] = '.agentflow'
	fs.writeFileSync(path.join(missing, 'ag.json'), `${JSON.stringify(config, null, 2)}\n`)
	const missing_result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', missing, '--host', 'codex', '--message-stdin', '--json'], {
		cwd: missing, input: '+ request\n', encoding: 'utf8',
	})
	assert.notEqual(missing_result.status, 0)
	assert.match(missing_result.stderr, /notebook is missing|restore|repair|configuration/i)
	assert.equal(fs.existsSync(path.join(missing, '.agentflow/devlog.md')), false)
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: missing, encoding: 'utf8' }).trim(), '?? ag.json')
	fs.rmSync(missing, { recursive: true, force: true })

	const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-outside-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: outside })
	const outside_config = ag_settings.make_template('codex')
	outside_config.switches['target-doc'] = '../outside.md'
	outside_config.switches['workspace-dir'] = '.agentflow'
	fs.writeFileSync(path.join(outside, 'ag.json'), `${JSON.stringify(outside_config, null, 2)}\n`)
	const outside_result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', outside, '--host', 'codex', '--message-stdin', '--json'], {
		cwd: outside, input: '+ request\n', encoding: 'utf8',
	})
	assert.notEqual(outside_result.status, 0)
	assert.match(outside_result.stderr, /repository-relative|outside|target-doc/i)
	assert.equal(fs.existsSync(path.join(path.dirname(outside), 'outside.md')), false)
	fs.rmSync(outside, { recursive: true, force: true })
})

test('start keeps an interrupted startup conservative when its lock is still present', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-start-interrupted-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		agf.update_ignore_file(dir)
		execFileSync('git', ['add', '-A'], { cwd: dir })
		execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: dir })
		fs.writeFileSync(path.join(dir, '.agentflow-start.lock'), 'Agentflow startup lock\npid: 1\n')
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', dir, '--host', 'codex', '--message-stdin', '--json'], {
			cwd: dir, input: '+ interrupted request\n', encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.equal(output.message.inserted, false)
		assert.equal(output.stream_decision.reason, 'foreign_or_parallel_work')
		assert.match(output.stream_decision.evidence.join(' '), /startup did not return/i)
		assert.match(fs.readFileSync(path.join(dir, '.agentflow/devlog.md'), 'utf8'), /\n\n\+ ?\n$/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

test('settings forwards show and validation through agf with empty stdout', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-settings-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const logs = []
	agf.init_main([], dir, () => {})

	assert.equal(agf.main(['settings', 'show'], dir, message => logs.push(message)), 0)
	assert.match(logs.join('\n'), /target-doc:/)
	assert.equal(agf.main(['settings', 'validate'], dir, message => logs.push(message)), 0)
	assert.match(logs.join('\n'), /valid .*ag\.json/)
	drop(dir)
})

test('hooks forwards project host selection and removal through agf', () => {
	const { dir } = make_repo()
	const logs = []

	assert.equal(agf.main(['hooks', '--project', '--host', 'codex'], dir, message => logs.push(message)), 0)
	assert.ok(fs.existsSync(path.join(dir, '.codex', 'hooks.json')))
	assert.equal(agf.main(['hooks', '--project', '--host', 'codex', '--off'], dir, message => logs.push(message)), 0)
	assert.doesNotMatch(fs.readFileSync(path.join(dir, '.codex', 'hooks.json'), 'utf8'), /stop-hook\.js/)
	drop(dir)
})

test('uninstall previews once, preserves a decline, then removes project hooks and shell shortcuts with empty stdout', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-uninstall-')))
	const home = path.join(dir, 'home')
	fs.mkdirSync(home)
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const cfg = path.join(home, '.zshrc')
	fs.writeFileSync(cfg, setup.lines_to_append('zsh', true, true, path.resolve(__dirname, '..')) + '\n')
	install_hook.install({ cwd: dir, quiet: true, say: () => {} })
	const env = { ...process.env, HOME: home, SHELL: '/bin/zsh' }

	const declined = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall'], { cwd: dir, env, input: 'n\n', encoding: 'utf8' })
	assert.equal(declined.status, 1)
	assert.equal(declined.stdout, '')
	assert.match(declined.stderr, /uninstall preview/i)
	assert.match(fs.readFileSync(cfg, 'utf8'), /agf\(\)/)

	const accepted = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'uninstall'], { cwd: dir, env, input: 'y\n', encoding: 'utf8' })
	assert.equal(accepted.status, 0, accepted.stderr)
	assert.equal(accepted.stdout, '')
	assert.doesNotMatch(fs.readFileSync(cfg, 'utf8'), /agf\(\)|agf-looper\(\)|AGF_OPEN/)
	assert.equal(fs.existsSync(path.join(dir, '.git', 'hooks', 'pre-commit')), false)
	drop(dir)
})

test('finish help receives the dispatcher terminal width', () => {
	const logs = []
	assert.equal(agf.main(['finish', '--help'], '/tmp', (message) => logs.push(message), undefined, 40), 1)
	assert.equal(logs.join(''), agf.render_usage(40))
})

test('init creates the configured notebook, ignore entries, and project hooks in one repeatable action', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	const logs = []
	const first = agf.init_main([], dir, message => logs.push(message))
	const first_notebook = fs.readFileSync(path.join(dir, '.agentflow', 'devlog.md'), 'utf8')
	const first_ignore = fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')
	const second = agf.init_main([], dir, message => logs.push(message))

	assert.equal(first.notebook, '.agentflow/devlog.md')
	assert.equal(second.notebook, '.agentflow/devlog.md')
	assert.equal(fs.readFileSync(path.join(dir, '.agentflow', 'devlog.md'), 'utf8'), first_notebook)
	assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), first_ignore)
	assert.deepEqual(first_ignore.trim().split('\n'), ['.claude/', '.codex/', '.worktrees/'])
	const host = ag_settings.detect_host()
	assert.ok(fs.existsSync(install_hook.config_path_for(host, 'project', dir)))
	assert.equal(fs.existsSync(path.join(dir, host === 'codex' ? '.claude' : '.codex')), false)
	assert.match(logs.join('\n'), /\.agentflow\/devlog\.md/)
	drop(dir)
})


for (const command of ['init', 'start']) for (const first_host of ['codex', 'claude']) test(command + ' installs only the active host and adds the second host on demand: ' + first_host, () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-host-init-')))
	const hosts = [first_host, first_host === 'codex' ? 'claude' : 'codex']
	const run = host => {
		const env = { ...process.env }
		for (const markers of Object.values(ag_settings.host_markers)) for (const marker of markers) delete env[marker]
		env[ag_settings.host_markers[host][0]] = '1'
		const args = command === 'start' ? ['start', '--repo', dir, '--host', host, '--message-stdin', '--json'] : ['init']
		if (command === 'start') args.push('--session', '1')
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), ...args], { cwd: dir, env, input: 'host selection regression\n', encoding: 'utf8' })
		assert.equal(result.status, 0, result.stderr)
	}
	try {
		run(hosts[0])
		const first_path = install_hook.config_path_for(hosts[0], 'project', dir)
		const original = fs.readFileSync(first_path, 'utf8')
		assert.equal(fs.existsSync(path.join(dir, '.' + hosts[1])), false)
		run(hosts[0])
		assert.equal(fs.readFileSync(first_path, 'utf8'), original)
		assert.equal(fs.existsSync(path.join(dir, '.' + hosts[1])), false)
		if (command === 'start') ownership_fixture.adopt(dir, '.agentflow/devlog.md', hosts[1], '1')
		run(hosts[1])
		assert.ok(fs.existsSync(install_hook.config_path_for(hosts[1], 'project', dir)))
		assert.equal(fs.readFileSync(first_path, 'utf8'), original)
	} finally { drop(dir) }
})

// ---------- pure: new ----------

test('kebab_case lowercases and hyphenates, trimming edges', () => {
	assert.equal(agf.kebab_case('Login Page'), 'login-page')
	assert.equal(agf.kebab_case('  Search!! Page  '), 'search-page')
	assert.equal(agf.kebab_case('foo_bar 2'), 'foo-bar-2')
	assert.equal(agf.kebab_case('搜尋頁'), '')
})

test('is_key accepts only lowercase keys', () => {
	assert.ok(agf.is_key('search-page'))
	assert.ok(agf.is_key('a1'))
	assert.ok(!agf.is_key('Search-Page'))
	assert.ok(!agf.is_key('-lead'))
	assert.ok(!agf.is_key('has space'))
})

test('next_key adds the smallest free numeric suffix', () => {
	assert.equal(agf.next_key('login', []), 'login')
	assert.equal(agf.next_key('login', ['login']), 'login-2')
	assert.equal(agf.next_key('login', ['login', 'login-2', 'login-3']), 'login-4')
})

test('parse_new_args splits name, key and -m wish', () => {
	assert.deepEqual(agf.parse_new_args(['搜尋頁', 'search-page']), { name: '搜尋頁', key: 'search-page', wish: '' })
	assert.deepEqual(agf.parse_new_args(['login', '-m', 'build it']), { name: 'login', key: '', wish: 'build it' })
	assert.deepEqual(agf.parse_new_args(['--help']), { help: true })
	assert.match(agf.parse_new_args(['login', '-m']).error, /requires a message/)
	assert.match(agf.parse_new_args(['login', '--force']).error, /unknown new option/)
	assert.match(agf.parse_new_args(['login', 'key', 'extra']).error, /at most one taskkey/)
})

test('resolve_key prefers an explicit key and rejects a bad one', () => {
	assert.equal(agf.resolve_key({ name: '搜尋頁', key: 'search-page' }), 'search-page')
	assert.equal(agf.resolve_key({ name: 'Login Page', key: '' }), 'login-page')
	assert.throws(() => agf.resolve_key({ name: 'x', key: 'Bad Key' }), /must be lowercase/)
	assert.throws(() => agf.resolve_key({ name: '搜尋頁', key: '' }), /no usable key/)
})

test('stream configuration changes only the adjacent target document', () => {
	const root = ag_settings.make_template('codex')
	const out = ag_settings.copy_for_notebook(root, 'features/x/x.devlog.md', { repo_root: '/tmp', active_host: 'codex', executables: ['codex', 'claude'] })
	assert.equal(out.switches['target-doc'], 'features/x/x.devlog.md')
	assert.equal(out.switches['auto-reply'], root.switches['auto-reply'])
	assert.equal(out['external-workers'].find(profile => profile.id === 'codex-default').tiers.best, root['external-workers'].find(profile => profile.id === 'codex-default').tiers.best)
})

const tpl_args = {
	taskkey: 'search-page',
	name: '搜尋頁',
	project_line: 'Project: ag — the skill',
	config_path: 'features/search-page/ag.json',
	host: 'codex',
	date: '2026-08-19',
}

test('devlog_template writes STATUS, backlink and one empty Ask when there is no wish', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: '' })
	assert.ok(out.startsWith('# STATUS\n'))
	assert.ok(out.includes('Project: ag — the skill'))
	assert.ok(out.includes('Feature: search-page — active — 搜尋頁'))
	assert.ok(out.includes('Backlink: main notebook `devlog.md`'))
	assert.ok(out.includes('Configuration: features/search-page/ag.json — schema v8; validated for codex this round.'))
	assert.ok(!out.includes('Settings:'))
	assert.ok(out.includes('# → Ask / A-001'))
	assert.ok(!out.includes('A-002'))
	assert.match(out, /Opened by[^]*\n\n---\n\n# → Ask \/ A-001/)
	assert.equal((out.match(/^---$/gm) || []).length, 1)
})

test('devlog_template puts the wish in A-001 verbatim and leaves A-002 empty', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: 'build the search box' })
	assert.ok(out.includes('# → Ask / A-001\n\n+ build the search box'))
	assert.ok(out.includes('# → Ask / A-002'))
})

test('devlog_template never writes the feature: trigger word into the notebook', () => {
	const out = agf.devlog_template({ ...tpl_args, wish: '' })
	assert.ok(!/^\s*\+?\s*feature:/m.test(out))
})

// ---------- pure: clean ----------

test('parse_clean_args takes the first plain word as the key and spots --help', () => {
	assert.deepEqual(agf.parse_clean_args(['login-page']), { help: false, key: 'login-page' })
	assert.deepEqual(agf.parse_clean_args([]), { help: false, key: '' })
	assert.equal(agf.parse_clean_args(['-h']).help, true)
	assert.equal(agf.parse_clean_args(['--help']).help, true)
	assert.match(agf.parse_clean_args(['login-page', 'extra']).error, /at most one taskkey/)
	assert.match(agf.parse_clean_args(['--force']).error, /unknown option/)
})

test('parse_finish_args requires exactly one phase and at most one valid key', () => {
	assert.deepEqual(agf.parse_finish_args(['--prep']), { help: false, phase: 'prep', key: '' })
	assert.deepEqual(agf.parse_finish_args(['--deliver', 'login-page']), { help: false, phase: 'deliver', key: 'login-page' })
	assert.equal(agf.parse_finish_args(['--help']).help, true)
	assert.match(agf.parse_finish_args([]).error, /exactly one/)
	assert.match(agf.parse_finish_args(['--prep', '--deliver']).error, /exactly one/)
	assert.match(agf.parse_finish_args(['--prep', 'one', 'two']).error, /at most one/)
	assert.match(agf.parse_finish_args(['--prep', 'Bad-Key']).error, /lowercase/)
	assert.match(agf.parse_finish_args(['--prep', '--force']).error, /unknown finish option/)
})

test('key_from_path reads the key out of a .worktrees folder, and nothing else', () => {
	assert.equal(agf.key_from_path('/repo/.worktrees/login-page'), 'login-page')
	assert.equal(agf.key_from_path('/repo/.worktrees/login-page/features/x'), 'login-page')
	assert.equal(agf.key_from_path('/repo'), '')
	assert.equal(agf.key_from_path('/repo/.worktrees'), '')
})

test('default_from_origin_head strips the origin/ prefix', () => {
	assert.equal(agf.default_from_origin_head('origin/main'), 'main')
	assert.equal(agf.default_from_origin_head('origin/trunk\n'), 'trunk')
	assert.equal(agf.default_from_origin_head(''), '')
})

test('near_keys offers the likely typos, not the whole list', () => {
	const known = ['login-page', 'logout', 'search-page', 'main']
	assert.deepEqual(agf.near_keys('login-pag', known), ['login-page', 'logout'])
	assert.deepEqual(agf.near_keys('zzz', known), [])
})

// ---------- end to end, in a throwaway repo ----------

const make_repo = ({ remote = false, prefix = 'agf-' } = {}) => {
	// realpath: on macOS /var is a symlink to /private/var, and git reports the real path
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
	const run = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8' })
	run(['init', '-b', 'main'])
	run(['config', 'user.email', 't@example.com'])
	run(['config', 'user.name', 'T'])
	fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n')
	fs.writeFileSync(path.join(dir, 'devlog.md'), ag_settings.format_status({
		project: 'demo — a test',
		notebook: 'devlog.md',
		current_commit: 'initial commit',
		tests_scenarios: 'none',
		config_path: 'ag.json',
		host: 'codex',
		validation: 'validated',
		proven: 'none',
		open: 'none',
		next: 'await the owner',
		artifacts: 'none',
		archived_eras: 'none',
	}))
	fs.writeFileSync(path.join(dir, 'ag.json'), `${JSON.stringify({ ...ag_settings.make_template('codex'), switches: { ...ag_settings.make_template('codex').switches, 'target-doc': 'devlog.md' } }, null, 2)}\n`)
	run(['add', '-A'])
	run(['commit', '-m', 'init'])

	if (remote) {
		const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-remote-')))
		execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: bare })
		run(['remote', 'add', 'origin', bare])
		run(['push', '-u', 'origin', 'main'])
		run(['remote', 'set-head', 'origin', 'main'])
		return { dir, run, bare }
	}
	return { dir, run }
}

const open_stream = (dir, name) => agf.main(['new', name], dir, () => {}).dir

const close_stamp = () => format_local_timestamp(new Date(Date.now() - 120000))

const close_manifest = (root, delivery = { mode: 'local' }) => {
	return {
		version: 1,
		notebook: 'devlog.md',
		ask: 'A-001',
		run_events: [`## [RUN-001] Event — ${close_stamp()} (during round A-001)\n\n- The close command was tested.\n`],
		reply: '# ← Reply / A-001\n\n## [SUMMARY]\n\n- The close command completed.\n\n## [FINAL REPORT]\n\n- The local closeout was verified.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n',
		status: {
			project: 'demo — a test',
			notebook: 'devlog.md',
			notebook_kind: 'root',
			current_commit: 'closeout pending',
			tests_scenarios: 'close command test',
			config_path: 'ag.json',
			host: 'codex',
			validation: 'validated',
			proven: 'the close command completed',
			open: 'none',
			next: 'await the owner',
			artifacts: 'none',
			archived_eras: 'none',
			streams: [],
		},
		allowed_paths: ['devlog.md'],
		commit_message: 'record fast closeout',
		delivery,
	}
}

const close_fixture = ({ remote = false } = {}) => {
	const fixture = make_repo({ remote })
	const config = ag_settings.make_template('codex')
	config.switches['target-doc'] = 'devlog.md'
	fs.writeFileSync(path.join(fixture.dir, 'ag.json'), `${JSON.stringify(config, null, 2)}\n`)
	fs.writeFileSync(path.join(fixture.dir, 'devlog.md'), `${ag_settings.format_status({
		project: 'demo — a test',
		notebook: 'devlog.md',
		notebook_kind: 'root',
		current_commit: 'initial commit',
		tests_scenarios: 'none',
		config_path: 'ag.json',
		host: 'codex',
		validation: 'validated',
		proven: 'none',
		open: 'none',
		next: 'await the owner',
		artifacts: 'none',
		archived_eras: 'none',
		streams: [],
	})}---\n\n# → Ask / A-001\n\n+ finish the round\n`)
	fixture.run(['add', '-A'])
	fixture.run(['commit', '-m', 'close fixture'])
	ownership_fixture.adopt(fixture.dir, 'devlog.md')
	return fixture
}

test('close and stop hook agree on the first commit with a persisted language setting', () => {
	for (const language of ['en', 'zh-tw', 'zh-cn']) {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-close-unborn-')))
	execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
	execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir })
	execFileSync('git', ['config', 'user.name', 'Agentflow Test'], { cwd: dir })
	try {
		ag_settings.initialize_project({ repo_root: dir, active_host: 'codex' })
		agf.update_ignore_file(dir)
		install_hook.install({ cwd: dir, quiet: true, say: () => {} })
		const notebook_path = '.agentflow/devlog.md'
		ag_settings.change_configuration(path.join(dir, 'ag.json'), { lang: language }, { repo_root: dir, active_host: 'codex' })
		const hook = input => spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], {
			cwd: dir, input: JSON.stringify({ cwd: dir, ...input }), encoding: 'utf8',
		})
		assert.equal(hook({ hook_event_name: 'UserPromptSubmit', prompt: 'hihi' }).status, 0)
		const manifest = {
			version: 1,
			notebook: notebook_path,
			ask: 'A-001',
			run_events: [`## [RUN-001] Event — ${close_stamp()} (during round A-001)\n\n- The first close was tested.\n`],
			reply: '# ← Reply / A-001\n\n## [SUMMARY]\n\n- The first close completed.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n',
			status: { ...close_manifest(dir).status, notebook: notebook_path },
			allowed_paths: [notebook_path, '.gitignore', 'ag.json'],
			commit_message: 'record first close',
			delivery: { mode: 'local' },
		}
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
		const output = JSON.parse(result.stdout)
		assert.equal(output.commit.state, 'created')
		assert.ok(Buffer.byteLength(result.stdout) < 1024, `close output was ${Buffer.byteLength(result.stdout)} bytes`)
		assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), '1')
		assert.deepEqual(execFileSync('git', ['show', '--pretty=', '--name-only', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim().split('\n').sort(), ['.agentflow/devlog.md', '.gitignore', 'ag.json'])
		const stop = hook({ hook_event_name: 'Stop', stop_hook_active: false })
		assert.equal(stop.status, 0, `${language}: ${stop.stderr}`)
		const retry = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})
		assert.equal(retry.status, 0, retry.stdout + retry.stderr)
		assert.equal(JSON.parse(retry.stdout).commit.sha, output.commit.sha)
		assert.equal(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(), '1')
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
	}
})

test('close reviews captured candidate files before replacing the notebook or committing', () => {
	for (const kind of ['source', 'configuration']) {
		const fixture = close_fixture()
		try {
			const manifest = close_manifest(fixture.dir)
			const candidate = kind === 'source' ? 'owner.js' : 'ag.json'
			if (kind === 'source') fs.writeFileSync(path.join(fixture.dir, candidate), 'module.exports = true;\n')
			else ag_settings.change_configuration(path.join(fixture.dir, candidate), { 'allow-ag': 'off' }, { repo_root: fixture.dir, active_host: 'codex' })
			require('./notebook-write.js').append_input({ root: fixture.dir, notebook: 'devlog.md', text: 'include the existing changed file', host: 'codex' })
			manifest.allowed_paths.push(candidate)
			const before = fs.readFileSync(path.join(fixture.dir, 'devlog.md'))
			const head = fixture.run(['rev-parse', 'HEAD'])
			const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
				cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
			})
			assert.notEqual(result.status, 0, `${kind}: an unreviewed candidate must be refused`)
			assert.equal(JSON.parse(result.stdout).error.code, 'completion_failed')
			assert.deepEqual(fs.readFileSync(path.join(fixture.dir, 'devlog.md')), before)
			assert.equal(fixture.run(['rev-parse', 'HEAD']), head)
			assert.equal(fixture.run(['diff', '--cached', '--name-only']).trim(), '')
		} finally {
			drop(fixture.dir)
		}
	}
})

test('close performs one local notebook replacement and one scoped commit, then retries idempotently', () => {
	const fixture = close_fixture()
	try {
		const manifest = close_manifest(fixture.dir)
		const first = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
		const output = JSON.parse(first.stdout)
		assert.equal(output.ok, true)
		assert.equal(output.phase, 'committed')
		assert.equal(output.commit.state, 'created')
		assert.match(fixture.run(['log', '-1', '--format=%B']), /Agentflow-Close-Id:/)
		const closed = fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8')
		assert.equal((closed.match(/# ← Reply \/ A-001/g) || []).length, 1)
		assert.match(closed, /# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/u)
		assert.match(closed, /Notebook: devlog\.md — root\./u)
		assert.match(closed, /Configuration: ag\.json — schema v8; validated for codex this round\./u)
		assert.match(closed, /Archived eras: none\./u)
		assert.match(closed, /Streams: none\./u)
		assert.equal(fixture.run(['status', '--porcelain']).trim(), '')

		const second = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`)
		const retry = JSON.parse(second.stdout)
		assert.equal(retry.phase, 'committed')
		assert.equal(retry.commit.state, 'existing')
		assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '3')
		assert.equal((fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8').match(/# ← Reply \/ A-001/g) || []).length, 1)
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true })
	}
})

test('close rejects a repository change immediately before notebook replacement', () => {
	const fixture = close_fixture()
	const wrapper = make_git_wrapper('race-before-replace')
	const counter = path.join(wrapper.bin, 'identity-counter')
	fs.writeFileSync(counter, '0')
	const before = fs.readFileSync(path.join(fixture.dir, 'devlog.md'))
	try {
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir,
			input: JSON.stringify(close_manifest(fixture.dir)),
			encoding: 'utf8',
			env: { ...process.env, PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`, AGF_TEST_IDENTITY_COUNTER: counter },
		})
		assert.notEqual(result.status, 0)
		const output = JSON.parse(result.stdout)
		assert.equal(output.error.code, 'repository_changed')
		assert.equal(output.phase, 'validated')
		assert.deepEqual(fs.readFileSync(path.join(fixture.dir, 'devlog.md')), before)
		assert.equal(fixture.run(['log', '-1', '--format=%s']).trim(), 'external first commit')
	} finally {
		drop(fixture.dir, wrapper.bin)
	}
})

test('close retries after a later unrelated commit by finding the original closeout', () => {
	const fixture = close_fixture()
	try {
		const manifest = close_manifest(fixture.dir)
		const command = [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin']
		const first = spawnSync(process.execPath, command, {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
		const original = JSON.parse(first.stdout)

		fixture.run(['commit', '--allow-empty', '-m', 'later unrelated commit'])
		const retry = spawnSync(process.execPath, command, {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`)
		const output = JSON.parse(retry.stdout)
		assert.equal(output.phase, 'committed')
		assert.equal(output.commit.state, 'existing')
		assert.equal(output.commit.sha, original.commit.sha)
		assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '4')
	} finally {
		drop(fixture.dir)
	}
})

test('close recovers a commit that reports failure after Git created it', () => {
	const fixture = close_fixture()
	const wrapper = make_git_wrapper('commit-then-fail')
	const previous_path = process.env.PATH
	process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
	try {
		const manifest = close_manifest(fixture.dir)
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
		const output = JSON.parse(result.stdout)
		assert.equal(output.ok, true)
		assert.equal(output.phase, 'committed')
		assert.equal(output.commit.state, 'existing')
		assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '3')
	} finally {
		process.env.PATH = previous_path
		drop(fixture.dir, wrapper.bin)
	}
})

test('close rejects push without the separate command authority before notebook mutation', () => {
	const fixture = close_fixture()
	try {
		const before = fs.readFileSync(path.join(fixture.dir, 'devlog.md'))
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir,
			input: JSON.stringify(close_manifest(fixture.dir, { mode: 'push', remote: 'origin', branch: 'main' })),
			encoding: 'utf8',
		})
		assert.notEqual(result.status, 0)
		const output = JSON.parse(result.stdout)
		assert.equal(output.error.code, 'push_not_authorized')
		assert.deepEqual(fs.readFileSync(path.join(fixture.dir, 'devlog.md')), before)
		assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '2')
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true })
	}
})

test('close rejects extra or duplicate manifest keys before any mutation', () => {
	for (const input_builder of [
		manifest => JSON.stringify({ ...manifest, extra: true }),
		manifest => `${JSON.stringify(manifest).slice(0, -1)},"version":1}`,
	]) {
		const fixture = close_fixture()
		try {
			const before = fs.readFileSync(path.join(fixture.dir, 'devlog.md'))
			const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
				cwd: fixture.dir,
				input: input_builder(close_manifest(fixture.dir)),
				encoding: 'utf8',
			})
			assert.notEqual(result.status, 0)
			const output = JSON.parse(result.stdout)
			assert.equal(output.error.code, 'invalid_manifest')
			assert.deepEqual(fs.readFileSync(path.join(fixture.dir, 'devlog.md')), before)
			assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '2')
		} finally {
			fs.rmSync(fixture.dir, { recursive: true, force: true })
		}
	}
})

test('close refuses a dirty index and both closeout locks without mutation', () => {
	for (const setup_case of ['index', 'delivery-lock', 'notebook-lock']) {
		const fixture = close_fixture()
		try {
			const notebook_file = path.join(fixture.dir, 'devlog.md')
			const before = fs.readFileSync(notebook_file)
			if (setup_case === 'index') {
				fs.writeFileSync(path.join(fixture.dir, 'staged.txt'), 'staged\n')
				fixture.run(['add', 'staged.txt'])
			} else if (setup_case === 'delivery-lock') {
				fs.writeFileSync(path.join(fixture.dir, '.git', 'agf-delivery.lock'), 'active\n')
			} else {
				fs.writeFileSync(`${notebook_file}.close-round.lock`, 'active\n')
			}
			const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
				cwd: fixture.dir,
				input: JSON.stringify(close_manifest(fixture.dir)),
				encoding: 'utf8',
			})
			assert.notEqual(result.status, 0, setup_case)
			const output = JSON.parse(result.stdout)
			assert.ok(['dirty_index', 'unrelated_paths', 'delivery_lock_busy', 'notebook_lock_busy'].includes(output.error.code), output.error.code)
			assert.deepEqual(fs.readFileSync(notebook_file), before)
			assert.equal(fixture.run(['rev-list', '--count', 'HEAD']).trim(), '2')
		} finally {
			fs.rmSync(fixture.dir, { recursive: true, force: true })
		}
	}
})

test('close preserves unrelated unstaged edits and untracked files outside its committed candidate', () => {
	const fixture = close_fixture()
	try {
		require('./notebook-write').append_input({ root: fixture.dir, notebook: 'devlog.md', text: 'complete the scoped closeout', host: 'codex' })
		const before_ignore = fixture.run(['show', 'HEAD:.gitignore'])
		fs.appendFileSync(path.join(fixture.dir, '.gitignore'), 'foreign-output/\n')
		fs.writeFileSync(path.join(fixture.dir, 'foreign.js'), 'owner work\n')
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
			cwd: fixture.dir, input: JSON.stringify(close_manifest(fixture.dir)), encoding: 'utf8',
		})
		assert.equal(result.status, 0, result.stdout + result.stderr)
		assert.deepEqual(fixture.run(['show', '--pretty=', '--name-only', 'HEAD']).trim().split('\n'), ['devlog.md'])
		assert.equal(fixture.run(['show', 'HEAD:.gitignore']), before_ignore)
		assert.equal(fs.readFileSync(path.join(fixture.dir, '.gitignore'), 'utf8'), before_ignore + 'foreign-output/\n')
		assert.equal(fs.readFileSync(path.join(fixture.dir, 'foreign.js'), 'utf8'), 'owner work\n')
		assert.match(fixture.run(['status', '--porcelain']), / M \.gitignore/)
		assert.match(fixture.run(['status', '--porcelain']), /\?\? foreign\.js/)
		const stop = spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], {
			cwd: fixture.dir, input: JSON.stringify({ cwd: fixture.dir, hook_event_name: 'Stop' }), encoding: 'utf8',
		})
		assert.equal(stop.status, 0, stop.stdout + stop.stderr)
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true })
	}
})

test('close scope preserves outside ownership during continued edits but reviews new, candidate and committed paths', () => {
	const fixture = close_fixture()
	const writer = require('./notebook-write')
	const stop = () => spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], {
		cwd: fixture.dir, input: JSON.stringify({ cwd: fixture.dir, hook_event_name: 'Stop' }), encoding: 'utf8',
	})
	const close = manifest => spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], {
		cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
	})
	try {
		const bytes = Buffer.alloc(2 * 1024 * 1024, 97)
		fs.writeFileSync(path.join(fixture.dir, 'old-history.md'), bytes)
		const notes = path.join(fixture.dir, 'owner-notes.md')
		fs.writeFileSync(notes, 'committed notes\n')
		const task_file = path.join(fixture.dir, 'task.js')
		fs.writeFileSync(task_file, 'module.exports = 0;\n')
		fixture.run(['add', '--', 'old-history.md', 'owner-notes.md', 'task.js'])
		fixture.run(['commit', '-qm', 'old artifact'])
		fs.writeFileSync(notes, 'notes at intake\n')
		fs.writeFileSync(task_file, 'module.exports = 1;\n')
		writer.append_input({ root: fixture.dir, notebook: 'devlog.md', text: 'complete the scoped closeout', host: 'codex' })
		fs.writeFileSync(task_file, 'module.exports = 0;\n')
		fs.writeFileSync(notes, 'notes at close\n')
		fs.renameSync(path.join(fixture.dir, 'old-history.md'), path.join(fixture.dir, 'moved-history.md'))
		const commit_hook = path.join(fixture.dir, '.git', 'hooks', 'pre-commit')
		fs.writeFileSync(commit_hook, "#!/bin/sh\nprintf '%s\\n' 'notes during close' > owner-notes.md\n", { mode: 0o755 })
		const manifest = close_manifest(fixture.dir)
		manifest.allowed_paths.push('task.js')
		const first = close(manifest)
		assert.equal(first.status, 0, first.stdout + first.stderr)
		fs.unlinkSync(commit_hook)
		const first_stop = stop()
		assert.equal(first_stop.status, 0, first_stop.stderr)
		assert.equal(fs.readFileSync(notes, 'utf8'), 'notes during close\n')
		assert.deepEqual(fixture.run(['show', '--pretty=', '--name-only', 'HEAD']).trim().split('\n'), ['devlog.md'])
		fs.writeFileSync(task_file, 'module.exports = 1;\n')
		assert.equal(stop().status, 2, 'a task-owned path cannot reuse its old intake exclusion after close')
		fs.writeFileSync(task_file, 'module.exports = 0;\n')
		const candidate = require('./completion-context').collect({
			project_root: fixture.dir, notebook_path: 'devlog.md', active_host: 'codex',
			devlog_text: fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8'), candidate_paths: ['owner-notes.md'],
		})
		assert.ok(candidate.review_decision.changed_files.includes('owner-notes.md'), 'candidate paths cannot inherit an outside exclusion')
		assert.equal(candidate.review_decision.status, 'required')
		fs.writeFileSync(notes, 'notes at intake\n')
		assert.equal(stop().status, 0, 'continued edits do not transfer outside-file ownership to the completed task')
		fs.writeFileSync(notes, 'notes at close\n')
		assert.equal(stop().status, 0)
		assert.deepEqual(fs.readFileSync(path.join(fixture.dir, 'moved-history.md')), bytes)
		assert.equal(close(manifest).status, 0)
		const receipt = path.join(fixture.dir, '.agentflow', '.tmp', fs.readdirSync(path.join(fixture.dir, '.agentflow', '.tmp')).find(file => file.startsWith('agentflow-input-')))
		const saved = fs.readFileSync(receipt, 'utf8')
		for (const corrupt of [data => { delete data.scope.close }, data => { data.scope.close.commit = 'f'.repeat(40) }, data => { data.scope.close.notebook_hash = '0'.repeat(64) }, data => { data.scope.close.paths = [] }, data => { data.repository = '/wrong-repository' }]) {
			const data = JSON.parse(saved)
			corrupt(data)
			fs.writeFileSync(receipt, JSON.stringify(data))
			assert.equal(stop().status, 2, 'invalid close scope cannot hide outside files')
		}
		fs.writeFileSync(receipt, saved)
		fixture.run(['add', '--', 'moved-history.md'])
		assert.equal(stop().status, 0, 'staging outside work does not put it in the completed task')
		fixture.run(['restore', '--staged', '--', 'moved-history.md'])
		fs.appendFileSync(path.join(fixture.dir, 'moved-history.md'), 'later change')
		assert.equal(stop().status, 0)
		assert.equal(close(manifest).status, 0, 'retry reuses established outside ownership')
		assert.equal(fs.readFileSync(receipt, 'utf8'), saved, 'retry must not rewrite the captured scope')
		fs.writeFileSync(path.join(fixture.dir, 'moved-history.md'), bytes)
		assert.equal(stop().status, 0)
		const preserved_notes = path.join(fixture.dir, '.git', 'preserved-notes')
		fs.renameSync(notes, preserved_notes)
		assert.equal(stop().status, 0, 'deletion remains outside the completed task')
		fs.symlinkSync(preserved_notes, notes)
		assert.equal(stop().status, 2, 'recorded ownership must not bypass unsafe path checks')
		fs.unlinkSync(notes)
		fs.renameSync(preserved_notes, notes)
		fs.writeFileSync(path.join(fixture.dir, 'new-unreviewed.js'), 'new work\n')
		assert.equal(stop().status, 2)
		fs.renameSync(path.join(fixture.dir, 'new-unreviewed.js'), path.join(fixture.dir, '.git', 'new-unreviewed.js'))
		fixture.run(['add', '--', 'old-history.md', 'moved-history.md', 'owner-notes.md'])
		fixture.run(['commit', '-qm', 'owner commits outside move'])
		assert.equal(stop().status, 2, 'committed changes remain conservative until the next Ask')
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true })
	}
})

test('authorized push fetches and verifies a local remote without force', () => {
	const fixture = close_fixture({ remote: true })
	try {
		const manifest = close_manifest(fixture.dir, { mode: 'push', remote: 'origin', branch: 'main' })
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], {
			cwd: fixture.dir,
			input: JSON.stringify(manifest),
			encoding: 'utf8',
		})
		assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
		const output = JSON.parse(result.stdout)
		assert.equal(output.phase, 'pushed', `${result.stdout}\n${result.stderr}`)
		assert.equal(output.delivery.state, 'pushed')
		assert.equal(output.delivery.remote_sha, output.commit.sha)
		assert.equal(fixture.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], output.commit.sha)
	} finally {
		fs.rmSync(fixture.dir, { recursive: true, force: true })
		if (fixture.bare) fs.rmSync(fixture.bare, { recursive: true, force: true })
	}
})

test('delivery retry uses the saved closeout commit after the next Ask is captured', () => {
	const fixture = close_fixture({ remote: true })
	const reject = path.join(fixture.bare, 'hooks', 'pre-receive')
	try {
		fs.writeFileSync(reject, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
		const manifest = close_manifest(fixture.dir, { mode: 'push', remote: 'origin', branch: 'main' })
		const first = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], {
			cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})
		assert.notEqual(first.status, 0)
		const original = JSON.parse(first.stdout).commit.sha
		require('./notebook-write').append_input({ root: fixture.dir, notebook: 'devlog.md', host: 'codex', session: ownership_fixture.session, text: 'next Ask arrived during delivery' })
		fs.unlinkSync(reject)
		const retry = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], {
			cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})
		assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`)
		const output = JSON.parse(retry.stdout)
		assert.equal(output.commit.sha, original)
		assert.equal(output.delivery.remote_sha, original)
		assert.match(fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8'), /next Ask arrived during delivery/)
	} finally {
		drop(fixture.dir, fixture.bare)
	}
})

test('delivery retry refuses a trailer-only close commit when verified receipt evidence is absent', () => {
	const fixture = close_fixture({ remote: true })
	const reject = path.join(fixture.bare, 'hooks', 'pre-receive')
	try {
		fs.writeFileSync(reject, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
		const manifest = close_manifest(fixture.dir, { mode: 'push', remote: 'origin', branch: 'main' })
		const first = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], {
			cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})
		assert.notEqual(first.status, 0)
		const close_receipt = fs.readdirSync(path.join(fixture.dir, '.agentflow', '.tmp')).find(file => file.endsWith('.close.json'))
		assert.ok(close_receipt)
		fs.unlinkSync(path.join(fixture.dir, '.agentflow', '.tmp', close_receipt))
		require('./notebook-write').append_input({ root: fixture.dir, notebook: 'devlog.md', host: 'codex', session: ownership_fixture.session, text: 'new Ask must keep ownership' })
		fs.unlinkSync(reject)
		const remote_before = fixture.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]

		const retry = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], {
			cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8',
		})

		assert.notEqual(retry.status, 0)
		assert.equal(fixture.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_before)
	} finally {
		drop(fixture.dir, fixture.bare)
	}
})

test('new places a stream below the configured workspace directory', () => {
	const { dir, run } = make_repo()
	try {
		const config_path = path.join(dir, 'ag.json')
		const config = ag_settings.make_template('codex')
		config.switches['workspace-dir'] = '.agentflow'
		config.switches['target-doc'] = '.agentflow/devlog.md'
		fs.mkdirSync(path.join(dir, '.agentflow'), { recursive: true })
		fs.renameSync(path.join(dir, 'devlog.md'), path.join(dir, '.agentflow/devlog.md'))
		fs.writeFileSync(config_path, `${JSON.stringify(config, null, 2)}\n`)
		run(['add', '-A'])
		run(['commit', '-m', 'configure workspace'])
		const worktree = open_stream(dir, 'Login page')
		assert.ok(fs.existsSync(path.join(worktree, '.agentflow/features/login-page/login-page.devlog.md')))
		assert.ok(fs.existsSync(path.join(worktree, '.agentflow/features/login-page/ag.json')))
		const notebook = fs.readFileSync(path.join(worktree, '.agentflow/features/login-page/login-page.devlog.md'), 'utf8')
		assert.match(notebook, /Backlink: main notebook `\.agentflow\/devlog\.md`/)
	} finally {
		fs.rmSync(dir, { recursive: true, force: true })
	}
})

const commit_stream_file = (run, wt, file, content, message = 'feature work') => {
	const target = path.join(wt, file)
	fs.mkdirSync(path.dirname(target), { recursive: true })
	fs.writeFileSync(target, content)
	run(['add', file], wt)
	run(['commit', '-m', message], wt)
}

const close_stream = (run, wt, key) => {
	const doc = path.join(wt, '.agentflow/features', key, `${key}.devlog.md`)
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), `Feature: ${key} — closed`)
	assert.notEqual(closed, opened)
	fs.writeFileSync(doc, closed)
	run(['add', doc], wt)
	run(['commit', '-m', 'devlog: close stream for test'], wt)
	const pushed = run(['push', 'origin', `HEAD:${key}`], wt)
	run(['fetch', 'origin'], wt)
	return pushed
}

const close_local_stream = (run, wt, key) => {
	const doc = path.join(wt, '.agentflow/features', key, `${key}.devlog.md`)
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), `Feature: ${key} — closed`)
	assert.notEqual(closed, opened)
	fs.writeFileSync(doc, closed)
	run(['add', doc], wt)
	return run(['commit', '-m', 'devlog: close local stream for test'], wt)
}

const commit_notebook_bytes = (run, wt, key, bytes, message = 'test notebook bytes') => {
	const doc = path.join(wt, '.agentflow/features', key, `${key}.devlog.md`)
	fs.writeFileSync(doc, bytes)
	run(['add', doc], wt)
	run(['commit', '-m', message], wt)
}

const make_unvalidated_tip = (run, wt, key, validated_tip) => {
	fs.writeFileSync(path.join(wt, 'unvalidated-stream-tip.txt'), 'unvalidated stream tip\n')
	run(['add', 'unvalidated-stream-tip.txt'], wt)
	run(['commit', '-m', 'unvalidated stream tip'], wt)
	const unvalidated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	run(['reset', '--hard', validated_tip], wt)
	return unvalidated_tip
}

const drop = (...dirs) => dirs.filter(Boolean).forEach((d) => fs.rmSync(d, { recursive: true, force: true }))

const shell_quote = value => `'${String(value).replace(/'/g, "'\\''")}'`

const make_git_wrapper = (mode) => {
	const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-git-wrapper-')))
	const real_git = process.env.PATH.split(path.delimiter)
		.map(directory => path.join(directory, 'git'))
		.find(candidate => fs.existsSync(candidate))
	if (!real_git) throw new Error('could not find the real git executable for the local test wrapper')
	const wrapper = path.join(bin, 'git')
	fs.writeFileSync(wrapper, `#!/usr/bin/env node
const child_process = require('node:child_process')
const fs = require('node:fs')
const real_git = ${JSON.stringify(real_git)}
const args = process.argv.slice(2)
if (${JSON.stringify(mode === 'local-delete-race')} && args[0] === 'update-ref' && args.includes('-d') && args.includes('refs/heads/login-page')) {
  child_process.execFileSync(real_git, ['update-ref', 'refs/heads/login-page', process.env.AGF_TEST_UNVALIDATED_TIP])
}
if (${JSON.stringify(mode === 'remote-delete-race')} && args[0] === 'push' && args.includes(':refs/heads/login-page')) {
  child_process.execFileSync(real_git, ['push', args[1], process.env.AGF_TEST_UNVALIDATED_TIP + ':refs/heads/login-page'])
}
if (${JSON.stringify(mode === 'inspection-failure')} && args[0] === 'for-each-ref' && args.includes('refs/heads/login-page')) process.exit(1)
if (${JSON.stringify(mode === 'remote-inspection-failure')} && args[0] === 'ls-remote') process.exit(1)
if (${JSON.stringify(mode === 'worktree-removal-failure')} && args[0] === 'worktree' && args[1] === 'remove') process.exit(1)
const race_before_replace = ${JSON.stringify(mode === 'race-before-replace')}
const is_head_identity = args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === 'HEAD'
if (race_before_replace && is_head_identity) {
  const counter_path = process.env.AGF_TEST_IDENTITY_COUNTER
  const count = Number(fs.readFileSync(counter_path, 'utf8') || '0') + 1
  fs.writeFileSync(counter_path, String(count))
  if (count === 2) child_process.spawnSync(real_git, ['commit', '--allow-empty', '-m', 'external first commit'], { cwd: process.cwd(), encoding: 'utf8' })
}
const result = child_process.spawnSync(real_git, args, { cwd: process.cwd(), encoding: 'utf8' })
process.stdout.write(result.stdout || '')
process.stderr.write(result.stderr || '')
const switch_after = process.env.AGF_TEST_SWITCH_AFTER || ''
const move_stream_after = process.env.AGF_TEST_MOVE_STREAM_AFTER || ''
const unvalidated_tip = process.env.AGF_TEST_UNVALIDATED_TIP || ''
const stream_key = process.env.AGF_TEST_STREAM_KEY || ''
const lock_replacement_after = process.env.AGF_TEST_REPLACE_LOCK_AFTER || ''
const lock_path = process.env.AGF_TEST_LOCK_PATH || ''
const commit_then_fail = ${JSON.stringify(mode === 'commit-then-fail')}
const is_diff = args[0] === 'diff' && args.includes('--diff-filter=A')
const is_merge = args[0] === 'merge' && args[1] === '--ff-only'
const is_stream_head = args[0] === 'rev-parse' && args[1] === 'HEAD' && process.cwd().includes('/.worktrees/')
if (result.status === 0 && ((switch_after === 'diff' && is_diff) || (switch_after === 'merge' && is_merge))) {
  const switched = child_process.spawnSync(real_git, ['switch', 'side'], { cwd: process.cwd(), encoding: 'utf8' })
  process.stderr.write(switched.stderr || '')
}
if (result.status === 0 && move_stream_after === 'stream-head' && is_stream_head && unvalidated_tip && stream_key) {
  const moved = child_process.spawnSync(real_git, ['update-ref', 'refs/heads/' + stream_key, unvalidated_tip], { cwd: process.cwd(), encoding: 'utf8' })
  process.stderr.write(moved.stderr || '')
}
if (result.status === 0 && lock_replacement_after === 'merge' && is_merge && lock_path) {
  try { fs.unlinkSync(lock_path) } catch {}
  fs.writeFileSync(lock_path, 'replacement owner\\n', { mode: 0o600 })
}
if (result.status === 0 && commit_then_fail && args[0] === 'commit') process.exit(1)
process.exit(result.status === null ? 1 : result.status)
`, { mode: 0o755 })
	return { bin, real_git }
}

// ----- agf new -----

test('new opens branch, worktree, notebook and commit in a real repo', () => {
	const { dir, run } = make_repo()
	const root_config_path = path.join(dir, 'ag.json')
	const root_config = JSON.parse(fs.readFileSync(root_config_path, 'utf8'))
	root_config.switches['auto-reply'] = 'on'
	fs.writeFileSync(root_config_path, `${JSON.stringify(root_config, null, 2)}\n`)
	run(['add', 'ag.json'])
	run(['commit', '-m', 'configure auto reply'])
	const logs = []
	const r = agf.main(['new', '搜尋頁', 'search-page'], dir, (m) => logs.push(m))

	assert.equal(r.dir, path.join(dir, '.worktrees', 'search-page'))
	const doc = path.join(r.dir, '.agentflow/features', 'search-page', 'search-page.devlog.md')
	const stream_config = JSON.parse(fs.readFileSync(path.join(r.dir, '.agentflow/features', 'search-page', 'ag.json'), 'utf8'))
	assert.ok(fs.existsSync(doc))
	assert.ok(fs.readFileSync(doc, 'utf8').includes('Project: demo — a test'))
	assert.equal(stream_config.switches['target-doc'], '.agentflow/features/search-page/search-page.devlog.md')
	assert.equal(stream_config.switches['auto-reply'], 'on')
	assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'ag.json'), 'utf8')).switches['target-doc'], 'devlog.md')
	assert.equal(JSON.parse(fs.readFileSync(root_config_path, 'utf8')).switches['auto-reply'], 'on')
	assert.ok(run(['branch', '--list', 'search-page']).includes('search-page'))
	assert.equal(run(['status', '--porcelain'], r.dir).trim(), '')
	assert.ok(logs.some((l) => l.includes('no remote configured')))
	assert.deepEqual(logs.slice(-12), [
		'',
		'stream: search-page open',
		'branch: search-page',
		'notebook: .worktrees/search-page/.agentflow/features/search-page/search-page.devlog.md',
		'',
		'open new notebook in your editor:',
		path.join(r.dir, '.agentflow/features', 'search-page', 'search-page.devlog.md'),
		'',
		'root stream pointer not written — the next `godev` in the main project folder adds it',
		'',
		'exit the current host, then continue in the stream:',
		`cd '${r.dir}' && codex`,
	])
	drop(dir)
})

test('public new command works from an ordinary shell without host session markers', () => {
	const { dir } = make_repo()
	const env = { ...process.env }
	for (const markers of Object.values(ag_settings.host_markers)) for (const marker of markers) delete env[marker]

	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'new', 'shell test'], {
		cwd: dir,
		env,
		encoding: 'utf8',
	})

	assert.equal(result.status, 0, result.stderr)
	assert.equal(result.stdout.trim(), path.join(dir, '.worktrees', 'shell-test'))
	assert.doesNotMatch(result.stderr, /\.worktrees\/.*not in \.gitignore/)
	drop(dir)
})

test('new prints a shell-quoted continuation for the active host and preserves its directory output', () => {
	for (const host of ['codex', 'claude']) {
		const { dir } = make_repo({ prefix: "agf quoted ' " })
		try {
			const env = { ...process.env }
			for (const markers of Object.values(ag_settings.host_markers)) for (const marker of markers) delete env[marker]
			env[ag_settings.host_markers[host][0]] = '1'
			const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'new', 'continuation'], { cwd: dir, env, encoding: 'utf8' })
			const worktree = path.join(dir, '.worktrees', 'continuation')
			assert.equal(result.status, 0, result.stderr)
			assert.match(result.stderr, /exit the current host/i)
			const continuation = result.stderr.trim().split('\n').at(-1)
			assert.ok(continuation.endsWith(` && ${host}`), result.stderr)
			const directory = spawnSync('/bin/sh', ['-c', `${continuation.slice(0, -host.length)}pwd`], { encoding: 'utf8' })
			assert.equal(directory.status, 0, directory.stderr)
			assert.equal(directory.stdout.trim(), worktree)
			assert.equal(result.stdout.trim(), worktree)
		} finally {
			drop(dir)
		}
	}
})

test('start in a stream writes only its notebook and keeps interrupted intake on that stream', () => {
	const { dir, run } = make_repo()
	try {
		fs.appendFileSync(path.join(dir, 'devlog.md'), '\n---\n\n# → Ask / A-001\n\n+\n')
		run(['add', 'devlog.md'])
		run(['commit', '-m', 'prepare root intake'])
		const worktree = agf.main(['new', 'stream intake'], dir, () => {}).dir
		const notebook = '.agentflow/features/stream-intake/stream-intake.devlog.md'
		const root_before = fs.readFileSync(path.join(worktree, 'devlog.md'))
		const config_before = fs.readFileSync(path.join(worktree, 'ag.json'))
		const args = [path.join(__dirname, 'agf.js'), 'start', '--repo', worktree, '--host', 'codex', '--message-stdin', '--json']
		const result = spawnSync(process.execPath, args, { cwd: worktree, input: 'Inspect this stream.\n', encoding: 'utf8' })
		assert.equal(result.status, 0, result.stderr)
		const output = JSON.parse(result.stdout)
		assert.equal(output.notebook, notebook)
		assert.equal(output.configuration.path, '.agentflow/features/stream-intake/ag.json')
		assert.match(fs.readFileSync(path.join(worktree, notebook), 'utf8'), /\+ Inspect this stream\./)
		assert.deepEqual(fs.readFileSync(path.join(worktree, 'devlog.md')), root_before)
		assert.deepEqual(fs.readFileSync(path.join(worktree, 'ag.json')), config_before)
		const stream_before = fs.readFileSync(path.join(worktree, notebook))
		fs.writeFileSync(path.join(worktree, '.agentflow-start.lock'), 'Agentflow startup lock\npid: 1\n')
		const locked = spawnSync(process.execPath, args, { cwd: worktree, input: 'Do not append while locked.\n', encoding: 'utf8' })
		assert.equal(locked.status, 0, locked.stderr)
		assert.equal(JSON.parse(locked.stdout).notebook, notebook)
		assert.equal(JSON.parse(locked.stdout).message.reason, 'startup_lock_present')
		assert.deepEqual(fs.readFileSync(path.join(worktree, notebook)), stream_before)
		assert.deepEqual(fs.readFileSync(path.join(worktree, 'devlog.md')), root_before)
	} finally {
		drop(dir)
	}
})

test('start refuses a missing stream configuration without falling back to root intake', () => {
	const { dir, run } = make_repo()
	try {
		fs.appendFileSync(path.join(dir, 'devlog.md'), '\n---\n\n# → Ask / A-001\n\n+\n')
		run(['add', 'devlog.md'])
		run(['commit', '-m', 'prepare root intake'])
		const worktree = agf.main(['new', 'missing pair'], dir, () => {}).dir
		const config = path.join(worktree, '.agentflow/features/missing-pair/ag.json')
		fs.renameSync(config, `${config}.saved`)
		const root_before = fs.readFileSync(path.join(worktree, 'devlog.md'))
		const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', worktree, '--host', 'codex', '--message-stdin', '--json'], { cwd: worktree, input: 'Preserve root history.\n', encoding: 'utf8' })
		assert.notEqual(result.status, 0)
		assert.match(result.stderr, /stream.*configuration|configuration.*stream/i)
		assert.deepEqual(fs.readFileSync(path.join(worktree, 'devlog.md')), root_before)
		assert.equal(fs.existsSync(config), false)
	} finally {
		drop(dir)
	}
})

test('new leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['new', 'login page'], dir, () => {})
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('new suffixes the key when the branch already exists', () => {
	const { dir } = make_repo()
	agf.main(['new', 'login page'], dir, () => {})
	const r = agf.main(['new', 'login page'], dir, () => {})
	assert.equal(path.basename(r.dir), 'login-page-2')
	drop(dir)
})

test('two parallel streams get independent adjacent configurations', () => {
	const { dir } = make_repo()
	try {
		const first = agf.main(['new', 'search-page'], dir, () => {}).dir
		const second = agf.main(['new', 'billing-page'], dir, () => {}).dir
		const first_config_path = path.join(first, '.agentflow/features/search-page/ag.json')
		const second_config_path = path.join(second, '.agentflow/features/billing-page/ag.json')
		const root_config_path = path.join(dir, 'ag.json')
		ag_settings.change_configuration(first_config_path, ['auto-reply: on'], { repo_root: first, active_host: 'codex', executables: ['codex', 'claude'] })
		assert.equal(JSON.parse(fs.readFileSync(first_config_path, 'utf8')).switches['auto-reply'], 'on')
		assert.equal(JSON.parse(fs.readFileSync(second_config_path, 'utf8')).switches['auto-reply'], 'off')
		assert.equal(JSON.parse(fs.readFileSync(root_config_path, 'utf8')).switches['auto-reply'], 'off')
	} finally {
		drop(dir)
	}
})

test('new refuses outside a git repository', () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-bare-'))
	const logs = []
	assert.equal(agf.main(['new', 'x'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not a git repository')))
	drop(dir)
})

test('new opens the notebook with AGF_OPEN when set', async () => {
	const { dir } = make_repo()
	const marker_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-marker-')))
	const marker = path.join(marker_dir, 'opened')
	const script = path.join(marker_dir, 'opener.sh')
	fs.writeFileSync(script, `#!/bin/sh\necho "$1" > "${marker}"\n`, { mode: 0o755 })
	process.env.AGF_OPEN = script
	try {
		const r = agf.main(['new', 'test-open'], dir, () => {})
		assert.ok(r.dir)
		for (let attempt = 0; attempt < 40 && !fs.existsSync(marker); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50))
		assert.ok(fs.existsSync(marker), 'AGF_OPEN command was executed')
		const opened = fs.readFileSync(marker, 'utf8').trim()
		assert.ok(opened.includes('test-open.devlog.md'), `notebook path passed to AGF_OPEN: ${opened}`)
	} finally {
		delete process.env.AGF_OPEN
		drop(dir, marker_dir)
	}
})

test('new succeeds even when AGF_OPEN command does not exist', () => {
	const { dir } = make_repo()
	process.env.AGF_OPEN = '/nonexistent/agf-open-command'
	try {
		const r = agf.main(['new', 'test-fail'], dir, () => {})
		assert.ok(r.dir)
	} finally {
		delete process.env.AGF_OPEN
		drop(dir)
	}
})

test('new prints the notebook path on its own line for clickability', () => {
	const { dir } = make_repo()
	const logs = []
	agf.main(['new', 'click-test'], dir, (m) => logs.push(m))
	const doc_path = path.join(dir, '.worktrees', 'click-test', '.agentflow/features', 'click-test', 'click-test.devlog.md')
	assert.ok(logs.includes(doc_path), `expected standalone path line, got: ${logs.join(' | ')}`)
	drop(dir)
})

test('new refuses when run from inside a worktree', () => {
	const { dir } = make_repo()
	const r = agf.main(['new', 'first'], dir, () => {})
	const logs = []
	assert.equal(agf.main(['new', 'second'], r.dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('worktree, not the main checkout')))
	drop(dir)
})

test('new prints usage and stops when no name is given', () => {
	const { dir } = make_repo()
	const logs = []
	assert.equal(agf.main(['new'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs[0].startsWith('usage:'))
	drop(dir)
})

// ----- agf finish -----

test('finish remote preparation integrates the default branch without moving it, then delivers the closing commit', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	run(['push', 'origin', 'main'])
	const remote_default_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const prep_logs = []

	assert.equal(agf.main(['finish', '--prep', 'login-page'], wt, (m) => prep_logs.push(m)), 0)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_default_before)
	assert.ok(run(['branch', '--show-current'], wt).trim() === 'login-page')
	assert.ok(prep_logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	assert.ok(prep_logs.some((line) => line === 'before running agf finish --deliver, push the committed closing record to origin/login-page'))
	assert.ok(prep_logs.some((line) => line.includes('pushed stream branch login-page to origin')))
	assert.equal(run(['status', '--porcelain'], wt).trim(), '')

	close_stream(run, wt, 'login-page')
	const deliver_logs = []
	const delivered = agf.main(['finish', '--deliver'], wt, (m) => deliver_logs.push(m))
	assert.equal(delivered.dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']).trim(), run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0])
	assert.ok(run(['log', '--format=%s', '-3']).includes('devlog: close stream for test'))
	assert.ok(deliver_logs.some((line) => line.includes('delivered origin/main to the main checkout')))
	drop(dir)
})

test('finish local-only preparation and delivery never need a remote', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	const prep_logs = []

	assert.equal(agf.main(['finish', '--prep'], wt, (m) => prep_logs.push(m)), 0)
	assert.ok(prep_logs.some((line) => line.includes('no remote configured — the merge is local only')))
	assert.ok(prep_logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	assert.equal(run(['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'main')
	assert.ok(run(['log', '--format=%s', '-3'], wt).includes('main work'))

	const local_doc = path.join(wt, '.agentflow/features/login-page/login-page.devlog.md')
	fs.writeFileSync(local_doc, fs.readFileSync(local_doc, 'utf8').replace(/^Feature: login-page — active —.*$/m, 'Feature: login-page — closed'))
	run(['add', '.agentflow/features/login-page/login-page.devlog.md'], wt)
	run(['commit', '-m', 'devlog: close local stream'], wt)
	const delivered = agf.main(['finish', '--deliver'], wt, () => {})
	assert.equal(delivered.dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']), run(['rev-parse', 'login-page']))
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir)
})

test('finish preparation never invokes the editor when Git auto-edit is enabled', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	commit_stream_file(run, dir, 'main.txt', 'main\n', 'main work')
	const marker_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-editor-marker-')))
	const marker = path.join(marker_dir, 'editor-ran')
	const editor = path.join(marker_dir, 'marker-editor.sh')
	fs.writeFileSync(editor, `#!/bin/sh\nprintf invoked > ${JSON.stringify(marker)}\nexit 1\n`, { mode: 0o755 })
	const previous_editor = process.env.GIT_EDITOR
	const previous_auto_edit = process.env.GIT_MERGE_AUTOEDIT
	process.env.GIT_EDITOR = editor
	process.env.GIT_MERGE_AUTOEDIT = 'yes'
	try {
		const logs = []
		assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 0)
		assert.ok(logs.some((line) => line === 'phase 1 complete — write the closing round and commit it, then run agf finish --deliver'))
	} finally {
		if (previous_editor === undefined) delete process.env.GIT_EDITOR
		else process.env.GIT_EDITOR = previous_editor
		if (previous_auto_edit === undefined) delete process.env.GIT_MERGE_AUTOEDIT
		else process.env.GIT_MERGE_AUTOEDIT = previous_auto_edit
	}
	assert.equal(fs.existsSync(marker), false, 'the merge editor was not invoked')
	drop(dir, marker_dir)
})

test('finish local delivery rechecks branch and tip after collision work and leaves an unrelated branch unmoved', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_local_stream(run, wt, 'login-page')
	run(['branch', 'side'])
	const side_before = run(['rev-parse', 'side']).trim()
	const main_before = run(['rev-parse', 'main']).trim()
	const wrapper = make_git_wrapper('diff')
	const previous_path = process.env.PATH
	const previous_switch = process.env.AGF_TEST_SWITCH_AFTER
	const logs = []

	process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
	process.env.AGF_TEST_SWITCH_AFTER = 'diff'
	try {
		assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	} finally {
		process.env.PATH = previous_path
		if (previous_switch === undefined) delete process.env.AGF_TEST_SWITCH_AFTER
		else process.env.AGF_TEST_SWITCH_AFTER = previous_switch
	}

	assert.ok(logs.some(line => line.includes('checkout changed during delivery')))
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'main'], { cwd: dir, encoding: 'utf8' }).trim(), main_before)
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'side'], { cwd: dir, encoding: 'utf8' }).trim(), side_before)
	assert.equal(execFileSync(wrapper.real_git, ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim(), 'side')
	drop(dir, wrapper.bin)
})

test('finish local delivery verifies branch and tip after a successful merge before returning stdout', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_local_stream(run, wt, 'login-page')
	run(['branch', 'side'])
	const side_before = run(['rev-parse', 'side']).trim()
	const wrapper = make_git_wrapper('merge')
	const previous_path = process.env.PATH
	const previous_switch = process.env.AGF_TEST_SWITCH_AFTER
	const logs = []

	process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
	process.env.AGF_TEST_SWITCH_AFTER = 'merge'
	let result
	try {
		result = agf.main(['finish', '--deliver'], wt, (message) => logs.push(message))
	} finally {
		process.env.PATH = previous_path
		if (previous_switch === undefined) delete process.env.AGF_TEST_SWITCH_AFTER
		else process.env.AGF_TEST_SWITCH_AFTER = previous_switch
	}

	assert.equal(result, 1)
	assert.ok(logs.some(line => line.includes('post-success checkout verification failed')))
	assert.equal(execFileSync(wrapper.real_git, ['branch', '--show-current'], { cwd: dir, encoding: 'utf8' }).trim(), 'side')
	assert.equal(execFileSync(wrapper.real_git, ['rev-parse', 'side'], { cwd: dir, encoding: 'utf8' }).trim(), side_before)
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir, wrapper.bin)
})

test('finish accepts a subdirectory of the matching registered worktree', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const subdir = path.join(wt, 'src', 'nested')
	fs.mkdirSync(subdir, { recursive: true })
	const logs = []

	assert.equal(agf.main(['finish', '--prep'], subdir, (m) => logs.push(m)), 0)
	assert.ok(logs.some((line) => line.includes('phase 1 complete')))
	assert.equal(run(['branch', '--show-current'], wt).trim(), 'login-page')
	drop(dir)
})

test('finish rejects the main checkout, mismatched worktree key, and dirty worktree before mutation', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const before = run(['rev-parse', 'HEAD'])
	const main_logs = []
	assert.equal(agf.main(['finish', '--prep', 'login-page'], dir, (m) => main_logs.push(m)), 1)
	assert.ok(main_logs.some((line) => line.includes('only inside a .worktrees')))
	assert.equal(run(['rev-parse', 'HEAD']), before)

	const mismatch_logs = []
	assert.equal(agf.main(['finish', '--prep', 'other-page'], wt, (m) => mismatch_logs.push(m)), 1)
	assert.ok(mismatch_logs.some((line) => line.includes('does not match the current worktree')))
	assert.equal(run(['rev-parse', 'HEAD']), before)

	fs.writeFileSync(path.join(wt, 'untracked.txt'), 'not committed\n')
	const dirty_logs = []
	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => dirty_logs.push(m)), 1)
	assert.ok(dirty_logs.some((line) => line.includes('has unsaved changes')))
	assert.equal(run(['rev-parse', 'HEAD']), before)
	assert.ok(fs.existsSync(path.join(wt, 'untracked.txt')))
	drop(dir)
})

test('finish rejects extra and ambiguous forms before inspecting a repository', () => {
	for (const argv of [
		['finish', '--prep', 'one', 'two'],
		['finish', '--prep', '--deliver'],
		['finish', '--force'],
		['finish'],
	]) {
		const logs = []
		assert.equal(agf.main(argv, '/tmp', (m) => logs.push(m)), 1)
		assert.ok(logs.length > 0)
		assert.equal(logs.join('\n').includes('not a git repository'), false)
	}
})

test('finish delivery stops after a rejected default-branch push and leaves stdout to the executable boundary', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	const main_before = run(['rev-parse', 'main'])

	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
	const logs = []
	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => logs.push(m)), 1)
	assert.ok(logs.some((line) => line.includes('delivery push failed; origin rejected the update')))
	assert.ok(logs.some((line) => line.includes('open a pull request from the stream branch')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir, bare)
})

test('finish process channels keep preparation stdout empty and successful delivery stdout to the main directory', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const script = path.join(__dirname, 'agf.js')

	const prep = spawnSync(process.execPath, [script, 'finish', '--prep'], { cwd: wt, encoding: 'utf8' })
	assert.equal(prep.status, 0)
	assert.equal(prep.stdout, '')
	assert.match(prep.stderr, /phase 1 complete/)

	close_stream(run, wt, 'login-page')
	const deliver = spawnSync(process.execPath, [script, 'finish', '--deliver'], { cwd: wt, encoding: 'utf8' })
	assert.equal(deliver.status, 0)
	assert.equal(deliver.stdout, `${dir}\n`)
	assert.doesNotMatch(deliver.stderr, new RegExp(`${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`))
	drop(dir)
})

test('finish remote delivery updates origin before refusing a mismatched main checkout branch', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	run(['switch', '-c', 'side'])
	const side_before = run(['rev-parse', 'HEAD'])
	const stream_tip = run(['rev-parse', 'login-page'], wt).trim()
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (m) => logs.push(m)), 1)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], stream_tip)
	assert.equal(run(['rev-parse', 'HEAD']), side_before)
	assert.equal(run(['branch', '--show-current']).trim(), 'side')
	assert.ok(logs.some((line) => line.includes('remote default branch was updated but the main checkout was not')))
	assert.ok(logs.some((line) => line.includes('recover with:')))
	drop(dir)
})

test('finish remote delivery refuses a stream tip movement before the default-ref push', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const unvalidated_tip = make_unvalidated_tip(run, wt, 'login-page', validated_tip)
	const remote_main_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const wrapper = make_git_wrapper('stream-head')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_MOVE_STREAM_AFTER: 'stream-head',
			AGF_TEST_UNVALIDATED_TIP: unvalidated_tip,
			AGF_TEST_STREAM_KEY: 'login-page',
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /stream worktree changed before default-ref/)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.notEqual(remote_main_before, unvalidated_tip)
	drop(dir, bare, wrapper.bin)
})

test('finish local delivery refuses a stream tip movement before the default-ref merge', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const unvalidated_tip = make_unvalidated_tip(run, wt, 'login-page', validated_tip)
	const main_before = run(['rev-parse', 'main'])
	const wrapper = make_git_wrapper('stream-head')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_MOVE_STREAM_AFTER: 'stream-head',
			AGF_TEST_UNVALIDATED_TIP: unvalidated_tip,
			AGF_TEST_STREAM_KEY: 'login-page',
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /stream worktree changed before default-ref mutation/)
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.notEqual(main_before, unvalidated_tip)
	drop(dir, wrapper.bin)
})

test('finish preparation aborts remote and local conflicts without moving the default branch', () => {
	const remote_case = make_repo({ remote: true })
	const remote_wt = open_stream(remote_case.dir, 'login page')
	commit_stream_file(remote_case.run, remote_wt, 'shared.txt', 'stream\n')
	commit_stream_file(remote_case.run, remote_case.dir, 'shared.txt', 'main\n', 'main conflict')
	remote_case.run(['push', 'origin', 'main'])
	const remote_main_before = remote_case.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const remote_logs = []

	assert.equal(agf.main(['finish', '--prep'], remote_wt, (m) => remote_logs.push(m)), 1)
	assert.ok(remote_logs.some((line) => line.includes('merging origin/main into "login-page" failed')))
	assert.ok(remote_logs.some((line) => line.includes('the merge was aborted')))
	assert.equal(remote_case.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.equal(remote_case.run(['status', '--porcelain'], remote_wt).trim(), '')
	assert.notEqual(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: remote_wt }).status, 0)
	assert.equal(fs.readFileSync(path.join(remote_wt, 'shared.txt'), 'utf8'), 'stream\n')
	drop(remote_case.dir)

	const local_case = make_repo()
	const local_wt = open_stream(local_case.dir, 'login page')
	commit_stream_file(local_case.run, local_wt, 'shared.txt', 'stream\n')
	commit_stream_file(local_case.run, local_case.dir, 'shared.txt', 'main\n', 'main conflict')
	const local_main_before = local_case.run(['rev-parse', 'main'])
	const local_logs = []

	assert.equal(agf.main(['finish', '--prep'], local_wt, (m) => local_logs.push(m)), 1)
	assert.ok(local_logs.some((line) => line.includes('merging main into "login-page" failed')))
	assert.ok(local_logs.some((line) => line.includes('the merge was aborted')))
	assert.equal(local_case.run(['rev-parse', 'main']), local_main_before)
	assert.equal(local_case.run(['status', '--porcelain'], local_wt).trim(), '')
	assert.notEqual(spawnSync('git', ['rev-parse', '-q', '--verify', 'MERGE_HEAD'], { cwd: local_wt }).status, 0)
	assert.equal(fs.readFileSync(path.join(local_wt, 'shared.txt'), 'utf8'), 'stream\n')
	drop(local_case.dir)
})

test('finish refuses staged, unstaged, and untracked work for both phases without committing it', () => {
	for (const kind of ['staged', 'unstaged', 'untracked']) {
		const { dir, run } = make_repo()
		const wt = open_stream(dir, 'login page')
		const file = path.join(wt, `${kind}.txt`)
		fs.writeFileSync(file, `${kind}\n`)
		if (kind === 'staged') run(['add', path.basename(file)], wt)
		const stream_before = run(['rev-parse', 'HEAD'], wt)
		const main_before = run(['rev-parse', 'main'])

		for (const phase of ['--prep', '--deliver']) {
			const logs = []
			assert.equal(agf.main(['finish', phase], wt, (m) => logs.push(m)), 1)
			assert.ok(logs.some((line) => line.includes('has unsaved changes')))
			assert.equal(run(['rev-parse', 'HEAD'], wt), stream_before)
			assert.equal(run(['rev-parse', 'main']), main_before)
		}

		assert.ok(fs.existsSync(file))
		drop(dir)
	}
})

test('finish preparation and delivery are repeatable no-ops after their first success', () => {
	const { dir, run } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const remote_main_before = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]

	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	const prepared_tip = run(['rev-parse', 'HEAD'], wt)
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	assert.equal(run(['rev-parse', 'HEAD'], wt), prepared_tip)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)

	close_stream(run, wt, 'login-page')
	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	const delivered_tip = run(['rev-parse', 'HEAD'])
	const remote_main_after = run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	assert.equal(run(['rev-parse', 'HEAD']), delivered_tip)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_after)
	drop(dir)
})

test('finish delivery requires a fixed tracked closing marker before moving the default branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('fixed stream-state marker')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir)
})

test('finish delivery validates original committed notebook bytes and rejects normalized marker forms', () => {
	const key = 'login-page'
	const marker = `Feature: ${key} — closed`
	const variants = [
		['embedded carriage return', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl\rosed`))],
		['NUL', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl\u0000osed`))],
		['escape', (valid) => Buffer.from(valid.replace(marker, `Feature: ${key} — cl${String.fromCharCode(27)}osed`))],
		['invalid UTF-8', (valid) => {
			const source = Buffer.from(valid)
			const needle = Buffer.from('closed')
			const position = source.indexOf(needle)
			assert.notEqual(position, -1)
			return Buffer.concat([source.subarray(0, position), Buffer.from([0xc3, 0x28]), source.subarray(position + needle.length)])
		}],
		['duplicate marker', (valid) => Buffer.from(`${valid}${marker}\n`)],
		['lone carriage return normalized marker', (valid) => Buffer.from(valid.replace(`${marker}\n`, `${marker}\r`))],
		['mixed line endings', (valid) => Buffer.from(valid.replace('\n', '\r\n'))],
	]

	for (const [label, make_bytes] of variants) {
		const { dir, run } = make_repo()
		const wt = open_stream(dir, 'login page')
		const doc = path.join(wt, '.agentflow/features', key, `${key}.devlog.md`)
		const opened = fs.readFileSync(doc, 'utf8')
		const valid = opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), marker)
		assert.notEqual(valid, opened)
		commit_notebook_bytes(run, wt, key, make_bytes(valid), `reject ${label}`)
		const main_before = run(['rev-parse', 'main'])
		const logs = []

		assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1, label)
		assert.ok(logs.some((line) => line.includes('fixed stream-state marker')), label)
		assert.equal(run(['rev-parse', 'main']), main_before, label)
		assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })), label)
		drop(dir)
	}
})

test('finish delivery accepts consistently formed CRLF committed notebook bytes', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const doc = path.join(wt, '.agentflow/features/login-page/login-page.devlog.md')
	const opened = fs.readFileSync(doc, 'utf8')
	const closed = opened.replace(/^Feature: login-page — active —.*$/m, 'Feature: login-page — closed').replace(/\n/g, '\r\n')
	commit_notebook_bytes(run, wt, 'login-page', Buffer.from(closed), 'CRLF closing notebook')

	assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
	assert.equal(run(['rev-parse', 'main']), run(['rev-parse', 'HEAD'], wt))
	assert.ok(!fs.existsSync(agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })))
	drop(dir)
})

test('finish delivery refuses a pre-existing Agentflow delivery lock without mutation', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const owner_record = 'pid: 12345\nrepository: recovery-test\n'
	fs.writeFileSync(lock, owner_record, { mode: 0o600 })
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some(line => line.includes(lock)))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.equal(fs.readFileSync(lock, 'utf8'), owner_record)
	drop(dir)
})

test('finish delivery preserves a replacement lock and emits no directory stdout', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const validated_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const replacement = 'replacement owner\n'
	const wrapper = make_git_wrapper('merge')
	const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'finish', '--deliver'], {
		cwd: wt,
		encoding: 'utf8',
		env: {
			...process.env,
			PATH: `${wrapper.bin}${path.delimiter}${process.env.PATH}`,
			AGF_TEST_REPLACE_LOCK_AFTER: 'merge',
			AGF_TEST_LOCK_PATH: lock,
		},
	})

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /lock pathname no longer refers to the acquired lock/)
	assert.match(result.stderr, /lifecycle cleanup did not complete/)
	assert.equal(fs.readFileSync(lock, 'utf8'), replacement)
	assert.equal(run(['rev-parse', 'main']).trim(), validated_tip)
	drop(dir, wrapper.bin)
})

test('finish delivery reports truthful partial state when lock unlink fails after Git delivery', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const delivered_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const lock = agf.delivery_lock_path({ git_common_dir: path.join(dir, '.git') })
	const child = [
		"const fs = require('node:fs')",
		`const lock = ${JSON.stringify(lock)}`,
		"const unlink = fs.unlinkSync",
		"fs.unlinkSync = (target) => target === lock ? (() => { throw new Error('forced lock release failure') })() : unlink(target)",
		`const agf = require(${JSON.stringify(path.join(__dirname, 'agf.js'))})`,
		"const result = agf.main(['finish', '--deliver'], process.cwd(), (message) => process.stderr.write(message + '\\n'))",
		"if (typeof result === 'number') process.exitCode = result; else process.stdout.write(result.dir + '\\n')",
	].join('\n')
	const result = spawnSync(process.execPath, ['-e', child], { cwd: wt, encoding: 'utf8' })

	assert.equal(result.status, 1)
	assert.equal(result.stdout, '')
	assert.match(result.stderr, /Git delivery status: remote default-ref delivery was not configured; local main-checkout delivery completed/)
	assert.match(result.stderr, /lifecycle cleanup did not complete/)
	assert.equal(run(['rev-parse', 'main']).trim(), delivered_tip)
	assert.ok(fs.existsSync(lock), 'failed release leaves the owned lock for recovery')
	drop(dir)
})

test('finish delivery rejects a closing commit that was not pushed to origin', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_local_stream(run, wt, 'login-page')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('origin/login-page to equal the current stream HEAD')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	drop(dir, bare)
})

test('finish delivery refuses ignored, untracked-ancestor, and no-op cache collisions', () => {
	const ignored_case = make_repo()
	const ignored_wt = open_stream(ignored_case.dir, 'login page')
	commit_stream_file(ignored_case.run, ignored_wt, 'private.txt', 'feature data\n')
	fs.appendFileSync(path.join(ignored_case.dir, '.gitignore'), 'private.txt\n')
	ignored_case.run(['add', '.gitignore'])
	ignored_case.run(['commit', '-m', 'ignore local file'])
	assert.equal(agf.main(['finish', '--prep'], ignored_wt, () => {}), 0)
	close_local_stream(ignored_case.run, ignored_wt, 'login-page')
	fs.writeFileSync(path.join(ignored_case.dir, 'private.txt'), 'local secret\n')
	const ignored_before = ignored_case.run(['rev-parse', 'main'])
	const ignored_logs = []
	assert.equal(agf.main(['finish', '--deliver'], ignored_wt, (message) => ignored_logs.push(message)), 1)
	assert.ok(ignored_logs.some((line) => line.includes('untracked or ignored entry at "private.txt"')))
	assert.equal(ignored_case.run(['rev-parse', 'main']), ignored_before)
	assert.equal(fs.readFileSync(path.join(ignored_case.dir, 'private.txt'), 'utf8'), 'local secret\n')
	assert.ok(fs.existsSync(ignored_wt))
	drop(ignored_case.dir)

	const ancestor_case = make_repo()
	const ancestor_wt = open_stream(ancestor_case.dir, 'login page')
	commit_stream_file(ancestor_case.run, ancestor_wt, 'nested/value.txt', 'feature data\n')
	assert.equal(agf.main(['finish', '--prep'], ancestor_wt, () => {}), 0)
	close_local_stream(ancestor_case.run, ancestor_wt, 'login-page')
	fs.writeFileSync(path.join(ancestor_case.dir, 'nested'), 'local file ancestor\n')
	const ancestor_logs = []
	assert.equal(agf.main(['finish', '--deliver'], ancestor_wt, (message) => ancestor_logs.push(message)), 1)
	assert.ok(ancestor_logs.some((line) => line.includes('untracked or ignored entry at "nested"')))
	assert.equal(fs.readFileSync(path.join(ancestor_case.dir, 'nested'), 'utf8'), 'local file ancestor\n')
	assert.ok(fs.existsSync(ancestor_wt))
	drop(ancestor_case.dir)

	const cache_case = make_repo()
	const cache_wt = open_stream(cache_case.dir, 'login page')
	commit_stream_file(cache_case.run, cache_wt, 'safe.txt', 'feature data\n')
	fs.appendFileSync(path.join(cache_case.dir, '.gitignore'), 'node_modules/\n')
	cache_case.run(['add', '.gitignore'])
	cache_case.run(['commit', '-m', 'ignore dependency cache'])
	assert.equal(agf.main(['finish', '--prep'], cache_wt, () => {}), 0)
	close_local_stream(cache_case.run, cache_wt, 'login-page')
	fs.mkdirSync(path.join(cache_case.dir, 'node_modules', 'cache'), { recursive: true })
	fs.writeFileSync(path.join(cache_case.dir, 'node_modules', 'cache', 'state'), 'cache\n')
	assert.equal(agf.main(['finish', '--deliver'], cache_wt, () => {}).dir, cache_case.dir)
	assert.ok(fs.existsSync(path.join(cache_case.dir, 'safe.txt')))
	drop(cache_case.dir)
})

test('finish remote delivery reports a partial result when the main checkout has an ignored collision', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'private.txt', 'feature data\n')
	fs.appendFileSync(path.join(dir, '.gitignore'), 'private.txt\n')
	run(['add', '.gitignore'])
	run(['commit', '-m', 'ignore local file'])
	run(['push', 'origin', 'main'])
	assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
	close_stream(run, wt, 'login-page')
	fs.writeFileSync(path.join(dir, 'private.txt'), 'local secret\n')
	const main_before = run(['rev-parse', 'main'])
	const stream_tip = run(['rev-parse', 'HEAD'], wt).trim()
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.equal(run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], stream_tip)
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(fs.existsSync(wt))
	assert.ok(logs.some((line) => line.includes('remote default branch was updated but the main checkout was not')))
	assert.ok(logs.some((line) => line.includes('untracked or ignored entry at "private.txt"')))
	drop(dir, bare)
})

test('finish recovery commands quote metacharacter-bearing default refs', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const weird = 'main;echo$PWNED' + String.fromCharCode(96) + 'id' + String.fromCharCode(96) + "'q"
	run(['branch', '-m', weird])
	run(['push', 'origin', 'HEAD:' + weird])
	run(['remote', 'set-head', 'origin', weird])
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	close_stream(run, wt, 'login-page')
	run(['switch', '-c', 'side'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes("switch 'main;echo$PWNED")))
	assert.ok(logs.some((line) => line.includes("merge --ff-only 'origin/main;echo$PWNED")))
	assert.ok(logs.some((line) => line.includes("'\\''q'")))
	drop(dir, bare)
})

test('cleanup recovery commands quote a spaced repository and metacharacter-bearing default ref', () => {
	const { dir, run, bare } = make_repo({ remote: true, prefix: 'agf recovery ' })
	const weird = 'main;echo$PWNED' + String.fromCharCode(96) + 'id' + String.fromCharCode(96) + "'q"
	run(['branch', '-m', weird])
	run(['push', 'origin', 'HEAD:' + weird])
	run(['remote', 'set-head', 'origin', weird])
	open_stream(dir, 'login page')
	run(['switch', '-c', 'side'])
	const logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], dir, (message) => logs.push(message)), 1)
	const recovery = logs.find(line => line.includes('get there with:'))
	assert.ok(recovery)
	assert.ok(recovery.includes(`cd ${shell_quote(dir)} && git switch ${shell_quote(weird)}`), recovery)
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'), 'nothing was deleted')
	drop(dir, bare)
})

test('finish delivery rejects a tracked notebook symlink before moving the default branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const target_dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-symlink-target-')))
	const target = path.join(target_dir, 'closed-marker.md')
	const doc = path.join(wt, '.agentflow/features/login-page/login-page.devlog.md')
	fs.writeFileSync(target, 'Feature: login-page — closed\n')
	fs.unlinkSync(doc)
	fs.symlinkSync(target, doc)
	run(['add', doc], wt)
	run(['commit', '-m', 'test tracked notebook symlink'], wt)
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['finish', '--deliver'], wt, (message) => logs.push(message)), 1)
	assert.ok(logs.some(line => line.includes('regular committed file')))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(fs.lstatSync(doc).isSymbolicLink())
	drop(dir, target_dir)
})

test('Git diagnostics remove terminal data and URL userinfo', () => {
	const esc = String.fromCharCode(27)
	const bell = String.fromCharCode(7)
	const raw = esc + '[31mremote ' + esc + ']0;title' + bell + 'https://user:secret@example.test/repo' + esc + '[0m'
	assert.equal(agf.sanitize_diagnostic(raw), 'remote https://[redacted]@example.test/repo')
})

test('public Git timeout accepts a value above the legacy cap and wins over the test override', () => {
	const previous_public = process.env.AGF_GIT_TIMEOUT_MS
	const previous_test = process.env.AGF_TEST_GIT_TIMEOUT_MS
	try {
		process.env.AGF_GIT_TIMEOUT_MS = '60000'
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '7'
		assert.equal(agf.git_timeout_ms(), 60000)
	} finally {
		if (previous_public === undefined) delete process.env.AGF_GIT_TIMEOUT_MS
		else process.env.AGF_GIT_TIMEOUT_MS = previous_public
		if (previous_test === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous_test
	}
})

test('invalid public Git timeout values fall back while the test override remains compatible', () => {
	const previous_public = process.env.AGF_GIT_TIMEOUT_MS
	const previous_test = process.env.AGF_TEST_GIT_TIMEOUT_MS
	try {
		delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		for (const value of ['', '0', '-1', '12.5', 'not-a-number']) {
			process.env.AGF_GIT_TIMEOUT_MS = value
			assert.equal(agf.git_timeout_ms(), 30000, `invalid public value ${JSON.stringify(value)}`)
		}
		process.env.AGF_GIT_TIMEOUT_MS = 'not-a-number'
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '7'
		assert.equal(agf.git_timeout_ms(), 7)
	} finally {
		if (previous_public === undefined) delete process.env.AGF_GIT_TIMEOUT_MS
		else process.env.AGF_GIT_TIMEOUT_MS = previous_public
		if (previous_test === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous_test
	}
})

test('configured Git timeout stays scoped to each repository and stream', () => {
	const first = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-timeout-first-')))
	const second = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-timeout-second-')))
	const previous_public = process.env.AGF_GIT_TIMEOUT_MS
	const previous_test = process.env.AGF_TEST_GIT_TIMEOUT_MS
	try {
		delete process.env.AGF_GIT_TIMEOUT_MS
		delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		for (const [repo, timeout] of [[first, 11000], [second, 22000]]) {
			fs.mkdirSync(path.join(repo, '.git'))
			const config = ag_settings.make_template('codex')
			config.switches['git-timeout-ms'] = timeout
			fs.writeFileSync(path.join(repo, 'ag.json'), `${JSON.stringify(config, null, 2)}\n`)
		}
		assert.equal(agf.git_timeout_ms(first), 11000)
		assert.equal(agf.git_timeout_ms(path.join(first, 'nested')), 11000)
		assert.equal(agf.git_timeout_ms(second), 22000)
		process.env.AGF_GIT_TIMEOUT_MS = '55000'
		assert.equal(agf.git_timeout_ms(first), 55000)
		process.env.AGF_GIT_TIMEOUT_MS = 'invalid'
		assert.equal(agf.git_timeout_ms(first), 11000)
		delete process.env.AGF_GIT_TIMEOUT_MS
		const independent = path.join(first, 'independent')
		fs.mkdirSync(path.join(independent, '.git'), { recursive: true })
		assert.equal(agf.git_timeout_ms(independent), 30000)

		const stream = path.join(first, '.worktrees', 'search-page')
		fs.mkdirSync(path.join(stream, '.agentflow', 'features', 'search-page'), { recursive: true })
		fs.writeFileSync(path.join(stream, '.git'), 'gitdir: ../.git/worktrees/search-page\n')
		fs.copyFileSync(path.join(first, 'ag.json'), path.join(stream, 'ag.json'))
		const stream_config = ag_settings.make_template('codex')
		stream_config.switches['git-timeout-ms'] = 33000
		fs.writeFileSync(path.join(stream, '.agentflow', 'features', 'search-page', 'ag.json'), `${JSON.stringify(stream_config, null, 2)}\n`)
		assert.equal(agf.git_timeout_ms(stream), 33000)
		fs.renameSync(path.join(stream, '.agentflow'), path.join(stream, 'work..space'))
		const bootstrap = JSON.parse(fs.readFileSync(path.join(stream, 'ag.json'), 'utf8'))
		bootstrap.switches['workspace-dir'] = 'work..space'
		fs.writeFileSync(path.join(stream, 'ag.json'), JSON.stringify(bootstrap))
		assert.equal(agf.git_timeout_ms(stream), 33000, 'valid custom workspace names use their stream timeout')
	} finally {
		if (previous_public === undefined) delete process.env.AGF_GIT_TIMEOUT_MS
		else process.env.AGF_GIT_TIMEOUT_MS = previous_public
		if (previous_test === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous_test
		fs.rmSync(first, { recursive: true, force: true })
		fs.rmSync(second, { recursive: true, force: true })
	}
})

test('CLI diagnostics remove carriage-return overwrite text while preserving line feeds', () => {
	const raw = 'trusted status\rOVERWRITE\nnext line'
	const sanitized = agf.sanitize_diagnostic(raw)

	assert.equal(sanitized, 'trusted statusOVERWRITE\nnext line')
	assert.doesNotMatch(sanitized, /\r/)
})

test('network Git failures use fixed diagnostics without child stderr', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nprintf \"\\\\033[31mhttps://user:secret@example.test/repo\\\\033]0;title\\\\007\\\\n\" >&2\nexit 1\n', { mode: 0o755 })
	const logs = []

	assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 1)
	const text = logs.join('\n')
	assert.match(text, /stream push failed/)
	assert.doesNotMatch(text, /secret|example\.test|\u001b/)
	drop(dir, bare)
})

test('Git timeout override can lower the deadline but cannot raise the thirty-second cap', () => {
	const previous = process.env.AGF_TEST_GIT_TIMEOUT_MS
	try {
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '999999'
		assert.equal(agf.git_timeout_ms(), 30000)
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '7'
		assert.equal(agf.git_timeout_ms(), 7)
	} finally {
		if (previous === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous
	}
})

test('the internal timeout override is ignored outside an explicit test context', () => {
	const previous_context = process.env.AGF_TEST_CONTEXT
	const previous_test = process.env.AGF_TEST_GIT_TIMEOUT_MS
	const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-timeout-isolation-')))
	try {
		delete process.env.AGF_TEST_CONTEXT
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '7'
		fs.mkdirSync(path.join(repo, '.git'))
		const config = ag_settings.make_template('codex')
		config.switches['git-timeout-ms'] = 11000
		fs.writeFileSync(path.join(repo, 'ag.json'), `${JSON.stringify(config)}\n`)
		assert.equal(agf.git_timeout_ms(repo), 11000)
	} finally {
		if (previous_context === undefined) delete process.env.AGF_TEST_CONTEXT
		else process.env.AGF_TEST_CONTEXT = previous_context
		if (previous_test === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous_test
		fs.rmSync(repo, { recursive: true, force: true })
	}
})

test('Git timeout reports an unknown push result without claiming no mutation', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	commit_stream_file(run, wt, 'feature.txt', 'feature\n')
	const hook = path.join(bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nsleep 1\nexit 0\n', { mode: 0o755 })
	const previous = process.env.AGF_TEST_GIT_TIMEOUT_MS
	const logs = []
	try {
		process.env.AGF_TEST_GIT_TIMEOUT_MS = '50'
		assert.equal(agf.main(['finish', '--prep'], wt, (message) => logs.push(message)), 1)
	} finally {
		if (previous === undefined) delete process.env.AGF_TEST_GIT_TIMEOUT_MS
		else process.env.AGF_TEST_GIT_TIMEOUT_MS = previous
	}
	const text = logs.join('\n')
	assert.match(text, /timed out after 50ms/)
	assert.match(text, /result is unknown/)
	assert.doesNotMatch(text, /default branch was not changed|stream branch is unchanged/)
	drop(dir, bare)
})

// ----- agf clean -----

test('cleanup merges the stream, removes the folder and deletes the branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)

	const logs = []
	const r = agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))

	assert.equal(r.dir, dir)
	assert.ok(fs.existsSync(path.join(dir, 'app.txt')), 'the feature landed on main')
	assert.ok(!fs.existsSync(wt), 'the worktree folder is gone')
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.ok(logs.some((l) => l.includes('merged "login-page" into main')))
	assert.ok(logs.some((l) => l.includes('main notebook devlog.md was NOT written')))
	drop(dir)
})

test('cleanup keeps the feature notebook as the record', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(fs.existsSync(path.join(dir, '.agentflow/features', 'login-page', 'login-page.devlog.md')))
	assert.ok(logs.some((l) => l.includes('.agentflow/features/login-page/login-page.devlog.md')))
	drop(dir)
})

test('cleanup preserves the worktree used by the running host and redirects cleanup to main', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const main_before = run(['rev-parse', 'main'])
	const logs = []

	assert.equal(agf.main(['cleanup'], wt, (message) => logs.push(message)), 1)
	assert.ok(fs.existsSync(wt))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.equal(run(['rev-parse', 'main']), main_before)
	assert.ok(logs.some((line) => line.includes('still using')))
	assert.ok(logs.some((line) => line.includes(`cd ${shell_quote(dir)} && agf cleanup ${shell_quote('login-page')}`)))
	drop(dir)
})

test('cleanup refuses when the main folder is on another branch', () => {
	const { dir, run } = make_repo()
	open_stream(dir, 'login page')
	run(['switch', '-c', 'side'])
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('on branch "side", not "main"')))
	assert.ok(logs.some((l) => l.includes("git switch 'main'")))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'), 'nothing was deleted')
	drop(dir)
})

test('cleanup refuses an unknown name and shows the closest ones', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-pag'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('no feature called "login-pag"')))
	assert.ok(logs.some((l) => l.includes('did you mean: login-page')))
	drop(dir)
})

test('cleanup refuses to sweep a worktree with unsaved work in it', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'half-done.txt'), 'not saved yet\n')
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('still has unsaved changes')))
	assert.ok(fs.existsSync(wt), 'the folder is untouched')
	drop(dir)
})

for (const timing of ['before cleanup', 'after merge']) test(`cleanup preserves ignored worktree files added ${timing}`, () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	try {
		fs.writeFileSync(path.join(wt, '.gitignore'), 'private/\n')
		run(['add', '.gitignore'], wt)
		run(['commit', '-m', 'ignore private files'], wt)
		run(['push', 'origin', 'login-page'], wt)
		const before = run(['rev-parse', 'login-page']).trim()
		const saved = path.join(wt, 'private', 'notes.txt')
		const write = () => {
			fs.mkdirSync(path.dirname(saved), { recursive: true })
			fs.writeFileSync(saved, 'unsaved private work\n')
		}
		if (timing === 'before cleanup') write()
		const result = agf.main(['cleanup', 'login-page'], dir, message => {
			if (timing === 'after merge' && message.includes('merged "login-page"')) write()
		})
		assert.equal(result, 1)
		assert.equal(fs.readFileSync(saved, 'utf8'), 'unsaved private work\n')
		assert.equal(run(['rev-parse', 'login-page']).trim(), before)
		assert.equal(run(['rev-parse', 'refs/heads/login-page'], bare).trim(), before)
	} finally { drop(dir, bare) }
})

test('cleanup undoes the merge and deletes nothing when the branch conflicts', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'shared.txt'), 'the feature version\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature side'], wt)
	fs.writeFileSync(path.join(dir, 'shared.txt'), 'the main version\n')
	run(['add', '-A'])
	run(['commit', '-m', 'main side'])

	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('hit a conflict')))
	assert.equal(run(['status', '--porcelain']).trim(), '', 'the merge was undone')
	assert.ok(fs.existsSync(wt), 'nothing was deleted')
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(dir)
})

test('cleanup runs only the sweeping-up on an already merged stream', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	run(['merge', '--no-ff', 'login-page', '-m', 'merged by hand'])
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(logs.some((l) => l.includes('was already merged')))
	assert.ok(!fs.existsSync(wt))
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	drop(dir)
})

test('cleanup pushes the merge and deletes the branch on the server', () => {
	const { dir, run, bare } = make_repo({ remote: true })
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))
	assert.ok(logs.some((l) => l.includes('pushed main to origin')))
	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	assert.ok(run(['ls-remote', '--heads', 'origin', 'main']).includes('main'))
	drop(dir, bare)
})

test('cleanup pushes the validated default branch to origin despite ambient push routing', () => {
	const fixture = make_repo({ remote: true })
	const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-cleanup-other-')))
	try {
		execFileSync('git', ['init', '--bare', '-b', 'main'], { cwd: other })
		fixture.run(['remote', 'add', 'other', other])
		fixture.run(['config', 'branch.main.pushRemote', 'other'])
		open_stream(fixture.dir, 'login page')
		const logs = []
		assert.equal(agf.main(['cleanup', 'login-page'], fixture.dir, message => logs.push(message)).dir, fixture.dir)
		assert.ok(fixture.run(['ls-remote', 'origin', 'refs/heads/main']).trim())
		const other_main = spawnSync('git', ['show-ref', '--verify', 'refs/heads/main'], { cwd: other, encoding: 'utf8' })
		assert.notEqual(other_main.status, 0)
	} finally {
		drop(fixture.dir, fixture.bare, other)
	}
})

test('cleanup refuses remote-ahead stream work before deleting its branch', () => {
	const fixture = make_repo({ remote: true })
	const other = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-cleanup-remote-ahead-')))
	try {
		const wt = open_stream(fixture.dir, 'login page')
		commit_stream_file(fixture.run, wt, 'feature.txt', 'local feature\n')
		fixture.run(['push', 'origin', 'HEAD:login-page'], wt)
		execFileSync('git', ['clone', '-q', fixture.bare, other])
		execFileSync('git', ['config', 'user.email', 'remote@example.invalid'], { cwd: other })
		execFileSync('git', ['config', 'user.name', 'remote'], { cwd: other })
		execFileSync('git', ['switch', '-q', 'login-page'], { cwd: other })
		fs.writeFileSync(path.join(other, 'remote-only.txt'), 'remote feature\n')
		execFileSync('git', ['add', '.'], { cwd: other })
		execFileSync('git', ['commit', '-qm', 'remote feature'], { cwd: other })
		execFileSync('git', ['push', '-q', 'origin', 'HEAD:login-page'], { cwd: other })
		const logs = []
		assert.equal(agf.main(['cleanup', 'login-page'], fixture.dir, message => logs.push(message)), 1)
		assert.match(logs.join('\n'), /remote|ahead|changed|integrat/i)
		assert.ok(fs.existsSync(wt))
		assert.ok(fixture.run(['ls-remote', 'origin', 'refs/heads/login-page']).trim())
	} finally {
		drop(fixture.dir, fixture.bare, other)
	}
})

test('cleanup refuses an ignored destination collision before merging a stream', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	try {
		fs.appendFileSync(path.join(dir, '.gitignore'), 'collision.txt\n')
		run(['add', '.gitignore'])
		run(['commit', '-m', 'ignore collision path'])
		fs.writeFileSync(path.join(dir, 'collision.txt'), 'local ignored bytes\n')
		fs.writeFileSync(path.join(wt, 'collision.txt'), 'incoming tracked bytes\n')
		run(['add', '-f', 'collision.txt'], wt)
		run(['commit', '-m', 'feature collision'], wt)
		const before = fs.readFileSync(path.join(dir, 'collision.txt'), 'utf8')
		const logs = []
		assert.equal(agf.main(['cleanup', 'login-page'], dir, message => logs.push(message)), 1)
		assert.match(logs.join('\n'), /ignored|collision|nothing was swept/i)
		assert.equal(fs.readFileSync(path.join(dir, 'collision.txt'), 'utf8'), before)
		assert.ok(fs.existsSync(wt))
	} finally {
		drop(dir)
	}
})

test('cleanup stops before sweeping when fetch or default-branch push fails', () => {
	const rejected = make_repo({ remote: true })
	const rejected_wt = open_stream(rejected.dir, 'login page')
	commit_stream_file(rejected.run, rejected_wt, 'app.txt', 'feature\n')
	const hook = path.join(rejected.bare, 'hooks', 'pre-receive')
	fs.writeFileSync(hook, '#!/bin/sh\nwhile read old new ref\ndo\n  case "$ref" in\n    refs/heads/main) printf "reject https://user:secret@example.test\\\\033[31m\\\\n" >&2; exit 1 ;;\n  esac\ndone\nexit 0\n', { mode: 0o755 })
	const remote_main_before = rejected.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0]
	const logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], rejected.dir, (message) => logs.push(message)), 1)
	assert.ok(logs.some((line) => line.includes('default-branch push failed')))
	assert.ok(!logs.some((line) => line.includes('removed folder')))
	assert.ok(!logs.some((line) => line.includes('deleted branch login-page')))
	assert.ok(fs.existsSync(rejected_wt))
	assert.ok(rejected.run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.ok(execFileSync('git', ['show-ref', '--verify', 'refs/heads/login-page'], { cwd: rejected.bare, encoding: 'utf8' }))
	assert.equal(rejected.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], remote_main_before)
	assert.doesNotMatch(logs.join('\n'), /secret|example\.test/)
	drop(rejected.dir, rejected.bare)

	const fetched = make_repo({ remote: true })
	const fetched_wt = open_stream(fetched.dir, 'login page')
	const missing_remote = path.join(fetched.dir, 'missing-origin')
	fetched.run(['remote', 'set-url', 'origin', missing_remote])
	const fetch_logs = []

	assert.equal(agf.main(['cleanup', 'login-page'], fetched.dir, (message) => fetch_logs.push(message)), 1)
	assert.ok(fetch_logs.some((line) => line.includes('fetch failed')))
	assert.ok(!fetch_logs.some((line) => line.includes('removed folder')))
	assert.ok(fs.existsSync(fetched_wt))
	assert.ok(fetched.run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(fetched.dir, fetched.bare)
})

test('cleanup leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['cleanup', 'login-page'], dir, () => {})
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('cleanup refuses outside a git repository', () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-bare-')))
	const logs = []
	assert.equal(agf.main(['cleanup', 'x'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not a git repository')))
	drop(dir)
})

test('cleanup prints usage when there is no name and no worktree to read one from', () => {
	const { dir } = make_repo()
	const logs = []
	assert.equal(agf.main(['cleanup'], dir, (m) => logs.push(m)), 1)
	assert.ok(logs.some((l) => l.includes('not standing in a .worktrees')))
	drop(dir)
})

test('stream_doc accepts only the canonical notebook name', () => {
	const { dir } = make_repo()
	fs.mkdirSync(path.join(dir, '.agentflow/features', 'new'), { recursive: true })
	fs.writeFileSync(path.join(dir, '.agentflow/features', 'new', 'new.devlog.md'), 'x')
	fs.mkdirSync(path.join(dir, '.agentflow/features', 'old'), { recursive: true })
	fs.writeFileSync(path.join(dir, '.agentflow/features', 'old', 'devlog.md'), 'x')
	assert.equal(agf.stream_doc(dir, 'new'), '.agentflow/features/new/new.devlog.md')
	const native_join = path.join
	// Exercise Windows relative-path generation on every platform without changing filesystem access.
	const simulated_path = { ...path, join: (...parts) => parts[0] === '.agentflow/features' ? path.win32.join(...parts) : native_join(...parts) }
	const loaded = { exports: {} }
	const filename = require.resolve('./agf')
	const wrapper = require('node:vm').runInThisContext(require('node:module').wrap(fs.readFileSync(filename, 'utf8').replace(/^#![^\n]*/, '')), { filename })
	wrapper(loaded.exports, name => name === 'node:path' ? simulated_path : require(name), loaded, filename, __dirname)
	const relative = loaded.exports.stream_doc(dir, 'new')
	assert.equal(relative, '.agentflow/features/new/new.devlog.md')
	assert.equal(require('./notebook-owner').safe_path(dir, relative), native_join(dir, '.agentflow/features/new/new.devlog.md'))
	assert.equal(agf.stream_doc(dir, 'old'), '')
	assert.equal(agf.stream_doc(dir, 'missing'), '')
	drop(dir)
})

// ----- agf ditch -----

for (const target of ['local', 'remote', 'worktree']) test(`ditch preserves ${target} changes made during confirmation`, () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	try {
		let changed
		const result = agf.main(['ditch', 'login-page'], dir, () => {}, () => {
			if (target === 'worktree') fs.writeFileSync(path.join(wt, 'new-work.txt'), 'new work')
			else {
				changed = run(['commit-tree', 'HEAD^{tree}', '-p', 'HEAD', '-m', 'concurrent work'], wt).trim()
				if (target === 'local') run(['update-ref', 'refs/heads/login-page', changed])
				else run(['push', 'origin', `${changed}:refs/heads/login-page`])
			}
			return 'Y\n'
		})
		assert.equal(result, 1)
		assert.ok(fs.existsSync(wt), 'changed worktree must survive')
		if (target === 'local') assert.equal(run(['rev-parse', 'login-page']).trim(), changed)
		if (target === 'remote') assert.ok(run(['ls-remote', 'origin', 'refs/heads/login-page']).startsWith(changed))
	} finally { drop(dir, bare) }
})

test('ditch refuses a folder registered to a different branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	try {
		run(['switch', '-c', 'other-work'], wt)
		assert.equal(agf.main(['ditch', 'login-page'], dir, () => {}, () => 'Y\n'), 1)
		assert.ok(fs.existsSync(wt))
	} finally { drop(dir) }
})

for (const command of ['ditch', 'cleanup']) for (const target of ['local', 'remote']) test(`${command} atomically preserves ${target} changes at deletion`, () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	const changed = run(['commit-tree', 'login-page^{tree}', '-p', 'login-page', '-m', 'concurrent work']).trim()
	const wrapper = make_git_wrapper(`${target}-delete-race`)
	const previous_path = process.env.PATH, previous_tip = process.env.AGF_TEST_UNVALIDATED_TIP
	const logs = []
	try {
		process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
		process.env.AGF_TEST_UNVALIDATED_TIP = changed
		assert.equal(agf.main([command, 'login-page'], dir, message => logs.push(message), () => 'Y\n'), 1)
		assert.ok(!fs.existsSync(wt), 'earlier worktree removal succeeded')
		assert.match(logs.join('\n'), /removed folder/)
		if (target === 'local') assert.equal(run(['rev-parse', 'login-page']).trim(), changed)
		else {
			assert.ok(run(['ls-remote', 'origin', 'refs/heads/login-page']).startsWith(changed))
			assert.ok(run(['rev-parse', 'login-page']).trim(), 'local branch survives failed remote deletion')
		}
	} finally {
		process.env.PATH = previous_path
		if (previous_tip === undefined) delete process.env.AGF_TEST_UNVALIDATED_TIP
		else process.env.AGF_TEST_UNVALIDATED_TIP = previous_tip
		drop(dir, bare, wrapper.bin)
	}
})

for (const command of ['ditch', 'cleanup']) test(`${command} refuses an uninspectable local branch`, () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const wrapper = make_git_wrapper('inspection-failure'), previous_path = process.env.PATH
	try {
		process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
		assert.equal(agf.main([command, 'login-page'], dir, () => {}, () => 'Y\n'), 1)
		assert.ok(fs.existsSync(wt))
	} finally { process.env.PATH = previous_path; drop(dir, wrapper.bin) }
})

for (const command of ['ditch', 'cleanup']) test(`${command} refuses a different origin push destination`, () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	try {
		run(['config', 'remote.origin.pushurl', path.join(dir, 'different-origin')])
		assert.equal(agf.main([command, 'login-page'], dir, () => {}, () => 'Y\n'), 1)
		assert.ok(fs.existsSync(wt))
		assert.ok(run(['rev-parse', 'login-page']).trim())
	} finally { drop(dir, bare) }
})

for (const mode of ['remote-inspection-failure', 'worktree-removal-failure']) test(`ditch stops after ${mode} and preserves both branches`, () => {
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	const wrapper = make_git_wrapper(mode), previous_path = process.env.PATH
	try {
		process.env.PATH = `${wrapper.bin}${path.delimiter}${previous_path}`
		assert.equal(agf.main(['ditch', 'login-page'], dir, () => {}, () => 'Y\n'), 1)
		assert.ok(fs.existsSync(wt))
		assert.ok(run(['rev-parse', 'login-page']).trim())
		assert.ok(execFileSync(wrapper.real_git, ['show-ref', '--verify', 'refs/heads/login-page'], { cwd: bare, encoding: 'utf8' }).trim())
	} finally { process.env.PATH = previous_path; drop(dir, bare, wrapper.bin) }
})

test('cleanup refuses a local tip changed after its merge', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	try {
		let changed
		const result = agf.main(['cleanup', 'login-page'], dir, message => {
			if (message.includes('merged "login-page"')) {
				changed = run(['commit-tree', 'login-page^{tree}', '-p', 'login-page', '-m', 'concurrent work']).trim()
				run(['update-ref', 'refs/heads/login-page', changed])
			}
		})
		assert.equal(result, 1)
		assert.ok(fs.existsSync(wt))
		assert.equal(run(['rev-parse', 'login-page']).trim(), changed)
	} finally { drop(dir) }
})

test('is_yes takes Enter, y and yes; EOF (null) and anything else are no', () => {
	assert.ok(agf.is_yes(''))
	assert.ok(agf.is_yes('\n'))
	assert.ok(agf.is_yes('y\n'))
	assert.ok(agf.is_yes('Y'))
	assert.ok(agf.is_yes('yes'))
	assert.ok(!agf.is_yes(null))
	assert.ok(!agf.is_yes('n\n'))
	assert.ok(!agf.is_yes('no'))
	assert.ok(!agf.is_yes('yeah nah'))
})

test('ditch needs the name written out — it never infers one from the folder', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch'], wt, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('you type what you delete')))
	assert.ok(fs.existsSync(wt))
	drop(dir)
})

test('ditch refuses an unknown name and shows the closest ones', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch', 'login-pag'], dir, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('no feature called "login-pag"')))
	assert.ok(logs.some((l) => l.includes('did you mean: login-page')))
	drop(dir)
})

test('ditch refuses the default branch', () => {
	const { dir, run } = make_repo()
	open_stream(dir, 'login page')
	const logs = []
	assert.equal(agf.main(['ditch', 'main'], dir, (m) => logs.push(m), () => 'Y\n'), 1)
	assert.ok(logs.some((l) => l.includes('main line of work')))
	assert.ok(run(['branch', '--list', 'main']).includes('main'))
	drop(dir)
})

test('ditch warns with what will be deleted, and n changes nothing', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	const logs = []
	const questions = []
	assert.equal(agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), (q) => { questions.push(q); return 'n\n' }), 1)
	assert.ok(logs.some((l) => l.includes('feature branch "login-page" will be deleted')))
	assert.ok(logs.some((l) => l.includes('unmerged work is lost')))
	assert.ok(questions.some((q) => q.includes('(Y/n)')))
	assert.ok(logs.some((l) => l === 'nothing was changed'))
	assert.ok(fs.existsSync(wt))
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	drop(dir)
})

test('ditch treats a closed stdin (EOF) as no', () => {
	const { dir } = make_repo()
	const wt = open_stream(dir, 'login page')
	assert.equal(agf.main(['ditch', 'login-page'], dir, () => {}, () => null), 1)
	assert.ok(fs.existsSync(wt))
	drop(dir)
})

test('ditch on yes deletes the worktree with unsaved work in it and the local branch', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'half-done.txt'), 'never saved\n')
	const logs = []
	const r = agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), () => 'Y\n')
	assert.equal(r.dir, dir)
	assert.ok(!fs.existsSync(wt))
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.ok(logs.some((l) => l.includes('main notebook devlog.md was NOT written')))
	drop(dir)
})

test('ditch deletes the branch on the server too', () => {
	const { dir, bare } = make_repo({ remote: true })
	open_stream(dir, 'login page')
	const logs = []
	agf.main(['ditch', 'login-page'], dir, (m) => logs.push(m), () => '\n')
	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	drop(dir, bare)
})

test('ditch leaves the root notebook untouched', () => {
	const { dir } = make_repo()
	open_stream(dir, 'login page')
	const before = fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8')
	agf.main(['ditch', 'login-page'], dir, () => {}, () => 'Y\n')
	assert.equal(fs.readFileSync(path.join(dir, 'devlog.md'), 'utf8'), before)
	drop(dir)
})

test('cleanup deletes the branch merge_back left ahead of its own upstream (remote swept first)', () => {
	// The shape merge_back leaves behind: the branch's last commit went to main on the server,
	// never to origin/<key>. `git branch -d` compares against origin/<key> while it exists and
	// refuses — so the remote branch must go first.
	const { dir, run, bare } = make_repo({ remote: true })
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)
	run(['push', 'origin', 'HEAD:main'], wt)
	run(['fetch', 'origin'])
	run(['merge', '--ff-only', 'origin/main'])
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))

	const logs = []
	agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m))

	assert.ok(logs.some((l) => l.includes('deleted branch login-page on origin')))
	assert.ok(logs.some((l) => l === 'deleted branch login-page'), `local branch not deleted: ${logs.join(' | ')}`)
	assert.equal(run(['branch', '--list', 'login-page']).trim(), '')
	assert.equal(execFileSync('git', ['branch', '--list', 'login-page'], { cwd: bare, encoding: 'utf8' }).trim(), '')
	assert.ok(!fs.existsSync(wt))
	drop(dir, bare)
})

test('cleanup still refuses to delete a branch whose work never made it in', () => {
	const { dir, run } = make_repo()
	const wt = open_stream(dir, 'login page')
	fs.writeFileSync(path.join(wt, 'app.txt'), 'the feature\n')
	run(['add', '-A'], wt)
	run(['commit', '-m', 'feature work'], wt)
	// A conflicting main-side change makes the merge fail, so nothing may be deleted.
	fs.writeFileSync(path.join(dir, 'app.txt'), 'the main version\n')
	run(['add', '-A'])
	run(['commit', '-m', 'main side'])
	const logs = []
	assert.equal(agf.main(['cleanup', 'login-page'], dir, (m) => logs.push(m)), 1)
	assert.ok(run(['branch', '--list', 'login-page']).includes('login-page'))
	assert.ok(fs.existsSync(wt))
	drop(dir)
})

test('slow close push releases the notebook writer while retaining delivery ownership', async t => {
  const fixture = close_fixture({ remote: true })
  const gate = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-slow-push-'))
  const entered = path.join(gate, 'entered'), release = path.join(gate, 'release')
  const hook = path.join(fixture.dir, '.git', 'hooks', 'pre-push')
  fs.writeFileSync(hook, `#!${process.execPath}\nconst fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(entered)}, 'ready');\nconst until = Date.now() + 15000;\nwhile (!fs.existsSync(${JSON.stringify(release)})) { if (Date.now() > until) process.exit(1); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); }\n`, { mode: 0o700 })
  const { spawn } = require('node:child_process')
  const child = spawn(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin', '--push-authorized'], { cwd: fixture.dir })
  let stdout = '', stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  const ended = new Promise(resolve => child.on('close', resolve))
  t.after(async () => { fs.writeFileSync(release, 'release'); await ended; drop(fixture.dir, fixture.bare, gate) })
  child.stdin.end(JSON.stringify(close_manifest(fixture.dir, { mode: 'push', remote: 'origin', branch: 'main' })))
  const until = Date.now() + 10000
  while (!fs.existsSync(entered) && Date.now() < until && child.exitCode === null) await new Promise(resolve => setTimeout(resolve, 20))
  assert.ok(fs.existsSync(entered), `${stdout}\n${stderr}`)
  assert.equal(fs.existsSync(path.join(fixture.dir, '.git', 'agf-delivery.lock')), true)
  assert.equal(fs.existsSync(path.join(fixture.dir, 'devlog.md.close-round.lock')), false)
  for (const host of ['codex', 'claude']) {
    const capture = spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', host], {
      cwd: fixture.dir, encoding: 'utf8', timeout: 2000,
      input: JSON.stringify({ cwd: fixture.dir, hook_event_name: 'UserPromptSubmit', session_id: ownership_fixture.session, turn_id: host, prompt: `incoming ${host} while push waits` }),
    })
    assert.equal(capture.status, 0, `${capture.stdout}\n${capture.stderr}`)
    if (host === 'claude') assert.match(JSON.parse(capture.stdout).hookSpecificOutput.additionalContext, /not saved.*ownership/u)
  }
  fs.writeFileSync(release, 'release')
  assert.equal(await ended, 0, `${stdout}\n${stderr}`)
  const output = JSON.parse(stdout)
  assert.equal(output.delivery.state, 'pushed')
  assert.equal(fixture.run(['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0], output.commit.sha)
  const committed = fixture.run(['show', `${output.commit.sha}:devlog.md`])
  assert.match(committed, /# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/)
  const saved = fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8')
  assert.ok(saved.includes('+ incoming codex while push waits'))
  assert.ok(!saved.includes('+ incoming claude while push waits'))
  assert.match(fixture.run(['status', '--porcelain']), / M devlog.md/)
  assert.equal(fs.existsSync(path.join(fixture.dir, '.git', 'agf-delivery.lock')), false)
})

test('close accepts cosmetic Reply headings and reports warnings', () => {
  const fixture = close_fixture()
  try {
    const manifest = close_manifest(fixture.dir)
    manifest.reply = '### Summary\n\nCompleted the requested work.\n\n### Final report\n\nThe regression passed.\n\n### Questions\n\n- None.\n'
    const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], { cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8' })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.ok(JSON.parse(result.stdout).warnings.some(check => check.id === 'reply_structure'))
    assert.ok(fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8').includes(manifest.reply.trim()))
  } finally { drop(fixture.dir) }
})

test('close rejects XML completion metadata before notebook publication or commit', () => {
  const fixture = close_fixture()
  const manifest = close_manifest(fixture.dir)
  manifest.reply += '\n<completion-metadata>\nHost review: PASS — inspected poem-zh-tw.md against the request; it contains one complete Traditional Chinese poem and no unrelated content.\nInformational document: poem-zh-tw.md — requested non-executable poem artifact.\n</completion-metadata>\n'
  const notebook = path.join(fixture.dir, manifest.notebook)
  const before = fs.readFileSync(notebook)
  const head = fixture.run(['rev-parse', 'HEAD'])
  const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], { cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8' })
  assert.notEqual(result.status, 0, result.stdout)
  assert.match(JSON.parse(result.stdout).error.message, /completion fields require a completion-metadata fence.*literal examples/i)
  assert.deepEqual(fs.readFileSync(notebook), before)
  assert.equal(fixture.run(['rev-parse', 'HEAD']), head)
  assert.equal(fixture.run(['status', '--porcelain']), '')
  const record = require('./completion-record').location({ project_root: fixture.dir, notebook_path: manifest.notebook, ask: manifest.ask })
  assert.equal(fs.existsSync(record.file), false)
})

test('close publishes ignored completion records and retries the same manifest without another commit', () => {
  const fixture = close_fixture()
  const manifest = close_manifest(fixture.dir)
  manifest.reply += '\n```completion-metadata\nHost review: PASS — checked linked close fixture.\n```\n'
  const close = () => spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'close', '--manifest-stdin'], { cwd: fixture.dir, input: JSON.stringify(manifest), encoding: 'utf8' })
  const first = close()
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`)
  const head = fixture.run(['rev-parse', 'HEAD'])
  const text = fs.readFileSync(path.join(fixture.dir, 'devlog.md'), 'utf8')
  assert.doesNotMatch(text, /Completion record:|sha256:|<!--/)
  assert.equal(fixture.run(['status', '--porcelain']), '')
  const retry = close()
  assert.equal(retry.status, 0, `${retry.stdout}\n${retry.stderr}`)
  assert.equal(fixture.run(['rev-parse', 'HEAD']), head)
})

test('configured custom default supports finish and cleanup and remains protected from ditch', () => {
  const { dir, run } = make_repo()
  try {
    run(['switch', '-c', 'trunk'])
    run(['config', 'agentflow.default-branch', 'trunk'])
    const original_main = run(['rev-parse', 'main'])
    const wt = open_stream(dir, 'custom branch')
    commit_stream_file(run, wt, 'custom.txt', 'custom default\n')
    assert.equal(agf.main(['finish', '--prep'], wt, () => {}), 0)
    close_local_stream(run, wt, 'custom-branch')
    assert.equal(agf.main(['finish', '--deliver'], wt, () => {}).dir, dir)
    assert.equal(run(['rev-parse', 'trunk']), run(['rev-parse', 'custom-branch']))
    assert.equal(run(['rev-parse', 'main']), original_main)
    assert.equal(agf.main(['cleanup', 'custom-branch'], dir, () => {}).dir, dir)
    assert.equal(fs.existsSync(wt), false)
    run(['switch', 'main'])
    const logs = []
    assert.equal(agf.main(['ditch', 'trunk'], dir, x => logs.push(x), () => { throw Error('must not prompt') }), 1)
    assert.match(logs.join('\n'), /main line of work/)
    assert.doesNotThrow(() => run(['rev-parse', '--verify', 'trunk']))
  } finally { drop(dir) }
})

test('invalid configured default stops stream operations before changing branch tips or worktrees', () => {
  const { dir, run } = make_repo()
  try {
    const wt = open_stream(dir, 'invalid default')
    const before = run(['show-ref'])
    run(['config', 'agentflow.default-branch', 'missing'])
    for (const [args, cwd] of [[['finish', '--prep'], wt], [['cleanup', 'invalid-default'], dir], [['ditch', 'invalid-default'], dir]]) {
      const logs = []
      assert.equal(agf.main(args, cwd, x => logs.push(x), () => { throw Error('must not prompt') }), 1)
      assert.match(logs.join('\n'), /agentflow.default-branch must name an existing local branch/)
      assert.equal(run(['show-ref']), before)
      assert.equal(fs.existsSync(wt), true)
    }
  } finally { drop(dir) }
})

test('cleanup preserves known local records outside the worktree without force', () => {
	const { dir, run } = make_repo()
	try {
		agf.update_ignore_file(dir)
		fs.appendFileSync(path.join(dir, '.gitignore'), '.DS_Store\n')
		run(['add', '.gitignore']); run(['commit', '-m', 'ignore local files'])
		const wt = open_stream(dir, 'preserved records')
		install_hook.install({ cwd: wt, hosts: ['codex'], quiet: true })
		const tmp = path.join(wt, '.agentflow/.tmp')
		fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, '.gitignore'), '*\n')
		fs.writeFileSync(path.join(wt, '.DS_Store'), 'finder metadata')
		const notebook = '.agentflow/features/preserved-records/preserved-records.devlog.md'
		const receipt = path.join(tmp, `agentflow-input-codex-${require('node:crypto').createHash('sha256').update(notebook).digest('hex')}.json`)
		fs.writeFileSync(receipt, '{"ask":"A-001","entries":{}}\n')
		const before = fs.readFileSync(receipt)
		const logs = []
		const result = agf.main(['cleanup', 'preserved-records'], dir, message => logs.push(message))
		assert.equal(result.dir, dir, logs.join('\n'))
		assert.ok(!fs.existsSync(wt))
		const backup = logs.find(line => line.startsWith('preserved local files: ')).slice('preserved local files: '.length)
		assert.deepEqual(fs.readFileSync(path.join(backup, path.relative(wt, receipt))), before)
		assert.equal(fs.readFileSync(path.join(backup, '.DS_Store'), 'utf8'), 'finder metadata')
	} finally { drop(dir) }
})

for (const kind of ['unknown', 'symlink', 'foreign-hooks', 'active-owner', 'notebook-lock', 'backup-collision', 'backup-symlink', 'changed-after-copy']) test(`cleanup keeps local files on ${kind}`, () => {
	const { dir, run } = make_repo()
	try {
		agf.update_ignore_file(dir)
		fs.appendFileSync(path.join(dir, '.gitignore'), '.DS_Store\n')
		run(['add', '.gitignore']); run(['commit', '-m', 'ignore local files'])
		const wt = open_stream(dir, 'guarded records')
		const finder = path.join(wt, '.DS_Store')
		fs.writeFileSync(finder, 'original')
		const notebook = '.agentflow/features/guarded-records/guarded-records.devlog.md'
		const tmp = path.join(wt, '.agentflow/.tmp')
		fs.mkdirSync(tmp, { recursive: true }); fs.writeFileSync(path.join(tmp, '.gitignore'), '*\n')
		if (kind === 'unknown') fs.writeFileSync(path.join(tmp, 'private.json'), 'private work')
		if (kind === 'symlink') { fs.renameSync(finder, path.join(dir, 'finder-original')); fs.symlinkSync(path.join(dir, 'finder-original'), finder) }
		if (kind === 'foreign-hooks') {
			install_hook.install({ cwd: wt, hosts: ['codex'], quiet: true })
			const file = path.join(wt, '.codex/hooks.json'), config = JSON.parse(fs.readFileSync(file))
			config.private_setting = 'preserve me'; fs.writeFileSync(file, JSON.stringify(config))
		}
		if (kind === 'active-owner') require('./notebook-owner').guard({ root: wt, notebook, host: 'codex' })
		if (kind === 'notebook-lock') fs.writeFileSync(path.join(wt, `${notebook}.close-round.lock`), 'busy')
		if (kind === 'backup-symlink') fs.symlinkSync(tmp, path.join(dir, '.git/agentflow-cleanup'))
		if (kind === 'backup-collision') fs.writeFileSync(path.join(dir, '.git/agentflow-cleanup'), 'do not overwrite')
		const logs = []
		const result = agf.main(['cleanup', 'guarded-records'], dir, message => {
			logs.push(message)
			if (kind === 'changed-after-copy' && message.startsWith('preserved local files: ')) fs.writeFileSync(finder, 'new work')
		})
		assert.equal(result, 1, logs.join('\n'))
		assert.ok(fs.existsSync(wt))
		assert.ok(run(['branch', '--list', 'guarded-records']).trim())
		assert.equal(fs.readFileSync(finder, 'utf8'), kind === 'changed-after-copy' ? 'new work' : 'original')
		if (kind === 'backup-collision') assert.equal(fs.readFileSync(path.join(dir, '.git/agentflow-cleanup'), 'utf8'), 'do not overwrite')
	} finally { drop(dir) }
})
