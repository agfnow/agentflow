'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync, spawn } = require('node:child_process');
const writer = require('./notebook-write');
const notebook = '.agentflow/devlog.md';
const ids = { A: '11111111-1111-4111-8111-111111111111', B: '22222222-2222-4222-8222-222222222222' };
const environment = id => ({ ...process.env, CODEX_THREAD_ID: ids[id], CODEX_SESSION_ID: ids[id], CLAUDE_SESSION_ID: '', CLAUDE_PROJECT_DIR: '', AGENTFLOW_SESSION_ID: '' });
const command = (root, script, args, input, id = 'A') => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: root, env: environment(id), input, encoding: 'utf8' });
const start = (root, id, input = `request ${id}`) => command(root, 'agf.js', ['start', '--repo', root, '--host', 'codex', '--message-stdin', '--json'], input, id);
const fixture = git => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-notebook-owner-')));
  if (git) assert.equal(spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: root }).status, 0);
  const result = start(root, 'A');
  assert.equal(result.status, 0, result.stderr);
  return root;
};
const read = root => fs.readFileSync(path.join(root, notebook), 'utf8');
const state = root => {
  const files = {};
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(root, file)] = fs.readFileSync(file).toString('base64');
    }
  };
  visit(root);
  return files;
};

for (const git of [true, false]) test(`foreign startup and all progress writers preserve ${git ? 'unborn Git' : 'plain'} owner state`, () => {
  const root = fixture(git);
  const before = state(root);
  const second = start(root, 'B', 'fast-lane foreign request');
  assert.notEqual(second.status, 0, 'foreign startup must refuse before capture');
  assert.match(second.stderr, /own|session/iu);
  assert.deepEqual(state(root), before);
  for (const operation of ['append-input', 'append-run', 'append-wip', 'append-reply', 'close-round']) {
    const args = [operation, '--notebook', notebook, '--host', 'codex', '--ask', 'A-001', '--input-stdin'];
    const reply = '# ← Reply / A-001\n\n## [SUMMARY]\n\n- Foreign writer.\n\n## [FINAL REPORT]\n\n1. Done.\n\n## Questions (batched — each with a suggested default)\n\n- None.\n';
    const input = operation === 'close-round' ? JSON.stringify({ ask: 'A-001', run_events: [], reply, status: {} }) : operation === 'append-reply' ? reply : '- foreign writer\n';
    const result = command(root, 'notebook-write.js', args, input, 'B');
    assert.notEqual(result.status, 0, operation);
    assert.match(result.stderr, /belongs to codex session/u, operation);
    assert.deepEqual(state(root), before, operation);
  }
  const same = start(root, 'A');
  assert.equal(same.status, 0, same.stderr);
  const captured = command(root, 'notebook-write.js', ['append-input', '--notebook', notebook, '--host', 'codex', '--input-stdin'], 'same-session follow-up');
  assert.equal(captured.status, 0, captured.stderr);
  assert.match(read(root), /same-session follow-up/u);
});

test('foreign prompt reaches the agent without startup or receipt mutation', () => {
  const root = fixture(false);
  const before = state(root);
  const result = command(root, 'stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: ids.B, turn_id: 'one', prompt: 'foreign hook' }), 'B');
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).hookSpecificOutput.additionalContext, /not saved.*ownership/u);
  assert.deepEqual(state(root), before);
});

const raw_fixture = (body = '+\n') => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-record-')));
  fs.mkdirSync(path.join(root, '.agentflow'));
  fs.writeFileSync(path.join(root, notebook), `# → Ask / A-001\n\n${body}`);
  return root;
};
const case_fixture = (target = notebook) => {
  const root = require('./fixtures/temp-directory')('agf-owner-case-');
  fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
  fs.writeFileSync(path.join(root, target), '# → Ask / A-001\n\n+\n');
  return root;
};
const same_file = (left, right) => {
  try {
    const a = fs.statSync(left), b = fs.statSync(right);
    return String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
  } catch { return false; }
};
const native_case_alias = (root, target = notebook) => {
  const upper = target.replace(/devlog\.md$/u, 'DEVLOG.md');
  return same_file(path.join(root, target), path.join(root, upper));
};
const locked_notebook = (root, target, fn) => {
  const lock = writer.acquire_close_round_lock(`${path.join(root, target)}.close-round.lock`);
  try { return fn(require('./notebook-owner')); } finally { writer.release_close_round_lock(lock); }
};
const locked = (root, fn) => {
  const lock = writer.acquire_close_round_lock(`${path.join(root, notebook)}.close-round.lock`);
  try { return fn(require('./notebook-owner')); } finally { writer.release_close_round_lock(lock); }
};

