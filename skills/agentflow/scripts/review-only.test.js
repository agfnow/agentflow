'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { collect } = require('./completion-context');
const { lint_cross_check } = require('./round-linter');
const records = require('./completion-record');
const writer = require('./notebook-write');
const owner = require('./fixtures/notebook-owner');
owner.configure();

const fixture = (input = 'review-only') => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-review-only-')));
  const notebook = '.agentflow/devlog.md';
  const report = '.agentflow/artifacts/A-001-review/review.md';
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Review test']);
  git(['config', 'user.email', 'review@example.invalid']);
  write('product.js', 'module.exports = 1;\n');
  const config = require('./ag-settings').make_template('codex');
  config.switches['review-policy'] = 'require-independent';
  write('ag.json', JSON.stringify(config));
  write('.gitignore', '.agentflow/.tmp/\n');
  write(notebook, '# → Ask / A-001\n\n+\n');
  git(['add', '.']); git(['commit', '-qm', 'baseline']);
  const commit = git(['rev-parse', 'HEAD']);
  writer.append_input({ root, notebook, text: input, host: 'codex', session: owner.session });
  const record = {
    version: 1, kind: 'native-review', purpose: 'review-only', completion: 'complete',
    reviewer: 'review-thread', host: 'codex', source: { kind: 'git', commit }, report,
    independence: { separate_reviewer: true, context: 'shared', permissions: 'shared', family: 'same', read_only_enforced: false },
    limitations: ['Shared permissions.'], transport: { tool: 'spawn_agent', handle: 'review-thread' },
  };
  const report_text = `* _2026-09-29 10:00:00 +0800 (fixture/medium)_\n\nReviewed commit: ${commit}\n\nThe product fails the checked behavior; preserve the defect for repair.\n\nVerdict: BLOCKING\n\nConsensus: UNRESOLVED\n\nSelf-check: reviewed the exact source and retained the finding.\n`;
  write(report, report_text);
  record.report_sha256 = require('node:crypto').createHash('sha256').update(report_text).digest('hex');
  const round = (value = record, extra = '') => fs.readFileSync(path.join(root, notebook), 'utf8') + '\n# ← Reply / A-001\n\n## [SUMMARY]\n\n- Review completed; product has blocking defects.\n\n```completion-metadata\nReview record: ' + JSON.stringify(value) + '\n' + extra + '```\n';
  const check = (value = record, extra = '') => {
    const text = round(value, extra);
    const facts = collect({ project_root: root, notebook_path: notebook, active_host: 'codex', devlog_text: text });
    return lint_cross_check(text, root, facts.review_decision, { notebook_path: notebook, active_host: 'codex' });
  };
  const save_report = text => {
    write(report, text);
    record.report_sha256 = require('node:crypto').createHash('sha256').update(text).digest('hex');
  };
  return { root, notebook, report, record, report_text, write, save_report, git, round, check };
};

test('review-only record represents task completion without product PASS', () => {
  const f = fixture();
  assert.equal(records.validate_review_record(f.record, { allowed_worker: ['internal'], review_policy: 'require-independent' }), null);
  for (const change of [{ completion: 'pending' }, { purpose: 'unknown' }, { purpose: 'implementation' }]) {
    assert.ok(records.validate_review_record({ ...f.record, ...change }, { allowed_worker: ['internal'] }));
  }
});

test('review-only closes truthful blocking findings and unresolved consensus without rewriting report', () => {
  for (const command of ['review-only', '3ways', 'threeways']) {
    const f = fixture(command);
    assert.equal(f.check().status, 'pass', f.check().detail);
    assert.match(f.check().detail, /review completed/i);
    assert.equal(fs.readFileSync(path.join(f.root, f.report), 'utf8'), f.report_text);
  }
});

test('review-only cannot be claimed by a metadata flag or ambiguous owner input', () => {
  for (const input of ['implement the change', 'review-only\n\nfix the bug', 'fix the bug\n\nreview-only', '> review-only', '```\nreview-only\n```', 'For example: review-only', 'Should we use review-only?', 'please do 3ways and implement']) {
    const f = fixture(input);
    assert.equal(f.check().status, 'fail', input);
  }
});

test('review-only rejects all non-record changes even after commit and misleading declarations', () => {
  for (const file of ['product.js', 'product.test.js', 'ag.json', 'OPERATIONS.md']) {
    const f = fixture();
    f.write(file, file === 'ag.json' ? JSON.stringify(require('./ag-settings').make_template('codex')) : 'changed\n');
    const extra = 'Non-behavioral change: ' + file + ' — claimed harmless\n';
    assert.equal(f.check(f.record, extra).status, 'fail', file);
    f.git(['add', file]); f.git(['commit', '-qm', 'changed during review']);
    const record = { ...f.record, source: { kind: 'git', commit: f.git(['rev-parse', 'HEAD']) } };
    f.write(f.report, f.report_text.replace(f.record.source.commit, record.source.commit));
    assert.equal(f.check(record, extra).status, 'fail', 'already committed ' + file);
  }
});

