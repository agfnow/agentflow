'use strict';

const node_assert = require('node:assert');
const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const node_test = require('node:test');
const { execFileSync } = require('node:child_process');
const ag_settings = require('./ag-settings.js');
const { format_local_timestamp } = require('./local-time.js');

const hook_path = node_path.join(__dirname, 'stop-hook.js');
require('./fixtures/notebook-owner').configure();

node_test.test('bare first activation is not an incomplete work round', () => {
  const root = make_project('# → Ask / A-001\n\n+\n');
  const result = execFileSync(process.execPath, [hook_path, '--host', 'codex'], { input: JSON.stringify({ cwd: root, hook_event_name: 'Stop' }), encoding: 'utf8' });
  node_assert.equal(result, '');
});

node_test.test('prompt submission saves steering immediately without running completion checks', () => {
  const root = make_project(round_ending_in_scaffold(valid_reply_body, local_stamp()));
  const message = 'Keep the existing behavior.\n# → Ask / A-999';
  const payload = JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'test-session', turn_id: 'steer', prompt: message });
  const result = execFileSync(process.execPath, [hook_path, '--host', 'codex'], { input: payload, encoding: 'utf8' });
  const text = node_fs.readFileSync(node_path.join(root, '.agentflow/devlog.md'), 'utf8');
  node_assert.ok(text.includes('+ Keep the existing behavior.'));
  node_assert.doesNotMatch(text, /agentflow-input:|^>/mu);
  node_assert.ok(text.includes('  # → Ask / A-999'));
  node_assert.match(result, /UserPromptSubmit/);
});

node_test.test('prompt hook adopts a manually saved multi-question Ask without duplicating it', () => {
  const root = make_project(round_ending_in_scaffold(valid_reply_body, local_stamp()));
  const notebook = '.agentflow/devlog.md';
  const prompt = '+ first question\n\n+ second question';
  require('./notebook-write').append_input({ root, notebook, text: prompt });
  const file = node_path.join(root, notebook);
  const before = node_fs.readFileSync(file, 'utf8');
  const payload = { cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'test-session', turn_id: 'first', prompt };
  for (let retry = 0; retry < 2; retry += 1) {
    execFileSync(process.execPath, [hook_path, '--host', 'codex'], { input: JSON.stringify(payload), encoding: 'utf8' });
    node_assert.equal(node_fs.readFileSync(file, 'utf8'), before);
  }
  execFileSync(process.execPath, [hook_path, '--host', 'codex'], { input: JSON.stringify({ ...payload, turn_id: 'second' }), encoding: 'utf8' });
  node_assert.equal(node_fs.readFileSync(file, 'utf8').split('+ first question').length - 1, 2);
});

node_test.test('Claude prompt capture hands the hook session to later commands, including duplicate capture', () => {
  const root = make_project(round_ending_in_scaffold(valid_reply_body, local_stamp(), 'claude'), 'claude');
  const payload = { cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'claude-hook-session', turn_id: 'first', prompt: 'continue from Claude' };
  const env = { ...process.env, CLAUDE_PROJECT_DIR: '', CLAUDE_SESSION_ID: '' };
  const first = execFileSync(process.execPath, [hook_path, '--host', 'claude'], { input: JSON.stringify(payload), encoding: 'utf8', env });
  node_assert.match(first, /claude-hook-session/);
  const duplicate = execFileSync(process.execPath, [hook_path, '--host', 'claude'], { input: JSON.stringify(payload), encoding: 'utf8', env });
  node_assert.match(duplicate, /claude-hook-session/);
});

// A machine-local wall-clock stamp near "now", so honest fixtures sit inside
// the linter's freshness window whenever the suite runs.
const local_stamp = (offset_ms = -120000) => format_local_timestamp(new Date(Date.now() + offset_ms));
const taipei_stamp = local_stamp;

