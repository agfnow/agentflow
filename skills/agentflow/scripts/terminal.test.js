'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const test = require('node:test')

const settings = require('./ag-settings.js')
const ownership_fixture = require('./fixtures/notebook-owner')
const setup = require('./setup.js')
const { format_local_timestamp } = require('./local-time.js')
const make_temp_directory = require('./fixtures/temp-directory')

const expect = '/usr/bin/expect'
const agf = path.join(__dirname, 'agf.js')
const looper = path.join(__dirname, 'looper.js')

const write_looper_config = (root, notebook = 'devlog.md') => {
  const config = settings.make_template('claude')
  config.switches['target-doc'] = notebook
  config.switches['cli-provider'] = 'on'
  config['external-workers'] = config['external-workers'].filter(profile => profile.family === 'claude')
  const file = settings.resolve_config_path(root, notebook)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(config))
}

const terminal_available = process.platform === 'darwin' && fs.existsSync(expect)
const local_stamp = (offset_ms = -120000) => format_local_timestamp(new Date(Date.now() + offset_ms))

const clean_terminal_env = (extra = {}) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  TERM: 'xterm-256color',
  ...extra,
})

const terminal = (command, args = [], options = {}) => {
  const tcl_word = (value) => `"${String(value).replaceAll('\\', '\\\\').replaceAll('$', '\\$').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('"', '\\"')}"`
  const child_words = options.columns
    ? ['/bin/sh', '-c', 'stty cols "$1" rows 24; shift; exec "$@"', 'terminal-test', String(options.columns), command, ...args]
    : [command, ...args]
  const program = [
    'set timeout 30',
    'log_user 1',
    `spawn -noecho ${child_words.map(tcl_word).join(' ')}`,
    'if {[info exists env(AGENTFLOW_TEST_INPUT)]} { send -- $env(AGENTFLOW_TEST_INPUT) }',
    ...(options.eof ? ['if {[info exists env(AGENTFLOW_TEST_INPUT)]} { send -- "\\004" }'] : []),
    'expect eof',
    'set child_status [wait]',
    'exit [lindex $child_status 3]',
  ].join('\n')
  const result = spawnSync(expect, ['-c', program], {
    cwd: options.cwd,
    env: clean_terminal_env({
      ...options.env,
      ...(options.columns ? { AGENTFLOW_TEST_COLUMNS: String(options.columns) } : {}),
      ...(options.input !== undefined ? { AGENTFLOW_TEST_INPUT: options.input } : {}),
    }),
    encoding: 'utf8',
    timeout: 30_000,
  })
  return {
    ...result,
    output: `${result.stdout || ''}${result.stderr || ''}`.replace(/\r/g, '').replace(/\^D\x08\x08/g, ''),
  }
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

const make_repo = (options = {}) => {
  const dir = fs.realpathSync(make_temp_directory(options.spaces ? 'agentflow terminal agf ' : 'agentflow-terminal-agf-'))
  git(dir, ['init', '-b', 'main'])
  git(dir, ['config', 'user.email', 'terminal@example.com'])
  git(dir, ['config', 'user.name', 'Terminal Test'])
  fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n')
  fs.writeFileSync(path.join(dir, 'ag.json'), `${JSON.stringify({ ...settings.make_template('codex'), switches: { ...settings.make_template('codex').switches, 'target-doc': 'devlog.md' } }, null, 2)}\n`)
  fs.writeFileSync(path.join(dir, 'devlog.md'), `${settings.format_status({
    project: 'terminal test',
    notebook: 'devlog.md',
    current_commit: 'initial',
    tests_scenarios: 'none',
    config_path: 'ag.json',
    host: 'codex',
    validation: 'validated',
    proven: 'none',
    open: 'none',
    next: 'none',
    artifacts: 'none',
    archived_eras: 'none',
  })}\n---\n\n# → Ask / A-001\n\n+ \n`)
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-m', 'initial'])
  if (options.remote) {
    const remote = fs.realpathSync(make_temp_directory('agentflow-terminal-remote-'))
    git(remote, ['init', '--bare'])
    git(dir, ['remote', 'add', 'origin', remote])
    git(dir, ['push', '-u', 'origin', 'main'])
    return { dir, remote }
  }
  return dir
}

const close_notebook = (repo, key) => {
  const worktree = path.join(repo, '.worktrees', key)
  const notebook = path.join(worktree, '.agentflow/features', key, `${key}.devlog.md`)
  const opened = fs.readFileSync(notebook, 'utf8')
  fs.writeFileSync(notebook, opened.replace(new RegExp(`^Feature: ${key} — active —.*$`, 'm'), `Feature: ${key} — closed`))
  git(worktree, ['add', path.relative(worktree, notebook)])
  git(worktree, ['commit', '-m', 'close stream'])
}

const make_completion_journey = () => {
  const repo = make_repo()
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'))
  config.switches['ask-names'] = 'off'
  fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(config))
  const checkpoint_stamp = local_stamp()
  const reply_stamp = local_stamp()
  const status = fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8').split('# → Ask / A-001')[0]
  const checkpoint = `## [RUN-001] Event — ${checkpoint_stamp} (during round A-001)

- **Scope check:** The changed paths match the tracker.

## [WIP-001] Checkpoint — ${checkpoint_stamp} (during round A-001)

- **Finished:**

  1. Prepared the current completion facts.

- **Running now:** None.

- **Still to do:** None.

- **Next work action:** finish.

- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker
`
  const reply = `# ← Reply / A-001
* _${reply_stamp} (terminal-test)_
* _state: code and devlog: this commit_

## [SUMMARY]

- The candidate completion is ready.

## [FINAL REPORT]

The candidate completion contains the required report.

## Verification, route, and mechanics

- The terminal journey checks the writer and the independent Stop hook.

## Questions (batched — each with a suggested default)

None.
`
  const devlog = `${status}# → Ask / A-000

+ prior request

# ← Reply / A-000

Prior reply.

---

# → Ask / A-001

+ current completion request

${checkpoint}`
  fs.writeFileSync(path.join(repo, 'devlog.md'), devlog)
  fs.writeFileSync(path.join(repo, '.devlog.audit.md'), '## A-001\n\n- Review decision: not-requested — no source, test, configuration, or user-document change\n')
  git(repo, ['add', 'ag.json', 'devlog.md', '.devlog.audit.md'])
  git(repo, ['commit', '-m', 'completion journey fixture'])

  const work_key = 'A-001-terminal-journey'
  const work_root = path.join(repo, 'artifacts', work_key)
  const draft_path = path.join('artifacts', work_key, 'reply.md')
  fs.mkdirSync(work_root, { recursive: true })
  fs.writeFileSync(path.join(repo, draft_path), reply)
  ownership_fixture.adopt(repo, 'devlog.md', 'codex', 'terminal-test')

  return { repo, work_key, work_root, draft_path, reply, checkpoint_stamp }
}

