#!/usr/bin/env node
'use strict';

// Opt-in model-backed interactive test, retaining repositories and evidence.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { parse_devlog } = require('./round-linter');

const session_entries = session => {
  const projects = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects');
  const files = fs.readdirSync(projects, { withFileTypes: true }).filter(e => e.isDirectory())
    .map(e => path.join(projects, e.name, `${session}.jsonl`)).filter(f => fs.existsSync(f));
  assert.equal(files.length, 1, 'one exact native Claude transcript');
  return fs.readFileSync(files[0], 'utf8').trim().split('\n').map(JSON.parse);
};

if (process.argv[2] === '--probe') {
  try {
    const [, , , repo, session, turns, rounds] = process.argv;
    const entries = session_entries(session);
    assert.ok(entries.filter(e => e.type === 'system' && e.subtype === 'turn_duration').length >= Number(turns));
    const text = fs.readFileSync(path.join(repo, '.agentflow/devlog.md'), 'utf8');
    assert.equal(parse_devlog(text).rounds.filter(r => r.reply_text.trim()).length, Number(rounds));
  } catch { process.exitCode = 1; }
} else {
  assert.equal(process.argv[2], '--run', 'Use --run to authorize model-backed Claude PTY conversations. Optional: --codex-first.');
  const codex_first = process.argv.includes('--codex-first');
  const skill = path.resolve(__dirname, '..');
  const base = path.join(os.homedir(), 'jxtmp');
  fs.mkdirSync(base, { recursive: true });
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(base, `agf-claude-${codex_first ? 'codex-first' : 'fresh'}-`)));
  const session = crypto.randomUUID();
  const env = { ...process.env, TERM: 'xterm-256color' };
  // A nested CLI must not inherit its parent's host/session identity.
  for (const name of Object.keys(env)) if (/^(?:CODEX_|CLAUDE(?:_CODE)?_SESSION_ID$|CLAUDE_PROJECT_DIR$|AGENTFLOW_SESSION_ID$|AGENTFLOW_EXTERNAL_DELEGATE$|CLAUDECODE$)/u.test(name)) delete env[name];
  const run = (command, args, input) => {
    const result = spawnSync(command, args, { cwd: repo, env, input, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return result.stdout.trim();
  };
  run('git', ['init', '-q', '-b', 'main']);
  run('git', ['config', 'user.name', 'Agentflow Claude terminal test']);
  run('git', ['config', 'user.email', 'claude-pty@example.invalid']);
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), `# Disposable Claude terminal test\n\nThe active-agentflow-skill-dir is \`${skill}\`. Read its SKILL.md for godev. Work directly without delegation. No remote is configured.\n`);
  fs.writeFileSync(path.join(repo, 'wait-window.js'), "require('node:fs').writeFileSync('steering-ready', 'ready'); setTimeout(() => console.log('timer complete'), 15000);\n");
  fs.writeFileSync(path.join(repo, '.gitignore'), 'steering-ready\n');
  run('git', ['add', '.']);
  run('git', ['commit', '-qm', 'Initialize Claude terminal fixture']);
  if (codex_first) {
    const first = JSON.parse(run(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', repo, '--host', 'codex', '--session', 'codex-bootstrap', '--message-stdin', '--json'], 'godev'));
    assert.equal(first.active_host, 'codex');
    assert.ok(fs.existsSync(path.join(repo, '.codex/hooks.json')));
    assert.equal(fs.existsSync(path.join(repo, '.claude')), false);
  }
  const transcript = `${repo}-terminal.log`;
  const program = String.raw`
set timeout 300
log_file -noappend $env(JOURNEY_LOG)
proc submit {message} {
  global spawn_id env
  send -- "\033\[200~$message\033\[201~"
  after 500
  send -- "\r"
}
proc ready {turns rounds} {
  global spawn_id env
  set deadline [expr {[clock milliseconds]+300000}]
  while {1} {
    if {![catch {exec $env(JOURNEY_NODE) $env(JOURNEY_SCRIPT) --probe $env(JOURNEY_REPO) $env(JOURNEY_SESSION) $turns $rounds}]} { return }
    if {[clock milliseconds]>$deadline} { puts "JOURNEY timeout turns=$turns rounds=$rounds"; exit 81 }
    expect -timeout 1 eof { exit 82 } timeout {}
  }
}
proc launch {resume} {
  global spawn_id env
  if {$resume} {
    spawn claude --dangerously-skip-permissions --strict-mcp-config --resume $env(JOURNEY_SESSION)
  } else {
    spawn claude --dangerously-skip-permissions --strict-mcp-config --session-id $env(JOURNEY_SESSION)
  }
  stty rows 40 columns 140 < $spawn_out(slave,name)
  expect {
    -re {Yes,.*trust.*folder} { after 500; send -- "\033\[B\r"; exp_continue }
    -re {bypass.*permissions} {}
    timeout { exit 80 }
  }
  after 1000
}
launch 0
submit "godev"
ready 1 0
puts "JOURNEY activation_ok=1"
submit $env(JOURNEY_FIRST)
set deadline [expr {[clock milliseconds]+180000}]
while {![file exists $env(JOURNEY_REPO)/steering-ready]} {
  if {[clock milliseconds]>$deadline} { exit 83 }
  expect -timeout 1 eof { exit 84 } timeout {}
}
submit $env(JOURNEY_CORRECTION)
ready 2 1
puts "JOURNEY steering_close_ok=1"
submit "/exit"
expect eof
set ended [wait]
if {[lindex $ended 3] != 0} { exit 85 }
launch 1
submit "godev"
ready 3 1
puts "JOURNEY resume_ok=1"
submit $env(JOURNEY_SECOND)
ready 4 2
puts "JOURNEY settings_close_ok=1"
submit $env(JOURNEY_THIRD)
ready 5 3
puts "JOURNEY ownership_close_ok=1"
submit "/exit"
expect eof
exit [lindex [wait] 3]
`;
  const first = 'fast-lane Run node wait-window.js, then create greeting.txt containing green and one newline. Verify it, save the complete answer, and close with local delivery. Work directly.';
  const correction = 'Use blue instead of green. Answer this correction together with the original request.';
  const second = 'fast-lane Change inline-reply to on and log-verbosity to off using agf settings with --host claude. Change greeting.txt to violet and one newline. Verify the file and settings, then close locally with your own review.';
  const third = 'fast-lane Change notebook-ownership to on and inline-reply to off using agf settings with --host claude. Create ownership.txt containing enabled and one newline. Verify the result and close locally with your own review.';
  console.log(`Live Claude PTY: ${repo}; transcript: ${transcript}`);
  const result = spawnSync('/usr/bin/expect', ['-c', program], { cwd: repo, env: { ...env,
    JOURNEY_LOG: transcript, JOURNEY_NODE: process.execPath, JOURNEY_SCRIPT: __filename, JOURNEY_REPO: repo, JOURNEY_SESSION: session,
    JOURNEY_FIRST: first, JOURNEY_CORRECTION: correction, JOURNEY_SECOND: second, JOURNEY_THIRD: third,
  }, encoding: 'utf8', timeout: 1200000, maxBuffer: 32 * 1024 * 1024 });
  let checks = {}, diagnostic;
  try {
    const text = fs.readFileSync(path.join(repo, '.agentflow/devlog.md'), 'utf8');
    const rounds = parse_devlog(text).rounds.filter(r => r.reply_text.trim());
    const config = JSON.parse(fs.readFileSync(path.join(repo, 'ag.json'), 'utf8'));
    const entries = session_entries(session);
    const answers = entries.filter(e => e.type === 'assistant' && !e.isSidechain).flatMap(e => (e.message?.content || []).filter(b => b.type === 'text').map(b => b.text));
    checks = {
      terminal_exit: result.status === 0,
      claude_hooks: ['Stop', 'UserPromptSubmit'].every(event => JSON.parse(fs.readFileSync(path.join(repo, '.claude/settings.json'))).hooks[event].length === 1),
      codex_hooks_preserved: fs.existsSync(path.join(repo, '.codex/hooks.json')) === codex_first,
      three_completed_rounds: rounds.length === 3,
      original_and_correction: text.split(`+ ${first}`).length === 2 && text.split(`+ ${correction}`).length === 2 && rounds[0]?.ask_text.includes(correction),
      product: fs.readFileSync(path.join(repo, 'greeting.txt'), 'utf8') === 'violet\n' && fs.readFileSync(path.join(repo, 'ownership.txt'), 'utf8') === 'enabled\n',
      settings: config.switches['inline-reply'] === 'off' && config.switches['log-verbosity'] === 'off' && config.switches['notebook-ownership'] === 'on',
      no_suppressed_runs: rounds.slice(1).every(r => !/^## \[RUN-/mu.test(r.text) && !r.wip_text.trim()),
      verified_claude_stamps: rounds.every(r => /\(claude-[A-Za-z0-9._-]+\/[A-Za-z_-]+\)_/u.test(r.reply_text)),
      inline_saved_reply: answers.includes(rounds[1]?.reply_text.replace(/\r?\n---\s*$/u, '').trim()),
      receipt_only: answers.filter(t => t === '.agentflow/devlog.md updated').length >= 2,
      clean_checkout: run('git', ['status', '--porcelain']) === '',
      three_close_commits: run('git', ['log', '--format=%B']).split('Agentflow-Close-Id:').length === 4,
      hooks_without_errors: entries.filter(e => e.type === 'system' && e.subtype === 'stop_hook_summary').every(e => !(e.hookErrors || []).length),
    };
  } catch (error) { diagnostic = error.message; }
  const report = { repo, transcript, session, codex_first, process_status: result.status, checks, diagnostic, error: result.error?.message, milestones: (result.stdout || '').match(/JOURNEY [^\r\n]+/gu) || [] };
  fs.writeFileSync(`${repo}-result.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (diagnostic || Object.values(checks).some(v => !v) || !Object.keys(checks).length) process.exitCode = 1;
}
