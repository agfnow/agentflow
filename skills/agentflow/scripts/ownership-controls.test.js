'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const owner = require('./notebook-owner');
const notebook = '.agentflow/devlog.md';
const fixture = () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-controls-')));
  fs.mkdirSync(path.join(root, '.agentflow'));
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+ request\n');
  return root;
};
const policy = (root, value) => fs.writeFileSync(path.join(root, '.agentflow/ag.json'), JSON.stringify({ switches: { 'notebook-ownership': value } }));
const options = root => ({ root, notebook, host: 'test-host', session: 'session-a' });
test('absent policy skips owner metadata and retains a bounded operation context', () => {
  const root = fixture();
  const held = owner.guard(options(root));
  assert.equal(held.policy, 'off');
  assert.equal(held.ask, 'A-001');
  assert.equal(held.record, undefined);
  assert.equal(fs.existsSync(path.join(root, '.agentflow/.tmp')), false);
  assert.doesNotThrow(() => owner.verify(held, { root, notebook, ask: 'A-001', active: true }));
  assert.throws(() => owner.verify(held, { ask: 'A-002' }), /another checkout, notebook or Ask/);
  assert.throws(() => owner.verify(held, { notebook: '.agentflow/other.md' }), /another checkout, notebook or Ask/);
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-002\n\n+ changed\n');
  assert.throws(() => owner.verify(held), /Ask.*changed/);
});
test('off never reads retained owner metadata and policy changes invalidate either mode', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n');
  policy(root, 'on');
  const first = owner.guard(options(root));
  const before = fs.readFileSync(first.file);
  policy(root, 'off');
  assert.throws(() => owner.verify(first), /policy.*changed/);
  const original_open = fs.openSync;
  const original_list = fs.readdirSync;
  fs.openSync = function(file, ...args) { if (String(file).includes('agentflow-owner-')) throw Error('owner metadata was opened'); return original_open.call(this, file, ...args); };
  fs.readdirSync = function(file, ...args) { if (String(file) === path.dirname(first.file)) throw Error('owner metadata directory was scanned'); return original_list.call(this, file, ...args); };
  let held;
  try { held = owner.guard({ ...options(root), session: 'session-b' }); owner.verify(held); }
  finally { fs.openSync = original_open; fs.readdirSync = original_list; }
  assert.deepEqual(fs.readFileSync(first.file), before);
  policy(root, 'on');
  assert.throws(() => owner.verify(held), /policy.*changed/);
  assert.throws(() => owner.guard({ ...options(root), session: 'session-b' }), /belongs to/);
  assert.deepEqual(fs.readFileSync(first.file), before);
});

test('off release and relocation preserve existing owner bytes without claiming a record', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n');
  policy(root, 'on');
  const first = owner.guard(options(root));
  const bytes = fs.readFileSync(first.file);
  policy(root, 'off');
  const held = owner.guard({ ...options(root), session: 'session-b' });
  const complete = '# → Ask / A-001\n\n+ request\n\n# ← Reply / A-001\n\nDone.\n\n# → Ask / A-002\n\n+\n';
  fs.writeFileSync(path.join(root, notebook), complete);
  assert.throws(() => owner.verify(held, { active: true }), /Ask.*changed/);
  owner.release(held, complete);
  assert.deepEqual(fs.readFileSync(first.file), bytes);
  const next = owner.guard({ ...options(root), session: 'session-c' });
  const destination = '.agentflow/renamed.md';
  fs.renameSync(path.join(root, notebook), path.join(root, destination));
  const relocated = owner.relocate(next, destination);
  assert.equal(relocated.record, undefined);
  assert.doesNotThrow(() => owner.verify(relocated));
  assert.deepEqual(fs.readFileSync(first.file), bytes);
  assert.equal(fs.readdirSync(path.dirname(first.file)).filter(file => file.startsWith('agentflow-owner-')).length, 1);
  fs.appendFileSync(path.join(root, destination), 'new active request\n');
  policy(root, 'on');
  assert.throws(() => owner.guard({ ...options(root), notebook: destination, session: 'session-c' }), /unknown/);
});

test('off rejects malformed policy, missing notebook, cross-checkout and unsafe targets', () => {
  const root = fixture();
  const held = owner.guard(options(root));
  assert.throws(() => owner.verify(held, { root: fixture() }), /another checkout/);
  assert.throws(() => owner.guard({ ...options(root), notebook: '../outside.md' }), /canonical/);
  policy(root, 'invalid');
  assert.throws(() => owner.guard(options(root)), /notebook-ownership/);
  policy(root, 'off');
  fs.renameSync(path.join(root, notebook), path.join(root, '.agentflow/retained.md'));
  assert.throws(() => owner.verify(held), /missing/);
});