test('foreign or unknown startup cannot migrate configuration before ownership, including locked intake', () => {
  const settings = require('./ag-settings');
  for (const owned of [false, true]) for (const startup_locked of [false, true]) {
    const root = owned ? fixture(false) : raw_fixture('+ legacy request\n');
    if (!owned) fs.writeFileSync(path.join(root, notebook), settings.format_status({ project: 'legacy ownership', notebook, notebook_kind: 'root', current_commit: 'fixture', tests_scenarios: 'none', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'resume', artifacts: 'none', archived_eras: 'none', streams: [] }) + '\n---\n\n' + read(root));
    const config = settings.make_template('codex');
    config['schema-version'] = 7;
    fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(config));
    if (startup_locked) fs.writeFileSync(path.join(root, '.agentflow-start.lock'), 'Agentflow startup lock\npid: 1\n');
    const before = state(root);
    const result = start(root, 'B');
    if (startup_locked) {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(JSON.parse(result.stdout).message.reason, 'startup_lock_present');
    } else {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /ownership/u);
    }
    assert.deepEqual(state(root), before);
    if (owned && !startup_locked) {
      assert.equal(start(root, 'A', 'authorized migration').status, 0);
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'ag.json')))['schema-version'], 8);
    }
  }
});

test('foreign Reply preparation and read-only intake leave legacy configuration unchanged', () => {
  const root = fixture(false);
  const config = JSON.parse(fs.readFileSync(path.join(root, 'ag.json')));
  config['schema-version'] = 7;
  fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(config));
  const before = state(root);
  const reply = '# ← Reply / A-001\n\n## [SUMMARY]\n\n- Foreign.\n\n## [FINAL REPORT]\n\n1. Foreign result.\n\n## Questions\n\n- None.\n';
  const result = command(root, 'notebook-write.js', ['append-reply', '--notebook', notebook, '--ask', 'A-001', '--host', 'codex', '--input-stdin'], reply, 'B');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /belongs to codex session/u);
  assert.deepEqual(state(root), before);
  require('./resume-intake').collect_intake({ repo_root: root, notebook_path: notebook, active_host: 'codex' });
  assert.deepEqual(state(root), before);
  assert.equal(require('./round-linter').lint_configuration({ project_root: root, notebook_path: notebook, active_host: 'codex' }).status, 'pass');
  assert.deepEqual(state(root), before);
});

test('identity requires a retained session and rejects native conflicts while ignoring unrelated generic markers', () => {
  const { identity } = require('./notebook-owner');
  assert.throws(() => identity({ host: 'codex', env: {} }), /identity is missing/u);
  assert.throws(() => identity({ host: 'codex', env: { CODEX_THREAD_ID: ids.A, CODEX_SESSION_ID: ids.B } }), /conflicting/u);
  assert.throws(() => identity({ host: 'claude', session: 'second', env: { CLAUDE_SESSION_ID: 'first' } }), /conflicting/u);
  assert.deepEqual(identity({ host: 'portable', session: 'retained', env: { CODEX_THREAD_ID: ids.A, CLAUDE_SESSION_ID: ids.B } }), { host: 'portable', session: 'retained' });
  assert.deepEqual(identity({ host: 'claude', session: 'native-payload', env: {} }), { host: 'claude', session: 'native-payload' });
});

test('Claude Code session identity accepts current and legacy names but rejects disagreements', () => {
  const { identity } = require('./notebook-owner');
  for (const env of [{ CLAUDE_CODE_SESSION_ID: 'current' }, { CLAUDE_SESSION_ID: 'current' }, { CLAUDE_CODE_SESSION_ID: 'current', CLAUDE_SESSION_ID: 'current' }]) {
    assert.deepEqual(identity({ env }), { host: 'claude', session: 'current' });
  }
  assert.throws(() => identity({ host: 'claude', env: { CLAUDE_CODE_SESSION_ID: 'current', CLAUDE_SESSION_ID: 'different' } }), /conflicting/u);
  assert.throws(() => identity({ host: 'claude', session: 'different', env: { CLAUDE_CODE_SESSION_ID: 'current' } }), /conflicting/u);
});