const round_ending_in_scaffold = (reply_body, stamp, host = 'codex') => `# STATUS

Project: sample — stop-hook fixture

Notebook: devlog.md — root.

Current commit: fixture.

Tests/scenarios: none.

Configuration: ag.json — schema v${ag_settings.schema_version}; validated for ${host} this round.

Proven: the fixture is ready.

Open: none.

Next: await the owner.

Artifacts: none.

Archived eras: none.

Streams: none.

---

# → Ask / A-001

+ do the thing

# ← Reply / A-001
* _${stamp} (test-model)_
* _state: code and devlog: this commit_

${reply_body}

---

# → Ask / A-002

+
`;

const valid_reply_body = `## [SUMMARY]

- did the thing

## Verification, route, and mechanics

- ran the tests, all green

## Questions (batched — each with a suggested default)

None.`;

const make_project = (devlog_text, host = 'codex') => {
  const project_dir = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'stop-hook-'));

  node_fs.mkdirSync(node_path.join(project_dir, '.agentflow'), { recursive: true });
  if (devlog_text !== null) {
    node_fs.writeFileSync(node_path.join(project_dir, '.agentflow/devlog.md'), devlog_text);
  }

  ag_settings.write_config_atomic(node_path.join(project_dir, 'ag.json'), ag_settings.make_template(host), {
    repo_root: project_dir,
    active_host: host,
    executables: ['codex', 'claude']
  });

  return project_dir;
};

const write_audit_decision = (project_dir, line) => {
  node_fs.writeFileSync(node_path.join(project_dir, '.agentflow/.devlog.audit.md'), `## A-001\n\n- ${line}\n`);
};

const run_hook = (project_dir, stdin_obj, host = 'codex', environment_overrides = {}) => {
  const env = { ...process.env };
  for (const markers of Object.values(ag_settings.host_markers)) {
    for (const marker of markers) delete env[marker];
  }
  delete env.AGENTFLOW_EXTERNAL_DELEGATE;
  Object.assign(env, environment_overrides);

  try {
    const args = host === null ? [hook_path] : [hook_path, '--host', host];
    execFileSync('node', args, {
      input: JSON.stringify({ cwd: project_dir, ...stdin_obj }),
      cwd: project_dir,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    return { code: 0, stderr: '' };
  } catch (error) {
    return { code: error.status, stderr: String(error.stderr || '') };
  }
};

node_test.test('stop-hook derives no-change without reading a legacy audit decision', () => {
  const prior = `# → Ask / A-000\n\n+ prior\n\n# ← Reply / A-000\n* _${local_stamp()} (test-model)_\n\n${valid_reply_body}\n\n---\n\n`;
  const devlog = round_ending_in_scaffold(valid_reply_body, local_stamp())
    .replace('# → Ask / A-001', `${prior}# → Ask / A-001`)
    .replace('+ do the thing', '+ explain cross-check without changing files');
  const project = make_project(devlog);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'hook@example.test'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: project });
  execFileSync('git', ['add', '.agentflow/devlog.md', 'ag.json'], { cwd: project });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: project });
  write_audit_decision(project, 'Review decision: not-requested — no source, test, configuration, or user-document change.');
  const result = run_hook(project, {});
  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook accepts first-time bookkeeping in a repository with no product files', () => {
  const project = make_project(round_ending_in_scaffold(valid_reply_body, local_stamp()));
  node_fs.writeFileSync(node_path.join(project, '.gitignore'), '.claude/\n.codex/\n.worktrees/\n');
  execFileSync('git', ['init', '-q'], { cwd: project });
  write_audit_decision(project, 'Review decision: not-requested — no source, test, configuration, or user-document change');

  const result = run_hook(project, {});

  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook derives required review when a first round changes a product file', () => {
  const project = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  node_fs.writeFileSync(node_path.join(project, '.gitignore'), '.claude/\n.codex/\n.worktrees/\n');
  node_fs.writeFileSync(node_path.join(project, 'app.js'), 'module.exports = true;\n');
  execFileSync('git', ['init', '-q'], { cwd: project });
  write_audit_decision(project, 'Review decision: not-requested — no source, test, configuration, or user-document change');

  const result = run_hook(project, {});

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /missing its external review report path/i);
});

