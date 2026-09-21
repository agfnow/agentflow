'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { format_local_timestamp } = require('./local-time')
const { publish_reply, location } = require('./completion-record')
const { completion_metadata } = require('./round-linter')
const { sweep_completion_records } = require('./completion-cleanup')
const settings = require('./ag-settings')
const ownership_fixture = require('./fixtures/notebook-owner')
ownership_fixture.configure()
const DAY = 86400000
const now = Math.floor(Date.now() / 1000) * 1000
const fixture = ({ reference_other = false } = {}) => {
  const project_root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'completion-retention-')))
  const notebook_path = '.agentflow/devlog.md'
  fs.mkdirSync(path.join(project_root, '.agentflow'))
  fs.writeFileSync(path.join(project_root, notebook_path), '# → Ask / A-001\n\n+ work\n')
  const config = settings.make_template('codex')
  config.switches['completion-cleanup'] = 'on'
  fs.writeFileSync(path.join(project_root, 'ag.json'), JSON.stringify(config))
  const options = { project_root, notebook_path, now_ms: now }
  const rounds = [60, 30, 0].map((age, i) => {
    const ask = `A-00${i + 1}`
    fs.writeFileSync(path.join(project_root, notebook_path), `# → Ask / ${ask}\n\n+ work\n`)
    ownership_fixture.adopt(project_root, notebook_path)
    const stamp = format_local_timestamp(new Date(now - age * DAY))
    const ctx = { ...options, ask }
    const related = reference_other && i === 2 ? `Still needed: [earlier evidence](${location({ ...options, ask: 'A-001' }).href})\n\n` : ''
    const draft = `# ← Reply / ${ask}\n\n* _${stamp} (host)_\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n1. Completed.\n\n${related}\x60\x60\x60completion-metadata\nHost review: PASS — checked historical fixture.\n\x60\x60\x60\n`
    let reply = publish_reply(draft, ctx)
    const read = completion_metadata(reply, ctx)
    read.record.created_at = stamp
    const bytes = JSON.stringify(read.record, null, 2) + '\n'
    fs.writeFileSync(read.record_file, bytes)
    const info = location(ctx)
    const reference = JSON.parse(fs.readFileSync(info.reference_file, 'utf8'))
    reference.sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    fs.writeFileSync(info.reference_file, JSON.stringify(reference, null, 2) + '\n')
    return { ask, reply, file: read.record_file, href: info.href, text: `# → Ask / ${ask}\n\n+ completed work\n\n${reply}\n` }
  })
  const write = (extra = '') => fs.writeFileSync(path.join(project_root, notebook_path), rounds.map(r => r.text).join('\n') + extra + '\n# → Ask / A-004\n\n+\n')
  write()
  const writer = require('./notebook-write'), owner = require('./notebook-owner')
  const lock = writer.acquire_close_round_lock(`${path.join(project_root, notebook_path)}.close-round.lock`)
  try {
    const context = owner.guard({ root: project_root, notebook: notebook_path, ask: 'A-003', host: 'codex', allow_closed: true })
    owner.release(context, fs.readFileSync(path.join(project_root, notebook_path), 'utf8'))
  } finally { writer.release_close_round_lock(lock) }
  return { options, rounds, write }
}

test('real linked records survive future sweeps after earlier records move to Trash', () => {
  const f = fixture()
  const trash = file => fs.renameSync(file, file + '.trashed')
  const first = sweep_completion_records({ ...f.options, trash })
  assert.equal(first.status, 'success', first.reason)
  assert.ok(first.moved.includes(f.rounds[0].file))
  assert.ok(fs.existsSync(f.rounds[2].file))
  const later = sweep_completion_records({ ...f.options, now_ms: now + 8 * DAY, trash })
  assert.equal(later.status, 'success', later.reason)
  assert.ok(fs.existsSync(f.rounds[2].file))
})

test('a reference in another round preserves older completion evidence', () => {
  const f = fixture({ reference_other: true })
  const result = sweep_completion_records({ ...f.options, trash: file => fs.renameSync(file, file + '.trashed') })
  assert.equal(result.status, 'success', result.reason)
  assert.ok(fs.existsSync(f.rounds[0].file), 'still-needed record was removed')
})

test('a watermark updated before lock acquisition suppresses a duplicate sweep', () => {
  const f = fixture(), original = fs.openSync
  const state = path.join(f.options.project_root, '.agentflow/.tmp/completion-cleanup-state.json')
  try {
    fs.openSync = (file, ...args) => {
      const fd = original(file, ...args)
      if (String(file).endsWith('/completion-cleanup.lock')) fs.writeFileSync(state, JSON.stringify({ version: 1, notebooks: { [f.options.notebook_path]: now } }))
      return fd
    }
    const result = sweep_completion_records({ ...f.options, trash: () => { throw Error('duplicate sweep') } })
    assert.equal(result.status, 'not-due', result.reason)
  } finally { fs.openSync = original }
})

test('ordinary Stop schedules cleanup, while prompt capture and corrective Stop preserve records', () => {
  const cp = require('node:child_process')
  for (const event of ['Stop', 'UserPromptSubmit', 'corrective']) {
    const f = fixture()
    const file = path.join(f.options.project_root, f.options.notebook_path)
    const status = settings.format_status({ project: 'cleanup test', notebook: f.options.notebook_path, current_commit: 'fixture', tests_scenarios: 'fixture', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'none', artifacts: 'none', archived_eras: 'none' })
    fs.writeFileSync(file, status + '\n---\n\n' + fs.readFileSync(file, 'utf8'))
    const bin = path.join(f.options.project_root, 'bin')
    fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'trash'), '#!' + process.execPath + '\nrequire("node:fs").renameSync(process.argv[2], process.argv[2]+".trashed")\n', { mode: 0o700 })
    const result = cp.spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], {
      input: JSON.stringify({ cwd: f.options.project_root, hook_event_name: event === 'corrective' ? 'Stop' : event, stop_hook_active: event === 'corrective', prompt: 'continue fixture' }), encoding: 'utf8',
      env: { ...process.env, AGENTFLOW_EXTERNAL_DELEGATE: '', CLAUDE_PROJECT_DIR: '', PATH: bin + path.delimiter + process.env.PATH }
    })
    assert.equal(result.status, 0, result.stderr)
    assert.doesNotMatch(result.stderr, /hook error|cleanup skipped/)
    assert.equal(fs.existsSync(f.rounds[0].file), event !== 'Stop', result.stderr)
  }
})