test('off input, RUN, WIP and completion publication preserve retained foreign metadata', () => {
  const writer = require('./notebook-write');
  const root = fixture();
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n');
  policy(root, 'on');
  const first = owner.guard(options(root));
  const bytes = fs.readFileSync(first.file);
  policy(root, 'off');
  writer.append_input({ ...options(root), session: 'session-b', text: 'second session request' });
  fs.writeFileSync(path.join(root, 'draft.md'), '- work done\n');
  writer.append_run({ ...options(root), session: 'session-c', ask: 'A-001', input: 'draft.md' });
  fs.writeFileSync(path.join(root, 'draft.md'), '- progress saved\n');
  writer.append_wip({ ...options(root), session: 'session-b', ask: 'A-001', input: 'draft.md' });
  const held = owner.guard({ ...options(root), session: 'session-c' });
  require('./completion-record').publish_reply('```completion-metadata\nHost review: PASS — inspected the request.\n```\n', { project_root: root, notebook_path: notebook, workspace_dir: '.agentflow', ask: 'A-001', ownership: held });
  assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /second session request/);
  assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /progress saved/);
  assert.deepEqual(fs.readFileSync(first.file), bytes);
});

test('policy change during archive preparation refuses both archive and live publication', () => {
  const root = fixture();
  const writer = require('./notebook-write');
  fs.writeFileSync(path.join(root, notebook), '# STATUS\n\nArchived eras: none.\n\n---\n\n# → Ask / A-000\n\n+ old\n\n# ← Reply / A-000\n\nDone.\n\n---\n\n# → Ask / A-001\n\n+ request\n');
  const before = fs.readFileSync(path.join(root, notebook));
  const original = fs.fsyncSync;
  fs.fsyncSync = function(fd) { policy(root, 'on'); return original.call(this, fd); };
  try {
    assert.throws(() => require('./notebook-compact').compact({ ...options(root) }), /policy.*changed/);
  } finally { fs.fsyncSync = original; }
  assert.deepEqual(fs.readFileSync(path.join(root, notebook)), before);
  assert.equal(fs.existsSync(path.join(root, '.agentflow/devlog.archive.md')), false);
});

test('each progress writer refuses a policy change after its guard before publishing', () => {
  const writer = require('./notebook-write');
  for (const operation of ['append_input', 'append_run', 'append_wip']) {
    const root = fixture();
    const before = fs.readFileSync(path.join(root, notebook));
    fs.writeFileSync(path.join(root, 'draft.md'), '- progress saved\n');
    const original = owner.guard;
    owner.guard = function(options) { const held = original(options); policy(root, 'on'); return held; };
    try {
      assert.throws(() => writer[operation]({ ...options(root), text: 'new input', ask: 'A-001', input: 'draft.md' }), /policy.*changed/, operation);
    } finally { owner.guard = original; }
    assert.deepEqual(fs.readFileSync(path.join(root, notebook)), before, operation);
  }
});

test('off ignores malformed retained metadata; on still rejects it', () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, notebook), '# → Ask / A-001\n\n+\n');
  policy(root, 'on');
  const first = owner.guard(options(root));
  fs.writeFileSync(first.file, '{malformed retained owner');
  const before = fs.readFileSync(first.file);
  policy(root, 'off');
  assert.doesNotThrow(() => owner.verify(owner.guard(options(root))));
  assert.deepEqual(fs.readFileSync(first.file), before);
  policy(root, 'on');
  assert.throws(() => owner.guard(options(root)), /malformed/);
  assert.deepEqual(fs.readFileSync(first.file), before);
});

test('completion reference publication checks policy again after record publication', () => {
  const root = fixture();
  const writer = require('./notebook-write');
  const held = owner.guard(options(root));
  const before = fs.readFileSync(path.join(root, notebook));
  const original = writer.atomic_replace;
  writer.atomic_replace = function(file, ...args) {
    const result = original(file, ...args);
    if (String(file).endsWith('.json') && String(file).includes('completion')) policy(root, 'on');
    return result;
  };
  try {
    assert.throws(() => require('./completion-record').publish_reply('```completion-metadata\nHost review: PASS — inspected.\n```\n', { project_root: root, notebook_path: notebook, workspace_dir: '.agentflow', ask: 'A-001', ownership: held }), /policy.*changed/);
  } finally { writer.atomic_replace = original; }
  assert.deepEqual(fs.readFileSync(path.join(root, notebook)), before);
  const info = require('./completion-record').location({ project_root: root, notebook_path: notebook, workspace_dir: '.agentflow', ask: 'A-001' });
  assert.equal(fs.existsSync(info.reference_file), false);
});
