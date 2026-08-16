'use strict';

const node_assert = require('node:assert');
const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const node_test = require('node:test');

const { lint_round, parse_devlog } = require('./round-linter');

const fixed_now_ms = Date.parse('2026-08-15T12:00:00+08:00');

const status_for = (result, id) => result.checks.find(check => check.id === id);

const devlog_with_stamp = stamp => `# STATUS
Settings: target_doc=devlog.md, lang=English, cli_provider=any

---

# → Ask / A-001

# ← Reply / A-001
* _${stamp} (test-model)_
`;

const devlog_with_ask = ask_id => `# STATUS

---

# → Ask / ${ask_id}
`;

node_test.test('parse_devlog returns settings, Ask ids, last round, and last-round stamps', () => {
  const devlog_text = `# STATUS
Settings: target_doc=devlog.md, lang=English, cli_provider=any, auto_reply=off

---

# → Ask / A-028
old round
* _2026-08-15 08:00:00 (old-model)_

---

# → Ask / A-031 (owner)
last round
* _2026-08-15 10:00:00 (new-model)_
## Progress checkpoint — 2026-08-15 10:30:00
`;
  const parsed = parse_devlog(devlog_text);

  node_assert.deepStrictEqual(parsed.settings, {
    target_doc: 'devlog.md',
    lang: 'English',
    cli_provider: 'any',
    auto_reply: 'off'
  });
  node_assert.deepStrictEqual(parsed.ask_ids, ['A-028', 'A-031']);
  node_assert.deepStrictEqual(parsed.stamps, ['2026-08-15 10:00:00', '2026-08-15 10:30:00']);
  node_assert.strictEqual(parsed.last_round, `# → Ask / A-031 (owner)
last round
* _2026-08-15 10:00:00 (new-model)_
## Progress checkpoint — 2026-08-15 10:30:00
`);
});

node_test.test('parse_devlog extracts the timestamp from the current [WIP-NNN] Checkpoint heading', () => {
  const devlog_text = `# STATUS

---

# → Ask / A-045 (owner)
last round
* _2026-08-17 10:00:00 (new-model)_
## [WIP-001] Checkpoint — 2026-08-17 10:30 (during round A-045)

- did the thing
`;
  const parsed = parse_devlog(devlog_text);

  node_assert.deepStrictEqual(parsed.stamps, ['2026-08-17 10:00:00', '2026-08-17 10:30']);
});

node_test.test('timestamps_sane fails for a future timestamp in the [WIP-NNN] Checkpoint heading', () => {
  const devlog_text = `# STATUS

---

# → Ask / A-045

# ← Reply / A-045
* _2026-08-15 10:00:00 (test-model)_
## [WIP-001] Checkpoint — 2026-08-15 16:00 (during round A-045)
`;
  const result = lint_round({ devlog_text, now_ms: fixed_now_ms });

  node_assert.strictEqual(status_for(result, 'timestamps_sane').status, 'fail');
  node_assert.match(status_for(result, 'timestamps_sane').detail, /future/);
});

node_test.test('terminal_one_line passes for the required line', () => {
  const result = lint_round({ devlog_text: devlog_with_ask('A-001'), terminal_output: 'devlog.md updated' });

  node_assert.strictEqual(status_for(result, 'terminal_one_line').status, 'pass');
});

node_test.test('terminal_one_line fails for a multi-line terminal dump', () => {
  const result = lint_round({ devlog_text: devlog_with_ask('A-001'), terminal_output: 'devlog.md updated\nextra output' });

  node_assert.strictEqual(status_for(result, 'terminal_one_line').status, 'fail');
  node_assert.match(status_for(result, 'terminal_one_line').detail, /2 lines/);
});

node_test.test('timestamps_sane passes for a recent fixed timestamp', () => {
  const result = lint_round({
    devlog_text: devlog_with_stamp('2026-08-15 11:00:00'),
    now_ms: fixed_now_ms
  });

  node_assert.strictEqual(status_for(result, 'timestamps_sane').status, 'pass');
});

node_test.test('timestamps_sane fails for a timestamp far in the future', () => {
  const result = lint_round({
    devlog_text: devlog_with_stamp('2026-08-15 16:00:00'),
    now_ms: fixed_now_ms
  });

  node_assert.strictEqual(status_for(result, 'timestamps_sane').status, 'fail');
  node_assert.match(status_for(result, 'timestamps_sane').detail, /future/);
});

