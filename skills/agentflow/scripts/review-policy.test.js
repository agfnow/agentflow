'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const { lint_cross_check, completion_metadata } = require('./round-linter');
const completion = require('./completion-record');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

const fixture = (git = true) => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-review-policy-')));
  const write = (name, value) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), value);
  };
  write('product.js', 'module.exports = 1;\n');
  const command = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git) {
    command(['init', '-q', '-b', 'main']);
    command(['config', 'user.name', 'Review fixture']);
    command(['config', 'user.email', 'review@example.invalid']);
    command(['add', '.']);
    command(['commit', '-qm', 'fixture']);
  }
  const source = git ? { kind: 'git', commit: command(['rev-parse', 'HEAD']) }
    : { kind: 'no-git', files: [{ path: 'product.js', sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'product.js'))).digest('hex') }] };
  const report = '.agentflow/artifacts/A-001-review/review.md';
  const record = {
    version: 1, kind: 'host-review', reviewer: 'session-host', host: 'session-host', source, report,
    verdicts: { outcome: 'PASS', minimality: 'PASS', conformance: 'PASS' },
    independence: { separate_reviewer: false, context: 'shared', permissions: 'shared', family: 'same', read_only_enforced: false },
    limitations: ['Independent review unavailable.'],
    unavailable: [{ kind: 'external', reason: 'No eligible executable.' }, { kind: 'internal', reason: 'No native interface.' }],
  };
  const save_report = value => write(report, `* _2026-09-19 15:30:00 +0800 (fixture/unknown)_\n\n${value.kind === 'git' ? 'Reviewed implementation commit: ' + value.commit : 'Reviewed source sha256: ' + crypto.createHash('sha256').update(JSON.stringify(value.files)).digest('hex')}\n\nOutcome: PASS\n\nMinimality: PASS\n\nConformance: PASS\n\nVerdict: PASS\n\nSelf-check: inspected product and evidence.\n`);
  save_report(source);
  const round = (value = record, extra = '') => `# → Ask / A-001\n\n+ Implement the requested behavior.\n\n# ← Reply / A-001\n\n## [SUMMARY]\n\n- Complete with recorded review.\n\n## [FINAL REPORT]\n\n1. Verified product.\n\n\`\`\`completion-metadata\nReview record: ${JSON.stringify(value)}\n${extra}\`\`\`\n`;
  const decision = {
    status: 'required', reason: 'source changed', record_files: ['.agentflow/devlog.md'],
    review_policy: 'prefer-independent', allowed_worker: ['external', 'internal', 'host'],
    independent_required: false,
  };
  return { root, write, record, round, decision, save_report };
};

test('policy-authorized host review completes without inventing an owner waiver', () => {
  const f = fixture();
  const result = lint_cross_check(f.round(), f.root, f.decision);
  assert.equal(result.status, 'pass', result.detail);
  assert.match(result.detail, /host review/i);
  assert.doesNotMatch(result.detail, /owner waived/i);
  for (const change of [{ review_policy: 'require-independent' }, { independent_required: true }, { allowed_worker: ['external', 'internal'] }, { allowed_worker: 'host' }, { review_policy: 'anything' }]) {
    assert.equal(lint_cross_check(f.round(), f.root, { ...f.decision, ...change }).status, 'fail');
  }
});

test('host fallback needs unavailability for every permitted separate kind and truthful identity', () => {
  const f = fixture();
  for (const change of [
    { unavailable: [] },
    { unavailable: [{ kind: 'external', reason: 'missing' }] },
    { reviewer: 'different-session' },
    { independence: { ...f.record.independence, separate_reviewer: true } },
    { verdicts: { ...f.record.verdicts, conformance: 'BLOCKING' } },
  ]) assert.equal(lint_cross_check(f.round({ ...f.record, ...change }), f.root, f.decision).status, 'fail');
  assert.equal(lint_cross_check(f.round({ ...f.record, unavailable: [] }), f.root, { ...f.decision, allowed_worker: ['host'] }).status, 'pass');
});

