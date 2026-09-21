'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { collect } = require('./completion-context');
const { lint_cross_check } = require('./round-linter');
const settings = require('./ag-settings');

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-no-ag-'));
  fs.mkdirSync(path.join(root, '.agentflow'));
  fs.writeFileSync(path.join(root, 'changed.js'), 'module.exports = 1;\n');
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root }).status, 0);
  fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(settings.make_template('codex')));
  return root;
};
const notebook = (owner, review = true) => '# → Ask / A-001\n\n' + owner + '\n\n# ← Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- Inspected changed source.\n\n' + (review ? 'Host review: PASS — inspected source and tests.\n\n' : '') + '## Questions\n\n- None.\n';
const decision = (root, text) => collect({ project_root: root, notebook_path: '.agentflow/devlog.md', active_host: 'codex', devlog_text: text }).review_decision;

for (const instruction of ['no-ag', '+ no-ag', '+ NO-AG.', '+ /no-ag', '+ **no-ag**, fix this', '+ no-ag, why is closeout blocked?', '+ no-ag: fix the hook', '+ no-ag\n\n+ follow-up task']) {
  test('direct opt-out: ' + instruction, () => {
    const root = fixture();
    const text = notebook(instruction);
    const result = decision(root, text);
    assert.equal(result.status, 'skip-review');
    assert.equal(result.owner_authorized, true);
    assert.match(result.reason, /no-ag/);
    assert.equal(lint_cross_check(text, root, result).status, 'pass');
    const missing_review = notebook(instruction, false);
    assert.equal(lint_cross_check(missing_review, root, decision(root, missing_review)).status, 'fail');
  });
}

for (const instruction of ['+ > no-ag', '+ › no-ag, pasted prior input', '+ `no-ag`', '+ "no-ag"', '+ "example:" no-ag', "+ 'example:' no-ag", '+ “no-ag”', '+ For example: no-ag', '+ For example, no-ag', '+ The command is; no-ag', '+ Use this example, no-ag', '+ Require this spelling, no-ag', '+ If approved, no-ag', '+ no-ag?', '+ no-ag if tests pass', '+ no-ag, if approved', '+ no-ag，if approved', '+ no-ag，unless approved', '+ no-ag: unless approved', '+ "\nno-ag\n"', '+ “example\nno-ag\nend”', "+ 'example\nno-ag\nend'", '+ Do not use no-ag', '+ no-ag is a command', '+ ```text\n  no-ag\n  ```', '+ ~~~text\n  no-ag\n  ~~~', '    no-ag', '<!--\nno-ag\n-->']) {
  test('non-authoritative mention: ' + instruction, () => {
    const root = fixture();
    assert.equal(decision(root, notebook(instruction)).status, 'required');
  });
}

for (const override of ['godev', '/godev, resume', 'ag', 'agentflow', 'require independent review', 'run one cross-check for this task', 'use cross-check', 'for remaining tasks, use cross-check', 'Please run an independent review.', 'perform an external review', 'Please use an independent reviewer.', 'review-requirement: independent', 'review-requirement: fresh-context', 'review-requirement: enforced-read-only']) {
  test('later override: ' + override, () => {
    const root = fixture();
    assert.equal(decision(root, notebook('+ no-ag\n\n+ ' + override)).status, 'required');
    assert.equal(decision(root, notebook('+ ' + override + '\n\n+ no-ag')).status, 'skip-review');
  });
}

test('same-line explicit review overrides no-ag; quoted override does not', () => {
  const root = fixture();
  assert.equal(decision(root, notebook('+ no-ag; require independent review')).status, 'required');
  assert.equal(decision(root, notebook('+ no-ag, require independent review')).status, 'required');
  assert.equal(decision(root, notebook('+ no-ag\n\n+ `require independent review`')).status, 'skip-review');
  for (const mention of ['"for remaining tasks, use cross-check"', '> for remaining tasks, use cross-check', 'for remaining tasks, use cross-check if approved']) {
    assert.equal(decision(root, notebook('+ no-ag\n\n+ ' + mention)).status, 'skip-review');
  }
});

test('no-ag does not leak into the next Ask or activate from a Reply', () => {
  const root = fixture();
  const prior = notebook('+ no-ag');
  const next = '\n# → Ask / A-002\n\n+ implement another task\n\n# ← Reply / A-002\n\nno-ag\n';
  assert.equal(decision(root, prior + next).status, 'required');
});

for (const host of ['codex', 'claude']) {
  test(`${host} real prompt, source change, close-round and Stop accept no-ag with host review`, () => {
    const root = fixture();
    const file = path.join(root, '.agentflow/devlog.md');
    fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(settings.make_template(host)));
    fs.writeFileSync(file, '# → Ask / A-001\n\n+\n');
    for (const args of [['config', 'user.name', 'No-ag Test'], ['config', 'user.email', 'no-ag@example.invalid'], ['add', 'ag.json', '.agentflow/devlog.md'], ['commit', '-qm', 'fixture baseline']]) {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    const status = { project: 'no-ag fixture', notebook: '.agentflow/devlog.md', notebook_kind: 'root', current_commit: commit, tests_scenarios: 'bounded fixture checks', config_path: 'ag.json', host, validation: 'validated', proven: 'bounded local change checked', open: 'none', next: 'await input', artifacts: 'none', archived_eras: 'none', streams: [] };
    fs.writeFileSync(file, settings.format_status(status) + '\n---\n\n# → Ask / A-001\n\n+\n');
    const env = { ...process.env };
    for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[name];
    env.AGENTFLOW_SESSION_ID = 'no-ag-fixture';
    const hook = path.join(__dirname, 'stop-hook.js');
    const capture = spawnSync(process.execPath, [hook, '--host', host], { cwd: root, env, input: JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'no-ag-fixture', turn_id: 'one', prompt: 'no-ag, implement bounded change' }), encoding: 'utf8' });
    assert.equal(capture.status, 0, capture.stderr);
    assert.match(capture.stdout, /instruction was saved/);
    const reply = '## [SUMMARY]\n\n- Bounded change checked.\n\n## [FINAL REPORT]\n\n1. Fixture change inspected.\n\n```completion-metadata\nHost review: PASS — inspected the changed source and fixture assertions.\n```\n\n## Questions\n\n- None.\n';
    const close = spawnSync(process.execPath, [path.join(__dirname, 'notebook-write.js'), 'close-round', '--notebook', '.agentflow/devlog.md', '--host', host, '--input-stdin'], { cwd: root, env, input: JSON.stringify({ ask: 'A-001', run_events: [], reply, status }), encoding: 'utf8' });
    assert.equal(close.status, 0, close.stderr);
    const next = require('./round-linter').parse_devlog(fs.readFileSync(file, 'utf8')).rounds.at(-1);
    assert.equal(next.id, 'A-002');
    assert.equal(next.ask_text.trim(), '+');
    const stop = spawnSync(process.execPath, [hook, '--host', host], { cwd: root, env, input: JSON.stringify({ cwd: root, hook_event_name: 'Stop' }), encoding: 'utf8' });
    assert.equal(stop.status, 0, stop.stderr);
  });
}
