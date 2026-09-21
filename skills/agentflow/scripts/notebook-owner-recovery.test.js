'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const owner = require('./notebook-owner');
const writer = require('./notebook-write');
const temporary = require('./fixtures/temp-directory');
const notebook = '.agentflow/devlog.md';
const start = (root, session, message = 'godev') => spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', root, '--host', 'portable', '--session', session, '--message-stdin', '--json'], { cwd: root, input: message, encoding: 'utf8' });
const locked = (root, action) => {
  const lock = writer.acquire_close_round_lock(`${path.join(root, notebook)}.close-round.lock`);
  try { return action(); } finally { writer.release_close_round_lock(lock); }
};
const fixture = () => {
  const root = temporary('agf-owner-resume-');
  const result = start(root, 'previous', 'earlier request');
  assert.equal(result.status, 0, result.stderr);
  const file = path.join(root, notebook);
  const context = locked(root, () => owner.guard({ root, notebook, host: 'portable', session: 'previous' }));
  const completed = `${fs.readFileSync(file, 'utf8').trimEnd()}\n\n# ← Reply / A-001\n\nDone.\n\n---\n\n# → Ask / A-002\n\n+\n`;
  fs.writeFileSync(file, completed);
  locked(root, () => owner.release(context, completed));
  fs.writeFileSync(file, completed.replace(/\+\n$/u, '+ owner-prepopulated request\n'));
  return { root, file, context };
};

test('owner-requested startup resumes a populated released successor without adoption or history changes', () => {
  const { root, file, context } = fixture();
  const before = fs.readFileSync(file);
  const inspected = owner.inspect({ root, notebook });
  locked(root, () => assert.throws(() => owner.guard({ root, notebook, host: 'portable', session: 'next' }), /ownership is unknown/u));
  const resumed = start(root, 'next');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).message.reason, 'already_present');
  assert.deepEqual(fs.readFileSync(file), before);
  const after = owner.inspect({ root, notebook }).owner;
  assert.equal(after.ask, 'A-002');
  assert.equal(after.session, 'next');
  assert.notEqual(after.token, inspected.owner.token);
  assert.equal(start(root, 'next', 'resume').status, 0);
  assert.notEqual(start(root, 'foreign').status, 0);
  locked(root, () => {
    assert.throws(() => owner.release(context, before.toString()), /owner changed/u);
    assert.throws(() => owner.transfer({ root, notebook, host: 'portable', session: 'stale', ask: inspected.ask, expected: inspected.owner.token, sha256: inspected.sha256 }), /precondition changed/u);
  });
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(owner.inspect({ root, notebook }).owner, after);
});

test('resume authorization never overrides active, missing, unrelated or invalid release proof', () => {
  for (const kind of ['active', 'missing', 'no-reply', 'gap', 'older-predecessor']) {
    const { root, file, context } = fixture();
    let text = fs.readFileSync(file, 'utf8');
    if (kind === 'active') fs.writeFileSync(context.file, JSON.stringify({ ...context.record, ask: 'A-002' }));
    if (kind === 'missing') fs.renameSync(context.file, `${context.file}.retained`);
    if (kind === 'no-reply') text = text.replace('# ← Reply / A-001\n\nDone.', '');
    if (kind === 'gap') text = text.replace('# → Ask / A-002', '# → Ask / A-003');
    if (kind === 'older-predecessor') text += '\n# ← Reply / A-002\n\nDone.\n\n# → Ask / A-003\n\n+ another saved request\n';
    fs.writeFileSync(file, text);
    const record = fs.existsSync(context.file) ? fs.readFileSync(context.file) : null;
    const result = start(root, 'next');
    assert.notEqual(result.status, 0, kind);
    assert.match(result.stderr, /ownership/u, kind);
    assert.equal(fs.readFileSync(file, 'utf8'), text, kind);
    assert.deepEqual(fs.existsSync(context.file) ? fs.readFileSync(context.file) : null, record, kind);
  }
});

test('simultaneous authorized successor claims accept exactly one session under the notebook lock', async () => {
  const { root, file } = fixture();
  const before = fs.readFileSync(file);
  const script = `const writer = require(process.argv[1]); const owner = require(process.argv[2]); const lock = writer.acquire_close_round_lock(process.argv[3] + '.close-round.lock'); try { owner.guard({root: process.cwd(), notebook: '.agentflow/devlog.md', host: 'portable', session: process.argv[4], resume_unclaimed: true}); } finally { writer.release_close_round_lock(lock); }`;
  const run = session => new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', script, path.join(__dirname, 'notebook-write.js'), path.join(__dirname, 'notebook-owner.js'), file, session], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('exit', code => resolve({ session, code, stderr }));
  });
  const results = await Promise.all(['one', 'two'].map(run));
  assert.equal(results.filter(result => result.code === 0).length, 1, JSON.stringify(results));
  assert.equal(owner.inspect({ root, notebook }).owner.session, results.find(result => result.code === 0).session);
  assert.deepEqual(fs.readFileSync(file), before);
});
