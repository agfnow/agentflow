'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const settings = require('./ag-settings.js');
const { collect } = require('./completion-context.js');
const { collect_intake } = require('./resume-intake.js');
const { lint_round } = require('./round-linter.js');
const { format_local_timestamp } = require('./local-time.js');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

const reply = () => `# ← Reply / A-001\n\n* _${format_local_timestamp()} (test/none)_\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- Host gate: PASS.\n\n- Host review: PASS — inspected fixture source and test evidence; no blocking findings.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n\n---\n\n# → Ask / A-002\n\n+\n`;
const fixture = t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-fast-lane-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Fast Lane Test']);
  git(['config', 'user.email', 'fast-lane@example.invalid']);
  const config = settings.make_template('codex');
  config.switches.streams = 'always';
  fs.mkdirSync(path.join(root, '.agentflow'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ag.json'), `${JSON.stringify(config, null, 2)}\n`);
  const status = settings.format_status({ project: 'fixture', notebook: '.agentflow/devlog.md', notebook_kind: 'root', current_commit: 'fixture', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'wait', artifacts: 'none', archived_eras: 'none', streams: [] });
  const write = (owner, closed = false) => {
    const text = `${status}\n---\n\n# → Ask / A-001\n\n${owner}\n\n${closed ? reply() : ''}`;
    fs.writeFileSync(path.join(root, '.agentflow/devlog.md'), text);
    return text;
  };
  write('+');
  git(['add', '.']);
  git(['commit', '-qm', 'fixture']);
  fs.writeFileSync(path.join(root, 'app.js'), 'module.exports = true;\n');
  const facts = text => collect({ project_root: root, notebook_path: '.agentflow/devlog.md', active_host: 'codex', devlog_text: text, require_status_projection: true });
  const hook = (host, input = {}) => spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', host], { cwd: root, input: JSON.stringify({ cwd: root, hook_event_name: 'Stop', ...input }), encoding: 'utf8', env: { ...process.env, AGENTFLOW_EXTERNAL_DELEGATE: '', CLAUDE_PROJECT_DIR: '', CLAUDE_SESSION_ID: '' } });
  return { root, write, facts, hook };
};

test('fast-lane survives prompt capture and resume without changing configuration or opening a stream', t => {
  const f = fixture(t);
  const before = fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8');
  const capture = f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'fast-lane', session_id: ownership_fixture.session, turn_id: 'one' });
  assert.equal(capture.status, 0, capture.stderr);
  assert.match(capture.stdout, /fast-lane.*pending/i);
  let intake = collect_intake({ repo_root: f.root });
  assert.equal(intake.fast_lane.state, 'pending');
  assert.equal(intake.stream_decision.open_new_stream, false);
  const followup = f.hook('codex', { hook_event_name: 'UserPromptSubmit', prompt: 'fix the login bug', session_id: ownership_fixture.session, turn_id: 'two' });
  assert.equal(followup.status, 0, followup.stderr);
  assert.match(followup.stdout, /fast-lane.*active/i);
  intake = collect_intake({ repo_root: f.root });
  assert.equal(intake.fast_lane.state, 'active');
  assert.equal(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(f.root, '.worktrees')), false);
  assert.equal(fs.readFileSync(path.join(f.root, 'app.js'), 'utf8'), 'module.exports = true;\n');
});

test('Claude fast-lane fixtures never inherit the caller project directory', t => {
  const f = fixture(t);
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-fast-lane-outside-')));
  try {
    fs.writeFileSync(path.join(outside, 'sentinel.txt'), 'must remain\n');
    const result = spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'claude'], {
      cwd: f.root,
      input: JSON.stringify({ cwd: f.root, hook_event_name: 'Stop' }),
      encoding: 'utf8',
      env: { ...process.env, CLAUDE_PROJECT_DIR: outside, CLAUDE_SESSION_ID: '' },
    });
    assert.notEqual(result.status, 2, result.stderr);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel.txt'), 'utf8'), 'must remain\n');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('fast-lane waives pipeline ceremony in both hooks and the linter, including stale pipeline facts', t => {
  const f = fixture(t);
  for (const owner of ['+ fast-lane fix the login bug', '+ fix the login bug\n\n+ fast-lane', '+ /fast-lane\n\n+ fix the login bug', '+ fix the login bug\n\n+ fast-lane, no over-engineering', '+ /fast-lane, fix the login bug', '+ fast-lane，fix the login bug']) {
    const text = f.write(owner, true);
    const facts = f.facts(text);
    assert.equal(facts.review_decision.status, 'skip-review');
    const result = lint_round({ ...facts, route_decision: {}, executor_decision: {}, pipeline: {}, review: {}, acceptance: {}, security: {}, large_work: {}, queue_contract: {} });
    assert.equal(result.ok, true, JSON.stringify(result.checks.filter(check => check.status === 'fail')));
    for (const host of ['codex', 'claude']) {
      const stopped = f.hook(host);
      assert.equal(stopped.status, 0, `${host}: ${stopped.stderr}`);
    }
  }
});