test('native review records a separate handle without claiming fresh context or permission isolation', () => {
  const f = fixture();
  const native = { ...f.record, kind: 'native-review', reviewer: 'native-thread-7', transport: { handle: 'native-thread-7', tool: 'spawn_agent' }, independence: { ...f.record.independence, separate_reviewer: true }, unavailable: [], limitations: ['Shared permissions and inherited context.'] };
  const decision = { ...f.decision, review_policy: 'require-independent' };
  assert.equal(lint_cross_check(f.round(native), f.root, decision).status, 'pass');
  assert.equal(lint_cross_check(f.round({ ...native, reviewer: native.host }), f.root, decision).status, 'fail');
  assert.equal(lint_cross_check(f.round({ ...native, transport: {} }), f.root, decision).status, 'fail');
  assert.equal(lint_cross_check(f.round(native), f.root, { ...decision, enforced_read_only_required: true }).status, 'fail');
});

test('new review evidence retains exact current Git source and report checks', () => {
  const f = fixture();
  assert.equal(lint_cross_check(f.round(), f.root, f.decision).status, 'pass');
  f.write('product.js', 'module.exports = 2;\n');
  assert.equal(lint_cross_check(f.round(), f.root, f.decision).status, 'fail');
  f.write('product.js', 'module.exports = 1;\n');
  f.save_report({ kind: 'git', commit: 'f'.repeat(40) });
  assert.equal(lint_cross_check(f.round(), f.root, f.decision).status, 'fail');
});

test('no-Git review binds declared file digests and never invents a commit', () => {
  const f = fixture(false);
  assert.equal(lint_cross_check(f.round(), f.root, f.decision).status, 'pass');
  f.write('product.js', 'changed after review\n');
  assert.equal(lint_cross_check(f.round(), f.root, f.decision).status, 'fail');
});

test('review records are persisted by the existing digest-bound metadata writer', () => {
  const f = fixture();
  const options = { project_root: f.root, notebook_path: '.agentflow/devlog.md', ask: 'A-001', workspace_dir: '.agentflow' };
  f.write('.agentflow/devlog.md', '# → Ask / A-001\n\n+ work\n');
  ownership_fixture.adopt(f.root, '.agentflow/devlog.md');
  const reply = f.round().split('# ← Reply / A-001')[1];
  const published = completion.publish_reply(reply, options);
  assert.doesNotMatch(published, /Review record:/);
  const metadata = completion_metadata(published, options);
  assert.equal(metadata.error, '');
  assert.match(metadata.text, /Review record:/);
  assert.equal(lint_cross_check(f.round(f.record, `Review record: ${JSON.stringify(f.record)}\n`), f.root, f.decision).status, 'fail');
});

test('completion collection loads the current policy and preserves explicit independent-review requirements', () => {
  const f = fixture();
  const config = require('./ag-settings').make_template('codex');
  config.switches['allowed-worker'] = ['host'];
  config.switches['review-policy'] = 'prefer-independent';
  f.write('ag.json', JSON.stringify(config));
  f.write('.agentflow/devlog.md', '# → Ask / A-001\n\n+ work\n');
  const collect = require('./completion-context').collect;
  for (const [request, independent] of [['Implement the requested behavior.', false], ['Require an independent reviewer.', true], ['review-requirement: independent', true]]) {
    const context = collect({ project_root: f.root, notebook_path: '.agentflow/devlog.md', active_host: 'codex', devlog_text: f.round().replace('Implement the requested behavior.', request) });
    assert.equal(context.review_decision.review_policy, 'prefer-independent');
    assert.deepEqual(context.review_decision.allowed_worker, ['host']);
    assert.equal(context.review_decision.independent_required, independent);
  }
});

test('workflow execution checks consume shared native evidence and reject failed acceptance', () => {
  const record = { record_version: 1, task_id: 'bounded-task', attempt_id: 'attempt-1', candidate_id: 'native', kind: 'internal', role: 'implementation',
    source_identity: { source_kind: 'git', value: 'a'.repeat(40) }, requested: {}, actual: { model: 'inherited', effort: 'inherited' }, state: 'completed',
    outputs: { report: 'report.md' }, changed_paths: ['product.js'], acceptance: { checks_run: true, coordinator_inspected: true, accepted: true },
    limitations: ['Shared permissions.'], transport: { tool: 'spawn_agent', thread_handle: 'thread-1', worker_started: true } };
  const lint = require('./round-linter').lint_executor_decision;
  assert.equal(lint(record).status, 'pass');
  assert.equal(lint({ ...record, acceptance: { ...record.acceptance, accepted: false } }).status, 'fail');
});