const repair_completion_records = fixture => {
  const tracker = require('./tracker-contract.js').template
    .replace('<work-key>', fixture.work_key)
    .replaceAll('<A-NNN>', 'A-001')
    .replace('<goal>', 'Validate the normal completion journey')
    .replace('<YYYY-MM-DD HH:MM:SS ±HHMM>', fixture.checkpoint_stamp)
    .replaceAll('<count>', '1')
    .replace('<self-contained task: required outcome, scope boundary, and proof needed>', 'Validate the candidate before replacement and prove the independent final check')
    .replace('<next action>', 'Run the completion journey')
    .replace('<paths>', 'devlog.md and tracker.md')
  fs.writeFileSync(path.join(fixture.work_root, 'tracker.md'), tracker)
}

test('append-reply preflight keeps a normal Reply draft open until the independent check can pass', { skip: !terminal_available }, (t) => {
  const fixture = make_completion_journey()
  t.after(() => fs.rmSync(fixture.repo, { recursive: true, force: true }))

  const writer = path.join(__dirname, 'notebook-write.js')
  const hook = path.join(__dirname, 'stop-hook.js')
  const notebook = path.join(fixture.repo, 'devlog.md')
  const before = fs.readFileSync(notebook)
  const missing_records = terminal(process.execPath, [writer, 'append-reply', '--notebook', 'devlog.md', '--ask', 'A-001', '--input', fixture.draft_path], {
    cwd: fixture.repo,
    input: '\n',
    env: { CODEX_SESSION_ID: 'terminal-test' }
  })

  assert.equal(missing_records.status, 1, missing_records.output)
  assert.match(missing_records.output, /tracker|checkpoint|preflight/i)
  assert.deepEqual(fs.readFileSync(notebook), before)
  assert.equal(fs.existsSync(path.join(fixture.repo, fixture.draft_path)), true)

  repair_completion_records(fixture)
  const completed = terminal(process.execPath, [writer, 'append-reply', '--notebook', 'devlog.md', '--ask', 'A-001', '--input', fixture.draft_path], {
    cwd: fixture.repo,
    input: '\n',
    env: { CODEX_SESSION_ID: 'terminal-test' }
  })

  assert.equal(completed.status, 0, completed.output)
  assert.match(completed.output, /devlog\.md updated/)
  assert.match(fs.readFileSync(notebook, 'utf8'), /# → Ask \/ A-002\n\n\+\n$/u)
  assert.equal(fs.existsSync(path.join(fixture.repo, fixture.draft_path)), false)

  const tracker_path = path.join(fixture.work_root, 'tracker.md')
  fs.writeFileSync(tracker_path, fs.readFileSync(tracker_path, 'utf8').replace(/- \*\*Last update:\*\* [^.]+\./u, '- **Last update:** 2020-01-01 00:00:00 +0800.'))
  const final_check = terminal(process.execPath, [hook, '--host', 'codex'], {
    cwd: fixture.repo,
    input: `${JSON.stringify({ cwd: fixture.repo, stop_hook_active: false })}\n`,
    eof: true
  })
  assert.equal(final_check.status, 2, final_check.output)
  assert.match(final_check.output, /checkpoint_verification|tracker/i)
  assert.equal(fs.existsSync(path.join(fixture.repo, 'devlog.md')), true)
  assert.match(fs.readFileSync(notebook, 'utf8'), /# ← Reply \/ A-001/)
})

test('append-reply accepts its complete Reply through a real terminal without a named draft', { skip: !terminal_available }, (t) => {
  const fixture = make_completion_journey()
  t.after(() => fs.rmSync(fixture.repo, { recursive: true, force: true }))
  repair_completion_records(fixture)
  fs.unlinkSync(path.join(fixture.repo, fixture.draft_path))

  const writer = path.join(__dirname, 'notebook-write.js')
  const completed = terminal(process.execPath, [writer, 'append-reply', '--notebook', 'devlog.md', '--ask', 'A-001', '--input-stdin'], {
    cwd: fixture.repo,
    input: fixture.reply,
    eof: true,
    env: { CODEX_SESSION_ID: 'terminal-test' }
  })

  assert.equal(completed.status, 0, completed.output)
  assert.match(completed.output, /devlog\.md updated/)
  assert.match(fs.readFileSync(path.join(fixture.repo, 'devlog.md'), 'utf8'), /# → Ask \/ A-002\n\n\+\n$/u)
  assert.equal(fs.existsSync(path.join(fixture.repo, fixture.draft_path)), false)
})

test('real terminal helper supplies a clean TTY, fixed width, input, output, and exit status', { skip: !terminal_available }, () => {
  const probe = 'process.stdin.once("data",d=>{console.error(JSON.stringify({stdin:process.stdin.isTTY,stdout:process.stdout.isTTY,stderr:process.stderr.isTTY,width:process.stderr.columns,input:d.toString().trim(),codex:process.env.CODEX_SESSION_ID||null}));process.exit(7)})'
  const result = terminal(process.execPath, ['-e', probe], {
    columns: 40,
    input: 'answer\n',
    env: { CODEX_SESSION_ID: undefined, CLAUDE_CODE: undefined },
  })
  assert.equal(result.status, 7, result.output)
  assert.match(result.output, /"stdin":true/)
  assert.match(result.output, /"stdout":true/)
  assert.match(result.output, /"stderr":true/)
  assert.match(result.output, /"width":40/)
  assert.match(result.output, /"input":"answer"/)
  assert.match(result.output, /"codex":null/)
})


test('real terminal journey reports the machine-local numeric offset', { skip: !terminal_available }, () => {
  const local_time = path.join(__dirname, 'local-time.js')
  const probe = `const { format_local_timestamp } = require(${JSON.stringify(local_time)}); process.stdout.write(format_local_timestamp(new Date(Date.UTC(2026, 8, 6, 12, 34, 56))))`
  const result = terminal(process.execPath, ['-e', probe], { env: { TZ: 'America/St_Johns' } })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /2026-09-06 10:04:56 -0230/)
})

test('real terminal journey preserves the quoted A-351 records before appending the first RUN', { skip: !terminal_available }, (t) => {
  const repo = make_repo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const notebook = path.join(repo, 'devlog.md')
  const status = fs.readFileSync(notebook, 'utf8').split('# → Ask / A-001')[0]
  const quoted = [
    '+ 類似這種 worker 內部又啟動另個 process 做事的情況已發生幾次',
    '',
    '\t## [RUN-008] Event — implementation start 1 rejected after nested review (during round A-351)',
    '',
    '- **Failure:** After committing `9ef9f98c`, worker start 1 launched another Codex process to perform the final review.',
    '',
    '```markdown',
    '## [WIP-001] Checkpoint — example only (during round A-351)',
    '```',
    '',
    '+ add to task: fix this too,',
  ].join('\n') + '\n'
  fs.writeFileSync(notebook, `${status}# → Ask / A-351\n\n${quoted}`)
  ownership_fixture.adopt(repo, 'devlog.md', 'codex', 'terminal-test')
  const event = `## [RUN-001] Event — ${format_local_timestamp(new Date(Date.now() - 120000))} (during round A-351)\n\n- The first real RUN was appended through a PTY.\n`
  const writer = path.join(__dirname, 'notebook-write.js')
  const result = terminal(process.execPath, [writer, 'append-run', '--notebook', 'devlog.md', '--ask', 'A-351', '--input-stdin'], {
    cwd: repo,
    input: event,
    eof: true,
    env: { CODEX_SESSION_ID: 'terminal-test' },
  })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /devlog\.md updated/)
  const updated = fs.readFileSync(notebook, 'utf8')
  assert.match(updated, /\t## \[RUN-008\][^\n]*\n/u)
  assert.match(updated, /```markdown\n## \[WIP-001\] Checkpoint — example only \(during round A-351\)\n```/u)
  assert.match(updated, /\n---\n\n## \[RUN-001\] Event —/u)
})

test('every agf command and subcommand crosses a real terminal boundary', { skip: !terminal_available }, (t) => {
  const repo = make_repo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))

  const help = terminal(process.execPath, [agf, '--help'], { cwd: repo, columns: 40 })
  assert.equal(help.status, 1)
  for (const syntax of ['agf new', 'agf finish --prep', 'agf finish --deliver', 'agf cleanup', 'agf ditch']) assert.match(help.output, new RegExp(syntax.replaceAll(' ', '\\s+')))
  assert.match(terminal(process.execPath, [agf, 'unknown'], { cwd: repo }).output, /unknown subcommand/)
  for (const args of [['new', 'name', 'key', 'extra'], ['cleanup', 'one', 'extra'], ['ditch', 'one', 'extra']]) {
    const refused = terminal(process.execPath, [agf, ...args], { cwd: repo })
    assert.equal(refused.status, 1)
    assert.match(refused.output, /at most one taskkey/)
  }

  const opened = terminal(process.execPath, [agf, 'new', 'Terminal Feature', '-m', 'test it'], {
    cwd: repo,
    env: { CODEX_SESSION_ID: undefined, CLAUDE_CODE: undefined },
  })
  assert.equal(opened.status, 0, opened.output)
  const key = 'terminal-feature'
  const worktree = path.join(repo, '.worktrees', key)
  const notebook = fs.readFileSync(path.join(worktree, '.agentflow/features', key, `${key}.devlog.md`), 'utf8')
  assert.match(notebook, /Opened by[^]*\n\n---\n\n# → Ask \/ A-001/)
  assert.equal((notebook.match(/^---$/gm) || []).length, 2)

  const prep = terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: worktree })
  assert.equal(prep.status, 0, prep.output)
  assert.match(prep.output, /phase 1 complete/)
  close_notebook(repo, key)
  const delivered = terminal(process.execPath, [agf, 'finish', '--deliver'], { cwd: worktree })
  assert.equal(delivered.status, 0, delivered.output)
  assert.match(delivered.output, /delivered terminal-feature/)
  const cleaned = terminal(process.execPath, [agf, 'cleanup', key], { cwd: repo })
  assert.equal(cleaned.status, 0, cleaned.output)
  assert.equal(fs.existsSync(worktree), false)

  for (const alias of ['clean', 'merge']) {
    const alias_key = `${alias}-feature`
    assert.equal(terminal(process.execPath, [agf, 'new', alias_key], { cwd: repo }).status, 0)
    const result = terminal(process.execPath, [agf, alias, alias_key], { cwd: repo })
    assert.equal(result.status, 0, result.output)
    assert.equal(fs.existsSync(path.join(repo, '.worktrees', alias_key)), false)
  }

  assert.equal(terminal(process.execPath, [agf, 'new', 'ditch-no'], { cwd: repo }).status, 0)
  const declined = terminal(process.execPath, [agf, 'ditch', 'ditch-no'], { cwd: repo, input: 'n\n' })
  assert.equal(declined.status, 1)
  assert.match(declined.output, /are you sure\? \(Y\/n\)/)
  assert.equal(fs.existsSync(path.join(repo, '.worktrees', 'ditch-no')), true)
  const ditched = terminal(process.execPath, [agf, 'ditch', 'ditch-no'], { cwd: repo, input: 'y\n' })
  assert.equal(ditched.status, 0, ditched.output)
  assert.equal(fs.existsSync(path.join(repo, '.worktrees', 'ditch-no')), false)
})