const make_skip_review_project = (changed_path, changed_text, reason = 'owner accepts no independent review for this change') => {
  const prior = `# → Ask / A-000\n\n+ prior\n\n# ← Reply / A-000\n* _${taipei_stamp()} (test-model)_\n\n${valid_reply_body}\n\n---\n\n`;
  const devlog = round_ending_in_scaffold(valid_reply_body, taipei_stamp())
    .replace('# → Ask / A-001', `${prior}# → Ask / A-001`)
    .replace('+ do the thing', `+ skip-review: ${reason}`)
    .replaceAll('## [SUMMARY]', 'Host review: PASS — inspected fixture source and test evidence; no blocking findings.\n\n## [SUMMARY]');
  const project = make_project(devlog);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'hook@example.test'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: project });
  execFileSync('git', ['add', '.agentflow/devlog.md', 'ag.json'], { cwd: project });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: project });
  node_fs.writeFileSync(node_path.join(project, changed_path), changed_text);
  return project;
};

node_test.test('stop-hook accepts skip-review for documentation and source changes', () => {
  const project = make_skip_review_project('README.md', '# Bounded documentation\n');
  const result = run_hook(project, {});
  node_assert.strictEqual(result.code, 0, result.stderr);
  const source_project = make_skip_review_project('app.js', 'module.exports = true;\n', 'urgent local source change');
  const source_result = run_hook(source_project, {});
  node_assert.strictEqual(source_result.code, 0, source_result.stderr);
});

node_test.test('stop-hook ignores an arbitrary decision in a legacy audit file', () => {
  const prior = `# → Ask / A-000\n\n+ prior\n\n# ← Reply / A-000\n* _${taipei_stamp()} (test-model)_\n\n${valid_reply_body}\n\n---\n\n`;
  const devlog = round_ending_in_scaffold(valid_reply_body, taipei_stamp())
    .replace('# → Ask / A-001', `${prior}# → Ask / A-001`)
    .replace('+ do the thing', '+ explain cross-check without changing files');
  const project = make_project(devlog);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'hook@example.test'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: project });
  execFileSync('git', ['add', '.agentflow/devlog.md', 'ag.json'], { cwd: project });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: project });
  write_audit_decision(project, 'Review decision: not-requested — unrelated cleanup was done.');
  const result = run_hook(project, {});
  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook preserves the leading dot of the first unstaged porcelain path', () => {
  const prior = `# → Ask / A-000\n\n+ prior\n\n# ← Reply / A-000\n* _${taipei_stamp()} (test-model)_\n\n${valid_reply_body}\n\n---\n\n`;
  const devlog = round_ending_in_scaffold(valid_reply_body, taipei_stamp())
    .replace('# → Ask / A-001', `${prior}# → Ask / A-001`)
    .replace('+ do the thing', '+ explain the existing behavior');
  const project = make_project(devlog);
  execFileSync('git', ['init', '-q'], { cwd: project });
  execFileSync('git', ['config', 'user.email', 'hook@example.test'], { cwd: project });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: project });
  write_audit_decision(project, 'Review decision: not-requested — no source, test, configuration, or user-document change');
  execFileSync('git', ['add', '.agentflow/devlog.md', 'ag.json', '.agentflow/.devlog.audit.md'], { cwd: project });
  execFileSync('git', ['commit', '-qm', 'baseline'], { cwd: project });
  node_fs.appendFileSync(node_path.join(project, '.agentflow/.devlog.audit.md'), '\n');

  const porcelain = execFileSync('git', ['status', '--porcelain=v1'], { cwd: project, encoding: 'utf8' });
  node_assert.match(porcelain, /^ M \.agentflow\/\.devlog\.audit\.md/mu);
  const result = run_hook(project, {});
  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook ignores an established audit that omits the current review decision', () => {
  const project = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  node_fs.writeFileSync(node_path.join(project, '.agentflow/.devlog.audit.md'), '## A-001\n\n- Route: direct.\n');
  const result = run_hook(project, {});
  node_assert.strictEqual(result.code, 0, result.stderr);
});