test('populated legacy Ask needs explicit exact adoption and stale handoff cannot change its owner', () => {
  const root = raw_fixture('+ legacy task\n');
  const before = read(root);
  locked(root, owner => {
    assert.throws(() => owner.guard({ root, notebook, host: 'portable', session: 'A' }), /unknown.*agf owner adopt/u);
    const inspection = owner.inspect({ root, notebook });
    owner.transfer({ root, notebook, host: 'portable', session: 'A', ask: inspection.ask, expected: 'unowned', sha256: inspection.sha256 });
    const first = owner.guard({ root, notebook, host: 'portable', session: 'A' });
    owner.transfer({ root, notebook, host: 'portable', session: 'B', ask: inspection.ask, expected: first.record.token, sha256: inspection.sha256 });
    assert.throws(() => owner.transfer({ root, notebook, host: 'portable', session: 'C', ask: inspection.ask, expected: first.record.token, sha256: inspection.sha256 }), /precondition changed/u);
    assert.throws(() => owner.guard({ root, notebook, host: 'portable', session: 'A' }), /belongs to portable session B/u);
    assert.throws(() => owner.release(first, read(root)), /owner changed/u);
    assert.equal(owner.guard({ root, notebook, host: 'portable', session: 'B' }).record.session, 'B');
  });
  assert.equal(read(root), before);
});

test('verified release permits the next owner and fences delayed release', () => {
  const root = raw_fixture();
  locked(root, owner => {
    const first = owner.guard({ root, notebook, host: 'portable', session: 'A' });
    assert.throws(() => owner.release(first, read(root)), /completed owned Ask/u);
    const closed = '# → Ask / A-001\n\n+ task\n\n# ← Reply / A-001\n\nDone.\n\n---\n\n# → Ask / A-002\n\n+\n';
    fs.writeFileSync(path.join(root, notebook), closed);
    assert.throws(() => owner.guard({ root, notebook, host: 'portable', session: 'B' }), /still owned/u);
    owner.release(first, closed);
    const second = owner.guard({ root, notebook, host: 'portable', session: 'B' });
    assert.equal(second.record.ask, 'A-002');
    assert.throws(() => owner.release(first, closed), /owner changed/u);
    assert.throws(() => owner.guard({ root, notebook, ask: 'A-001', host: 'portable', session: 'A', allow_closed: true }), /still owned/u);
  });
});

test('malformed and symlink owner records refuse without notebook changes', () => {
  for (const kind of ['malformed', 'symlink']) {
    const root = raw_fixture();
    locked(root, owner => {
      const context = owner.guard({ root, notebook, host: 'portable', session: 'A' });
      if (kind === 'malformed') fs.writeFileSync(context.file, '{}');
      else {
        fs.renameSync(context.file, `${context.file}.retained`);
        fs.symlinkSync(`${context.file}.retained`, context.file);
      }
      const before = read(root);
      assert.throws(() => owner.guard({ root, notebook, host: 'portable', session: 'A' }), /malformed|symbolic/u);
      assert.equal(read(root), before);
    });
  }
});

test('direct completion publication cannot bypass foreign ownership', () => {
  const root = fixture(false);
  const before = state(root);
  // Run the exported publisher itself in a different native session.
  const actual = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).publish_reply("```completion-metadata\\nHost review: PASS — foreign\\n```\\n", {project_root: process.cwd(), notebook_path: ".agentflow/devlog.md", ask: "A-001", host: "codex"})', path.join(__dirname, 'completion-record.js')], { cwd: root, env: environment('B'), encoding: 'utf8' });
  assert.notEqual(actual.status, 0, actual.stderr);
  assert.match(actual.stderr, /belongs to codex session/u);
  assert.deepEqual(state(root), before);
  const scope = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).capture_input_scope(process.cwd(), ".agentflow/devlog.md", "codex", "A-001")', path.join(__dirname, 'notebook-write.js')], { cwd: root, env: environment('B'), encoding: 'utf8' });
  assert.notEqual(scope.status, 0, scope.stderr);
  assert.match(scope.stderr, /belongs to codex session/u);
  assert.deepEqual(state(root), before);
});