test('agf uses the configured workspace in a real terminal journey', { skip: !terminal_available }, (t) => {
	const repo = make_repo()
	t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
	const config_path = path.join(repo, 'ag.json')
	const config = JSON.parse(fs.readFileSync(config_path, 'utf8'))
	config.switches['workspace-dir'] = '.agentflow'
	config.switches['target-doc'] = '.agentflow/devlog.md'
	fs.mkdirSync(path.join(repo, '.agentflow'))
	fs.renameSync(path.join(repo, 'devlog.md'), path.join(repo, '.agentflow/devlog.md'))
	fs.writeFileSync(config_path, `${JSON.stringify(config, null, 2)}\n`)
	git(repo, ['add', '-A'])
	git(repo, ['commit', '-m', 'configure workspace'])

	const opened = terminal(process.execPath, [agf, 'new', 'Workspace Feature'], { cwd: repo, env: { CODEX_SESSION_ID: undefined, CLAUDE_CODE: undefined } })
	assert.equal(opened.status, 0, opened.output)
	const worktree = path.join(repo, '.worktrees', 'workspace-feature')
	const notebook = path.join(worktree, '.agentflow/features/workspace-feature/workspace-feature.devlog.md')
	assert.match(fs.readFileSync(notebook, 'utf8'), /Backlink: main notebook `\.agentflow\/devlog\.md`/)

	const cleaned = terminal(process.execPath, [agf, 'cleanup', 'workspace-feature'], { cwd: repo })
	assert.equal(cleaned.status, 0, cleaned.output)
	assert.match(cleaned.output, /main notebook \.agentflow\/devlog\.md was NOT written/)
	assert.equal(fs.existsSync(worktree), false)
})

