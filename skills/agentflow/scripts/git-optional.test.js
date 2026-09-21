'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const settings = require('./ag-settings');
const tracker = require('./tracker-contract');
const { format_local_timestamp } = require('./local-time');
const { detect } = require('./repository-state');
const { collect, validate_candidate } = require('./completion-context');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

const tracker_path = '.agentflow/artifacts/A-001-local/tracker.md';
const fixture = t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-git-optional-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.dirname(path.join(root, tracker_path)), { recursive: true });
  const config = settings.make_template('codex');
  fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(config));
  fs.writeFileSync(path.join(root, 'result.txt'), 'A verified local artifact.\n');
  const text = tracker.template
    .replace('<work-key>', 'A-001-local').replaceAll('<A-NNN>', 'A-001')
    .replace('<goal>', 'Save a local artifact').replace('<YYYY-MM-DD HH:MM:SS ±HHMM>', format_local_timestamp(new Date()))
    .replace('**Evidence commit:** uncommitted.', '**Evidence commit:** not applicable; plain folder.')
    .replaceAll('<count>', '1').replace('**Completed:** 0.', '**Completed:** 1.')
    .replace('**Remaining:** 1.', '**Remaining:** 0.')
    .replace('- [ ] **T-1:** <self-contained task: required outcome, scope boundary, and proof needed>.', '- [x] **T-1:** Saved result.txt. Proof: result.txt.')
    .replaceAll('**State:** active.', '**State:** complete.').replace('**Judgment:** active.', '**Judgment:** complete.')
    .replace('**All accepted tasks checked:** no.', '**All accepted tasks checked:** yes.')
    .replace('**Next action remaining:** T-1.', '**Next action remaining:** none.')
    .replace('<next action>', 'none').replace('**Evidence status:** current.', '**Evidence status:** complete.')
    .replace('<paths>', 'result.txt');
  fs.writeFileSync(path.join(root, tracker_path), text);
  const status = {
    project: 'local-test', notebook: '.agentflow/devlog.md', notebook_kind: 'root',
    current_commit: 'not applicable; plain folder', tests_scenarios: 'artifact read-back',
    config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'artifact saved',
    open: 'none', next: 'await the owner', artifacts: 'result.txt', archived_eras: 'none', streams: [],
  };
  const notebook = `${settings.format_status(status)}---\n\n# → Ask / A-001\n\n+ Save a local artifact.\n`;
  fs.writeFileSync(path.join(root, status.notebook), notebook);
  ownership_fixture.adopt(root, status.notebook);
  const manifest = {
    version: 1, notebook: status.notebook, ask: 'A-001', status,
    run_events: ['- Saved result.txt and verified its contents.'],
    reply: '## [SUMMARY]\n\n- Saved the local artifact.\n\n## [FINAL REPORT]\n\n1. Save a local artifact.\n\n   - Succeeded and checked the saved content.\n\n```completion-metadata\nInformational document: result.txt — standalone non-executable text artifact\n```\n',
    allowed_paths: [status.notebook, 'ag.json', tracker_path, 'result.txt'],
    commit_message: 'save local artifact', delivery: { mode: 'local' },
  };
  const run = (script, args, input, env = process.env) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env,
  });
  return { root, text, notebook, manifest, run };
};

test('plain-folder tracker validation accepts truthful local evidence', t => {
  const f = fixture(t);
  const validated = f.run('tracker-contract.js', ['validate', '--refresh', '--repo', f.root, '--tracker', tracker_path]);
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
});

