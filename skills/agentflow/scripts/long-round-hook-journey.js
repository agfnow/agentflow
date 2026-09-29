#!/usr/bin/env node
'use strict';

// Run in a real terminal: node skills/agentflow/scripts/long-round-hook-journey.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { format_local_timestamp } = require('./local-time.js');

assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Run this journey in a real terminal/PTY');
console.log('Terminal: ' + execFileSync('tty', { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' }).trim());
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-long-round-hook-')));
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git(['init', '-q', '-b', 'main']);
git(['config', 'user.name', 'Agentflow journey']);
git(['config', 'user.email', 'journey@example.invalid']);
const run = (file, args, input) => {
  console.log('$ node ' + file + ' ' + args.join(' '));
  if (input !== undefined) console.log('stdin: ' + input);
  const child = spawnSync(process.execPath, [path.join(__dirname, file), ...args], {
    cwd: root, input, encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], timeout: 30000,
  });
  console.log('Exit: ' + child.status);
  assert.equal(child.status, 0, child.error?.message);
};
const notebook = '.agentflow/devlog.md';
const identity = ['--host', 'journey', '--session', 'long-round-fixture'];
run('agf.js', ['start', '--repo', root, ...identity, '--message-stdin', '--json'], 'Verify a long-running round.');
const target = path.join(root, notebook);
const old = format_local_timestamp(new Date(Date.now() - 72 * 3600000));
const history = '\n---\n\n## [RUN-001] Event — ' + old + ' (A-001)\n\n- Started three days ago.\n';
fs.appendFileSync(target, history);
run('agf.js', ['close', ...identity, '--manifest-stdin'], JSON.stringify({
  version: 1, notebook, ask: 'A-001', run_events: [],
  reply: '## [SUMMARY]\n\n- Long round completed.\n\n## [FINAL REPORT]\n\n1. Preserved three-day-old progress and saved a fresh Reply.\n',
  status: { project: 'long round journey', notebook, notebook_kind: 'root', current_commit: 'local delivery recorded in Git history', tests_scenarios: 'old progress preserved', config_path: 'ag.json', host: 'journey', validation: 'validated', proven: 'long round closes', open: 'none', next: 'none', artifacts: 'none', archived_eras: 'none', streams: [] },
  allowed_paths: [notebook, 'ag.json', '.gitignore'], commit_message: 'verify long round', delivery: { mode: 'local' },
}));
const saved = fs.readFileSync(target, 'utf8');
assert.ok(saved.includes(history));
assert.ok(saved.includes('# ← Reply / A-001'));
assert.ok(saved.includes('# → Ask / A-002'));
assert.equal(git(['status', '--porcelain']), '');
assert.equal(git(['show', 'HEAD:' + notebook]), saved.trim());

const config = path.join(root, '.codex', 'hooks.json');
fs.mkdirSync(path.dirname(config), { recursive: true });
const command = 'node "' + path.join(__dirname, 'stop-hook.js') + '" --host codex';
const entry = { hooks: [{ type: 'command', command }] };
const bytes = JSON.stringify({ hooks: { Stop: [entry], UserPromptSubmit: [entry] } }, null, 4) + '\n';
fs.writeFileSync(config, bytes);
run('install-hook.js', ['--project', '--host', 'codex']);
assert.equal(fs.readFileSync(config, 'utf8'), bytes);
assert.equal(fs.existsSync(config + '.agentflow-backup'), false);
console.log('PASS: long-round close committed unchanged history; equivalent hooks kept exact bytes without a backup.');
console.log('Fixture retained: ' + root);