test('real terminal rename and new-to-start journey preserves root history and selects stream intake', { skip: !terminal_available }, t => {
  const repo = make_repo({ spaces: true })
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const config_path = path.join(repo, 'ag.json')
  const config = JSON.parse(fs.readFileSync(config_path, 'utf8'))
  config.switches['target-doc'] = '.agentflow/devlog.md'
  fs.mkdirSync(path.join(repo, '.agentflow'))
  const original = fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8').replace('Notebook: devlog.md', 'Notebook: .agentflow/devlog.md')
  fs.renameSync(path.join(repo, 'devlog.md'), path.join(repo, '.agentflow/devlog.md'))
  fs.writeFileSync(path.join(repo, '.agentflow/devlog.md'), original)
  fs.writeFileSync(config_path, JSON.stringify(config, null, 2) + '\n')
  git(repo, ['add', '-A'])
  git(repo, ['commit', '-m', 'prepare canonical notebook'])
  const commits_before = Number(git(repo, ['rev-list', '--count', 'HEAD']).trim())

  const renamed = terminal(process.execPath, [path.join(__dirname, 'ag-settings.js'), 'rename', '--repo', repo, '--host', 'codex', '--session', 'terminal-test', '--from', '.agentflow/devlog.md', '--to', 'notes.md'], { cwd: repo })
  assert.equal(renamed.status, 0, renamed.output)
  assert.match(renamed.output, /renamed \.agentflow\/devlog\.md → notes\.md in two commits/)
  assert.equal(Number(git(repo, ['rev-list', '--count', 'HEAD']).trim()), commits_before + 2)
  assert.equal(git(repo, ['show', 'HEAD^:notes.md']), original)
  assert.equal(git(repo, ['status', '--porcelain']).trim(), '')
  assert.equal(JSON.parse(fs.readFileSync(config_path)).switches['target-doc'], 'notes.md')

  const root_before = fs.readFileSync(path.join(repo, 'notes.md'))
  const opened = terminal(process.execPath, [agf, 'new', 'Terminal Stream'], { cwd: repo })
  assert.equal(opened.status, 0, opened.output)
  const worktree = path.join(repo, '.worktrees', 'terminal-stream')
  assert.match(opened.output, /exit the current host/)
  assert.ok(opened.output.includes(`cd '${worktree}' && codex`), opened.output)
  assert.equal(opened.output.trim().split('\n').at(-1), worktree)

  const command = `test -t 0 && test -t 1 && test -t 2 || exit 9
print 'terminal identity: stdin/stdout/stderr are TTYs'
set -x
node "$1" start --repo "$2" --host codex --session terminal-stream-test --message-stdin --json <<'STREAM_INPUT'
Continue this stream only.
STREAM_INPUT`
  const started = terminal('/bin/zsh', ['-c', command, 'stream-journey', agf, worktree], { cwd: worktree })
  assert.equal(started.status, 0, started.output)
  assert.match(started.output, /terminal identity: stdin\/stdout\/stderr are TTYs/)
  assert.match(started.output, /"notebook": "\.agentflow\/features\/terminal-stream\/terminal-stream\.devlog\.md"/)
  const stream = fs.readFileSync(path.join(worktree, '.agentflow/features/terminal-stream/terminal-stream.devlog.md'), 'utf8')
  assert.match(stream, /\+ Continue this stream only\./)
  assert.deepEqual(fs.readFileSync(path.join(worktree, 'notes.md')), root_before)
  assert.deepEqual(fs.readFileSync(path.join(repo, 'notes.md')), root_before)
  assert.equal(JSON.parse(fs.readFileSync(path.join(worktree, 'ag.json'))).switches['target-doc'], 'notes.md')
  t.diagnostic(JSON.stringify({ rename: renamed.output, open: opened.output, start: started.output, checks: ['two rename commits', 'move preserves bytes', 'clean rename', 'quoted current-host continuation', 'directory output preserved', 'stream-only owner intake', 'both root notebook copies preserved'] }))
})

