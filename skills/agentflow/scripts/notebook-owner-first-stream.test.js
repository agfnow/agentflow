'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const test = require('node:test');
const owner = require('./notebook-owner');
const writer = require('./notebook-write');
const temporary = require('./fixtures/temp-directory');
const cli = path.join(__dirname, 'agf.js');
const notebook = '.agentflow/features/first/first.devlog.md';
const start = (root, session) => spawnSync(process.execPath, [cli, 'start', '--repo', root, '--host', 'portable', '--session', session, '--message-stdin', '--json'], { cwd: root, input: 'godev', encoding: 'utf8' });
const git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const fixture = () => {
  const root = temporary('agf-first-stream-');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  const initialized = start(root, 'bootstrap');
  assert.equal(initialized.status, 0, initialized.stderr);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'bootstrap']);
  const opened = spawnSync(process.execPath, [cli, 'new', 'first'], { cwd: root, encoding: 'utf8' });
  assert.equal(opened.status, 0, opened.stderr);
  const worktree = path.join(root, '.worktrees', 'first');
  const file = path.join(worktree, notebook);
  const empty = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, empty.replace(/\+\s*$/u, '+ Explain this project.\n'));
  return { root, worktree, file, empty };
};

test('first startup claims a newly opened stream after its first Ask is filled, preserving owner text', () => {
  const { root, worktree, file } = fixture();
  const before = fs.readFileSync(file);
  const mainBefore = fs.readFileSync(path.join(root, '.agentflow/devlog.md'));
  const lock = writer.acquire_close_round_lock(`${file}.close-round.lock`);
  try {
    assert.throws(() => owner.guard({ root: worktree, notebook, host: 'portable', session: 'first' }), /ownership is unknown/u);
  } finally { writer.release_close_round_lock(lock); }
  const result = start(worktree, 'first');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).message.reason, 'already_present');
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readFileSync(path.join(root, '.agentflow/devlog.md')), mainBefore);
  assert.equal(owner.inspect({ root: worktree, notebook }).owner.session, 'first');
  assert.equal(start(worktree, 'first').status, 0);
  const foreign = start(worktree, 'second');
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /belongs to portable session first/u);
  assert.deepEqual(fs.readFileSync(file), before);
});

test('first-stream recovery refuses changed history, progress, later rounds and already committed requests', () => {
  for (const kind of ['prefix', 'progress', 'later', 'committed']) {
    const { worktree, file } = fixture();
    let text = fs.readFileSync(file, 'utf8');
    if (kind === 'prefix') text = text.replace('Project:', 'Changed project:');
    if (kind === 'progress') text += '\n## [RUN-001] Event\n\n- Work started.\n';
    if (kind === 'later') text += '\n# → Ask / A-002\n\n+ another request\n';
    fs.writeFileSync(file, text);
    if (kind === 'committed') { git(worktree, ['add', notebook]); git(worktree, ['commit', '-qm', 'existing request']); }
    const result = start(worktree, 'first');
    assert.notEqual(result.status, 0, kind);
    assert.match(result.stderr, /ownership/u, kind);
    assert.equal(fs.readFileSync(file, 'utf8'), text, kind);
    assert.equal(owner.inspect({ root: worktree, notebook }).owner, null, kind);
  }
});

test('two first-stream claims accept one session under the existing notebook lock', async () => {
  const { worktree, file } = fixture();
  const before = fs.readFileSync(file);
  const script = `const writer = require(process.argv[1]); const owner = require(process.argv[2]); const lock = writer.acquire_close_round_lock(process.argv[3] + '.close-round.lock'); try { owner.guard({root: process.cwd(), notebook: process.argv[4], host: 'portable', session: process.argv[5], resume_unclaimed: true}); } finally { writer.release_close_round_lock(lock); }`;
  const run = session => new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', script, path.join(__dirname, 'notebook-write.js'), path.join(__dirname, 'notebook-owner.js'), file, notebook, session], { cwd: worktree, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('exit', code => resolve({ session, code, stderr }));
  });
  const results = await Promise.all(['one', 'two'].map(run));
  assert.equal(results.filter(result => result.code === 0).length, 1, JSON.stringify(results));
  assert.equal(owner.inspect({ root: worktree, notebook }).owner.session, results.find(result => result.code === 0).session);
  assert.deepEqual(fs.readFileSync(file), before);
});