const make_checkpoint_project = ({ scope_event = true } = {}) => {
  const stamp = local_stamp();
  const devlog = `# STATUS

Project: checkpoint truth fixture.

Notebook: devlog.md — root.

Current commit: fixture.

Tests/scenarios: none.

Configuration: ag.json — schema v${ag_settings.schema_version}; validated for codex this round.

Proven: checkpoint fixture.

Open: work continues.

Next: continue.

Artifacts: artifacts/A-002-checkpoint/.

Archived eras: none.

Streams: none.

---

# → Ask / A-002

+ verify the checkpoint

${scope_event ? `## [RUN-001] Event — ${stamp} (during round A-002)\n\n- **Scope check:** Changed paths match the tracker.\n\n` : ''}
## [WIP-001] Checkpoint — ${stamp} (during round A-002)

- **Finished:**

  1. Saved current evidence.

- **Running now:** None.

- **Still to do:** None.

- **Next work action:** finish.

- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker
`;
  const project_dir = make_project(devlog);
  const work_root = node_path.join(project_dir, 'artifacts', 'A-002-checkpoint');
  node_fs.mkdirSync(work_root, { recursive: true });
  const tracker_template = require('./tracker-contract.js').template;
  const tracker_text = tracker_template
    .replace('<work-key>', 'A-002-checkpoint')
    .replaceAll('<A-NNN>', 'A-002')
    .replace('<goal>', 'Verify the checkpoint')
    .replace('<YYYY-MM-DD HH:MM:SS ±HHMM>', stamp)
    .replaceAll('<count>', '1')
    .replace('<task>', 'Save current evidence')
    .replace('<next action>', 'Save the checkpoint')
    .replace('<paths>', 'devlog.md and tracker.md');
  node_fs.writeFileSync(node_path.join(work_root, 'tracker.md'), tracker_text);
  execFileSync('git', ['init', '-b', 'main'], { cwd: project_dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'hook@example.com'], { cwd: project_dir });
  execFileSync('git', ['config', 'user.name', 'Hook Test'], { cwd: project_dir });
  execFileSync('git', ['add', '-A'], { cwd: project_dir });
  execFileSync('git', ['commit', '-m', 'checkpoint'], { cwd: project_dir, stdio: 'ignore' });
  return { project_dir, work_root };
};

node_test.test('exits 0 for an honest round with the mandatory headings', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0);
});

node_test.test('reads the configured workspace notebook instead of a legacy root notebook', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const config_path = node_path.join(project_dir, 'ag.json');
  const config = JSON.parse(node_fs.readFileSync(config_path, 'utf8'));
  config.switches['workspace-dir'] = '.agentflow';
  config.switches['target-doc'] = '.agentflow/devlog.md';
  node_fs.writeFileSync(config_path, `${JSON.stringify(config, null, 2)}\n`);
  node_fs.writeFileSync(node_path.join(project_dir, 'devlog.md'), 'Invalid historical root notebook; do not select it.\n');

  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0, result.stderr);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('reads the adjacent stream notebook in a named worktree', () => {
  const parent = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'stop-hook-stream-'));
  const project_dir = node_path.join(parent, '.worktrees', 'fix-2');
  const stream_dir = node_path.join(project_dir, '.agentflow', 'features', 'fix-2');
  node_fs.mkdirSync(stream_dir, { recursive: true });

  const root_config = ag_settings.make_template('codex');
  node_fs.writeFileSync(node_path.join(project_dir, 'ag.json'), `${JSON.stringify(root_config, null, 2)}\n`);
  const stream_config = structuredClone(root_config);
  stream_config.switches['target-doc'] = '.agentflow/features/fix-2/fix-2.devlog.md';
  node_fs.writeFileSync(node_path.join(stream_dir, 'ag.json'), `${JSON.stringify(stream_config, null, 2)}\n`);

  node_fs.mkdirSync(node_path.join(project_dir, '.agentflow'), { recursive: true });
  node_fs.writeFileSync(node_path.join(project_dir, '.agentflow', 'devlog.md'), round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const open_stream = round_ending_in_scaffold(valid_reply_body, taipei_stamp()).split('# ← Reply / A-001')[0];
  node_fs.writeFileSync(node_path.join(stream_dir, 'fix-2.devlog.md'), open_stream);

  const result = run_hook(project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('explicit hook host validates configuration without runtime markers', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('ordinary Claude sessions pass with a matching Claude configuration', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp(), 'claude'), 'claude');
  const result = run_hook(project_dir, { stop_hook_active: false }, 'claude');

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('blocks a written round when the established configuration is malformed', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  node_fs.writeFileSync(node_path.join(project_dir, 'ag.json'), '{ malformed');
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /configuration_valid/);
});

node_test.test('blocks a false checked push claim', () => {
  const project_dir = make_project(round_ending_in_scaffold(`${valid_reply_body}\n\nEverything was pushed to origin.`, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /push_claim_valid/);
});

node_test.test('accepts a Claude host opening a configuration without a stored host field', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false }, 'claude');

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('allows a completed Reply with the mandatory headings', () => {
  const body = `## [SUMMARY]

- did the thing

## Questions (batched — each with a suggested default)

None.`;
  const project_dir = make_project(round_ending_in_scaffold(body, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('exits 2 for a future timestamp in the completed Reply behind the scaffold', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp(48 * 3600000)));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /timestamps_sane/);
});

node_test.test('an editable future WIP warns without blocking an active round', () => {
  const active = round_ending_in_scaffold(valid_reply_body, taipei_stamp())
    .replace(/# ← Reply \/ A-001[\s\S]*$/u, `## [WIP-001] Checkpoint — ${local_stamp(48 * 3600000)} (during round A-001)\n`);
  const project_dir = make_project(active);
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0);
});