test('simultaneous first captures accept one session only', async () => {
  const root = raw_fixture();
  const run = id => new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'notebook-write.js'), 'append-input', '--notebook', notebook, '--host', 'codex', '--input-stdin'], { cwd: root, env: environment(id), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => resolve({ id, code, stderr }));
    child.stdin.end(`request ${id}`);
  });
  const results = await Promise.all(['A', 'B'].map(run));
  assert.equal(results.filter(result => result.code === 0).length, 1, JSON.stringify(results));
  const winner = results.find(result => result.code === 0).id;
  assert.match(read(root), new RegExp(`request ${winner}`, 'u'));
  assert.doesNotMatch(read(root), new RegExp(`request ${winner === 'A' ? 'B' : 'A'}`, 'u'));
});

test('a valid owner context cannot write another notebook or Ask', () => {
  const first = raw_fixture(), second = raw_fixture();
  locked(first, owner => {
    const context = owner.guard({ root: first, notebook, host: 'portable', session: 'A' });
    locked(second, other => other.guard({ root: second, notebook, host: 'portable', session: 'B' }));
    const before = state(second);
    assert.throws(() => writer.capture_input_scope(second, notebook, 'portable', 'A-001', { ownership: context }), /another checkout, notebook or Ask/u);
    assert.throws(() => require('./completion-record').publish_reply('plain reply', { project_root: second, notebook_path: notebook, ask: 'A-001', ownership: context }), /another checkout, notebook or Ask/u);
    assert.throws(() => writer.capture_input_scope(first, notebook, 'portable', 'A-002', { ownership: context }), /another checkout, notebook or Ask/u);
    assert.deepEqual(state(second), before);
  });
});

test('Windows case variants share one ownership key (simulated platform)', t => {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  const root = raw_fixture();
  locked(root, owner => {
    owner.guard({ root, notebook, host: 'portable', session: 'A' });
    const upper = '.agentflow/DEVLOG.md';
    assert.equal(owner.location({ root, notebook }).file, owner.location({ root, notebook: upper }).file);
    assert.equal(owner.location({ root, notebook, workspace: '.AGENTFLOW' }).file.toLowerCase(), owner.location({ root, notebook }).file.toLowerCase());
    assert.equal(owner.location({ root, notebook: '.agentflow/not-created.md' }).file, owner.location({ root, notebook: '.agentflow/NOT-CREATED.md' }).file);
    assert.throws(() => owner.guard({ root, notebook: upper, text: read(root), host: 'portable', session: 'B' }), /belongs to portable session A/u);
  });
});