test('agf uninstall crosses a real terminal and keeps optional skill removal recoverable', { skip: !terminal_available }, (t) => {
  const repo = make_repo()
  const home = make_temp_directory('agentflow-terminal-uninstall-home-')
  const installed = path.join(home, '.codex', 'skills', 'agentflow')
  fs.mkdirSync(path.dirname(installed), { recursive: true })
  fs.cpSync(path.resolve(__dirname, '..'), installed, { recursive: true })
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  })
  assert.equal(setup.main({
    argv: ['--fix', '--quiet'], shell: '/bin/zsh', home, skill_dir: installed,
    marker: path.join(home, '.marker'), env: {}, ask: () => 'y',
  }), 0)
  execFileSync(process.execPath, [path.join(installed, 'scripts', 'install-hook.js'), '--project', '--quiet'], { cwd: repo })
  const cfg = path.join(home, '.zshrc')
  const command = `source "${cfg}"; agf uninstall --skills`

  const result = terminal('/bin/zsh', ['-c', command], { cwd: repo, input: 'y\n', env: { HOME: home, SHELL: '/bin/zsh' } })

  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /Agentflow uninstall preview/)
  assert.match(result.output, /Remove these Agentflow items\? \(Y\/n\)/)
  assert.match(result.output, /moved .*agentflow\.agentflow-uninstalled/)
  assert.doesNotMatch(fs.readFileSync(cfg, 'utf8'), /agf\(\)|agf-looper\(\)|AGF_OPEN/)
  assert.equal(fs.existsSync(path.join(repo, '.git', 'hooks', 'pre-commit')), false)
  assert.equal(fs.existsSync(installed), false)
  assert.ok(fs.existsSync(`${installed}.agentflow-uninstalled`))
})