node_test.test('exits 0 under the stop_hook_active loop guard even for a broken round', () => {
  const project_dir = make_project(round_ending_in_scaffold('## nothing useful here', taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: true });

  node_assert.strictEqual(result.code, 0);
});

node_test.test('loop guard releases a correcting turn from an older host-neutral command', () => {
  const project_dir = make_project(round_ending_in_scaffold('## nothing useful here', taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: true }, null);

  node_assert.strictEqual(result.code, 0);
});

node_test.test('a valid command-scoped delegate marker bypasses owner-round checks before host resolution', () => {
  const project_dir = make_project(round_ending_in_scaffold('## nothing useful here', taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false }, null, {
    AGENTFLOW_EXTERNAL_DELEGATE: 'delegate-2026.08.22:alpha'
  });

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('absent, empty, malformed, and boundary-invalid delegate markers follow owner processing', () => {
  const project_dir = make_project(round_ending_in_scaffold('## nothing useful here', taipei_stamp()));
  const cases = [
    ['absent', {}, 2],
    ['empty', { AGENTFLOW_EXTERNAL_DELEGATE: '' }, 2],
    ['whitespace', { AGENTFLOW_EXTERNAL_DELEGATE: 'delegate value' }, 2],
    ['leading punctuation', { AGENTFLOW_EXTERNAL_DELEGATE: '-delegate' }, 2],
    ['128-character valid boundary', { AGENTFLOW_EXTERNAL_DELEGATE: `A${'b'.repeat(127)}` }, 0],
    ['129-character invalid boundary', { AGENTFLOW_EXTERNAL_DELEGATE: `A${'b'.repeat(128)}` }, 2],
  ];

  for (const [label, overrides, expected_code = 0] of cases) {
    const result = run_hook(project_dir, { stop_hook_active: false }, 'codex', overrides);
    node_assert.strictEqual(result.code, expected_code, label);
    if (expected_code === 0) node_assert.strictEqual(result.stderr, '', label);
    else node_assert.match(result.stderr, /reply_structure/, label);
  }
});

node_test.test('exits 0 when the project has no devlog', () => {
  const project_dir = make_project(null);
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0);
});

// --- terminal-one-line, fed from the transcript (Q1 / A-052) ---

// Write a JSONL transcript into the project and hand the hook its path.
const write_transcript = (project_dir, entries) => {
  const transcript_path = node_path.join(project_dir, 'transcript.jsonl');

  node_fs.writeFileSync(transcript_path, entries.map(entry => JSON.stringify(entry)).join('\n'));

  return transcript_path;
};

const owner_prompt = text => ({ type: 'user', message: { role: 'user', content: text } });
const tool_result = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const devlog_edit = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/x/devlog.md' } }] } });
const assistant_text = text => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

node_test.test('exits 0 when a round turn printed exactly the one-line terminal output', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const transcript_path = write_transcript(project_dir, [
    owner_prompt('godev'),
    devlog_edit(),
    tool_result(),
    assistant_text('devlog.md updated')
  ]);
  const result = run_hook(project_dir, { stop_hook_active: false, transcript_path });

  node_assert.strictEqual(result.code, 0);
});

