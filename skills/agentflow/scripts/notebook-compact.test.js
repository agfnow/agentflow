'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const writer = require('./notebook-write');
const settings = require('./ag-settings');
const { spawnSync } = require('node:child_process');
const session = process.env.CODEX_THREAD_ID || process.env.CODEX_SESSION_ID || 'compact-test-session';
process.env.CODEX_THREAD_ID = session;
process.env.CODEX_SESSION_ID = session;

const fixture = (history = '', open = '+ current request\n') => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-compact-')));
  const notebook = '.agentflow/devlog.md';
  fs.mkdirSync(path.join(root, '.agentflow'));
  const config = settings.template_for_host('codex');
  fs.writeFileSync(path.join(root, 'ag.json'), JSON.stringify(config));
  const file = path.join(root, notebook);
  fs.writeFileSync(file, '# STATUS\n\nArchived eras: none.\n\n---\n\n' + history + '# → Ask / A-003\n\n' + open);
  const ownership = require('./notebook-owner');
  const lock = writer.acquire_close_round_lock(file + '.close-round.lock');
  try {
    const info = ownership.inspect({ root, notebook });
    ownership.transfer({ root, notebook, host: 'codex', session, ask: info.ask, expected: 'unowned', sha256: info.sha256 });
  } finally { writer.release_close_round_lock(lock); }
  return { root, notebook, file, archive: path.join(root, '.agentflow/devlog.archive.md') };
};
const closed = (id, text = 'finished') => `# → Ask / ${id}\n\n+ request\n\n# ← Reply / ${id}\n\n${text}\n\n## Questions\n\n- None.\n\n---\n\n`;
const compact = (f, options = {}) => {
  const lock = writer.acquire_close_round_lock(f.file + '.close-round.lock');
  try { return require('./notebook-compact').compact_locked({ root: f.root, notebook: f.notebook, original: writer.read_regular_file(f.file, 'notebook'), force: true, ...options }); }
  finally { writer.release_close_round_lock(lock); }
};

test('a single open Ask above one MiB accepts another owner message without truncation', () => {
  const text = '+ current request\n\n' + '歷史 input\n'.repeat(100000);
  const f = fixture('', text);
  const before = fs.readFileSync(f.file, 'utf8');
  assert.ok(Buffer.byteLength(before) > 1024 * 1024);
  writer.append_input({ root: f.root, notebook: f.notebook, text: 'continue large round', host: 'codex' });
  const after = fs.readFileSync(f.file, 'utf8');
  assert.ok(after.includes(text.trimEnd()));
  assert.match(after, /\+ continue large round/);
  assert.equal(fs.existsSync(f.archive), false);
});

test('compaction copies physical rounds byte-exactly and preserves the open Ask', () => {
  const history = closed('A-001', '繁體中文\r\n' + 'old\n'.repeat(1200)) + closed('A-002');
  const f = fixture(history);
  const before = fs.readFileSync(f.file);
  const result = compact(f);
  assert.equal(result.rounds.length, 2);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
  const after = fs.readFileSync(f.file, 'utf8');
  assert.ok(after.endsWith('# → Ask / A-003\n\n+ current request\n'));
  assert.match(after, /Archived eras: \.agentflow\/devlog.archive.md/);
  assert.ok(before.length > fs.statSync(f.file).size);
  assert.equal(compact(f).rounds.length, 0);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
});

test('capture automatically compacts completed history over the line threshold', () => {
  const history = closed('A-001', 'done\n'.repeat(1100));
  const f = fixture(history);
  writer.append_input({ root: f.root, notebook: f.notebook, text: 'next direction', host: 'codex' });
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
  assert.match(fs.readFileSync(f.file, 'utf8'), /\+ next direction/);
});

test('compaction reports the answered round that conservatively blocks the prefix', () => {
  const answered = `${closed('A-001')}## Questions\n\n- ans: keep this decision\n\n---\n\n`;
  const f = fixture(answered + closed('A-002'));
  const result = compact(f);
  assert.equal(result.rounds.length, 0);
  assert.deepEqual(result.blocked, { ask: 'A-001', reason: 'answered-round-retained' });
  assert.match(result.message, /A-001|answered|live/i);
});

test('an explicit manual override archives answered rounds without changing their bytes', () => {
  const answered = `${closed('A-001')}## Questions\n\n- ans: keep this decision\n\n---\n\n`;
  const history = answered + closed('A-002');
  const f = fixture(history);
  const result = compact(f, { include_answered: true });
  assert.equal(result.rounds.length, 2);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
  assert.ok(fs.readFileSync(f.file, 'utf8').endsWith('# → Ask / A-003\n\n+ current request\n'));
});