test('every documented looper command-line form crosses a real terminal boundary', { skip: !terminal_available }, (t) => {
  const root = make_temp_directory('.agentflow-terminal-looper-')
  const state = make_temp_directory('.agentflow-terminal-state-')
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(state, { recursive: true, force: true })
  })
  git(root, ['init', '-b', 'main'])
  fs.mkdirSync(path.join(root, 'planned'))

  const base = { cwd: root, env: { XDG_STATE_HOME: state } }
  const default_queue = terminal(process.execPath, [looper], base)
  assert.equal(default_queue.status, 0, default_queue.output)
  assert.match(default_queue.output, /All plans are complete/)

  const positional = path.join(root, 'positional')
  const selected = path.join(root, 'selected')
  fs.mkdirSync(positional)
  fs.mkdirSync(selected)
  assert.equal(terminal(process.execPath, [looper, positional], base).status, 0)
  assert.equal(terminal(process.execPath, [looper, '--tasks-dir', selected, '--completion-path', '.agentflow/features/demo/demo.devlog.md'], base).status, 0)

  const executable_queue = path.join(root, 'executable')
  fs.mkdirSync(executable_queue)
  write_looper_config(root)
  fs.writeFileSync(path.join(executable_queue, 'plan-001.md'), 'run the plan\n')
  fs.writeFileSync(path.join(root, 'devlog.md'), '# → Ask / A-001\n\n+\n')
  const worker = path.join(root, 'claude')
  fs.writeFileSync(worker, `#!/usr/bin/env node
const fs = require('node:fs')
const file = ${JSON.stringify(path.join(root, 'devlog.md'))}
const text = fs.readFileSync(file, 'utf8').replace('# → Ask / A-001\\n\\n+\\n', '# → Ask / A-001\\n\\n# ← Reply / A-001\\n\\nDone.\\n\\n# → Ask / A-002\\n\\n+\\n')
fs.writeFileSync(file, text)
process.stdout.write('devlog.md updated\\n')
`, { mode: 0o755 })
  const executable = terminal(process.execPath, [looper, '--tasks-dir', executable_queue, '--completion-path', 'devlog.md', '--executable', worker], base)
  assert.equal(executable.status, 0, executable.output)
  assert.equal(fs.existsSync(path.join(executable_queue, 'done', 'plan-001.md')), true)

  const help = terminal(process.execPath, [looper, '--help'], base)
  assert.equal(help.status, 0)
  assert.match(help.output, /Usage: agf-looper/)
})

test('agf remote lifecycle preserves literal user text and remote state from a normal terminal', { skip: !terminal_available }, (t) => {
  const { dir: repo, remote } = make_repo({ remote: true, spaces: true })
  t.after(() => {
    fs.rmSync(repo, { recursive: true, force: true })
    fs.rmSync(remote, { recursive: true, force: true })
  })

  const wish = 'keep $HOME, "quotes", [brackets], and 中文 literal'
  const opened = terminal(process.execPath, [agf, 'new', '搜尋 page', 'search-page', '-m', wish], {
    cwd: repo,
    env: { CODEX_SESSION_ID: undefined, CLAUDE_CODE: undefined },
  })
  assert.equal(opened.status, 0, opened.output)
  const worktree = path.join(repo, '.worktrees', 'search-page')
  const notebook = path.join(worktree, '.agentflow/features', 'search-page', 'search-page.devlog.md')
  assert.match(fs.readFileSync(notebook, 'utf8'), new RegExp(wish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.notEqual(git(repo, ['ls-remote', '--heads', 'origin', 'search-page']).trim(), '')

  assert.equal(terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: worktree }).status, 0)
  close_notebook(repo, 'search-page')
  git(worktree, ['push', 'origin', 'search-page'])
  const delivered = terminal(process.execPath, [agf, 'finish', '--deliver'], { cwd: worktree })
  assert.equal(delivered.status, 0, delivered.output)
  assert.equal(git(repo, ['rev-parse', 'main']).trim(), git(repo, ['ls-remote', 'origin', 'refs/heads/main']).split('\t')[0])
  assert.equal(terminal(process.execPath, [agf, 'cleanup', 'search-page'], { cwd: repo }).status, 0)
  assert.equal(fs.existsSync(worktree), false)
})

test('agf refuses common wrong-place, dirty-state, premature-delivery, and ambiguous cleanup actions', { skip: !terminal_available }, (t) => {
  const outside = make_temp_directory('agentflow-terminal-outside-')
  const repo = make_repo()
  t.after(() => {
    fs.rmSync(outside, { recursive: true, force: true })
    fs.rmSync(repo, { recursive: true, force: true })
  })

  assert.equal(terminal(process.execPath, [agf, 'new', 'outside'], { cwd: outside }).status, 1)
  assert.equal(terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: repo }).status, 1)
  assert.equal(terminal(process.execPath, [agf, 'new', 'Safety Feature'], { cwd: repo }).status, 0)
  const worktree = path.join(repo, '.worktrees', 'safety-feature')
  fs.writeFileSync(path.join(worktree, 'unsaved.txt'), 'unsaved\n')
  const dirty_prep = terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: worktree })
  assert.equal(dirty_prep.status, 1)
  assert.match(dirty_prep.output, /uncommitted|untracked|dirty|unsaved/i)
  assert.equal(fs.existsSync(path.join(worktree, 'unsaved.txt')), true)
  fs.unlinkSync(path.join(worktree, 'unsaved.txt'))

  assert.equal(terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: worktree }).status, 0)
  const premature = terminal(process.execPath, [agf, 'finish', '--deliver'], { cwd: worktree })
  assert.equal(premature.status, 1)
  assert.match(premature.output, /closed|closing/i)
  const inside_cleanup = terminal(process.execPath, [agf, 'cleanup', 'safety-feature'], { cwd: worktree })
  assert.equal(inside_cleanup.status, 1)
  assert.match(inside_cleanup.output, /main checkout|exit/i)
  assert.equal(fs.existsSync(worktree), true)

  const unknown = terminal(process.execPath, [agf, 'cleanup', 'safety-featur'], { cwd: repo })
  assert.equal(unknown.status, 1)
  assert.match(unknown.output, /safety-feature/)
  const ditched = terminal(process.execPath, [agf, 'ditch', 'safety-feature'], { cwd: repo, input: '\n' })
  assert.equal(ditched.status, 0, ditched.output)
  assert.equal(fs.existsSync(worktree), false)
})