node_test.test('allows extra terminal lines as a warning (F-004)', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const transcript_path = write_transcript(project_dir, [
    owner_prompt('godev'),
    devlog_edit(),
    tool_result(),
    assistant_text('devlog.md updated\nAll green — you are good to go!')
  ]);
  const result = run_hook(project_dir, { stop_hook_active: false, transcript_path });

  node_assert.strictEqual(result.code, 0);
  node_assert.strictEqual(result.stderr, '');
});

node_test.test('does not block when a round turn printed a line not ending in " updated"', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const transcript_path = write_transcript(project_dir, [
    owner_prompt('godev'),
    devlog_edit(),
    tool_result(),
    assistant_text('All done!')
  ]);
  const result = run_hook(project_dir, { stop_hook_active: false, transcript_path });

  node_assert.strictEqual(result.code, 0);
  node_assert.equal(result.stderr, '');
});

// The load-bearing guard: a plain-chat turn (no devlog edit) with multi-line
// terminal output must NOT be blocked, even though a devlog.md exists in the repo.
node_test.test('exits 0 for a plain-chat turn that did not write a round', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  const transcript_path = write_transcript(project_dir, [
    owner_prompt('what does gather_push do?'),
    assistant_text('It reads whether HEAD is fully pushed.\nRemote first, then upstream, then unpushed count.')
  ]);
  const result = run_hook(project_dir, { stop_hook_active: false, transcript_path });

  node_assert.strictEqual(result.code, 0);
});

node_test.test('blocks a written round when the established adjacent ag.json is missing', () => {
  const project_dir = make_project(round_ending_in_scaffold(valid_reply_body, taipei_stamp()));
  node_fs.unlinkSync(node_path.join(project_dir, 'ag.json'));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /configuration_valid/);
});

node_test.test('stop-hook supplies host push facts to the round linter', () => {
  const project_dir = make_project(round_ending_in_scaffold(`${valid_reply_body}\n\nEverything was pushed to origin.`, taipei_stamp()));
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 2);
  node_assert.match(result.stderr, /push_claim_valid/);
});

