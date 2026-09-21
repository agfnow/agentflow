'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')
const test = require('node:test')

const wrapper = `const fs=require('node:fs'),cp=require('node:child_process');
if(!process.stdin.isTTY||!process.stdout.isTTY)process.exit(90);
process.stdout.write('Terminal: '+cp.spawnSync('tty',[],{stdio:[0,'pipe','pipe'],encoding:'utf8'}).stdout);
process.stdout.write('Visible input: '+process.env.AGF_JOURNEY_INPUT+'\\n');
const r=cp.spawnSync(process.execPath,JSON.parse(process.env.AGF_JOURNEY_ARGS),{input:process.env.AGF_JOURNEY_INPUT,encoding:'utf8'});
process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');
process.stdout.write('\\nProcess exit: '+r.status+'\\n');process.exit(r.status??91);`
const expect_script = 'set timeout 30\nlog_user 1\nspawn $env(AGF_JOURNEY_NODE) -e $env(AGF_JOURNEY_WRAPPER)\nexpect eof\nset result [wait]\nexit [lindex $result 3]'
const terminal = (root, script, args, input = '') => {
  const result = spawnSync('/usr/bin/expect', ['-c', expect_script], { cwd: root, encoding: 'utf8', env: {
    ...process.env, CODEX_THREAD_ID: 'inherited-codex', CLAUDE_SESSION_ID: 'inherited-claude',
    AGENTFLOW_SESSION_ID: 'portable-terminal-session',
    AGF_JOURNEY_NODE: process.execPath, AGF_JOURNEY_WRAPPER: wrapper,
    AGF_JOURNEY_ARGS: JSON.stringify(script === null ? args : [path.join(__dirname, script), ...args]), AGF_JOURNEY_INPUT: input,
  } })
  assert.match(result.stdout, /Terminal: \/dev\/tt/)
  assert.match(result.stdout, /Visible input:/)
  assert.match(result.stdout, new RegExp(`Process exit: ${result.status}`))
  return result
}