node_test.test('pipeline_artifacts passes for a stamped required file', () => {
  const artifact_dir = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'round-linter-'));
  node_fs.writeFileSync(node_path.join(artifact_dir, 'requirements.md'), '* _2026-08-15 10:00:00 (test-model)_\ncontent\n');
  const result = lint_round({
    devlog_text: devlog_with_ask('A-001'),
    pipeline: { artifact_dir, require: ['requirements.md'] }
  });

  node_assert.strictEqual(status_for(result, 'pipeline_artifacts').status, 'pass');
  node_assert.match(status_for(result, 'pipeline_artifacts').detail, /authorship \(dispatched-worker vs coordinator\)/);
});

node_test.test('pipeline_artifacts fails for a missing required file', () => {
  const artifact_dir = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'round-linter-'));
  const result = lint_round({
    devlog_text: devlog_with_ask('A-001'),
    pipeline: { artifact_dir, require: ['missing.md'] }
  });

  node_assert.strictEqual(status_for(result, 'pipeline_artifacts').status, 'fail');
  node_assert.match(status_for(result, 'pipeline_artifacts').detail, /missing\.md: missing/);
});

node_test.test('no_invented_ask passes when the owner delivered every Ask id', () => {
  const result = lint_round({
    devlog_text: devlog_with_ask('A-001'),
    owner_ask_ids: ['A-001']
  });

  node_assert.strictEqual(status_for(result, 'no_invented_ask').status, 'pass');
});

node_test.test('no_invented_ask fails for an Ask id absent from owner delivery', () => {
  const result = lint_round({
    devlog_text: `${devlog_with_ask('A-001')}\n# → Ask / A-002\n`,
    owner_ask_ids: ['A-001']
  });

  node_assert.strictEqual(status_for(result, 'no_invented_ask').status, 'fail');
  node_assert.match(status_for(result, 'no_invented_ask').detail, /A-002/);
});

node_test.test('push_claim_valid passes when the host confirms the push', () => {
  const result = lint_round({
    devlog_text: `${devlog_with_ask('A-001')}pushed to origin\n`,
    push: { remote_exists: true, exit_code: 0 }
  });

  node_assert.strictEqual(status_for(result, 'push_claim_valid').status, 'pass');
});

node_test.test('push_claim_valid fails when the host reports no remote', () => {
  const result = lint_round({
    devlog_text: `${devlog_with_ask('A-001')}pushed\n`,
    push: { remote_exists: false, exit_code: 0 }
  });

  node_assert.strictEqual(status_for(result, 'push_claim_valid').status, 'fail');
});

node_test.test('status_settings_match passes when expected settings match', () => {
  const result = lint_round({
    devlog_text: devlog_with_stamp('2026-08-15 11:00:00'),
    expected_settings: { cli_provider: 'any' }
  });

  node_assert.strictEqual(status_for(result, 'status_settings_match').status, 'pass');
});

node_test.test('status_settings_match fails when a setting differs', () => {
  const devlog_text = devlog_with_stamp('2026-08-15 11:00:00').replace('cli_provider=any', 'cli_provider=off');
  const result = lint_round({
    devlog_text,
    expected_settings: { cli_provider: 'any' }
  });

  node_assert.strictEqual(status_for(result, 'status_settings_match').status, 'fail');
  node_assert.match(status_for(result, 'status_settings_match').detail, /expected any/);
});

node_test.test('lint_round skips checks without host facts and remains okay', () => {
  const result = lint_round({ devlog_text: devlog_with_ask('A-001') });

  node_assert.strictEqual(result.ok, true);
  node_assert.strictEqual(status_for(result, 'terminal_one_line').status, 'skip');
  node_assert.strictEqual(status_for(result, 'pipeline_artifacts').status, 'skip');
  node_assert.strictEqual(status_for(result, 'no_invented_ask').status, 'skip');
  node_assert.strictEqual(status_for(result, 'push_claim_valid').status, 'pass');
  node_assert.strictEqual(status_for(result, 'status_settings_match').status, 'skip');
});