test('native case aliases preserve one owner through writes, replacement and custom workspace spelling', t => {
  const root = case_fixture();
  const upper = '.agentflow/DEVLOG.md';
  try {
    if (!native_case_alias(root)) { t.skip('the fixture volume is case-sensitive; native alias coverage is unavailable'); return; }
    const owner = require('./notebook-owner');
    const first = locked_notebook(root, notebook, current => current.guard({ root, notebook, host: 'portable', session: 'A' }));
    const before = state(root);
    const lower = owner.location({ root, notebook });
    const alias = owner.location({ root, notebook: upper });
    const root_alias = owner.location({ root: root.toUpperCase(), notebook: upper, workspace: '.AGENTFLOW' });
    assert.equal(alias.file, lower.file);
    assert.equal(root_alias.file, lower.file);
    assert.equal(alias.notebook, notebook);
    assert.throws(() => writer.append_input({ root, notebook: upper, host: 'portable', session: 'B', text: 'foreign alias' }), /belongs to portable session A/u);
    assert.deepEqual(state(root), before, 'foreign alias refusal must preserve notebook and owner bytes');
    fs.renameSync(path.join(root, notebook), path.join(root, '.agentflow/temporary.md'));
    fs.renameSync(path.join(root, '.agentflow/temporary.md'), path.join(root, upper));
    assert.doesNotThrow(() => owner.verify(first, { root, notebook: upper, active: true }));
    assert.equal(writer.append_input({ root, notebook: upper, host: 'portable', session: 'A', text: 'same owner alias' }).inserted, true);
    assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /same owner alias/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native case aliases retain the first owner key when the notebook is created afterward', t => {
  const root = case_fixture();
  const target = path.join(root, notebook);
  const upper = '.agentflow/DEVLOG.md';
  fs.rmSync(target);
  try {
    fs.writeFileSync(target, '# → Ask / A-001\n\n+\n');
    const aliases_share_file = native_case_alias(root);
    fs.rmSync(target);
    if (!aliases_share_file) { t.skip('the fixture volume is case-sensitive; native alias coverage is unavailable'); return; }
    const owner = require('./notebook-owner');
    const first = locked_notebook(root, notebook, current => current.guard({ root, notebook, host: 'portable', session: 'A', allow_missing: true }));
    fs.writeFileSync(path.join(root, upper), '# → Ask / A-001\n\n+\n');
    const lower = owner.location({ root, notebook });
    const alias = owner.location({ root, notebook: upper });
    assert.equal(alias.file, first.file);
    assert.equal(alias.notebook, first.notebook);
    assert.doesNotThrow(() => owner.verify(first, { root, notebook: upper, active: true }));
    assert.equal(owner.guard({ root, notebook: upper, text: fs.readFileSync(path.join(root, upper), 'utf8'), host: 'portable', session: 'A' }).file, lower.file);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('case-sensitive volumes keep distinct actual notebook files independent', t => {
  const root = case_fixture();
  const upper = '.agentflow/DEVLOG.md';
  try {
    if (native_case_alias(root)) { t.skip('the fixture volume is case-insensitive; distinct-file coverage is unavailable'); return; }
    fs.writeFileSync(path.join(root, upper), '# → Ask / A-001\n\n+\n');
    const owner = require('./notebook-owner');
    const lower = locked_notebook(root, notebook, current => current.guard({ root, notebook, host: 'portable', session: 'A' }));
    const upper_owner = locked_notebook(root, upper, current => current.guard({ root, notebook: upper, host: 'portable', session: 'B' }));
    assert.notEqual(lower.file, upper_owner.file);
    assert.equal(owner.read(lower).session, 'A');
    assert.equal(owner.read(upper_owner).session, 'B');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native notebook aliases select adjacent custom-workspace configuration before the owner key', t => {
  const target = 'records/devlog.md', alias = 'RECORDS/DEVLOG.md';
  const root = case_fixture(target);
  try {
    if (!native_case_alias(root, target)) { t.skip('the fixture volume is case-sensitive'); return; }
    const config = require('./ag-settings').make_template('portable');
    config.switches['target-doc'] = target;
    config.switches['workspace-dir'] = '.runtime';
    fs.writeFileSync(path.join(root, 'records/ag.json'), JSON.stringify(config));
    const owner = require('./notebook-owner');
    const first = locked_notebook(root, target, current => current.guard({ root, notebook: target, host: 'portable', session: 'A' }));
    assert.match(first.file, /\.runtime\/\.tmp\//u);
    assert.equal(owner.location({ root, notebook: alias }).file, first.file);
    const before = state(root);
    assert.throws(() => writer.append_input({ root, notebook: alias, host: 'portable', session: 'B', text: 'foreign custom alias' }), /belongs to portable session A/u);
    assert.deepEqual(state(root), before);
    assert.equal(writer.append_input({ root, notebook: alias, host: 'portable', session: 'A', text: 'same custom owner' }).inserted, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('concurrent independent notebooks share runtime storage without taking each other owner', async () => {
  const root = raw_fixture();
  const other = '.agentflow/other.md';
  fs.writeFileSync(path.join(root, other), '# → Ask / A-001\n\n+\n');
  const run = (id, target) => new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'notebook-write.js'), 'append-input', '--notebook', target, '--host', 'codex', '--input-stdin'], { cwd: root, env: environment(id), stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('exit', code => resolve({ code, stderr }));
    child.stdin.end(`independent ${id}`);
  });
  const outcomes = await Promise.all([run('A', notebook), run('B', other)]);
  assert.ok(outcomes.every(result => result.code === 0), JSON.stringify(outcomes));
  assert.match(read(root), /independent A/u);
  assert.doesNotMatch(read(root), /independent B/u);
  assert.match(fs.readFileSync(path.join(root, other), 'utf8'), /independent B/u);
});

test('custom-workspace linked worktree hooks capture only their stream notebook', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-worktree-')));
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Notebook Test']);
  git(['config', 'user.email', 'notebook@example.invalid']);
  const settings = require('./ag-settings');
  const config = settings.make_template('codex');
  config.switches['workspace-dir'] = '.runtime';
  config.switches['target-doc'] = '.runtime/devlog.md';
  fs.mkdirSync(path.join(root, '.runtime'));
  fs.writeFileSync(path.join(root, '.runtime/devlog.md'), '# → Ask / A-001\n\n+\n');
  fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(config));
  git(['add', '-A']); git(['commit', '-qm', 'fixture']);
  const worktree = path.join(root, '.worktrees', 'feature');
  git(['worktree', 'add', '-qb', 'feature', worktree]);
  const stream = '.runtime/features/feature/feature.devlog.md';
  fs.mkdirSync(path.dirname(path.join(worktree, stream)), { recursive: true });
  fs.writeFileSync(path.join(worktree, stream), '# → Ask / A-001\n\n+\n');
  fs.writeFileSync(path.join(worktree, '.runtime/features/feature/ag.json'), JSON.stringify(settings.copy_for_notebook(config, stream, { repo_root: worktree, active_host: 'codex' })));
  const before = fs.readFileSync(path.join(worktree, '.runtime/devlog.md'));
  const hook = command(worktree, 'stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: worktree, hook_event_name: 'UserPromptSubmit', session_id: ids.B, turn_id: 'stream', prompt: 'stream-only request' }), 'B');
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(fs.readFileSync(path.join(worktree, stream), 'utf8'), /stream-only request/u);
  const rootWrite = command(worktree, 'notebook-write.js', ['append-input', '--notebook', '.runtime/devlog.md', '--host', 'codex', '--input-stdin'], 'wrong root', 'B');
  assert.notEqual(rootWrite.status, 0);
  assert.match(rootWrite.stderr, /canonical stream notebook/u);
  assert.deepEqual(fs.readFileSync(path.join(worktree, '.runtime/devlog.md')), before);
});

test('same-owner rename migrates active ownership in a custom workspace and rejects foreign rename', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-rename-')));
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Notebook Test']);
  git(['config', 'user.email', 'notebook@example.invalid']);
  const settings = require('./ag-settings');
  const from = 'records/source.md', to = 'relocated/destination.md';
  const config = settings.make_template('portable');
  config.switches['workspace-dir'] = '.runtime'; config.switches['target-doc'] = from;
  fs.mkdirSync(path.join(root, 'records'));
  fs.writeFileSync(path.join(root, 'records/ag.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, from), settings.format_status({ project: 'ownership test', notebook: from, notebook_kind: 'root', current_commit: 'fixture', tests_scenarios: 'none', config_path: 'records/ag.json', host: 'portable', validation: 'validated', proven: 'fixture', open: 'none', next: 'rename', artifacts: 'none', archived_eras: 'none', streams: [] }) + '\n---\n\n# → Ask / A-001\n\n+ rename this active notebook\n');
  git(['add', '-A']); git(['commit', '-qm', 'fixture']);
  const owner = require('./notebook-owner');
  const inspection = owner.inspect({ root, notebook: from });
  const lock = writer.acquire_close_round_lock(`${path.join(root, from)}.close-round.lock`);
  try { owner.transfer({ root, notebook: from, host: 'portable', session: 'A', ask: inspection.ask, expected: 'unowned', sha256: inspection.sha256 }); }
  finally { writer.release_close_round_lock(lock); }
  const before = state(root);
  assert.throws(() => settings.rename_target_document({ repo_root: root, old_notebook: from, new_notebook: to, active_host: 'portable', session: 'B' }), /belongs to portable session A/u);
  assert.deepEqual(state(root), before);
  settings.rename_target_document({ repo_root: root, old_notebook: from, new_notebook: to, active_host: 'portable', session: 'A' });
  assert.equal(owner.inspect({ root, notebook: to }).owner.session, 'A');
  assert.match(owner.location({ root, notebook: to }).file, /\.runtime\/\.tmp/u);
  assert.equal(writer.append_input({ root, notebook: to, host: 'portable', session: 'A', text: 'continue after rename' }).inserted, true);
  assert.throws(() => writer.append_input({ root, notebook: to, host: 'portable', session: 'B', text: 'foreign after rename' }), /belongs to portable session A/u);
  assert.match(fs.readFileSync(path.join(root, from), 'utf8'), /^Moved to:/u);
});

test('a standalone repository with a separate Git directory keeps its root notebook', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-separate-git-')));
  const git_dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-gitdir-'));
  const initialized = spawnSync('git', ['init', '-q', '-b', 'main', '--separate-git-dir', git_dir], { cwd: root, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(require('./notebook-owner').linked_worktree(root), false);
  const first = start(root, 'A');
  assert.equal(first.status, 0, first.stderr);
  const hook = command(root, 'stop-hook.js', ['--host', 'codex'], JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: ids.A, turn_id: 'root', prompt: 'standalone follow-up' }));
  assert.equal(hook.status, 0, hook.stderr);
  assert.match(read(root), /standalone follow-up/u);
  assert.notEqual(start(root, 'B').status, 0);
});