test('looper handles paths with spaces, literal completion paths, and a second completed invocation', { skip: !terminal_available }, (t) => {
  const root = make_temp_directory('.agentflow terminal looper ')
  const state = make_temp_directory('.agentflow terminal state ')
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(state, { recursive: true, force: true })
  })
  git(root, ['init', '-b', 'main'])
  const queue = path.join(root, 'planned work')
  fs.mkdirSync(queue)
  fs.writeFileSync(path.join(queue, 'plan-001.md'), 'run the spaced plan\n')
  const completion = '.agentflow/features/my feature/dev log.md'
  const completion_file = path.join(root, completion)
  fs.mkdirSync(path.dirname(completion_file), { recursive: true })
  write_looper_config(root, completion)
  fs.writeFileSync(completion_file, '# → Ask / A-001\n\n+\n')
  const worker = path.join(root, 'claude')
  fs.writeFileSync(worker, `#!/usr/bin/env node
const fs = require('node:fs')
const file = ${JSON.stringify(completion_file)}
const text = fs.readFileSync(file, 'utf8').replace('# → Ask / A-001\\n\\n+\\n', '# → Ask / A-001\\n\\n# ← Reply / A-001\\n\\nDone.\\n\\n# → Ask / A-002\\n\\n+\\n')
fs.writeFileSync(file, text)
process.stdout.write(${JSON.stringify(`${completion} updated\n`)})
`, { mode: 0o755 })
  const options = { cwd: root, env: { XDG_STATE_HOME: state } }
  const first = terminal(process.execPath, [looper, '--tasks-dir', queue, '--completion-path', completion, '--executable', worker], options)
  assert.equal(first.status, 0, first.output)
  assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), true)
  const second = terminal(process.execPath, [looper, '--tasks-dir', queue, '--completion-path', completion, '--executable', worker], options)
  assert.equal(second.status, 0, second.output)
  assert.match(second.output, /All plans are complete/)
})

test('looper help and visible progress cross a real terminal boundary', { skip: !terminal_available }, () => {
  const help = terminal(process.execPath, [looper, '--help'], { columns: 40 })
  assert.equal(help.status, 0, help.output)
  assert.match(help.output, /Usage: agf-looper/)
  assert.match(help.output, /setup\.js\s+--fix/)
  for (const line of help.output.split('\n')) {
    const words = line.trim().split(/\s+/u)
    assert.ok(line.length <= 40 || (words.length === 1 && words[0].length > 40), `${line.length}: ${line}`)
  }
})

test('looper refuses malformed options, missing queues, and failed child attempts without losing the plan', { skip: !terminal_available }, (t) => {
  const root = make_temp_directory('.agentflow-terminal-looper-errors-')
  const state = make_temp_directory('.agentflow-terminal-state-errors-')
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(state, { recursive: true, force: true })
  })
  git(root, ['init', '-b', 'main'])
  const options = { cwd: root, env: { XDG_STATE_HOME: state } }
  for (const args of [['--tasks-dir'], ['--completion-path'], ['--executable'], ['--unknown'], ['one', 'two']]) {
    const result = terminal(process.execPath, [looper, ...args], options)
    assert.equal(result.status, 1)
    assert.match(result.output, /HALT:/)
  }
  const missing = terminal(process.execPath, [looper, '--tasks-dir', path.join(root, 'missing')], options)
  assert.equal(missing.status, 1)
  assert.match(missing.output, /HALT:/)

  const queue = path.join(root, 'planned')
  fs.mkdirSync(queue)
  write_looper_config(root)
  fs.writeFileSync(path.join(root, 'devlog.md'), '# → Ask / A-001\n\n+\n')
  fs.writeFileSync(path.join(queue, 'plan-001.md'), 'must survive failure\n')
  const worker = path.join(root, 'claude')
  fs.writeFileSync(worker, '#!/bin/sh\nprintf "%s\\n" "child failed" >&2\nexit 7\n', { mode: 0o755 })
  const failed = terminal(process.execPath, [looper, '--tasks-dir', queue, '--completion-path', 'devlog.md', '--executable', worker], options)
  assert.equal(failed.status, 1, failed.output)
  assert.match(failed.output, /child exited with code 7/)
  assert.equal(fs.readFileSync(path.join(queue, 'plan-001.md'), 'utf8'), 'must survive failure\n')
  assert.equal(fs.existsSync(path.join(queue, 'done', 'plan-001.md')), false)
  const recovery_refusal = terminal(process.execPath, [looper, '--tasks-dir', queue, '--completion-path', 'devlog.md', '--executable', worker], options)
  assert.equal(recovery_refusal.status, 1)
  assert.match(recovery_refusal.output, /attempt evidence|human review/i)
})

test('removed workspace migration is rejected in a real terminal without moving records', { skip: !terminal_available }, (t) => {
  const repo = make_repo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const before = git(repo, ['status', '--porcelain'])
  const result = terminal(process.execPath, [agf, 'settings', 'migrate-workspace'], { cwd: repo, env: { CODEX_SESSION_ID: 'terminal-fixture' } })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /unknown|unsupported|usage/i)
  assert.equal(git(repo, ['status', '--porcelain']), before)
  assert.equal(fs.existsSync(path.join(repo, 'devlog.md')), true)
})

