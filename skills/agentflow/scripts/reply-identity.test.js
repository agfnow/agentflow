'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detect_reply_identity } = require('./reply-identity');
const id = '01a0927f-421d-7263-ab12-083e0839d8ac';
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-identity-'));
  const home = path.join(root, 'codex');
  const dir = path.join(home, 'sessions', '2026', '09', '12');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `rollout-date-${id}.jsonl`);
  const meta = { type: 'session_meta', payload: { id, cwd: root } };
  const turn = { type: 'turn_context', payload: { turn_id: 'turn-1', cwd: root, model: 'model-one', effort: 'low' } };
  const write = (...records) => fs.writeFileSync(file, records.map(r => JSON.stringify(r)).join('\n') + '\n');
  write(meta, turn);
  const options = { root, env: { CODEX_THREAD_ID: id, CODEX_HOME: home } };
  return { root, home, file, meta, turn, write, options };
};
test('rereads latest turn after a model switch and ignores config defaults', () => {
  const f = fixture();
  fs.writeFileSync(path.join(f.home, 'config.toml'), 'model = "wrong"');
  assert.equal(detect_reply_identity(f.options), 'model-one/low');
  fs.appendFileSync(f.file, JSON.stringify({ type: 'turn_context', payload: { ...f.turn.payload, model: 'model-two', effort: 'high' } }) + '\n');
  assert.equal(detect_reply_identity(f.options), 'model-two/high');
});
test('missing latest fields never reuse a previous turn', () => {
  const f = fixture();
  f.write(f.meta, f.turn, { type: 'turn_context', payload: { cwd: f.root, model: 'new-model' } });
  assert.equal(detect_reply_identity(f.options), 'codex/unknown');
});
test('rejects session, working directory and conflicting metadata identities', () => {
  for (const change of [f => { f.meta.payload.id = 'other'; }, f => { f.turn.payload.cwd = '/other'; }, f => { f.meta.payload.cwd = '/other'; }, f => { f.options.env.CODEX_SESSION_ID = 'other'; }, f => { f.turn.payload.collaboration_mode = { settings: { model: 'wrong', reasoning_effort: 'low' } }; }]) {
    const f = fixture(); change(f); f.write(f.meta, f.turn);
    assert.equal(detect_reply_identity(f.options), 'codex/unknown');
  }
});
test('absent, malformed, ambiguous and unsafe transcript evidence stays unknown', () => {
  assert.equal(detect_reply_identity({ env: {}, root: process.cwd() }), 'host/unknown');
  assert.equal(detect_reply_identity({ env: { CLAUDE_SESSION_ID: 'session' } }), 'claude/unknown');
  assert.equal(detect_reply_identity({ env: { CLAUDE_CODE_SESSION_ID: 'session' } }), 'claude/unknown');
  for (const change of [f => fs.writeFileSync(f.file, '{broken\n'), f => fs.appendFileSync(f.file, '{partial'), f => fs.copyFileSync(f.file, path.join(path.dirname(f.file), `rollout-other-${id}.jsonl`)), f => { f.turn.payload.model = 'bad)label'; f.write(f.meta, f.turn); }, f => { f.options.env.CODEX_HOME = path.join(f.root, 'missing'); }]) {
    const f = fixture(); change(f);
    assert.equal(detect_reply_identity(f.options), 'codex/unknown');
  }
});