node_test.test('stop-hook verifies combined checkpoint claims from committed durable evidence', () => {
  const { project_dir } = make_checkpoint_project();
  const result = run_hook(project_dir, { stop_hook_active: false });

  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook accepts current uncommitted checkpoint records', () => {
  const fixture = make_checkpoint_project();
  const tracker = node_path.join(fixture.work_root, 'tracker.md');
  node_fs.writeFileSync(tracker, node_fs.readFileSync(tracker, 'utf8').replace('- **Reason:** Work remains.', '- **Reason:** Current checkpoint facts are saved.'));
  node_fs.appendFileSync(node_path.join(fixture.project_dir, '.agentflow/devlog.md'), '\n');

  const result = run_hook(fixture.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0, result.stderr);
});

node_test.test('stop-hook warns without blocking active checkpoint evidence that needs repair', () => {
  const stale = make_checkpoint_project();
  const stale_tracker = node_path.join(stale.work_root, 'tracker.md');
  node_fs.writeFileSync(stale_tracker, node_fs.readFileSync(stale_tracker, 'utf8').replace(/- \*\*Last update:\*\* [^.]+\./u, '- **Last update:** 2026-01-01 00:00:00 Asia/Taipei.'));
  const stale_result = run_hook(stale.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(stale_result.code, 0);

  const no_scope = make_checkpoint_project({ scope_event: false });
  const no_scope_result = run_hook(no_scope.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(no_scope_result.code, 0);
});

node_test.test('stop-hook leaves an active malformed tracker for the owning session to repair', () => {
  const fixture = make_checkpoint_project();
  node_fs.writeFileSync(node_path.join(fixture.work_root, 'tracker.md'), '# Tracker\n\n- **Active Ask:** A-002.\n');
  execFileSync('git', ['add', '-A'], { cwd: fixture.project_dir });
  execFileSync('git', ['commit', '-m', 'malformed tracker'], { cwd: fixture.project_dir, stdio: 'ignore' });
  const result = run_hook(fixture.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0);
});

node_test.test('stop-hook does not trap an active round whose tracker identity needs repair', () => {
  const fixture = make_checkpoint_project();
  const tracker_path = node_path.join(fixture.work_root, 'tracker.md');
  node_fs.writeFileSync(tracker_path, node_fs.readFileSync(tracker_path, 'utf8').replace('- **Active Ask:** A-002.', '- **Owner round:** A-002.'));
  execFileSync('git', ['add', '-A'], { cwd: fixture.project_dir });
  execFileSync('git', ['commit', '-m', 'tracker without identity'], { cwd: fixture.project_dir, stdio: 'ignore' });
  const result = run_hook(fixture.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0);
});

node_test.test('stop-hook does not trap an active round with ambiguous tracker ownership', () => {
  const fixture = make_checkpoint_project();
  const duplicate_root = node_path.join(fixture.project_dir, 'artifacts', 'duplicate');
  node_fs.mkdirSync(duplicate_root, { recursive: true });
  node_fs.copyFileSync(node_path.join(fixture.work_root, 'tracker.md'), node_path.join(duplicate_root, 'tracker.md'));
  execFileSync('git', ['add', '-A'], { cwd: fixture.project_dir });
  execFileSync('git', ['commit', '-m', 'ambiguous tracker'], { cwd: fixture.project_dir, stdio: 'ignore' });
  const result = run_hook(fixture.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0);
});

node_test.test('stop-hook checkpoint recovery does not create a separate runlog', () => {
  const fixture = make_checkpoint_project();
  const result = run_hook(fixture.project_dir, { stop_hook_active: false });
  node_assert.strictEqual(result.code, 0, result.stderr);
  node_assert.strictEqual(node_fs.existsSync(node_path.join(fixture.work_root, 'runlog.md')), false);
});

node_test.test('explicit natural review waivers pass the round linter and both stop hosts', () => {
  const { collect } = require('./completion-context.js');
  const { lint_round } = require('./round-linter.js');
  for (const instruction of ['skip review', 'Please skip the final review.', 'no review', 'stop the reviewer and continue', 'cancel the background reviewer and finish', 'skip-review', 'skip ag pipeline, stream and cross-check', 'Implement the fix. **skip ag pipeline, stream and cross-check, never over-egnieering**']) {
    const project = make_skip_review_project('app.js', 'module.exports = true;\n');
    const file = node_path.join(project, '.agentflow/devlog.md');
    const text = node_fs.readFileSync(file, 'utf8').replace('+ skip-review: owner accepts no independent review for this change', `+ ${instruction}`);
    node_fs.writeFileSync(file, text);
    const facts = collect({ project_root: project, notebook_path: '.agentflow/devlog.md', devlog_text: text });
    node_assert.equal(facts.review_decision.status, 'skip-review', instruction);
    const lint = lint_round({ ...facts, devlog_text: text, project_root: project });
    node_assert.equal(lint.checks.find(check => check.id === 'cross_check').status, 'pass', instruction);
    for (const host of ['codex', 'claude']) {
      const result = run_hook(project, {}, host);
      node_assert.equal(result.code, 0, `${host}: ${instruction}: ${result.stderr}`);
    }
  }
});

node_test.test('review discussion, negation, and quoted examples do not waive review', () => {
  const { collect } = require('./completion-context.js');
  const project = make_skip_review_project('app.js', 'module.exports = true;\n');
  const original = node_fs.readFileSync(node_path.join(project, '.agentflow/devlog.md'), 'utf8');
  for (const instruction of ['do not skip review', 'should we skip review?', 'if user wants to skip review, let them', '> skip review', 'skip review if tests pass', 'override it']) {
    const text = original.replace('+ skip-review: owner accepts no independent review for this change', `+ ${instruction}`);
    const facts = collect({ project_root: project, notebook_path: '.agentflow/devlog.md', devlog_text: text });
    node_assert.equal(facts.review_decision.status, 'required', instruction);
  }
});

node_test.test('cosmetic tracker and scope wording survives collection and both completed-round hooks', () => {
  const fixture = make_checkpoint_project();
  const tracker = node_path.join(fixture.work_root, 'tracker.md');
  node_fs.writeFileSync(tracker, node_fs.readFileSync(tracker, 'utf8').replaceAll('**', '').replaceAll('- ', '+ '));
  const notebook = node_path.join(fixture.project_dir, '.agentflow/devlog.md');
  const text = node_fs.readFileSync(notebook, 'utf8').replace('+ verify the checkpoint', '+ verify the checkpoint\n\n+ skip-review: fixture owner requests host review only').replace('**Scope check:**', '**Tracker and scope:**') + '\n# ← Reply / A-002\n\n### Summary\n\nThe checkpoint was verified.\n\n### Final report\n\nCurrent evidence is recorded.\n\n* **Host review:** PASS - inspected the fixture and evidence; no blocking findings.\n\n### Questions\n\n- None.\n\n---\n\n# → Ask / A-003\n\n+\n';
  node_fs.writeFileSync(notebook, text);
  const facts = require('./completion-context.js').collect({ project_root: fixture.project_dir, notebook_path: '.agentflow/devlog.md', devlog_text: text, active_host: 'codex' });
  node_assert.equal(facts.tracker.path, 'artifacts/A-002-checkpoint/tracker.md');
  node_assert.equal(facts.checkpoint_verification.tracker_current, true);
  node_assert.equal(facts.checkpoint_verification.scope_label_present, false);
  const check = require('./round-linter.js').lint_round(facts);
  node_assert.equal(check.ok, true, JSON.stringify(check.checks.filter(item => item.status === 'fail')));
  for (const host of ['codex', 'claude']) {
    const result = run_hook(fixture.project_dir, { stop_hook_active: false }, host);
    node_assert.equal(result.code, 0, result.stderr);
  }
  node_fs.writeFileSync(notebook, text.replace('* **Host review:** PASS - inspected the fixture and evidence; no blocking findings.\n', ''));
  for (const host of ['codex', 'claude']) node_assert.equal(run_hook(fixture.project_dir, { stop_hook_active: false }, host).code, 2);
});
