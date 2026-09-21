'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { sweep_completion_records } = require('./completion-cleanup.js')
const settings = require('./ag-settings.js')
const ownership_fixture = require('./fixtures/notebook-owner')
ownership_fixture.configure()

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-11T00:00:00Z')
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })

const make_fixture = ({ cleanup = 'on', interval = 7, rounds = [], read_metadata } = {}) => {
	const project_root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'completion-cleanup-')))
	const notebook_path = 'devlog.md'
	const config_path = path.join(project_root, 'ag.json')
	const config = settings.make_template('codex')
	config.switches['target-doc'] = notebook_path
	config.switches['workspace-dir'] = '.agentflow'
	config.switches['completion-cleanup'] = cleanup
	config.switches['completion-cleanup-interval-days'] = interval
	fs.mkdirSync(path.join(project_root, '.agentflow'), { recursive: true })
	fs.writeFileSync(config_path, JSON.stringify(config, null, 2) + '\n')
	const notebook = rounds.map(round => `# → Ask / ${round.ask}\n+ ${round.ask} request\n# ← Reply / ${round.ask}\n* _${round.completed_at} (gpt-5.6-luna/xhigh)_\nreply\n`).join('\n') + '# → Ask / A-999\n+\n'
	fs.writeFileSync(path.join(project_root, notebook_path), notebook)
	return {
		project_root,
		notebook_path,
		config_path,
		read_metadata: read_metadata || ((reply, context) => {
			const round = rounds.find(item => item.ask === context.ask)
			return round?.metadata || { text: reply, document_effects: [], error: '', record: undefined }
		}),
	}
}

const add_record_file = (fixture, round, namespace = 'A-1') => {
	const file = path.join(fixture.project_root, '.agentflow', '.tmp', namespace, 'completion.json')
	fs.mkdirSync(path.dirname(file), { recursive: true })
	fs.writeFileSync(file, JSON.stringify(round.metadata.record) + '\n')
	round.metadata.record_file = file
	return file
}

test('disabled cleanup exits before creating state or invoking trash', () => {
	const fixture = make_fixture({ cleanup: 'off', rounds: [] })
	try {
		let trash_calls = 0
		const result = sweep_completion_records({ ...fixture, now_ms: NOW, trash: () => { trash_calls += 1 } })
		assert.deepEqual(result, { status: 'disabled', moved: [], reason: 'completion-cleanup is off' })
		assert.equal(trash_calls, 0)
		assert.equal(fs.existsSync(path.join(fixture.project_root, '.agentflow', '.tmp')), false)
	} finally { drop(fixture.project_root) }
})

test('real sidecar records are swept once and retained references keep missing evidence explicit', () => {
  const fixture = make_fixture()
  const records = require('./completion-record')
  const linter = require('./round-linter')
  const notebook = path.join(fixture.project_root, fixture.notebook_path)
  const parts = []
  const now = Date.now()
  for (const ask of ['A-001', 'A-002']) {
    const ctx = { ...fixture, ask }
    fs.writeFileSync(notebook, `# → Ask / ${ask}\n\n+ fixture\n`)
    ownership_fixture.adopt(fixture.project_root, fixture.notebook_path)
    const reply = records.publish_reply('## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n1. Verified.\n\n```completion-metadata\nHost review: PASS — inspected the fixture.\n```\n', ctx)
    const stamp = require('./local-time').format_local_timestamp(new Date(now))
    parts.push(`# → Ask / ${ask}\n\n+ fixture\n\n# ← Reply / ${ask}\n\n* _${stamp} (codex/unknown)_\n\n${reply}`)
  }
  fs.writeFileSync(notebook, parts.join('\n---\n\n') + '\n---\n\n# → Ask / A-003\n\n+\n')
  const { read_metadata, ...options } = fixture
  const old_file = records.location({ ...fixture, ask: 'A-001' }).file
  const first = sweep_completion_records({ ...options, now_ms: now + 40 * DAY, trash: file => fs.renameSync(file, file + '.trashed') })
  assert.equal(first.status, 'success', first.reason)
  assert.deepEqual(first.moved, [old_file])
  const round = linter.parse_devlog(fs.readFileSync(notebook, 'utf8')).rounds[0]
  assert.match(linter.completion_metadata(round.reply_text, { ...fixture, ask: 'A-001' }).error, /records unavailable/i)
  const again = sweep_completion_records({ ...options, now_ms: now + 48 * DAY, trash: () => assert.fail('already swept') })
  assert.equal(again.status, 'success', again.reason)
  assert.deepEqual(again.moved, [])
})