test('bare fast-lane waits for a task without a fake Reply and still enforces record integrity', t => {
  const f = fixture(t);
  const text = f.write('+ fast-lane');
  const result = lint_round(f.facts(text));
  assert.equal(result.ok, true, JSON.stringify(result.checks.filter(check => check.status === 'fail')));
  for (const host of ['codex', 'claude']) assert.equal(f.hook(host).status, 0);
  const broken = `${text}\n## [RUN-001] Event — ${format_local_timestamp()} (during round A-999)\n\n- Wrong owner.\n`;
  assert.equal(lint_round(f.facts(broken)).checks.find(check => check.id === 'round_boundaries').status, 'fail');
  assert.equal(lint_round(f.facts(f.write('+ fast-lane', true))).checks.find(check => check.id === 'fast_lane_task').status, 'fail');
});

test('fast-lane expires at the next task and does not activate from mentions, quotes, or records', t => {
  const f = fixture(t);
  for (const owner of ['+ explain fast-lane', '+ `fast-lane`', '+ > fast-lane', '+ do not use fast-lane', '+ ```\n  fast-lane\n  ```', '+ fast-lane: on', '+ `fast-lane, no over-engineering`', '+ > fast-lane, no over-engineering', '+ For example: fast-lane, fix this', '+ do not use fast-lane, fix this', '+ fast-laner, fix this']) {
    assert.equal(f.facts(f.write(owner, true)).review_decision.status, 'required', owner);
  }
  const closed = f.write('+ fast-lane implement the fix', true);
  const next = closed.replace('# → Ask / A-002\n\n+\n', '# → Ask / A-002\n\n+ ordinary next task\n');
  assert.equal(f.facts(next).review_decision.status, 'required');
  const ordinary = f.write('+ ordinary task', true).replace('## [FINAL REPORT]', '## [FINAL REPORT]\n\nfast-lane');
  assert.equal(f.facts(ordinary).review_decision.status, 'required');
});

test('fast-lane keeps truthful push claims and valid configuration mandatory', t => {
  const f = fixture(t);
  const text = f.write('+ fast-lane fix the bug', true);
  const missing_tracker = lint_round({ ...f.facts(text), tracker: {} });
  assert.equal(missing_tracker.checks.find(check => check.id === 'tracker').status, 'fail');
  const missing_progress = lint_round({ ...f.facts(text), reporting: { substantial: true } });
  assert.equal(missing_progress.checks.find(check => check.id === 'round_reporting').status, 'fail');
  const missing_checkpoint = lint_round({ ...f.facts(text), checkpoint_verification: { required: true, tracker_current: false } });
  assert.equal(missing_checkpoint.checks.find(check => check.id === 'checkpoint_verification').status, 'fail');
  const missing_tests = lint_round({ ...f.facts(text), direct_route: { route: 'direct', executable: true, completed: true } });
  assert.equal(missing_tests.checks.find(check => check.id === 'direct_route_completion').status, 'skip');
  const other_approval = lint_round({ ...f.facts(text), quality_gate: {} });
  assert.equal(other_approval.checks.find(check => check.id === 'quality_gate').status, 'skip');
  const bad_claim = lint_round({ ...f.facts(text), terminal_output: 'Pushed to origin/main.' });
  assert.equal(bad_claim.ok, false);
  fs.writeFileSync(path.join(f.root, 'ag.json'), '{}\n');
  const invalid_config = f.hook('codex');
  assert.equal(invalid_config.status, 2);
  assert.match(invalid_config.stderr, /configuration_valid/);
});

test('fast-lane and standalone review skips still require host self-review before completion', t => {
  const f = fixture(t);
  for (const owner of ['+ fast-lane fix the bug', '+ fast-lane, no over-engineering', '+ skip review', '+ skip-review: owner requested direct host review']) {
    const text = f.write(owner, true).replace(/^- Host review:.*\n/gmu, '');
    fs.writeFileSync(path.join(f.root, '.agentflow/devlog.md'), text);
    const result = lint_round(f.facts(text));
    assert.equal(result.checks.find(check => check.id === 'cross_check').status, 'fail');
    assert.match(result.checks.find(check => check.id === 'cross_check').detail, /host.*review/i);
    for (const host of ['codex', 'claude']) assert.equal(f.hook(host).status, 2);
  }
});