test('close recovery rejects raw STATUS in a real terminal and preserves the notebook', { skip: !terminal_available }, t => {
  const repo = make_repo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  const notebook = path.join(repo, 'devlog.md')
  fs.writeFileSync(notebook, fs.readFileSync(notebook, 'utf8').replace(/\+ \n$/u, '+ finish this round\n'))
  ownership_fixture.adopt(repo, 'devlog.md', 'codex', 'terminal-test')
  const before = fs.readFileSync(notebook)
  const result = terminal(process.execPath, [path.join(__dirname, 'notebook-write.js'), 'close-round', '--notebook', 'devlog.md', '--host', 'codex', '--session', 'terminal-test', '--input-stdin'], { cwd: repo, input: JSON.stringify({ ask: 'A-001', run_events: [], reply: 'Done.', status: '# STATUS\n' }) + '\n', eof: true })
  assert.notEqual(result.status, 0, result.output)
  assert.match(result.output, /STATUS.*fields object/)
  assert.deepEqual(fs.readFileSync(notebook), before)
})

test('linked completion closeout and cleanup settings work through a real PTY', { skip: !terminal_available }, () => {
  const repo = make_repo()
  const options = { cwd: repo, env: { CODEX_SESSION_ID: 'completion-terminal-fixture' } }
  const setting = terminal(process.execPath, [agf, 'settings', 'change', 'completion-cleanup-interval-days: 3'], options)
  assert.equal(setting.status, 0, setting.output)
  const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'))
  assert.equal(config.switches['completion-cleanup'], 'off')
  assert.equal(config.switches['completion-cleanup-interval-days'], 3)
  fs.writeFileSync(path.join(repo, 'devlog.md'), fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8').replace(/\+ \n$/u, '+ finish this round\n\n+ skip-review: disposable terminal fixture\n'))
  git(repo, ['add', 'ag.json', 'devlog.md'])
  git(repo, ['commit', '-m', 'prepare linked completion journey'])
  ownership_fixture.adopt(repo, 'devlog.md', 'codex', 'completion-terminal-fixture')
  const manifest = {
    version: 1, notebook: 'devlog.md', ask: 'A-001', run_events: [],
    reply: '## [SUMMARY]\n\n- Completed.\n\n## [FINAL REPORT]\n\n1. Verified the terminal journey.\n\n```completion-metadata\nHost review: PASS — inspected the disposable terminal fixture.\n```\n',
    status: { project: 'terminal test', notebook: 'devlog.md', notebook_kind: 'root', current_commit: 'tested', tests_scenarios: 'PTY close', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'linked completion', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] },
    allowed_paths: ['devlog.md'], commit_message: 'record terminal completion', delivery: { mode: 'local' }
  }
  const wrapper = 'if (![process.stdin,process.stdout,process.stderr].every(s=>s.isTTY)) process.exit(3); console.error("terminal identity: stdin/stdout/stderr are TTYs"); const r=require("node:child_process").spawnSync(process.execPath,[process.argv[1],"close","--manifest-stdin"],{stdio:"inherit"}); process.exit(r.status ?? 1)'
  const result = terminal(process.execPath, ['-e', wrapper, agf], { ...options, input: JSON.stringify(manifest, null, 2) + '\n', eof: true })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /terminal identity: stdin\/stdout\/stderr are TTYs/)
  assert.match(result.output, /"ask": "A-001"/)
  assert.match(result.output, /"ok": true/)
  const notebook = fs.readFileSync(path.join(repo, 'devlog.md'), 'utf8')
  const round = require('./round-linter').parse_devlog(notebook).rounds.find(r => r.id === 'A-001')
  const read = require('./round-linter').completion_metadata(round.reply_text, { project_root: repo, notebook_path: 'devlog.md', ask: 'A-001' })
  assert.equal(read.error, '')
  assert.ok(fs.existsSync(read.record_file))
  assert.equal(git(repo, ['status', '--porcelain']), '')
})

test('configured custom default works through a real terminal stream journey', { skip: !terminal_available }, t => {
  const repo = make_repo()
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }))
  git(repo, ['switch', '-c', 'trunk'])
  git(repo, ['config', 'agentflow.default-branch', 'trunk'])
  const before_main = git(repo, ['rev-parse', 'main'])
  const opened = terminal('/bin/sh', ['-c', [
    'test -t 0 && test -t 1 && test -t 2 || exit 91',
    'printf "terminal stdin=true stdout=true stderr=true\\n"',
    'IFS= read -r request',
    'printf "request: %s\\n" "$request"',
    'exec "$1" "$2" new custom-default',
  ].join('\n'), 'branch-journey', process.execPath, agf], { cwd: repo, input: 'use configured trunk\n' })
  assert.equal(opened.status, 0, opened.output)
  assert.match(opened.output, /terminal stdin=true stdout=true stderr=true/)
  assert.match(opened.output, /request: use configured trunk/)
  const worktree = path.join(repo, '.worktrees/custom-default')
  const prepared = terminal(process.execPath, [agf, 'finish', '--prep'], { cwd: worktree })
  assert.equal(prepared.status, 0, prepared.output)
  const cleaned = terminal(process.execPath, [agf, 'cleanup', 'custom-default'], { cwd: repo })
  assert.equal(cleaned.status, 0, cleaned.output)
  assert.equal(fs.existsSync(worktree), false)
  assert.equal(git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'trunk')
  assert.equal(git(repo, ['rev-parse', 'main']), before_main)
})