test('review-only retains source and independence checks', () => {
  const f = fixture();
  for (const change of [{ source: { kind: 'git', commit: 'f'.repeat(40) } }, { independence: { ...f.record.independence, separate_reviewer: false } }, { transport: {} }]) assert.equal(f.check({ ...f.record, ...change }).status, 'fail');
  f.write(f.report, '');
  assert.equal(f.check().status, 'fail');
});

test('review reports accept a plain semantic stamp and diagnose missing fields separately', () => {
  const f = fixture();
  f.save_report(f.report_text.replace(/^\* _(.+)_/u, '$1'));
  assert.equal(f.check().status, 'warn', f.check().detail);
  f.save_report(f.report_text.replace(/^\* _.*\n/u, ''));
  assert.match(f.check().detail, /stamp|identity/i);
  assert.doesNotMatch(f.check().detail, /Self-check/);
  f.save_report(f.report_text.replace(/Self-check:.*\n/u, ''));
  assert.match(f.check().detail, /Self-check/);
  assert.doesNotMatch(f.check().detail, /stamp/);
});

test('review-only requires captured scope and cannot replace a preexisting evidence file', () => {
  const f = fixture();
  const scope = writer.read_input_scope(f.root, f.notebook, 'codex', 'A-001');
  fs.renameSync(path.join(f.root, scope.file), path.join(f.root, scope.file + '.saved'));
  assert.equal(f.check().status, 'fail');
  const g = fixture();
  g.git(['add', g.report]); g.git(['commit', '-qm', 'existing report']);
  const value = { ...g.record, source: { kind: 'git', commit: g.git(['rev-parse', 'HEAD']) } };
  g.write(g.report, g.report_text.replace(g.record.source.commit, value.source.commit));
  // A baseline including this file cannot authorize replacing it as new evidence.
  const text = g.round(value);
  const facts = collect({ project_root: g.root, notebook_path: g.notebook, active_host: 'codex', devlog_text: text });
  facts.review_decision.review_only_baseline = value.source.commit;
  assert.match(lint_cross_check(text, g.root, facts.review_decision).detail, /replace an existing file/);
});

test('plain stamp tolerance does not relax implementation PASS or required identity', () => {
  const f = fixture();
  const value = { ...f.record, purpose: 'implementation', verdicts: { outcome: 'PASS', minimality: 'PASS', conformance: 'PASS' } };
  const body = f.report_text.replace(/^\* _(.+)_/u, '$1').replace('Verdict: BLOCKING', 'Verdict: PASS\n\nOutcome: PASS\n\nMinimality: PASS\n\nConformance: PASS');
  f.write(f.report, body);
  assert.equal(f.check(value).status, 'warn');
  f.write(f.report, body.replace('Outcome: PASS', 'Outcome: BLOCKING'));
  assert.equal(f.check(value).status, 'fail');
  f.write(f.report, body.replace('2026-09-29', '2026-02-30'));
  assert.match(f.check(value).detail, /identity stamp/);
  f.write(f.report, body + '\n2026-09-29 10:00:00 +0800 (another/medium)\n');
  assert.match(f.check(value).detail, /identity stamp/);
});

test('review-only cannot exempt an unused dispatch record to deliver operating instructions', () => {
  const f = fixture();
  const dispatch = 'OPERATIONS.md';
  f.write(dispatch, '# New operating instructions\n\nRun the changed deployment process.\n');
  const value = { ...f.record, transport: { ...f.record.transport, dispatch_record: dispatch } };
  const result = f.check(value, 'Non-behavioral change: OPERATIONS.md — claimed harmless\n');
  assert.equal(result.status, 'fail', result.detail);
});

test('review-only retains the validated original dispatch fallback when report omits source', () => {
  const f = fixture();
  const dispatch = '.agentflow/artifacts/A-001-review/dispatch.md';
  f.save_report(f.report_text.replace(/^Reviewed commit:.*\n/mu, ''));
  f.write(dispatch, 'Review target commit: ' + f.record.source.commit + '\n');
  const value = { ...f.record, transport: { ...f.record.transport, dispatch_record: dispatch } };
  assert.equal(f.check(value).status, 'pass', f.check(value).detail);
  f.write(dispatch, 'Review target commit: ' + 'f'.repeat(40) + '\n');
  assert.equal(f.check(value).status, 'fail');
});