test('plain-folder local closeout succeeds without invented commits and retries once', t => {
  const f = fixture(t);
  const close = () => f.run('agf.js', ['close', '--manifest-stdin'], f.manifest);
  const first = close();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  assert.equal(JSON.parse(first.stdout).commit.state, 'not_applicable');
  const file = path.join(f.root, f.manifest.notebook);
  const saved = fs.readFileSync(file, 'utf8');
  assert.equal(close().status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), saved);
  assert.equal((saved.match(/# ← Reply \/ A-001/g) || []).length, 1);
  assert.equal((saved.match(/# → Ask \/ A-002/g) || []).length, 1);
  assert.ok(saved.includes(f.notebook.slice(f.notebook.indexOf('# → Ask'))));
  assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
});

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const initialize_git = root => {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.name', 'Local Test']);
  git(root, ['config', 'user.email', 'local@example.invalid']);
};
const check_callers = (f, env = process.env, expected = 0) => {
  const preflight = f.run('terminal-preflight.js', [f.manifest.notebook, '--context-stdin'], {
    project_root: f.root, notebook_path: f.manifest.notebook, active_host: 'codex', require_status_projection: true,
  }, env);
  assert.equal(preflight.status, expected === 0 ? 0 : 1, preflight.stdout + preflight.stderr);
  const stop = f.run('stop-hook.js', ['--host', 'codex'], { cwd: f.root, hook_event_name: 'Stop' }, env);
  assert.equal(stop.status, expected === 0 ? 0 : 2, stop.stdout + stop.stderr);
  return { preflight, stop };
};

test('plain-folder closeout, preflight and stop work with Git absent from PATH', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'empty-bin');
  fs.mkdirSync(bin);
  const env = { ...process.env, PATH: bin };
  const validated = f.run('tracker-contract.js', ['validate', '--repo', f.root, '--tracker', tracker_path], undefined, env);
  assert.equal(validated.status, 0, validated.stderr + validated.stdout);
  const close = f.run('agf.js', ['close', '--manifest-stdin'], f.manifest, env);
  assert.equal(close.status, 0, close.stdout + close.stderr);
  assert.equal(JSON.parse(close.stdout).commit.state, 'not_applicable');
  check_callers(f, env);
});

test('Reply insertion, context, preflight and stop share local tracker validation', t => {
  const f = fixture(t);
  const context = () => collect({ project_root: f.root, notebook_path: f.manifest.notebook, active_host: 'codex', devlog_text: fs.readFileSync(path.join(f.root, f.manifest.notebook), 'utf8') });
  assert.equal(context().tracker.repository.state, 'plain');
  const inserted = f.run('notebook-write.js', ['append-reply', '--notebook', f.manifest.notebook, '--ask', 'A-001', '--input-stdin'], `# ← Reply / A-001\n\n${f.manifest.reply}`);
  assert.equal(inserted.status, 0, inserted.stdout + inserted.stderr);
  assert.equal(validate_candidate({ devlog_text: context().devlog_text, context: { project_root: f.root, notebook_path: f.manifest.notebook, active_host: 'codex' } }).ok, true);
  check_callers(f);
  fs.writeFileSync(path.join(f.root, tracker_path), f.text.replace('**Remaining:** 0.', '**Remaining:** 1.'));
  const failed = check_callers(f, process.env, 1);
  assert.match(failed.stop.stderr, /tracker counts/);
});

test('invalid local completion leaves notebook bytes unchanged and push remains unavailable', t => {
  const f = fixture(t);
  const notebook = path.join(f.root, f.manifest.notebook);
  fs.writeFileSync(path.join(f.root, tracker_path), f.text.replace('- [x]', '- [ ]'));
  for (const [script, args, input] of [
    ['agf.js', ['close', '--manifest-stdin'], f.manifest],
    ['notebook-write.js', ['append-reply', '--notebook', f.manifest.notebook, '--ask', 'A-001', '--input-stdin'], `# ← Reply / A-001\n\n${f.manifest.reply}`],
  ]) {
    const result = f.run(script, args, input);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /unfinished tasks/);
    assert.equal(fs.readFileSync(notebook, 'utf8'), f.notebook);
  }
  fs.writeFileSync(path.join(f.root, tracker_path), f.text);
  const push = f.run('agf.js', ['close', '--manifest-stdin', '--push-authorized'], { ...f.manifest, delivery: { mode: 'push', remote: 'origin', branch: 'main' } });
  assert.notEqual(push.status, 0);
  assert.match(push.stdout, /push delivery requires a Git repository/);
  assert.equal(fs.readFileSync(notebook, 'utf8'), f.notebook);
});

test('Git repositories including unborn and worktrees never accept the local marker', t => {
  const f = fixture(t);
  initialize_git(f.root);
  assert.equal(detect(f.root).state, 'git');
  // A repository created after startup cannot reuse a stale plain-folder fact.
  assert.equal(collect({ project_root: f.root, notebook_path: f.manifest.notebook, devlog_text: f.notebook }).tracker.repository.state, 'git');
  assert.equal(tracker.validate({ repo: f.root, tracker: path.join(f.root, tracker_path) }).status, 'fail');
  git(f.root, ['add', '.']);
  git(f.root, ['commit', '-qm', 'fixture']);
  const head = git(f.root, ['rev-parse', 'HEAD']);
  const worktree = path.join(f.root, 'linked');
  git(f.root, ['worktree', 'add', '-q', '-b', 'linked', worktree]);
  for (const root of [f.root, worktree]) {
    const file = path.join(root, tracker_path);
    const nested = path.dirname(file);
    assert.equal(detect(nested).state, 'git');
    assert.equal(tracker.validate({ repo: root, tracker: file }).status, 'fail');
    fs.writeFileSync(file, f.text.replace('not applicable; plain folder', head));
    assert.equal(tracker.validate({ repo: root, tracker: file }).status, 'pass');
  }
});

test('missing or broken Git with metadata is an error, including without a tracker', t => {
  for (const kind of ['missing', 'broken', 'worktree-file', 'malformed-metadata', 'bare']) {
    const f = fixture(t);
    initialize_git(f.root);
    if (kind === 'worktree-file') {
      fs.renameSync(path.join(f.root, '.git'), path.join(f.root, 'saved-git'));
      fs.writeFileSync(path.join(f.root, '.git'), 'gitdir: ./saved-git\n');
    }
    if (kind === 'malformed-metadata') fs.writeFileSync(path.join(f.root, '.git', 'HEAD'), 'broken\n');
    if (kind === 'bare') git(f.root, ['config', 'core.bare', 'true']);
    const bin = path.join(f.root, 'bin');
    fs.mkdirSync(bin);
    if (kind === 'broken') fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nprocess.stderr.write('fatal: simulated Git failure'); process.exit(128);\n`, { mode: 0o755 });
    const env = ['malformed-metadata', 'bare'].includes(kind) ? process.env : { ...process.env, PATH: bin };
    const validated = f.run('tracker-contract.js', ['validate', '--repo', f.root, '--tracker', tracker_path], undefined, env);
    assert.notEqual(validated.status, 0, kind);
    assert.match(validated.stdout + validated.stderr, /Cannot determine repository state/);
    // Also guard completion when tracker discovery has nothing to validate.
    fs.renameSync(path.join(f.root, tracker_path), path.join(f.root, 'saved-tracker.txt'));
    const closed_text = `${f.notebook}\n# ← Reply / A-001\n\n${f.manifest.reply}\n---\n\n# → Ask / A-002\n\n+\n`;
    fs.writeFileSync(path.join(f.root, f.manifest.notebook), closed_text);
    const failed = check_callers(f, env, 1);
    assert.match(failed.stop.stderr, /repository_state/);
    fs.writeFileSync(path.join(f.root, f.manifest.notebook), f.notebook);
    const close = f.run('agf.js', ['close', '--manifest-stdin'], f.manifest, env);
    assert.notEqual(close.status, 0);
    assert.match(close.stdout, /Cannot determine repository state/);
    assert.equal(fs.readFileSync(path.join(f.root, f.manifest.notebook), 'utf8'), f.notebook);
  }
});

test('plain-folder exports retain existing commit-hash compatibility', t => {
  const f = fixture(t);
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-export-source-'));
  t.after(() => fs.rmSync(source, { recursive: true, force: true }));
  initialize_git(source);
  git(source, ['commit', '--allow-empty', '-qm', 'export source']);
  const exported = f.text.replace('not applicable; plain folder', git(source, ['rev-parse', 'HEAD']));
  fs.writeFileSync(path.join(f.root, tracker_path), exported);
  const validated = f.run('tracker-contract.js', ['validate', '--repo', f.root, '--tracker', tracker_path]);
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const closed = f.run('agf.js', ['close', '--manifest-stdin'], f.manifest);
  assert.equal(closed.status, 0, closed.stdout + closed.stderr);
  assert.equal(JSON.parse(closed.stdout).commit.state, 'not_applicable');
});

test('filesystem-native metadata lookup protects mixed-case Git directories and worktree files', t => {
  for (const kind of ['directory', 'worktree-file']) {
    const f = fixture(t);
    initialize_git(f.root);
    if (kind === 'worktree-file') {
      fs.renameSync(path.join(f.root, '.git'), path.join(f.root, 'saved-git'));
      fs.writeFileSync(path.join(f.root, '.git'), 'gitdir: ./saved-git\n');
    }
    fs.renameSync(path.join(f.root, '.git'), path.join(f.root, '.GiT'));
    if (!fs.existsSync(path.join(f.root, '.git'))) { t.skip('This regression requires a case-insensitive filesystem.'); return; }
    assert.equal(detect(f.root).state, 'git');
    const bin = path.join(f.root, 'empty-bin');
    fs.mkdirSync(bin);
    const env = { ...process.env, PATH: bin };
    const validation = f.run('tracker-contract.js', ['validate', '--repo', f.root, '--tracker', tracker_path], undefined, env);
    assert.notEqual(validation.status, 0, kind);
    assert.match(validation.stdout + validation.stderr, /Cannot determine repository state/);
    const close = f.run('agf.js', ['close', '--manifest-stdin'], f.manifest, env);
    assert.notEqual(close.status, 0);
    assert.equal(fs.readFileSync(path.join(f.root, f.manifest.notebook), 'utf8'), f.notebook);
  }
});

test('unexpected Git failures and environment overrides cannot manufacture a plain folder', t => {
  const f = fixture(t);
  const bin = path.join(f.root, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\nprocess.stderr.write('fatal: unexpected failure'); process.exit(128);\n`, { mode: 0o755 });
  for (const env of [{ ...process.env, PATH: bin }, { ...process.env, GIT_DIR: path.join(f.root, 'absent') }]) {
    const result = f.run('tracker-contract.js', ['validate', '--repo', f.root, '--tracker', tracker_path], undefined, env);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /Cannot determine repository state/);
  }
  t.mock.method(fs, 'lstatSync', () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); });
  assert.equal(detect(f.root).state, 'error');
});

for (const mode of ['plain', 'git']) test(`${mode} tracked completion has a real PTY journey`, t => {
  const f = fixture(t);
  if (mode === 'git') {
    initialize_git(f.root);
    git(f.root, ['add', '.']);
    git(f.root, ['commit', '-qm', 'fixture']);
    fs.writeFileSync(path.join(f.root, tracker_path), f.text.replace('not applicable; plain folder', git(f.root, ['rev-parse', 'HEAD'])));
    f.manifest.status.current_commit = 'local delivery recorded in Git history';
  }
  const journey = spawnSync('/usr/bin/expect', ['-c', [
    'set timeout 30', 'log_user 1',
    'spawn /bin/sh -c {test -t 0 && test -t 1 && tty && printf %s "$JOURNEY_INPUT" | tee /dev/stderr | "$JOURNEY_NODE" "$JOURNEY_AGF" close --manifest-stdin}',
    'expect eof', 'set waited [wait]', 'exit [lindex $waited 3]',
  ].join('\n')], {
    cwd: f.root, encoding: 'utf8', env: { ...process.env, JOURNEY_INPUT: JSON.stringify(f.manifest), JOURNEY_NODE: process.execPath, JOURNEY_AGF: path.join(__dirname, 'agf.js') },
  });
  assert.equal(journey.status, 0, journey.stdout + journey.stderr);
  assert.match(journey.stdout, /\/dev\/tt/);
  assert.match(journey.stdout, /Save a local artifact/);
  assert.match(journey.stdout, mode === 'plain' ? /"state": "not_applicable"/ : /"state": "created"/);
  assert.match(fs.readFileSync(path.join(f.root, f.manifest.notebook), 'utf8'), /# → Ask \/ A-002/);
  if (mode === 'git') assert.equal(git(f.root, ['rev-list', '--count', 'HEAD']), '2');
  else assert.equal(fs.existsSync(path.join(f.root, '.git')), false);
  check_callers(f);
});
