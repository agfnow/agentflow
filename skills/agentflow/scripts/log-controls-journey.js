#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const settings = require('./ag-settings');
const { parse_devlog } = require('./round-linter');
const { format_local_timestamp } = require('./local-time');

assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Run this journey in a real terminal/PTY');
console.log('PTY_OK: stdin/stdout are terminals');
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-log-controls-pty-')));
const notebook = '.agentflow/devlog.md';
const run = (cwd, script, args, input, status = 0) => {
  console.log(`$ node ${script} ${args.join(' ')}`);
  if (input !== undefined) console.log(`stdin: ${input}`);
  const child = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd, input, encoding: 'utf8', timeout: 30000 });
  process.stdout.write(child.stdout || '');
  process.stderr.write(child.stderr || '');
  console.log(`exit: ${child.status}`);
  assert.equal(child.status, status, child.error?.message || `${script} exited ${child.status}`);
  return child.stdout;
};
for (const level of ['off', 'wip', 'all']) for (const inline of ['off', 'on']) {
  const cwd = path.join(root, `${level}-${inline}`);
  fs.mkdirSync(cwd);
  settings.initialize_project({ repo_root: cwd, active_host: 'test-host' });
  run(cwd, 'agf.js', ['settings', 'change', '--host', 'test-host', '--notebook', notebook, '--set', `log-verbosity: ${level}`, '--set', `inline-reply: ${inline}`]);
  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'ag.json'), 'utf8'));
  assert.equal(config.switches['log-verbosity'], level);
  assert.equal(config.switches['inline-reply'], inline);
  const config_bytes = fs.readFileSync(path.join(cwd, 'ag.json'), 'utf8');
  run(cwd, 'agf.js', ['settings', 'change', '--host', 'test-host', '--set', 'log-verbosity: quiet'], undefined, 1);
  assert.equal(fs.readFileSync(path.join(cwd, 'ag.json'), 'utf8'), config_bytes);
  run(cwd, 'notebook-write.js', ['append-input', '--host', 'test-host', '--notebook', notebook, '--input-stdin'], 'Verify logging and preserve my Reply.');
  const tracker = '.agentflow/artifacts/A-001-logging/tracker.md';
  fs.mkdirSync(path.dirname(path.join(cwd, tracker)), { recursive: true });
  let text = execFileSync(process.execPath, [path.join(__dirname, 'tracker-contract.js'), 'template'], { encoding: 'utf8' });
  text = text.replaceAll('<work-key>', 'A-001-logging').replaceAll('<A-NNN>', 'A-001').replace('<goal>', 'Verify settings in a terminal').replace('<YYYY-MM-DD HH:MM:SS ±HHMM>', format_local_timestamp()).replaceAll('<count>', '1').replace('**Completed:** 0.', '**Completed:** 1.').replace('**Remaining:** 1.', '**Remaining:** 0.').replace(/^- \[ \] \*\*T-1:.*$/mu, '- [x] **T-1:** Settings persisted and invalid input refused. Proof: CLI exit status and unchanged configuration bytes. Source: A-001.').replace('**Evidence commit:** uncommitted.', '**Evidence commit:** not applicable.').replace('**State:** active.', '**State:** complete.').replace('**Reason:** Work remains.', '**Reason:** Verified.').replace('**Current item:** T-1.', '**Current item:** none.').replace('**Last proven result:** None.', '**Last proven result:** Persisted settings.').replace('<next action>', 'none').replace('<paths>', notebook).replace('**All accepted tasks checked:** no.', '**All accepted tasks checked:** yes.').replace('**Next action remaining:** T-1.', '**Next action remaining:** none.').replace('**Judgment:** active.', '**Judgment:** complete.').replace('**Evidence status:** current.', '**Evidence status:** complete.');
  fs.writeFileSync(path.join(cwd, tracker), text);
  run(cwd, 'notebook-write.js', ['append-run', '--notebook', notebook, '--ask', 'A-001', '--input-stdin'], '- Verified setting values and scope.');
  run(cwd, 'notebook-write.js', ['append-wip', '--notebook', notebook, '--ask', 'A-001', '--input-stdin'], '- **Finished:** Settings saved.\n\n- **Running now:** Closeout.\n\n- **Still to do:** None.\n\n- **Next work action:** Save Reply.\n\n- **Checks:** [x] tracker.md | ' + (level === 'all' ? '[x] devlog RUN | ' : '') + '[x] scope matches tracker');
  // Refresh the recorded timestamp as well as the derived completion counts.
  fs.writeFileSync(path.join(cwd, tracker), fs.readFileSync(path.join(cwd, tracker), 'utf8').replace(/(Last update:\*\* )[^\n]+/u, `$1${format_local_timestamp()}.`));
  run(cwd, 'tracker-contract.js', ['validate', '--refresh', '--repo', cwd, '--tracker', tracker]);
  const manifest = {
    version: 1, notebook, ask: 'A-001', run_events: ['- Closeout checked.'],
    reply: '## [SUMMARY]\n\n- Logging controls work.\n\n## [FINAL REPORT]\n\n1. This full Reply remains saved at every verbosity.\n',
    status: { project: 'logging PTY', notebook, notebook_kind: 'root', current_commit: 'not applicable', tests_scenarios: 'PTY matrix', config_path: 'ag.json', host: 'test-host', validation: 'validated', proven: 'control behavior', open: 'none', next: 'await owner', artifacts: tracker, archived_eras: 'none', streams: [] },
    allowed_paths: [notebook, 'ag.json', tracker], commit_message: 'record terminal check', delivery: { mode: 'local' },
  };
  const output = JSON.parse(run(cwd, 'agf.js', ['close', '--manifest-stdin'], JSON.stringify(manifest)));
  const saved = fs.readFileSync(path.join(cwd, notebook), 'utf8');
  assert.equal((saved.match(/^## \[RUN-/gm) || []).length, level === 'all' ? 2 : 0);
  assert.equal((saved.match(/^## \[WIP-/gm) || []).length, level === 'off' ? 0 : 1);
  if (inline === 'on') assert.equal(output.display.text, parse_devlog(saved).rounds[0].reply_text.replace(/\r?\n---\s*$/u, '').trim());
  assert.equal(output.display.inline_reply, inline === 'on');
  if (inline === 'off') assert.equal(output.display.text, `${notebook} updated`);
  console.log(`HOST DISPLAY:\n${output.display.text}`);
  assert.match(saved, /This full Reply remains saved at every verbosity/);
}
console.log(`PASS: all six combinations, invalid setting refusal, persisted Ask/Reply, exact RUN/WIP counts and visible display. Fixtures retained: ${root}`);