test('due sweep moves only old inactive records and preserves the latest completed record', () => {
	const old = { ask: 'A-1', completed_at: '2026-07-01 00:00:00 +0000', metadata: {} }
	const latest = { ask: 'A-2', completed_at: '2026-07-02 00:00:00 +0000', metadata: {} }
	const fixture = make_fixture({ rounds: [old, latest] })
	try {
		for (const round of [old, latest]) {
			round.metadata = {
				text: `metadata ${round.ask}`,
				document_effects: [],
				error: '',
				record: { version: 1, notebook: 'devlog.md', ask: round.ask, created_at: round.completed_at, metadata_text: `metadata ${round.ask}` },
			}
			add_record_file(fixture, round, round.ask)
		}
		const moved = []
		const result = sweep_completion_records({ ...fixture, now_ms: NOW, trash: file => moved.push(file) })
		assert.equal(result.status, 'success')
		assert.deepEqual(result.moved, [path.join(fixture.project_root, '.agentflow', '.tmp', 'A-1', 'completion.json')])
		assert.deepEqual(moved, result.moved)
	} finally { drop(fixture.project_root) }
})

test('unfinished nonempty latest round skips the sweep and does not advance watermark', () => {
	const fixture = make_fixture({ rounds: [] })
	try {
		const notebook = '# → Ask / A-1\n+ active request\n'
		fs.writeFileSync(path.join(fixture.project_root, fixture.notebook_path), notebook)
		const result = sweep_completion_records({ ...fixture, now_ms: NOW, trash: () => { throw new Error('must not trash') } })
		assert.equal(result.status, 'skipped')
		assert.match(result.reason, /active|unfinished|current/i)
		assert.equal(fs.existsSync(path.join(fixture.project_root, '.agentflow', '.tmp', 'completion-cleanup-state.json')), false)
	} finally { drop(fixture.project_root) }
})

test('lock contention returns busy without touching records or watermark', () => {
	const fixture = make_fixture({ rounds: [] })
	try {
		const lock = path.join(fixture.project_root, '.agentflow', '.tmp', 'completion-cleanup.lock')
		fs.mkdirSync(path.dirname(lock), { recursive: true })
		fs.writeFileSync(lock, JSON.stringify({ pid: 1, token: 'other' }))
		const result = sweep_completion_records({ ...fixture, now_ms: NOW })
		assert.equal(result.status, 'busy')
		assert.equal(fs.existsSync(lock), true)
	} finally { drop(fixture.project_root) }
})

test('successful empty sweep advances a notebook-scoped watermark and honors the interval', () => {
	const fixture = make_fixture({ rounds: [] })
	try {
		const options = { ...fixture, now_ms: NOW, trash: () => { throw new Error('must not trash') } }
		assert.equal(sweep_completion_records(options).status, 'success')
		assert.equal(sweep_completion_records({ ...options, now_ms: NOW + 6 * DAY }).status, 'not-due')
		assert.equal(sweep_completion_records({ ...options, now_ms: NOW + 7 * DAY }).status, 'success')
	} finally { drop(fixture.project_root) }
})

test('move failure reports error and leaves last-success watermark unchanged', () => {
	const round = { ask: 'A-1', completed_at: '2026-07-01 00:00:00 +0000', metadata: {} }
	const latest = { ask: 'A-2', completed_at: '2026-07-02 00:00:00 +0000', metadata: {} }
	const fixture = make_fixture({ rounds: [round, latest] })
	try {
		round.metadata = {
			text: 'metadata A-1', document_effects: [], error: '',
			record: { version: 1, notebook: 'devlog.md', ask: 'A-1', created_at: round.completed_at, metadata_text: 'metadata A-1' },
		}
		add_record_file(fixture, round, round.ask)
		latest.metadata = { text: 'metadata A-2', document_effects: [], error: '' }
		const result = sweep_completion_records({ ...fixture, now_ms: NOW, trash: () => { throw new Error('trash unavailable') } })
		assert.equal(result.status, 'error')
		assert.deepEqual(result.moved, [])
		assert.equal(fs.existsSync(path.join(fixture.project_root, '.agentflow', '.tmp', 'completion-cleanup-state.json')), false)
	} finally { drop(fixture.project_root) }
})

test('an empty first sweep keeps its scheduling state out of Git', () => {
  const fixture = make_fixture({ rounds: [] })
  const cp = require('node:child_process')
  cp.execFileSync('git', ['init', '-q'], { cwd: fixture.project_root })
  assert.equal(sweep_completion_records({ ...fixture, now_ms: NOW }).status, 'success')
  const result = cp.spawnSync('git', ['check-ignore', '.agentflow/.tmp/completion-cleanup-state.json'], { cwd: fixture.project_root, encoding: 'utf8' })
  assert.equal(result.status, 0, 'local cleanup state must be ignored before any completion record exists')
})
