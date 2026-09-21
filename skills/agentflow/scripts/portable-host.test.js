'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const agf = require('./agf.js')
const hooks = require('./install-hook.js')
const { detect_reply_identity } = require('./reply-identity.js')
const notebook = require('./notebook-write.js')
const { spawnSync, execFileSync } = require('node:child_process')

const AGF = path.join(__dirname, 'agf.js')

const temp_root = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-portable-host-')))

test('explicit generic startup accepts a safe host and optional family', () => {

	assert.deepEqual(agf.parse_start_args([
		'--repo', '/tmp/repo', '--host', 'example-agent', '--host-family', 'example-family', '--message-stdin', '--json',
	]), {
		repo: '/tmp/repo', host: 'example-agent', host_family: 'example-family', message_stdin: true, json: true,
	})
})

test('generic hooks report manual mode without creating provider files', () => {

	const root = temp_root()
	try {
		const result = hooks.install({ cwd: root, hosts: ['example-agent'], quiet: true })
		assert.equal(result.status, 'not_available')
		assert.equal(result.host, 'example-agent')
		assert.match(result.instructions.capture, /append-input/)
		assert.match(result.instructions.closeout, /agf close/)
		assert.equal(fs.existsSync(path.join(root, '.codex')), false)
		assert.equal(fs.existsSync(path.join(root, '.claude')), false)
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

test('explicit generic reply identity ignores inherited provider markers', () => {

	assert.equal(detect_reply_identity({ host: 'example-agent', env: {
		CODEX_THREAD_ID: '01a0927f-421d-7263-ab12-083e0839d8ac',
		CLAUDE_SESSION_ID: 'inherited',
	} }), 'example-agent/unknown')
})

test('generic input receipts stay in configured workspace tmp and remain duplicate-safe', () => {

	const root = temp_root()
	try {
		fs.mkdirSync(path.join(root, '.agentflow'), { recursive: true })
		fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify({ switches: { 'workspace-dir': '.agentflow' } }))
		const notebook_path = '.agentflow/devlog.md'
		fs.writeFileSync(path.join(root, notebook_path), '# STATUS\n\n---\n\n# → Ask / A-001\n\n+\n')
		const options = { root, notebook: notebook_path, text: 'capture this once', host: 'example-agent', session: 'portable-session', message_id: 'turn-1' }
		assert.equal(notebook.append_input(options).inserted, true)
		assert.equal(notebook.append_input(options).inserted, false)
		assert.equal(fs.existsSync(path.join(root, '.example-agent')), false)
		const receipts = path.join(root, '.agentflow', '.tmp')
		assert.ok(fs.existsSync(receipts))
		assert.ok(fs.readdirSync(receipts).some(name => name.startsWith('agentflow-input-')))
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})

for (const git_mode of [true, false]) test(`generic host retains explicit session and foreign baseline through closeout in ${git_mode ? 'Git' : 'plain'} folders`, () => {

	const root = temp_root()
	const env = { ...process.env, CODEX_THREAD_ID: 'inherited-codex-marker', CLAUDE_SESSION_ID: 'inherited-claude-marker', AGENTFLOW_SESSION_ID: '' }
	try {
		if (git_mode) {
			execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root })
			execFileSync('git', ['config', 'user.email', 'portable@example.invalid'], { cwd: root })
			execFileSync('git', ['config', 'user.name', 'Portable Host Test'], { cwd: root })
		}
		fs.writeFileSync(path.join(root, 'outside.txt'), 'another session owns this file\n')
		const start_args = [AGF, 'start', '--repo', root, '--host', 'example-agent', '--session', 'portable-session', '--host-family', 'example-family', '--message-stdin', '--json']
		const first = spawnSync(process.execPath, start_args, { cwd: root, env, input: 'portable request\n', encoding: 'utf8' })
		assert.equal(first.status, 0, first.stderr)
		const first_output = JSON.parse(first.stdout)
		assert.equal(first_output.active_host, 'example-agent')
		assert.equal(first_output.host_family, 'example-family')
		assert.equal(first_output.hooks.status, 'not_available')
		assert.match(first_output.hooks.instructions.capture, /append-input/)
		assert.match(first_output.hooks.instructions.closeout, /agf close/)
		assert.equal(fs.existsSync(path.join(root, '.codex')), false)
		assert.equal(fs.existsSync(path.join(root, '.claude')), false)
		assert.equal(fs.existsSync(path.join(root, '.example-agent')), false)
		if (git_mode) assert.equal(fs.existsSync(path.join(root, '.git', 'hooks', 'pre-commit')), false)
		if (git_mode) assert.doesNotMatch(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), /\.agentflow\/\.tmp/u)

		const second = spawnSync(process.execPath, start_args, { cwd: root, env, input: 'portable request\n', encoding: 'utf8' })
		assert.equal(second.status, 0, second.stderr)
		assert.equal(JSON.parse(second.stdout).message.inserted, false)
		const notebook_path = '.agentflow/devlog.md'
		assert.equal(notebook.append_input({ root, notebook: notebook_path, host: 'example-agent', session: 'portable-session', text: 'portable later message', message_id: 'later-1' }).inserted, true)
		assert.equal(notebook.append_input({ root, notebook: notebook_path, host: 'example-agent', session: 'portable-session', text: 'portable later message', message_id: 'later-1' }).inserted, false)
		fs.writeFileSync(path.join(root, '.agentflow-start.lock'), 'interrupted startup\n')
		const recovery = spawnSync(process.execPath, start_args, { cwd: root, env, input: 'godev\n', encoding: 'utf8' })
		assert.equal(recovery.status, 0, recovery.stderr)
		assert.equal(JSON.parse(recovery.stdout).message.reason, 'startup_lock_present')
		fs.unlinkSync(path.join(root, '.agentflow-start.lock'))

		const manifest = {
			version: 1,
			notebook: notebook_path,
			ask: 'A-001',
			run_events: ['- Generic portable lifecycle checks passed.\n'],
			reply: '## Summary\n\n- Generic startup and manual capture completed.\n\n## Final report\n\n- Closeout was verified in a portable host fixture.\n\n```completion-metadata\nHost review: PASS — inspected the fixture change and lifecycle evidence; independent review was unavailable.\n```\n',
			status: { project: 'portable host', notebook: notebook_path, notebook_kind: 'root', current_commit: 'pending', tests_scenarios: 'portable host journey', config_path: 'ag.json', host: 'example-agent', validation: 'validated', proven: 'portable lifecycle', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] },
			allowed_paths: [notebook_path, '.gitignore', 'ag.json'],
			commit_message: 'record portable host lifecycle',
			delivery: { mode: 'local' },
		}
		const close = spawnSync(process.execPath, [AGF, 'close', '--manifest-stdin', '--host', 'example-agent', '--session', 'portable-session'], { cwd: root, env, input: JSON.stringify(manifest), encoding: 'utf8' })
		assert.equal(close.status, 0, close.stderr + close.stdout)
		const close_output = JSON.parse(close.stdout)
		assert.equal(close_output.delivery.state, 'local')
		assert.equal(close_output.phase, git_mode ? 'committed' : 'notebook_replaced')
		assert.match(fs.readFileSync(path.join(root, notebook_path), 'utf8'), /# ← Reply \/ A-001/)
		assert.equal(fs.readFileSync(path.join(root, 'outside.txt'), 'utf8'), 'another session owns this file\n')
	} finally {
		fs.rmSync(root, { recursive: true, force: true })
	}
})
