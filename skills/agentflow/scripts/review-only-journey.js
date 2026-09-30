#!/usr/bin/env node
'use strict';

// Synthetic reviewer evidence exercises real closeout and stop-hook commands; no model call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { format_local_timestamp } = require('./local-time');
require('./fixtures/notebook-owner').configure();
assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Run this journey in a real terminal/PTY');
console.log('Terminal: ' + execFileSync('tty', { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' }).trim());
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-review-only-pty-')));
const notebook = '.agentflow/devlog.md';
const report = '.agentflow/artifacts/A-001-review/review.md';
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
git(['init', '-q', '-b', 'main']);
git(['config', 'user.name', 'Review journey']);
git(['config', 'user.email', 'review@example.invalid']);
require('./ag-settings').initialize_project({ repo_root: root, active_host: 'codex' });
require('./agf').update_ignore_file(root);
const config_path = path.join(root, 'ag.json');
const config = JSON.parse(fs.readFileSync(config_path));
config.switches['review-policy'] = 'require-independent';
fs.writeFileSync(config_path, JSON.stringify(config));
fs.writeFileSync(path.join(root, 'product.js'), 'module.exports = false;\n');
git(['add', '.']); git(['commit', '-qm', 'baseline']);
const target = git(['rev-parse', 'HEAD']);
const run = (file, args, input, expected = 0) => {
  console.log('$ node ' + file + ' ' + args.join(' '));
  console.log('stdin: ' + input);
  const child = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: root, input, encoding: 'utf8', timeout: 30000 });
  process.stdout.write(child.stdout || ''); process.stderr.write(child.stderr || '');
  console.log('Exit: ' + child.status);
  assert.equal(child.status, expected, child.error?.message);
  return child;
};
run('notebook-write.js', ['append-input', '--host', 'codex', '--notebook', notebook, '--input-stdin'], 'godev\nreview-only, reviewer 用 codex\ntarget: ' + target + ' ~ HEAD');
run('notebook-write.js', ['append-input', '--host', 'codex', '--notebook', notebook, '--input-stdin'], '授權接管並繼續審查');
assert.equal(git(['remote']), '', 'The review fixture must have no remote');
const record = {
  version: 1, kind: 'native-review', purpose: 'review-only', completion: 'complete',
  reviewer: 'synthetic-reviewer', host: 'codex', source: { kind: 'git', commit: target }, report,
  independence: { separate_reviewer: true, context: 'shared', permissions: 'shared', family: 'same', read_only_enforced: false },
  limitations: ['Synthetic reviewer fixture; no actual model invocation.'], transport: { tool: 'fixture', handle: 'synthetic-reviewer' },
};
const report_text = `${format_local_timestamp()} (fixture/medium)\n\nReviewed commit: ${target}\n\nThe product returns false when true is required.\n\nVerdict: BLOCKING\n\nConsensus: UNRESOLVED\n\nSelf-check: preserved the defect and exact source.\n`;
fs.mkdirSync(path.dirname(path.join(root, report)), { recursive: true });
fs.writeFileSync(path.join(root, report), report_text);
record.report_sha256 = require('node:crypto').createHash('sha256').update(report_text).digest('hex');
const manifest = {
  version: 1, notebook, ask: 'A-001', run_events: [],
  reply: '## [SUMMARY]\n\n- Review completed; the product has a blocking defect.\n\n## [FINAL REPORT]\n\n1. The review found a defect. Product acceptance remains blocked.\n\n```completion-metadata\nReview record: ' + JSON.stringify(record) + '\n```\n',
  status: { project: 'review-only journey', notebook, notebook_kind: 'root', current_commit: 'local delivery recorded in Git history', tests_scenarios: 'review completed with truthful defect', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'review complete', open: 'product defect', next: 'owner chooses repair', artifacts: report, archived_eras: 'none', streams: [] },
  allowed_paths: [notebook, report], commit_message: 'record completed review with defects', delivery: { mode: 'local' },
};
const close = run('agf.js', ['close', '--host', 'codex', '--manifest-stdin'], JSON.stringify(manifest));
assert.equal(JSON.parse(close.stdout).ok, true);
assert.equal(fs.readFileSync(path.join(root, report), 'utf8'), report_text);
const saved = fs.readFileSync(path.join(root, notebook), 'utf8');
assert.match(saved, /product has a blocking defect/);
assert.match(saved, /# → Ask \/ A-002/);
assert.doesNotMatch(saved, /Review record:/);
assert.equal(git(['status', '--porcelain']), '');
assert.equal(git(['diff', target, 'HEAD', '--', 'product.js']), '');
console.log('Git delivery commit: ' + git(['rev-parse', 'HEAD']));
console.log('Git status after close: clean; product unchanged; no remote.');
run('stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }));
fs.writeFileSync(path.join(root, 'product.js'), 'module.exports = true;\n');
const rejected = run('stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }), 2);
assert.match(rejected.stderr, /review-only cannot deliver|unreviewed changes/);
fs.writeFileSync(path.join(root, 'product.js'), 'module.exports = false;\n');
fs.writeFileSync(path.join(root, report), report_text.replace('Verdict: BLOCKING', 'Verdict: PASS'));
const tampered = run('stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }), 2);
assert.match(tampered.stderr, /SHA-256/);
fs.writeFileSync(path.join(root, report), report_text);
assert.equal(git(['status', '--porcelain']), '');
assert.equal(fs.readFileSync(path.join(root, report), 'utf8'), report_text);
console.log('PASS: reported review command and continuation closed truthful BLOCKING findings, unchanged report, stop-hook agreed, later product/report changes refused, final Git state clean.');
console.log('Fixture retained: ' + root);
