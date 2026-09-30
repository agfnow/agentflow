#!/usr/bin/env node
'use strict'

// Opt-in, paid interactive test. Keeps its disposable repository and transcript.
// Default baseline: --run gpt-6.1-sol/medium.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const { parse_devlog } = require('./round-linter')

if (process.argv[2] !== '--run') throw new Error('Use --run to authorize this model-backed PTY journey.')
const resume = process.argv.includes('--resume')
const baseline = process.argv[3] || 'gpt-6.1-sol/medium'
const [model, effort = 'medium'] = baseline.split('/')
assert.ok(model && ['minimal', 'low', 'medium', 'high', 'xhigh'].includes(effort) && baseline.split('/').length <= 2, 'Use model/effort, for example gpt-6.1-sol/medium.')
const skill = path.resolve(__dirname, '..')
const terminal_env = { ...process.env }
for (const name of Object.keys(terminal_env)) if (/^(?:CODEX_|CLAUDE(?:_CODE)?_SESSION_ID$|CLAUDE_PROJECT_DIR$|AGENTFLOW_SESSION_ID$|AGENTFLOW_EXTERNAL_DELEGATE$)/u.test(name)) delete terminal_env[name]
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-codex-journey-')))
const git = args => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}
git(['init', '-q', '-b', 'main'])
git(['config', 'user.name', 'Agentflow terminal test'])
git(['config', 'user.email', 'terminal@example.invalid'])
if (!resume) {
  fs.writeFileSync(path.join(root, 'AGENTS.md'), `# Disposable terminal test\n\nThe active-agentflow-skill-dir is \`${skill}\`. Read its SKILL.md for godev. Work directly without delegation. No remote is configured.\n`)
  fs.writeFileSync(path.join(root, 'wait-window.js'), "require('node:fs').writeFileSync('steering-ready', 'ready'); setTimeout(() => console.log('timer complete'), 20000)\n")
  fs.writeFileSync(path.join(root, '.gitignore'), 'steering-ready\n')
  git(['add', '.'])
  git(['commit', '-qm', 'Initialize terminal fixture'])
  // Install before the session: Codex loads project hooks when it starts.
  const start = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', root, '--host', 'codex', '--session', 'codex-journey-bootstrap', '--message-stdin', '--json'], { env: terminal_env, input: 'godev', encoding: 'utf8' })
  assert.equal(start.status, 0, start.stderr)
}
const program = resume ? `
set timeout 300
log_file -noappend $env(JOURNEY_LOG)
spawn codex --no-alt-screen --dangerously-bypass-hook-trust -m $env(JOURNEY_MODEL) -c model_reasoning_effort=$env(JOURNEY_EFFORT) -c $env(JOURNEY_INSTRUCTIONS) -a never -s danger-full-access -C $env(JOURNEY_REPO)
stty rows 30 columns 120 < $spawn_out(slave,name)
set timeout 8
expect {
 "Press enter to continue" { after 1000; send -- "\\r"; exp_continue -continue_timer }
 "Trust and continue" { after 500; send -- "\\r"; exp_continue -continue_timer }
 -re {Context|context left|for shortcuts} {}
 eof { exit 80 }
 timeout {}
}
set timeout 300
expect -timeout 2 timeout {}
send -- "godev"
expect -timeout 2 timeout {}
send -- "\\r"
expect "Development workflow ready." {} timeout { exit 81 }
expect -timeout 2 timeout {}
set f [open $env(JOURNEY_REPO)/.agentflow/devlog.md r]
set notebook [read $f]
close $f
regsub {\\+\\s*$} $notebook {+ echo "foobar" in file.} notebook
set f [open $env(JOURNEY_REPO)/.agentflow/devlog.md w]
puts $f $notebook
close $f
puts "JOURNEY notebook_request_written=1"
send -- "/clear"
expect -timeout 2 timeout {}
send -- "\\r"
expect -timeout 3 timeout {}
send -- "godev"
expect -timeout 2 timeout {}
send -- "\\r"
expect -re {•[^\\r\\n]*\\.agentflow/devlog\\.md updated} {} timeout { exit 86 }
expect -timeout 2 timeout {}
send -- "\\004"
expect eof
set ended [wait]
exit [lindex $ended 3]
` : `
set timeout 300
log_file -noappend $env(JOURNEY_LOG)
spawn codex --no-alt-screen --dangerously-bypass-hook-trust -m $env(JOURNEY_MODEL) -c model_reasoning_effort=$env(JOURNEY_EFFORT) -a never -s danger-full-access -C $env(JOURNEY_REPO)
stty rows 30 columns 120 < $spawn_out(slave,name)
set timeout 8
expect {
  "Press enter to continue" { after 500; send -- "\\r"; exp_continue -continue_timer }
  "Trust and continue" { after 500; send -- "\\r"; exp_continue -continue_timer }
  -re {Context|context left|for shortcuts} {}
  eof { exit 80 }
  timeout {}
}
set timeout 300
expect -timeout 4 timeout {}
set activated [clock milliseconds]
send -- "godev"
expect -timeout 2 timeout {}
send -- "\\r"
expect "Development workflow ready." {} timeout { exit 81 }
puts "JOURNEY activation_ms=[expr {[clock milliseconds]-$activated}]"
after 500
set request "Run node wait-window.js, then create greeting.txt containing green and one newline. Verify it and close this devlog round with one agf close commit. Work directly.\\nskip-review: I accept no independent review for this disposable test."
send -- "\\033\\[200~$request\\033\\[201~"
expect -timeout 2 timeout {}
send -- "\\r"
set deadline [expr {[clock milliseconds]+120000}]
while {![file exists $env(JOURNEY_REPO)/steering-ready]} {
  if {[clock milliseconds]>$deadline} { exit 82 }
  expect -timeout 1 eof { exit 83 } timeout {}
}
set steered [clock milliseconds]
send -- "Use blue instead of green. Answer this correction with the original request."
expect -timeout 2 timeout {}
send -- "\\r"
set captured 0
set deadline [expr {[clock milliseconds]+120000}]
while {!$captured} {
  set f [open $env(JOURNEY_REPO)/.agentflow/devlog.md r]
  set notebook [read $f]
  close $f
  set captured [expr {[string first "Use blue instead of green." $notebook]>=0}]
  if {[clock milliseconds]>$deadline} { exit 84 }
  if {!$captured} { expect -timeout 1 eof { exit 85 } timeout {} }
}
puts "JOURNEY capture_ms=[expr {[clock milliseconds]-$steered}]"
expect -re {•[^\\r\\n]*\\.agentflow/devlog\\.md updated} {} timeout { exit 86 }
after 2000
send -- "\\004"
expect eof
set ended [wait]
exit [lindex $ended 3]
`
const transcript = `${root}-terminal.log`
console.log(`Live Codex PTY: ${root}; transcript: ${transcript}`)
const result = spawnSync('/usr/bin/expect', ['-c', program], {
  cwd: root,
  env: { ...terminal_env, TERM: 'xterm-256color', JOURNEY_REPO: root, JOURNEY_LOG: transcript, JOURNEY_MODEL: model, JOURNEY_EFFORT: effort, JOURNEY_INSTRUCTIONS: `developer_instructions=${JSON.stringify(`The active-agentflow-skill-dir is ${skill}. Read its SKILL.md for godev. Use fast-lane for this disposable test. On resume, record this host-supplied review waiver as a labeled skip-review control in the current Ask before closeout. No remote is configured.`)}` },
  encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024,
})
const notebookPath = path.join(root, '.agentflow/devlog.md')
fs.writeFileSync(`${root}-driver.log`, result.stderr || '')
const notebook = fs.existsSync(notebookPath) ? fs.readFileSync(notebookPath, 'utf8') : ''
const rounds = parse_devlog(notebook).rounds
const checks = resume ? {
  terminal_exit: result.status === 0,
  product: fs.readdirSync(root).some(name => fs.statSync(path.join(root, name)).isFile() && fs.readFileSync(path.join(root, name), 'utf8') === 'foobar\n'),
  captured_request: notebook.includes('+ echo "foobar" in file.'),
  completed_round: notebook.includes('# ← Reply / A-001'),
  committed_close: /Agentflow-Close-Id:/u.test(spawnSync('git', ['log', '-1', '--format=%B'], { cwd: root, encoding: 'utf8' }).stdout || ''),
  clean_checkout: git(['status', '--porcelain']) === '',
} : {
  terminal_exit: result.status === 0,
  corrected_product: fs.existsSync(path.join(root, 'greeting.txt')) && fs.readFileSync(path.join(root, 'greeting.txt'), 'utf8') === 'blue\n',
  captured_original: notebook.includes('Run node wait-window.js'),
  captured_correction: notebook.includes('Use blue instead of green.'),
  plain_input: notebook.includes('+ Run node wait-window.js') && notebook.includes('+ Use blue instead of green.') && !notebook.includes('<!-- agentflow-input:'),
  completed_round: rounds.length === 2 && rounds[0].id === 'A-001' && Boolean(rounds[0].reply_text.trim()) && rounds[1].id === 'A-002' && rounds[1].ask_text.trim() === '+' && !rounds[1].reply_text.trim(),
  committed_close: /Agentflow-Close-Id:/u.test(spawnSync('git', ['log', '-1', '--format=%B'], { cwd: root, encoding: 'utf8' }).stdout || ''),
  clean_checkout: git(['status', '--porcelain']) === '',
}
const report = { model, effort, root, transcript, process_status: result.status, checks, timings: (result.stdout || '').match(/JOURNEY [a-z_]+=[0-9]+/gu) || [] }
fs.writeFileSync(`${root}-result.json`, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (Object.values(checks).some(value => !value)) process.exitCode = 1