for (const git_mode of [true, false]) test(`real terminal portable host, policy changes, pending handoff and closeout in ${git_mode ? 'Git' : 'plain'} folder`, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-transport-pty-')))
  if (git_mode) {
    for (const args of [['init', '-q', '-b', 'main'], ['config', 'user.name', 'PTY fixture'], ['config', 'user.email', 'pty@example.invalid']]) execFileSync('git', args, { cwd: root })
  }
  const start = terminal(root, 'agf.js', ['start', '--repo', root, '--host', 'example-agent', '--host-family', 'codex', '--message-stdin', '--json'], 'portable terminal request\n')
  assert.equal(start.status, 0, start.stdout + start.stderr)
  assert.match(start.stdout, /"status": "not_available"/)
  assert.equal(fs.existsSync(path.join(root, '.codex')), false)
  assert.equal(fs.existsSync(path.join(root, '.claude')), false)
  const config_file = path.join(root, 'ag.json')
  assert.deepEqual(JSON.parse(fs.readFileSync(config_file)).switches['allowed-worker'], ['external', 'internal', 'host'])
  const selection_program = 'const fs=require("node:fs"),route=require(process.argv[1]);const facts=JSON.parse(fs.readFileSync(0,"utf8"));facts.config=JSON.parse(fs.readFileSync("ag.json","utf8"));process.stdout.write(JSON.stringify(route.select_executor_action(facts))+"\\n")'
  for (const allowed of [['external', 'internal', 'host'], ['host', 'internal', 'external']]) {
    const reordered = terminal(root, 'ag-settings.js', ['change', '--repo', root, '--host', 'example-agent', '--set', 'allowed-worker: ' + JSON.stringify(allowed)])
    assert.equal(reordered.status, 0, reordered.stdout)
    const facts = { task: { role: 'implementation', executor_choice: { kind: 'host', reason: 'Reuse task context in the current host' } }, capabilities: { host: { candidate_id: 'host', available: true }, internal: { candidate_id: 'native', available: true } } }
    const chosen = terminal(root, null, ['-e', selection_program, path.join(__dirname, 'delegation-route.js')], JSON.stringify(facts))
    assert.equal(chosen.status, 0, chosen.stdout)
    assert.match(chosen.stdout, /"status":"selected","candidate_id":"host","kind":"host"/)
    assert.deepEqual(JSON.parse(fs.readFileSync(config_file)).switches['allowed-worker'], allowed)
  }
  const change = terminal(root, 'ag-settings.js', ['change', '--repo', root, '--host', 'example-agent', '--set', 'allowed-worker: ["host"]'])
  assert.equal(change.status, 0, change.stdout)
  const valid_config = fs.readFileSync(config_file)
  const invalid = terminal(root, 'ag-settings.js', ['change', '--repo', root, '--host', 'example-agent', '--set', 'allowed-worker: []'])
  assert.equal(invalid.status, 1)
  assert.deepEqual(fs.readFileSync(config_file), valid_config)
  const notebook = '.agentflow/devlog.md'
  const capture = terminal(root, 'notebook-write.js', ['append-input', '--notebook', notebook, '--host', 'example-agent', '--input-stdin'], 'later terminal instruction\n')
  assert.equal(capture.status, 0, capture.stdout)
  assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /later terminal instruction/)
  const tasks = path.join(root, '.agentflow', 'planned')
  fs.mkdirSync(tasks)
  const plan_file = path.join(tasks, 'plan-001.md')
  fs.writeFileSync(plan_file, '# Pending plan\n\nCreate pending-product.txt.\n')
  const handoff = terminal(root, 'looper.js', ['--tasks-dir', tasks, '--completion-path', notebook])
  assert.equal(handoff.status, 2, handoff.stdout + handoff.stderr)
  assert.match(handoff.stdout + handoff.stderr, /interactive host/)
  assert.equal(fs.readFileSync(plan_file, 'utf8'), '# Pending plan\n\nCreate pending-product.txt.\n')
  assert.equal(fs.existsSync(path.join(tasks, 'done')), false)
  assert.equal(fs.existsSync(path.join(root, 'pending-product.txt')), false)
  // The queued plan remains a separate pending task; this round proves the
  // portable lifecycle and does not claim that plan's product was completed.
  const manifest = { version: 1, notebook, ask: 'A-001', run_events: [],
    reply: '## [SUMMARY]\n\n- Verified portable terminal controls; the queue remains pending.\n\n## [FINAL REPORT]\n\n1. Startup, policy validation, manual capture and handoff verified.\n\n```completion-metadata\nHost review: PASS — inspected the fixture and terminal results.\n```\n',
    status: { project: 'portable terminal fixture', notebook, notebook_kind: 'root', current_commit: 'local delivery', tests_scenarios: 'real terminal journey', config_path: 'ag.json', host: 'example-agent', validation: 'validated', proven: 'portable lifecycle', open: 'one pending queue plan', next: 'resume queue in an interactive host', artifacts: '.agentflow/planned/plan-001.md', archived_eras: 'none', streams: [] },
    allowed_paths: [notebook, '.gitignore', 'ag.json'], commit_message: 'verify portable terminal controls', delivery: { mode: 'local' } }
  // Explicit waiver is fixture owner input, not an inferred policy fallback.
  terminal(root, 'notebook-write.js', ['append-input', '--notebook', notebook, '--host', 'example-agent', '--input-stdin'], 'skip-review: bounded terminal fixture\n')
  const close = terminal(root, 'agf.js', ['close', '--manifest-stdin'], JSON.stringify(manifest))
  assert.equal(close.status, 0, close.stdout + close.stderr)
  const text = fs.readFileSync(path.join(root, notebook), 'utf8')
  assert.match(text, /# ← Reply \/ A-001/)
  assert.match(text, /example-agent\/unknown/)
  assert.match(text, /# → Ask \/ A-002/)
  assert.equal(fs.existsSync(path.join(root, '.git')), git_mode)
})
