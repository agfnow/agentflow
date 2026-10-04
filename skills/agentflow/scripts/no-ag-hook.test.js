'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const hook = path.join(__dirname, 'stop-hook.js');
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ag-hook-'));
  fs.mkdirSync(path.join(root, '.agentflow'));
  fs.writeFileSync(path.join(root, '.agentflow/devlog.md'), '# → Ask / A-001\n\n+ existing ordinary task\n');
  fs.writeFileSync(path.join(root, 'ag.json'), '{ malformed config');
  return root;
};
const run = (root, host, input, preload) => {
  const env = { ...process.env };
  for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CLAUDE_PROJECT_DIR', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID']) delete env[name];
  return spawnSync(process.execPath, [...(preload ? ['--require', preload] : []), hook, '--host', host], { cwd: root, env, input: JSON.stringify({ cwd: root, ...input }), encoding: 'utf8' });
};
const snapshot = root => fs.readdirSync(path.join(root, '.agentflow'), { recursive: true }).map(name => [name, fs.readFileSync(path.join(root, '.agentflow', name), 'utf8')]);
for (const host of ['codex', 'claude']) {
  test(`${host} Stop cannot reuse a prior bypass without current prompt or transcript`, () => {
    const root = fixture();
    assert.equal(run(root, host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt: 'no-ag repair' }).stdout, '');
    const stop = run(root, host, { hook_event_name: 'Stop', session_id: 'owner', transcript_path: path.join(root, 'missing.jsonl') });
    assert.equal(stop.status, 2, stop.stderr);
    assert.match(stop.stderr, /configuration_valid/);
  });
  for (const prompt of ['no-ag', 'no-ag:', 'no-ag: repair', 'no-ag how many files in folder?', 'no-ag yes again', '/no-ag repair this', 'no-ag, repair', '/no-ag, repair', '**no-ag**, repair']) {
    test(`${host} ${prompt} bypasses capture and Stop without notebook mutations`, () => {
      const root = fixture();
      const before = snapshot(root);
      const result = run(root, host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.deepEqual(snapshot(root), before);
      assert.equal(fs.readFileSync(path.join(root, 'ag.json'), 'utf8'), '{ malformed config');
      const stop = run(root, host, { hook_event_name: 'Stop', session_id: 'owner', prompt });
      assert.equal(stop.status, 0, stop.stderr);
      assert.equal(stop.stderr, '');
      assert.equal(run(root, host, { hook_event_name: 'Stop', session_id: 'other' }).status, 2);
      const ordinary = run(root, host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt: 'ordinary task' });
      assert.match(ordinary.stdout, /instruction was saved/);
      assert.equal(run(root, host, { hook_event_name: 'Stop', session_id: 'owner' }).status, 2);
    });
  }
  for (const prompt of ['"no-ag"', "'no-ag'", '`no-ag`', '"no-ag:"', "'no-ag: fix'", '`no-ag: fix`', '"no-ag how many files in folder?"', "'no-ag yes again'", '`no-ag repair`', '"example\nno-ag:\nend"', '`example\nno-ag:\nend`', '```text\nno-ag:\n```', '~~~text\nno-ag:\n~~~', '> no-ag:', 'For example: no-ag:', 'no-ag is a command', 'no-ag if tests pass', 'no-ag unless approved', 'no-ag: unless approved', 'no-ag repair; godev']) {
    test(`${host} captures mention ${JSON.stringify(prompt)}`, () => {
      const result = run(fixture(), host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt });
      assert.match(result.stdout, /instruction was saved/);
    });
  }
  test(`${host} Stop uses only the latest real transcript owner turn`, () => {
    const root = fixture();
    const transcript = path.join(root, 'transcript.jsonl');
    const write = entries => fs.writeFileSync(transcript, entries.map(entry => JSON.stringify(entry)).join('\n'));
    const owner = text => ({ type: 'user', sessionId: 'owner', message: { content: text } });
    write([owner('no-ag:'), { type: 'assistant', message: { content: 'ordinary assistant text' } }, { type: 'user', message: { content: [{ type: 'tool_result', content: 'ordinary tool text' }] } }]);
    assert.equal(run(root, host, { hook_event_name: 'Stop', transcript_path: transcript }).stderr, '');
    run(root, host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt: 'no-ag' });
    write([owner('no-ag'), owner('ordinary task')]);
    assert.equal(run(root, host, { hook_event_name: 'Stop', session_id: 'owner', transcript_path: transcript }).status, 2);
    write([{ type: 'user', sessionId: 'other', message: { content: 'ordinary task' } }]);
    run(root, host, { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt: 'no-ag' });
    assert.equal(run(root, host, { hook_event_name: 'Stop', session_id: 'owner', transcript_path: transcript }).status, 2);
    write([owner('no-ag')]);
    assert.equal(run(root, host, { hook_event_name: 'Stop', session_id: 'other', transcript_path: transcript }).status, 2);
  });
}
test('Codex Stop reads response_item and event_msg owner turns, excluding assistant and tool turns', () => {
  const root = fixture();
  const transcript = path.join(root, 'rollout.jsonl');
  const write = entries => fs.writeFileSync(transcript, entries.map(entry => JSON.stringify(entry)).join('\n'));
  for (const entry of [
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'no-ag:' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'no-ag: repair' } },
  ]) {
    write([{ type: 'session_meta', payload: { id: 'owner' } }, entry, { type: 'response_item', payload: { type: 'function_call_output', output: 'ordinary tool result' } }]);
    assert.equal(run(root, 'codex', { hook_event_name: 'Stop', session_id: 'owner', transcript_path: transcript }).stderr, '');
    assert.equal(run(root, 'codex', { hook_event_name: 'Stop', session_id: 'other', transcript_path: transcript }).status, 2);
  }
});

test('no-ag skips without creating a notebook or configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ag-absent-'));
  const result = run(root, 'codex', { hook_event_name: 'UserPromptSubmit', session_id: 'owner', prompt: 'no-ag:' });
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.deepEqual(fs.readdirSync(root), []);
});