for (const invocation of ['canonical', 'case-alias', 'case-alias-capture']) test(`stream compaction extends its canonical archive and rename preserves the history (${invocation})`, t => {
  const root = require('./fixtures/temp-directory')('agf-stream-compact-');
  const notebook = '.agentflow/features/topic/topic.devlog.md';
  const archive = '.agentflow/features/topic/topic.archive.md';
  const config_path = '.agentflow/features/topic/ag.json';
  fs.mkdirSync(path.dirname(path.join(root, notebook)), { recursive: true });
  const config = settings.make_template('portable');
  config.switches['target-doc'] = notebook;
  fs.writeFileSync(path.join(root, config_path), JSON.stringify(config));
  const prior = closed('A-001', 'already archived');
  const recent = closed('A-002', invocation === 'case-alias-capture' ? 'done\n'.repeat(1100) : 'just completed');
  fs.writeFileSync(path.join(root, archive), prior);
  const status = settings.format_status({ project: 'stream archive', notebook, notebook_kind: 'stream', current_commit: 'fixture', tests_scenarios: 'none', config_path, host: 'portable', validation: 'validated', proven: 'fixture', open: 'none', next: 'compact', artifacts: 'none', archived_eras: archive, streams: [] });
  fs.writeFileSync(path.join(root, notebook), status + '\n---\n\n' + recent + '# → Ask / A-003\n\n+ current task\n');
  const target = invocation === 'canonical' ? notebook : notebook.replace('topic.devlog.md', 'topic.DEVLOG.md');
  if (!fs.existsSync(path.join(root, target))) { t.skip('native case alias requires a case-insensitive volume'); return; }
  require('./fixtures/notebook-owner').adopt(root, notebook, 'portable', 'stream-archive');
  assert.equal(settings.validate_status_projection(fs.readFileSync(path.join(root, notebook), 'utf8')).valid, true);
  if (invocation === 'case-alias-capture') writer.append_input({ root, notebook: target, host: 'portable', session: 'stream-archive', text: 'continue through alias' });
  else {
    const result = require('./notebook-compact').compact({ root, notebook: target, host: 'portable', session: 'stream-archive' });
    assert.equal(result.archive, archive);
  }
  assert.deepEqual(fs.readFileSync(path.join(root, archive)), Buffer.from(prior + recent));
  assert.equal(fs.existsSync(path.join(root, '.agentflow/features/topic/topic.devlog.archive.md')), false);
  assert.equal(fs.existsSync(path.join(root, '.agentflow/features/topic/topic.DEVLOG.archive.md')), false);
  assert.equal(settings.validate_status_projection(fs.readFileSync(path.join(root, notebook), 'utf8')).valid, true);
  const git = args => {
    const run = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
  };
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', 'Archive Test']);
  git(['config', 'user.email', 'archive@example.invalid']);
  git(['add', '-A']); git(['commit', '-qm', 'compacted fixture']);
  const renamed = '.agentflow/features/renamed/renamed.devlog.md';
  settings.rename_target_document({ repo_root: root, old_notebook: notebook, new_notebook: renamed, active_host: 'portable', session: 'stream-archive' });
  assert.deepEqual(fs.readFileSync(path.join(root, '.agentflow/features/renamed/renamed.archive.md')), Buffer.from(prior + recent));
  assert.equal(fs.existsSync(path.join(root, archive)), false);
  assert.equal(settings.validate_status_projection(fs.readFileSync(path.join(root, renamed), 'utf8')).valid, true);
});

test('archive collision and symlink refuse compaction without changing live bytes', () => {
  for (const kind of ['collision', 'symlink']) {
    const f = fixture(closed('A-001'));
    const before = fs.readFileSync(f.file);
    if (kind === 'collision') fs.writeFileSync(f.archive, closed('A-001', 'different'));
    else fs.symlinkSync(f.file, f.archive);
    assert.throws(() => compact(f), /collision|symbolic/i);
    assert.deepEqual(fs.readFileSync(f.file), before);
  }
});

test('archive copied before an interrupted notebook replacement is safely reused', () => {
  const history = closed('A-001');
  const f = fixture(history);
  const before = fs.readFileSync(f.file);
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => { if (to === f.file) throw Error('injected notebook rename failure'); return rename(from, to); };
    assert.throws(() => compact(f), /injected/);
  } finally { fs.renameSync = rename; }
  assert.deepEqual(fs.readFileSync(f.file), before);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
  assert.equal(compact(f).rounds.length, 1);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(history));
});

test('nonempty inline answers keep their round and later history live', () => {
  const answered = closed('A-002', 'Review choice\n\n- ans: preserve this answer');
  const f = fixture(closed('A-001') + answered);
  assert.equal(compact(f).rounds.length, 1);
  assert.ok(fs.readFileSync(f.file, 'utf8').includes(answered));
});

test('startup resumes a single large open Ask with bounded metadata', () => {
  const f = fixture('', '+ ' + 'large request '.repeat(90000) + '\n');
  const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', f.root, '--host', 'codex', '--message-stdin', '--json'], { cwd: f.root, input: 'godev\n', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).current_ask_identifier, 'A-003');
  assert.ok(Buffer.byteLength(result.stdout) < 8192);
});

test('large existing archives stream without truncation before verified append', () => {
  const existing = closed('A-000', '繁體'.repeat(400000));
  const history = closed('A-001');
  const f = fixture(history);
  fs.writeFileSync(f.archive, existing);
  compact(f);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(existing + history));
});

test('external notebook replacement during archive publication keeps the newer live bytes', () => {
  const f = fixture(closed('A-001'));
  const newer = fs.readFileSync(f.file, 'utf8') + '\n+ external owner instruction\n';
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      const result = rename(from, to);
      if (to === f.archive) fs.writeFileSync(f.file, newer);
      return result;
    };
    assert.throws(() => compact(f), /identity changed/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(f.file, 'utf8'), newer);
  assert.deepEqual(fs.readFileSync(f.archive), Buffer.from(closed('A-001')));
});
