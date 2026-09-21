'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const agf = path.join(__dirname, 'agf.js');
const writer = path.join(__dirname, 'notebook-write.js');
const expect = '/usr/bin/expect';

const program = [
  'set timeout 30',
  'log_user 1',
  'spawn -noecho $env(BOUNDARY_NODE) $env(BOUNDARY_DRIVER)',
  'expect eof',
  'set result [wait]',
  'exit [lindex $result 3]',
].join('\n');

test('real terminal verifies owner refusal, hash-checked handoff and oversized notebook compaction', { skip: !fs.existsSync(expect) }, () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-boundary-pty-')));
  const driver = path.join(root, 'terminal-driver.cjs');
  fs.writeFileSync(driver, [
    "const cp = require('node:child_process');",
    "if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error('real terminal required');",
    "process.stdout.write('TTY: ' + cp.execFileSync('tty', {stdio:[0,'pipe','pipe'],encoding:'utf8'}));",
    "const command = JSON.parse(process.env.BOUNDARY_COMMAND);",
    "console.log('Command: ' + JSON.stringify(command));",
    "console.log('Input: ' + process.env.BOUNDARY_INPUT);",
    "const result = cp.spawnSync(process.execPath, command, {cwd:process.cwd(),input:process.env.BOUNDARY_INPUT,encoding:'utf8'});",
    "process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');",
    "console.log('Exit: ' + result.status); process.exitCode = result.status ?? 1;",
  ].join('\n'));
  const run = (session, command, input = '') => {
    const result = spawnSync(expect, ['-c', program], {
      cwd: root, encoding: 'utf8', timeout: 40000,
      env: {
        PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color',
        CODEX_THREAD_ID: session, CODEX_SESSION_ID: session,
        BOUNDARY_NODE: process.execPath, BOUNDARY_DRIVER: driver,
        BOUNDARY_COMMAND: JSON.stringify(command), BOUNDARY_INPUT: input,
      },
    });
    const output = (result.stdout || '') + (result.stderr || '');
    assert.match(output, /TTY: \/dev\//);
    assert.match(output, /Command:/);
    assert.match(output, /Input:/);
    assert.match(output, /Exit: [01]/);
    return { status: result.status, output };
  };
  const notebook = '.agentflow/devlog.md';
  const file = path.join(root, notebook);
  const start = run('owner-a', [agf, 'start', '--repo', root, '--host', 'codex', '--message-stdin', '--json'], 'terminal owner request\n');
  assert.equal(start.status, 0, start.output);
  assert.match(start.output, /terminal owner request/);
  const before = fs.readFileSync(file);
  const capture_args = [writer, 'append-input', '--notebook', notebook, '--host', 'codex', '--input-stdin'];
  const foreign = run('owner-b', capture_args, 'foreign marker\n');
  assert.equal(foreign.status, 1, foreign.output);
  assert.match(foreign.output, /belongs to codex session owner-a/);
  assert.deepEqual(fs.readFileSync(file), before);
  const history = '# → Ask / A-000\n\n+ old task\n\n# ← Reply / A-000\n\n' + '歷史 preserved bytes\n'.repeat(65000) + '\n---\n\n';
  fs.writeFileSync(file, before.toString('utf8').replace('# → Ask / A-001', history + '# → Ask / A-001'));
  assert.ok(fs.statSync(file).size > 1024 * 1024);
  const compact = run('owner-a', [agf, 'compact', '--notebook', notebook, '--host', 'codex']);
  assert.equal(compact.status, 0, compact.output);
  assert.match(compact.output, /"sha256"/);
  assert.deepEqual(fs.readFileSync(path.join(root, '.agentflow/devlog.archive.md')), Buffer.from(history));
  assert.ok(fs.statSync(file).size < 4096);
  const inspected = run('owner-a', [agf, 'owner', 'inspect', '--notebook', notebook]);
  assert.equal(inspected.status, 0, inspected.output);
  const info = require('./notebook-owner').inspect({root,notebook});
  const handoff = run('owner-b', [agf, 'owner', 'adopt', '--notebook', notebook, '--host', 'codex', '--session', 'owner-b', '--ask', info.ask, '--expect', info.owner.token, '--sha256', info.sha256]);
  assert.equal(handoff.status, 0, handoff.output);
  const handed = fs.readFileSync(file);
  const stale = run('owner-a', capture_args, 'stale owner marker\n');
  assert.equal(stale.status, 1, stale.output);
  assert.deepEqual(fs.readFileSync(file), handed);
  const next = run('owner-b', capture_args, 'accepted after handoff\n');
  assert.equal(next.status, 0, next.output);
  assert.match(fs.readFileSync(file, 'utf8'), /accepted after handoff/);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /foreign marker|stale owner marker/);
  assert.ok(fs.readdirSync(path.join(root, '.agentflow/.tmp')).some(name => name.startsWith('agentflow-input-codex-')));
  assert.equal(fs.readdirSync(path.join(root, '.codex')).some(name => name.startsWith('agentflow-input-')), false);
});
