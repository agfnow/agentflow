'use strict';

const node_assert = require('node:assert/strict');
const node_child_process = require('node:child_process');
const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const node_test = require('node:test');
const ag_settings = require('./ag-settings.js');
const { format_local_timestamp } = require('./local-time.js');

const SCRIPT = node_path.join(__dirname, 'notebook-write.js');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

node_test.test('writer generates RUN and WIP scaffolds from content without model-authored time', () => {
  const fixture = setup();
  const event = run_writer_stdin(fixture.root, ['append-run', '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], '- Tested the actual change.\n');
  node_assert.equal(event.status, 0, event.stderr);
  const progress = run_writer_stdin(fixture.root, ['append-wip', '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], '- **Finished:** First task.\n\n- **Running now:** Checking behavior.\n\n- **Still to do:** Second task.\n\n- **Next work action:** Run its test.\n\n' + CHECKS + '\n');
  node_assert.equal(progress.status, 0, progress.stderr);
  const text = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.match(text, /## \[RUN-001\] Event — \d{4}-\d{2}-\d{2}/u);
  node_assert.match(text, /## \[WIP-001\] Checkpoint — \d{4}-\d{2}-\d{2}/u);
  node_assert.match(text, /^## \[RUN-001\] Event[^\n]+ \(A-001\)$/mu);
  node_assert.match(text, /^## \[WIP-001\] Checkpoint[^\n]+ \(A-001\)$/mu);
  node_assert.ok(text.includes('Second task.'));
  node_assert.doesNotMatch(text, /\(during round A-001\)/u);
});

node_test.test('submitted paragraphs use plain plus items without capture metadata', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const text = 'also: are there any advisor prompt deleted?\r\n\r\n\r\ntoc is typo, removed already.';
  const first = run_writer_stdin(fixture.root, ['append-input', '--notebook', fixture.notebook_path, '--input-stdin'], text);
  node_assert.equal(first.status, 0, first.stderr);
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.ok(saved.endsWith('+ also: are there any advisor prompt deleted?\n\n+ toc is typo, removed already.\n'));
  node_assert.doesNotMatch(saved, /agentflow-input:|^>/mu);
  const retry = run_writer_stdin(fixture.root, ['append-input', '--notebook', fixture.notebook_path, '--input-stdin'], text);
  node_assert.equal(retry.status, 0, retry.stderr);
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), saved);
});

node_test.test('messages already written as plus items keep one list marker', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const text = '+ first question\n\n+ second question';
  require('./notebook-write.js').append_input({ root: fixture.root, notebook: fixture.notebook_path, text });
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.ok(saved.endsWith(text + '\n'));
  node_assert.doesNotMatch(saved, /^\+ \+/mu);
});

node_test.test('submitted owner input is preserved inside the current Ask before progress records', () => {
  const fixture = setup({ text: notebook({ body: '+ original\n\n---\n\n' + run_event(1, 'A-001') }) });
  const writer = require('./notebook-write.js');
  const message = 'New instruction: keep all files.\n# → Ask / A-999\n$(do not execute)';
  writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: message, message_id: 'turn-one' });
  writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: message, message_id: 'turn-one' });
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  const parsed = require('./round-linter.js').parse_devlog(saved);
  node_assert.deepEqual(parsed.ask_ids, ['A-001']);
  node_assert.ok(parsed.rounds[0].ask_text.includes('New instruction: keep all files.'));
  node_assert.equal(saved.split('New instruction: keep all files.').length - 1, 1);
  node_assert.ok(saved.includes('  # → Ask / A-999'));
  writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'Another instruction', message_id: 'turn-two' });
	writer.append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'skip-review: disposable test\n> skip-review: quoted example', message_id: 'turn-three' });
	const after = require('./round-linter').parse_devlog(node_fs.readFileSync(node_path.join(fixture.root, fixture.notebook_path), 'utf8'));
	node_assert.match(after.rounds.at(-1).owner_text, /^\+ skip-review: disposable test$/mu);
	node_assert.match(after.rounds.at(-1).owner_text, /^  > skip-review: quoted example$/mu);
  node_assert.ok(node_fs.readFileSync(fixture.notebook_file, 'utf8').includes('Another instruction'));
});

node_test.test('a hook submission adopts already captured input before preserving a later deliberate repeat', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const writer = require('./notebook-write.js');
  const text = '+ first question\n\n+ second question';
  const options = { root: fixture.root, notebook: fixture.notebook_path, text };
  writer.append_input(options);
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  const first = writer.append_input({ ...options, message_id: 'first' });
  node_assert.equal(first.inserted, false);
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), saved);
  writer.append_input({ ...options, message_id: 'first' });
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), saved);
  writer.append_input({ ...options, message_id: 'second' });
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8').split('+ first question').length - 1, 2);
});

node_test.test('a later submission matching one paragraph of a claimed message is preserved', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const writer = require('./notebook-write.js');
  const options = { root: fixture.root, notebook: fixture.notebook_path };
  writer.append_input({ ...options, text: 'first question\n\nsecond question', message_id: 'first' });
  const result = writer.append_input({ ...options, text: 'second question', message_id: 'second' });
  node_assert.equal(result.inserted, true);
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8').split('+ second question').length - 1, 2);
});

node_test.test('distinct submission IDs preserve repeated text across writer processes', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const submit = id => node_child_process.spawnSync(process.execPath, ['-e',
    'require(process.argv[1]).append_input({root:process.argv[2],notebook:process.argv[3],text:"repeat this instruction",message_id:process.argv[4]})',
    SCRIPT, fixture.root, fixture.notebook_path, id], { encoding: 'utf8' });
  for (const id of ['first', 'second', 'first', 'second']) {
    const result = submit(id);
    node_assert.equal(result.status, 0, result.stderr);
  }
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.equal(saved.split('+ repeat this instruction').length - 1, 2);
  node_assert.doesNotMatch(saved, /agentflow-input:|^>/mu);
});

node_test.test('an input receipt cannot hide a message whose notebook replacement failed', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const writer = require('./notebook-write.js');
  const options = { root: fixture.root, notebook: fixture.notebook_path, text: 'same text' };
  writer.append_input({ ...options, message_id: 'first' });
  const rename = node_fs.renameSync;
  try {
    node_fs.renameSync = (from, to) => {
      if (to === fixture.notebook_file) throw new Error('simulated notebook replacement failure');
      return rename(from, to);
    };
    node_assert.throws(() => writer.append_input({ ...options, message_id: 'second' }), /simulated/);
  } finally { node_fs.renameSync = rename; }
  writer.append_input({ ...options, message_id: 'second' });
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8').split('+ same text').length - 1, 2);
});

node_test.test('input receipts refuse a linked workspace runtime directory without changing the notebook', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const before = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_fs.symlinkSync(make_root(), node_path.join(fixture.root, '.agentflow', '.tmp'), 'dir');
  node_assert.throws(() => require('./notebook-write.js').append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'save me', message_id: 'first' }), /symbolic link/);
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), before);
});

node_test.test('Codex manual capture stores receipts in workspace without writing host configuration', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const writer = require('./notebook-write');
  const open = node_fs.openSync;
  const mkdir = node_fs.mkdirSync;
  const protected_path = node_path.join(fixture.root, '.codex');
  const deny = file => { if (String(file) === protected_path || String(file).startsWith(protected_path + node_path.sep)) throw Object.assign(new Error('simulated protected Codex directory'), { code: 'EPERM' }); };
  try {
    node_fs.openSync = (file, ...args) => { deny(file); return open(file, ...args); };
    node_fs.mkdirSync = (file, ...args) => { deny(file); return mkdir(file, ...args); };
    const options = { root: fixture.root, notebook: fixture.notebook_path, host: 'codex', text: 'manual recovery', message_id: 'first' };
    node_assert.equal(writer.append_input(options).inserted, true);
    node_assert.equal(writer.append_input(options).inserted, false);
  } finally { node_fs.openSync = open; node_fs.mkdirSync = mkdir; }
  node_assert.equal(node_fs.existsSync(protected_path), false);
  node_assert.ok(node_fs.readdirSync(node_path.join(fixture.root, '.agentflow', '.tmp')).some(file => file.startsWith('agentflow-input-codex-')));
});

node_test.test('append-run cannot race an active closeout writer', () => {
  const fixture = setup();
  node_fs.writeFileSync(`${fixture.notebook_file}.close-round.lock`, 'another writer');
  const before = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  const result = run_writer_stdin(fixture.root, ['append-run', '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], run_event(1, 'A-001'), { AGF_TEST_LOCK_WAIT_MS: '20' });
  node_assert.notEqual(result.status, 0);
  node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), before);
});

node_test.test('first captured instruction replaces the empty scaffold and permits progress', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  require('./notebook-write').append_input({ root: fixture.root, notebook: fixture.notebook_path, text: 'Create a blue greeting.' });
  const result = run_writer_stdin(fixture.root, ['append-run', '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], '- The greeting is verified.\n');
  node_assert.equal(result.status, 0, result.stderr);
});
const CHECKS = '- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker';
const recent_local_timestamp = () => format_local_timestamp(new Date(Date.now() - 120000));

const make_root = () => node_fs.realpathSync(node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-notebook-write-')));

const run_writer = (root, args) => node_child_process.spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: root,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

const run_writer_stdin = (root, args, input, env = {}) => node_child_process.spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: root,
  encoding: 'utf8',
  input,
  env: { ...process.env, ...env },
  stdio: ['pipe', 'pipe', 'pipe']
});

const write = (root, relative, content, mode = 0o644) => {
  const file = node_path.join(root, relative);
  node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
  node_fs.writeFileSync(file, content, { mode });
  node_fs.chmodSync(file, mode);
  return file;
};

const read_bytes = file => node_fs.readFileSync(file);

const checkpoint = (number, ask_id, marker = 'checkpoint', timestamp = recent_local_timestamp()) => [
  `## [WIP-${String(number).padStart(3, '0')}] Checkpoint — ${timestamp} (during round ${ask_id})`,
  '',
  '- **Finished:**',
  '',
  `  1. ${marker}.`,
  '',
  '- **Running now:** None.',
  '',
  '- **Still to do:** None.',
  '',
  '- **Next work action:** continue.',
  '',
  CHECKS,
  ''
].join('\n');

const run_event = (number, ask_id, marker = 'material change', timestamp = recent_local_timestamp()) => [
  `## [RUN-${String(number).padStart(3, '0')}] Event — ${timestamp} (during round ${ask_id})`,
  '',
  `- ${marker}.`,
  ''
].join('\n');

const notebook = ({ ask_id = 'A-001', body = '+ owner request\n', later = '', reply = '' } = {}) => [
  '# STATUS',
  '',
  'Project: test',
  '',
  '---',
  '',
  `# → Ask / ${ask_id}`,
  '',
  body,
  reply,
  later
].join('\n');

const setup = ({ relative = '.agentflow/devlog.md', text, mode = 0o644 } = {}) => {
  const root = make_root();
  const notebook_path = relative;
  const notebook_file = write(root, notebook_path, text ?? notebook(), mode);
  ownership_fixture.adopt(root, notebook_path);
  const draft_path = 'draft.md';
  const draft_file = write(root, draft_path, checkpoint(1, 'A-001', 'new WIP'));
  return { root, notebook_path, notebook_file, draft_path, draft_file };
};

const emulate_mode = (t, platform, observed_mode) => {
  const original_platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const chmod = node_fs.chmodSync;
  Object.defineProperty(process, 'platform', { value: platform });
  t.after(() => Object.defineProperty(process, 'platform', original_platform));
  t.mock.method(node_fs, 'chmodSync', (file, mode) => chmod(file, observed_mode(mode)));
};

for (const [platform, requested, observed, accepted] of [
  ['win32', 0o600, 0o666, true],
  ['win32', 0o400, 0o444, true],
  ['win32', 0o600, 0o444, false],
  ['win32', 0o400, 0o666, false],
  ['linux', 0o600, 0o666, false],
  ['linux', 0o640, 0o600, false],
]) node_test.test(`atomic replacement checks ${platform} permissions ${requested.toString(8)} -> ${observed.toString(8)}`, {
  skip: platform !== 'win32' && process.platform === 'win32' ? 'requires POSIX permission bits' : false,
}, t => {
  const fixture = setup();
  const before = read_bytes(fixture.notebook_file);
  const before_names = node_fs.readdirSync(node_path.dirname(fixture.notebook_file));
  emulate_mode(t, platform, () => observed);
  const replace = () => require('./notebook-write').atomic_replace(fixture.notebook_file, Buffer.from('replacement\n'), requested);
  if (accepted) {
    replace();
    node_assert.equal(node_fs.readFileSync(fixture.notebook_file, 'utf8'), 'replacement\n');
  } else {
    node_assert.throws(replace, error => {
      node_assert.match(error.message, /temporary notebook mode could not be preserved/u);
      node_assert.ok(error.message.includes(fixture.notebook_file), error.message);
      return true;
    });
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  }
  node_assert.deepEqual(node_fs.readdirSync(node_path.dirname(fixture.notebook_file)), before_names);
});

node_test.test('Windows permission mapping preserves Claude receipts and later owner input', t => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  emulate_mode(t, 'win32', mode => mode & 0o200 ? 0o666 : 0o444);
  const writer = require('./notebook-write');
  const options = { root: fixture.root, notebook: fixture.notebook_path, host: 'claude', session: ownership_fixture.session };
  writer.capture_input_scope(fixture.root, fixture.notebook_path, 'claude', 'A-001', { session: ownership_fixture.session });
  node_assert.equal(writer.append_input({ ...options, text: 'godev' }).reason, 'activation_only');
  for (const [message_id, text] of [['first', 'hihi'], ['second', 'follow-up'], ['second', 'follow-up']]) {
    writer.append_input({ ...options, message_id, text });
  }
  const saved = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.equal(saved.split('+ hihi').length - 1, 1);
  node_assert.equal(saved.split('+ follow-up').length - 1, 1);
  const receipt = node_fs.readdirSync(node_path.join(fixture.root, '.agentflow', '.tmp')).find(file => file.startsWith('agentflow-input-'));
  const data = JSON.parse(node_fs.readFileSync(node_path.join(fixture.root, '.agentflow', '.tmp', receipt), 'utf8'));
  node_assert.equal(data.ask, 'A-001');
  node_assert.equal(Object.keys(data.entries).length, 2);
});

node_test.test('startup --json reports the receipt path when permission preservation fails', () => {
  const root = make_root();
  const preload = write(root, 'mode-failure.cjs', [
    "const fs = require('node:fs');",
    'const chmod = fs.chmodSync;',
    "fs.chmodSync = (file, mode) => chmod(file, String(file).includes('agentflow-input-') ? 0o444 : mode);",
  ].join('\n'));
  const result = node_child_process.spawnSync(process.execPath, [
    '--require', preload, node_path.join(__dirname, 'agf.js'), 'start',
    '--repo', root, '--host', 'claude', '--session', ownership_fixture.session, '--message-stdin', '--json',
  ], { cwd: root, input: 'hihi\n', encoding: 'utf8' });
  node_assert.equal(result.status, 1);
  node_assert.match(result.stderr, /temporary notebook mode could not be preserved/u);
  node_assert.ok(result.stderr.includes(node_path.join(root, '.agentflow', '.tmp', 'agentflow-input-')), result.stderr);
  node_assert.match(result.stderr, /requested 600, observed 444/u);
  node_assert.doesNotMatch(node_fs.readFileSync(node_path.join(root, '.agentflow/devlog.md'), 'utf8'), /\+ hihi/u);
});

const command = (root, notebook_path, draft_path, ask_id = 'A-001') => [
  'append-wip',
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input',
  draft_path
];

const reply_command = (root, notebook_path, draft_path, ask_id = 'A-001') => [
  'append-reply',
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input',
  draft_path
];

const stdin_command = (operation, notebook_path, ask_id = 'A-001') => [
  operation,
  '--notebook',
  notebook_path,
  '--ask',
  ask_id,
  '--input-stdin'
];

const reply = (ask_id = 'A-001', body = '## [SUMMARY]\n\n- Done.\n\n## Questions (batched — each with a suggested default)\n\n- None.') => `# ← Reply / ${ask_id}\n\n${body}\n`;

const complete_reply = ask_id => reply(ask_id, '## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- The saved round is complete.\n\n## Questions (batched — each with a suggested default)\n\n- None.');

const complete_status_fields = () => ({
  project: 'test',
  notebook: 'devlog.md',
  notebook_kind: 'root',
  current_commit: 'implementation pending',
  tests_scenarios: 'focused tests',
  config_path: 'ag.json',
  host: 'codex',
  validation: 'validated',
  proven: 'the close-round candidate was checked',
  open: 'none',
  next: 'await the owner',
  artifacts: 'none',
  archived_eras: 'none',
  streams: [],
});

const complete_status = () => ag_settings.format_status(complete_status_fields());

const close_input = ({ ask = 'A-001', runs = [], reply_text = complete_reply('A-001'), status = complete_status_fields() } = {}) => JSON.stringify({
  ask,
  run_events: runs,
  reply: reply_text,
  status,
});

const close_command = (notebook_path = 'devlog.md') => ['close-round', '--notebook', notebook_path, '--input-stdin'];

const close_fixture = ({ text = `${complete_status()}---\n\n# → Ask / A-001\n\n+ finish the round\n`, mode = 0o644 } = {}) => {
  const root = make_root();
  write(root, 'ag.json', `${JSON.stringify(ag_settings.make_template('codex'), null, 2)}\n`);
  const notebook_file = write(root, 'devlog.md', text, mode);
  ownership_fixture.adopt(root, 'devlog.md');
  return { root, notebook_path: 'devlog.md', notebook_file };
};

const failure_text = result => `${result.stdout}\n${result.stderr}`;

const assert_refused_without_write = ({ root, notebook_path, draft_path, ask_id = 'A-001', pattern, snapshot_path = notebook_path }) => {
  const notebook_file = node_path.isAbsolute(snapshot_path) ? snapshot_path : node_path.join(root, snapshot_path);
  const before = read_bytes(notebook_file);
  const result = run_writer(root, command(root, notebook_path, draft_path, ask_id));
  node_assert.notEqual(result.status, 0);
  node_assert.match(failure_text(result), pattern);
  node_assert.deepEqual(read_bytes(notebook_file), before);
};

node_test.test('append-wip appends after the target Ask WIPs despite repeated identical footers', () => {
  const root = make_root();
  const notebook_path = 'history.md';
  const expected_timestamp = recent_local_timestamp();
  const old_round = notebook({
    ask_id: 'A-001',
    body: `+ old request\n\n${checkpoint(1, 'A-001', 'old', expected_timestamp)}`,
    reply: '# ← Reply / A-001\n\nold reply\n\n',
    later: '# → Ask / A-002\n\n+ current request\n\n'
  });
  const target = old_round + checkpoint(1, 'A-002', 'first target WIP', expected_timestamp) + checkpoint(2, 'A-002', 'second target WIP', expected_timestamp);
  const notebook_file = write(root, notebook_path, target);
  ownership_fixture.adopt(root, notebook_path);
  const draft_path = 'draft.md';
  const draft = write(root, draft_path, checkpoint(3, 'A-002', 'new target WIP', expected_timestamp));

  const result = run_writer(root, command(root, notebook_path, draft_path, 'A-002'));

  node_assert.equal(result.status, 0, failure_text(result));
  const updated = read_bytes(notebook_file).toString('utf8');
  const second = checkpoint(2, 'A-002', 'second target WIP', expected_timestamp).trimEnd();
  const third = checkpoint(3, 'A-002', 'new target WIP', expected_timestamp).trimEnd();
  node_assert.ok(updated.indexOf(second) < updated.indexOf(third));
  node_assert.ok(updated.indexOf(third) > updated.indexOf('# → Ask / A-002'));
  node_assert.equal((updated.match(/## \[WIP-003\]/g) || []).length, 1);
  node_assert.equal((updated.match(/## \[WIP-002\]/g) || []).length, 1);
  node_assert.equal(node_fs.existsSync(draft), false);
});

node_test.test('close-round validates and saves runs, Reply, STATUS, and the next Ask with one replacement', () => {
  const fixture = close_fixture();
  const first = run_writer_stdin(fixture.root, close_command(), close_input({ runs: [run_event(1, 'A-001', 'focused tests passed')] }));

  node_assert.equal(first.status, 0, failure_text(first));
  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /\+ finish the round\n\n---\n\n## \[RUN-001\]/u);
  node_assert.match(updated, /\[RUN-001\][\s\S]*# ← Reply \/ A-001[\s\S]*# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/u);
  node_assert.equal((updated.match(/\[RUN-001\]/g) || []).length, 1);
  node_assert.match(first.stdout, /"runs_inserted": 1/);
});

node_test.test('close-round rejects duplicate or out-of-order RUN content before writing', () => {
  for (const runs of [
    [run_event(2, 'A-001', 'one'), run_event(2, 'A-001', 'two')],
    [run_event(3, 'A-001', 'one')],
  ]) {
    const fixture = close_fixture({ text: `${complete_status()}---\n\n# → Ask / A-001\n\n+ finish the round\n\n${run_event(1, 'A-001', 'existing')}` });
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer_stdin(fixture.root, close_command(), close_input({ runs }));
    node_assert.notEqual(result.status, 0);
    node_assert.match(failure_text(result), /RUN.*(number|duplicate|already|next)/i);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  }
});

node_test.test('close-round distinguishes repeated manifest RUNs from notebook RUNs', () => {
  const repeated = close_fixture();
  const repeated_before = read_bytes(repeated.notebook_file);
  const event = run_event(1, 'A-001', 'same event');
  const repeated_result = run_writer_stdin(repeated.root, close_command(), close_input({ runs: [event, event] }));
  node_assert.notEqual(repeated_result.status, 0);
  node_assert.match(failure_text(repeated_result), /RUN-001.*more than once.*run_events/i);
  node_assert.deepEqual(read_bytes(repeated.notebook_file), repeated_before);

  const stored = close_fixture({ text: `${complete_status()}---\n\n# → Ask / A-001\n\n+ finish the round\n\n${event}` });
  const stored_before = read_bytes(stored.notebook_file);
  const stored_result = run_writer_stdin(stored.root, close_command(), close_input({ runs: [event] }));
  node_assert.notEqual(stored_result.status, 0);
  node_assert.match(failure_text(stored_result), /RUN-001.*already present.*remove it from run_events/i);
  node_assert.deepEqual(read_bytes(stored.notebook_file), stored_before);
});

node_test.test('close-round refuses malformed STATUS, incomplete Reply, failed completion, and stale identity', () => {
  const cases = [
    [close_input({ status: '# STATUS\n\nProject: broken\n' }), /STATUS|candidate completion/i],
    [close_input({ reply_text: '# ← Reply / A-001\n\n## [SUMMARY]\n\n## Questions (batched — each with a suggested default)\n\n- None.\n' }), /Reply|Questions|candidate completion/i],
  ];
  for (const [input, pattern] of cases) {
    const fixture = close_fixture();
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer_stdin(fixture.root, close_command(), input);
    node_assert.notEqual(result.status, 0);
    node_assert.match(failure_text(result), pattern);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  }

  const stale = close_fixture();
  const writer = require('./notebook-write.js');
  const original_open = node_fs.openSync;
  node_fs.openSync = (...args) => {
    const descriptor = original_open(...args);
    if (args[0] === `${stale.notebook_file}.close-round.lock`) node_fs.appendFileSync(stale.notebook_file, '\nforeign change\n');
    return descriptor;
  };
  try {
    node_assert.throws(() => writer.close_round({
      root: stale.root,
      notebook: stale.notebook_path,
      input: JSON.parse(close_input()),
    }), /identity changed|stale/i);
  } finally {
    node_fs.openSync = original_open;
  }
});

node_test.test('close-round leaves an old valid notebook when its atomic write fails', () => {
  const fixture = close_fixture();
  const before = read_bytes(fixture.notebook_file);
  const original = node_fs.renameSync;
  node_fs.renameSync = (from, to) => {
    if (to === fixture.notebook_file) throw new Error('forced close-round crash');
    return original(from, to);
  };
  try {
    node_assert.throws(() => require('./notebook-write.js').close_round({
      root: fixture.root,
      notebook: fixture.notebook_path,
      input: JSON.parse(close_input()),
    }), /forced close-round crash/);
  } finally {
    node_fs.renameSync = original;
  }
  node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
});

node_test.test('close-round takes one lock and performs one notebook replacement', () => {
  const fixture = close_fixture();
  const writer = require('./notebook-write.js');
  const lock_path = `${fixture.notebook_file}.close-round.lock`;
  const original_open = node_fs.openSync;
  const original_rename = node_fs.renameSync;
  let lock_opens = 0;
  let notebook_replacements = 0;
  node_fs.openSync = (...args) => {
    if (args[0] === lock_path) lock_opens += 1;
    return original_open(...args);
  };
  node_fs.renameSync = (from, to) => {
    if (to === fixture.notebook_file) notebook_replacements += 1;
    return original_rename(from, to);
  };
  try {
    const result = writer.close_round({
      root: fixture.root,
      notebook: fixture.notebook_path,
      input: JSON.parse(close_input()),
    });
    node_assert.equal(result.runs_inserted, 0);
  } finally {
    node_fs.openSync = original_open;
    node_fs.renameSync = original_rename;
  }
  node_assert.equal(lock_opens, 1);
  node_assert.equal(notebook_replacements, 1);
});

node_test.test('close-round preserves a replacement lock pathname during cleanup', () => {
  const fixture = close_fixture();
  const writer = require('./notebook-write.js');
  const lock_path = `${fixture.notebook_file}.close-round.lock`;
  const original_rename = node_fs.renameSync;
  let lock_replaced = false;
  node_fs.renameSync = (from, to) => {
    const result = original_rename(from, to);
    if (to === fixture.notebook_file) {
      node_fs.unlinkSync(lock_path);
      node_fs.writeFileSync(lock_path, 'replacement close-round\n');
      lock_replaced = true;
    }
    return result;
  };
  try {
    writer.close_round({
      root: fixture.root,
      notebook: fixture.notebook_path,
      input: JSON.parse(close_input()),
    });
  } finally {
    node_fs.renameSync = original_rename;
  }
  try {
    node_assert.equal(lock_replaced, true);
    node_assert.equal(node_fs.readFileSync(lock_path, 'utf8'), 'replacement close-round\n');
  } finally {
    if (node_fs.existsSync(lock_path)) node_fs.unlinkSync(lock_path);
  }
});

node_test.test('close-round refuses lock contention without changing notebook bytes', () => {
  const fixture = close_fixture();
  const lock_path = `${fixture.notebook_file}.close-round.lock`;
  const before = read_bytes(fixture.notebook_file);
  node_fs.writeFileSync(lock_path, 'active close-round\n');
  try {
    const result = run_writer_stdin(fixture.root, close_command(), close_input(), { AGF_TEST_LOCK_WAIT_MS: '0' });
    node_assert.notEqual(result.status, 0);
    node_assert.match(failure_text(result), /writer.*active|lock/i);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  } finally {
    node_fs.unlinkSync(lock_path);
  }
});

node_test.test('close-round remains old-or-new if the process fails after rename', () => {
  const fixture = close_fixture();
  const writer = require('./notebook-write.js');
  const original = node_fs.renameSync;
  let replaced = false;
  node_fs.renameSync = (from, to) => {
    const result = original(from, to);
    if (to === fixture.notebook_file) {
      replaced = true;
      throw new Error('forced post-rename crash');
    }
    return result;
  };
  try {
    node_assert.throws(() => writer.close_round({
      root: fixture.root,
      notebook: fixture.notebook_path,
      input: JSON.parse(close_input({ runs: [run_event(1, 'A-001', 'post-rename test')] })),
    }), /forced post-rename crash/);
  } finally {
    node_fs.renameSync = original;
  }
  node_assert.equal(replaced, true);
  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /post-rename test/);
  node_assert.match(updated, /# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/u);
  node_assert.equal(node_fs.existsSync(`${fixture.notebook_file}.close-round.lock`), false);
});

node_test.test('append-wip preserves notebook bytes outside the insertion and preserves mode', () => {
  const fixture = setup({ mode: 0o640 });
  const before = read_bytes(fixture.notebook_file);
  const draft_bytes = read_bytes(fixture.draft_file);
  const result = run_writer(fixture.root, command(fixture.root, fixture.notebook_path, fixture.draft_path));

  node_assert.equal(result.status, 0, failure_text(result));
  const after = read_bytes(fixture.notebook_file);
  const draft_start = after.indexOf(draft_bytes);
  node_assert.ok(draft_start > 0);
  node_assert.deepEqual(after.subarray(0, draft_start), before);
  node_assert.deepEqual(after.subarray(draft_start), draft_bytes);
  node_assert.equal(node_fs.statSync(fixture.notebook_file).mode & 0o7777, 0o640);
  node_assert.equal(node_fs.existsSync(fixture.draft_file), false);
});

node_test.test('append-wip accepts bounded standard input without a draft file', () => {
  const fixture = setup();
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-wip', fixture.notebook_path), checkpoint(1, 'A-001', 'stdin WIP'));

  node_assert.equal(result.status, 0, failure_text(result));
  node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /stdin WIP/);
  node_assert.equal(node_fs.readdirSync(fixture.root).some(name => /draft/i.test(name)), false);
});

node_test.test('append-run accepts sequential standard-input events interleaved with WIP checkpoints', () => {
  const fixture = setup({ text: notebook({ body: `+ request\n\n${run_event(1, 'A-001')}\n${checkpoint(1, 'A-001')}` }) });
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), run_event(2, 'A-001', 'focused tests passed'));

  node_assert.equal(result.status, 0, failure_text(result));
  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /\[RUN-001\][\s\S]*\[WIP-001\][\s\S]*\[RUN-002\]/u);
});

node_test.test('append-run separates the first RUN from owner input exactly once', () => {
  const fixture = setup({ text: notebook({ body: '+ owner request' }) });
  node_fs.unlinkSync(fixture.draft_file);

  const first = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), run_event(1, 'A-001', 'route selected'));
  node_assert.equal(first.status, 0, failure_text(first));

  const second = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), run_event(2, 'A-001', 'focused tests passed'));
  node_assert.equal(second.status, 0, failure_text(second));

  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /\+ owner request\n\n---\n\n## \[RUN-001\]/u);
  node_assert.match(updated, /## \[RUN-001\][\s\S]*## \[RUN-002\]/u);
  node_assert.equal((updated.match(/^---$/gmu) || []).length, 2);
});

node_test.test('append-run refuses duplicate numbering, a wrong round, and a closed Ask', () => {
  for (const [label, text, event, pattern] of [
    ['duplicate', notebook({ body: `+ request\n\n${run_event(1, 'A-001')}` }), run_event(1, 'A-001'), /RUN.*number/i],
    ['wrong-round', notebook(), run_event(1, 'A-002'), /round/i],
    ['short-round', notebook(), run_event(1, 'A-002').replace('during round ', ''), /round/i],
    ['closed', notebook({ reply: reply('A-001') }), run_event(1, 'A-001'), /closed|Reply/i],
  ]) {
    const fixture = setup({ text });
    node_fs.unlinkSync(fixture.draft_file);
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path), event);
    node_assert.notEqual(result.status, 0, label);
    node_assert.match(failure_text(result), pattern, label);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before, label);
  }
});

node_test.test('append-run ignores the exact quoted A-351 RUN and fenced WIP examples before its divider', () => {
  const quoted = [
    '+ 類似這種 worker 內部又啟動另個 process 做事的情況已發生幾次',
    '',
    '\t## [RUN-008] Event — implementation start 1 rejected after nested review (during round A-001)',
    '',
    '- **Failure:** After committing `9ef9f98c`, worker start 1 launched another Codex process to perform the final review.',
    '',
    '```markdown',
    '## [WIP-001] Checkpoint — example only (during round A-351)',
    '```',
    '',
    '+ add to task: fix this too,',
  ].join('\n') + '\n';
  const fixture = setup({ text: notebook({ ask_id: 'A-351', body: quoted }) });
  node_fs.unlinkSync(fixture.draft_file);
  const event = run_event(1, 'A-351', 'the first real RUN after the owner examples');
  const before = read_bytes(fixture.notebook_file).toString('utf8');
  const result = run_writer_stdin(fixture.root, stdin_command('append-run', fixture.notebook_path, 'A-351'), event);

  node_assert.equal(result.status, 0, failure_text(result));
  const updated = read_bytes(fixture.notebook_file).toString('utf8');
  node_assert.match(updated, /\t## \[RUN-008\][^\n]*\n/u);
  node_assert.match(updated, /```markdown\n## \[WIP-001\] Checkpoint — example only \(during round A-351\)\n```/u);
  node_assert.match(updated, /\n---\n\n## \[RUN-001\] Event —/u);
  node_assert.equal(updated.indexOf(quoted), 0 < updated.indexOf(quoted) ? updated.indexOf(quoted) : -1);
  node_assert.equal(updated.slice(0, updated.indexOf('\n---\n\n## [RUN-001]')), before.replace(/\n$/u, ''));
});

node_test.test('append-wip and append-run require a real local numeric-offset timestamp with seconds', () => {
  const expected_timestamp = recent_local_timestamp();
  for (const [command_name, valid, heading_pattern] of [
    ['append-wip', checkpoint(1, 'A-001', 'checkpoint', expected_timestamp), /^## \[WIP-001\][^\n]+/u],
    ['append-run', run_event(1, 'A-001', 'material change', expected_timestamp), /^## \[RUN-001\][^\n]+/u],
  ]) {
    for (const replacement of [
      `## [${command_name === 'append-wip' ? 'WIP' : 'RUN'}-001] ${command_name === 'append-wip' ? 'Checkpoint' : 'Event'} (during round A-001)`,
      `## [${command_name === 'append-wip' ? 'WIP' : 'RUN'}-001] ${command_name === 'append-wip' ? 'Checkpoint' : 'Event'} — 2026-09-06 09:57 (during round A-001)`,
      valid.replace(/ — \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}/u, ''),
      valid.replace(/\d{2}:\d{2}:\d{2} [+-]\d{4}/u, '09:57'),
      valid.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}/u, '2026-02-30 09:57:00 +0800'),
      `## [${command_name === 'append-wip' ? 'WIP' : 'RUN'}-001] ${command_name === 'append-wip' ? 'Checkpoint' : 'Event'} — 2026-09-06 09:57:00 UTC (during round A-001)`,
      valid.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} [+-]\d{4}/u, '2000-01-01 00:00:00 +0800'),
    ]) {
      const fixture = setup();
      node_fs.unlinkSync(fixture.draft_file);
      const input = valid.replace(heading_pattern, replacement);
      const result = run_writer_stdin(fixture.root, stdin_command(command_name, fixture.notebook_path), input);
      node_assert.notEqual(result.status, 0, replacement);
      node_assert.match(failure_text(result), /timestamp|Asia\/Taipei|heading/i, replacement);
    }
  }
});

node_test.test('standard input is mutually exclusive with file input and remains size bounded', () => {
  const fixture = setup();
  const both = run_writer_stdin(fixture.root, [...command(fixture.root, fixture.notebook_path, fixture.draft_path), '--input-stdin'], checkpoint(1, 'A-001'));
  node_assert.notEqual(both.status, 0);
  node_assert.match(failure_text(both), /mutually exclusive|usage/i);

  const before = read_bytes(fixture.notebook_file);
  const oversized = run_writer_stdin(fixture.root, stdin_command('append-wip', fixture.notebook_path), 'x'.repeat(1024 * 1024 + 1));
  node_assert.notEqual(oversized.status, 0);
  node_assert.match(failure_text(oversized), /oversized|maximum/i);
  node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
});

node_test.test('usage requires standard input first and labels named drafts as fallback-only', () => {
  const result = run_writer(process.cwd(), []);
  const output = failure_text(result);

  node_assert.notEqual(result.status, 0);
  node_assert.match(output, /--input-stdin.*fallback only after --input-stdin fails: --input <draft>/iu);
  node_assert.ok(output.indexOf('--input-stdin') < output.indexOf('--input <draft>'));
});

node_test.test('append-reply accepts standard input and creates the next Ask scaffold', () => {
  const fixture = setup();
  node_fs.unlinkSync(fixture.draft_file);
  const result = run_writer_stdin(fixture.root, stdin_command('append-reply', fixture.notebook_path), reply('A-001'));

  node_assert.equal(result.status, 0, failure_text(result));
  node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /# ← Reply \/ A-001[\s\S]*# → Ask \/ A-002(?: \([^\r\n)]+\))?\n\n\+\n$/u);
  node_assert.equal(node_fs.readdirSync(fixture.root).some(name => /draft/i.test(name)), false);
});

node_test.test('append-wip refuses an older non-final Ask', () => {
  const fixture = setup({
    text: notebook({
      ask_id: 'A-001',
      body: '+ older request\n',
      later: '# → Ask / A-002\n\n+ final request\n'
    })
  });

  assert_refused_without_write({ ...fixture, pattern: /non-final|later Ask|final unresolved/i });
});

node_test.test('append-wip refuses an Ask that already has a Reply', () => {
  const fixture = setup({
    text: notebook({
      body: '+ completed request\n',
      reply: '# ← Reply / A-001\n\ncompleted\n'
    })
  });

  assert_refused_without_write({ ...fixture, pattern: /closed|Reply/i });
});

node_test.test('append-wip refuses wrong WIP numbers and declared rounds', () => {
  const wrong_number = setup({ text: notebook({ body: `+ request\n\n${checkpoint(1, 'A-001', 'existing')}\n` }) });
  wrong_number.draft_file = write(wrong_number.root, 'wrong-number.md', checkpoint(1, 'A-001', 'duplicate'));
  assert_refused_without_write({ ...wrong_number, draft_path: 'wrong-number.md', pattern: /WIP.*(next|number|duplicate)/i });

  const wrong_round = setup({ text: notebook({ body: '+ request\n' }) });
  wrong_round.draft_file = write(wrong_round.root, 'wrong-round.md', checkpoint(2, 'A-002', 'wrong round'));
  assert_refused_without_write({ ...wrong_round, draft_path: 'wrong-round.md', pattern: /round/i });
});

node_test.test('append-wip refuses empty, multi-block, and boundary-bearing drafts without writing', () => {
  const valid = checkpoint(1, 'A-001');
  const cases = [
    ['empty', '', /empty/i],
    ['two WIPs', valid + checkpoint(2, 'A-001'), /exactly one|more than one|WIP/i],
    ['Ask heading', valid + '# → Ask / A-002\n', /Ask heading|boundary|draft/i],
    ['Reply heading', valid + '# ← Reply / A-001\n', /Reply heading|boundary|draft/i],
    ['STATUS heading', valid + '# STATUS\n', /STATUS|boundary|draft/i],
  ];

  for (const [label, content, pattern] of cases) {
    const fixture = setup();
    const draft_path = `${label.replace(/\s+/g, '-')}.md`;
    write(fixture.root, draft_path, content);
    assert_refused_without_write({ ...fixture, draft_path, pattern });
  }
});

node_test.test('append-wip supports the configured root notebook and a stream notebook with spaces', () => {
  for (const relative of ['.agentflow/devlog.md', 'features/stream with spaces/stream note.md']) {
    const fixture = setup({ relative });
    const result = run_writer(fixture.root, command(fixture.root, relative, fixture.draft_path));
    node_assert.equal(result.status, 0, `${relative}: ${failure_text(result)}`);
    node_assert.match(read_bytes(fixture.notebook_file).toString('utf8'), /\[WIP-001\]/);
  }
});

node_test.test('append-wip refuses absolute, traversal, duplicate, and symbolic-link paths without writing', () => {
  const traversal = setup();
  assert_refused_without_write({
    ...traversal,
    notebook_path: '../outside.md',
    snapshot_path: traversal.notebook_path,
    pattern: /traversal|repository-relative|inside/i
  });

  const absolute = setup();
  assert_refused_without_write({
    ...absolute,
    notebook_path: absolute.notebook_file,
    pattern: /absolute|repository-relative|inside/i
  });

  const duplicate = setup();
  assert_refused_without_write({
    ...duplicate,
    draft_path: duplicate.notebook_path,
    pattern: /same|duplicate|identity/i
  });

  const linked_notebook = setup();
  node_fs.symlinkSync(linked_notebook.notebook_file, node_path.join(linked_notebook.root, 'linked.md'));
  assert_refused_without_write({
    ...linked_notebook,
    notebook_path: 'linked.md',
    pattern: /symbolic|symlink|regular/i
  });

  const linked_draft = setup();
  node_fs.symlinkSync(linked_draft.draft_file, node_path.join(linked_draft.root, 'linked-draft.md'));
  assert_refused_without_write({
    ...linked_draft,
    draft_path: 'linked-draft.md',
    pattern: /symbolic|symlink|regular/i
  });
});

node_test.test('append-wip refuses oversized drafts without writing', () => {
  const fixture = setup();
  const oversized_path = 'oversized.md';
  write(fixture.root, oversized_path, Buffer.alloc(1024 * 1024 + 1, 0x78));
  assert_refused_without_write({ ...fixture, draft_path: oversized_path, pattern: /oversized|maximum|size/i });
});

node_test.test('two concurrent append-wip attempts cannot overwrite one another', () => {
  const fixture = setup({
    text: notebook({ body: `+ request\n\n${'x'.repeat(512 * 1024)}\n` })
  });
  const first = node_child_process.spawn(process.execPath, [SCRIPT, ...command(fixture.root, fixture.notebook_path, fixture.draft_path)], {
    cwd: fixture.root,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const second = node_child_process.spawn(process.execPath, [SCRIPT, ...command(fixture.root, fixture.notebook_path, fixture.draft_path)], {
    cwd: fixture.root,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  return Promise.all([
    new Promise(resolve => first.on('close', (code, signal) => resolve({ code, signal }))),
    new Promise(resolve => second.on('close', (code, signal) => resolve({ code, signal })))
  ]).then(results => {
    node_assert.equal(results.filter(result => result.code === 0).length, 1);
    node_assert.equal(results.filter(result => result.code !== 0).length, 1);
    const updated = read_bytes(fixture.notebook_file).toString('utf8');
    node_assert.equal((updated.match(/## \[WIP-001\]/g) || []).length, 1);
  });
});

node_test.test('append-reply closes only the exact final Ask and creates the next scaffold', () => {
  const root = make_root();
  const notebook_path = 'history.md';
  const old = notebook({
    ask_id: 'A-001',
    body: `+ old request\n\n${checkpoint(1, 'A-001', 'same footer')}`,
    reply: '# ← Reply / A-001\n\nold reply\n\n',
    later: `# → Ask / A-002\n\n+ current request\n\n${checkpoint(1, 'A-002', 'same footer')}`
  });
  const notebook_file = write(root, notebook_path, old, 0o640);
  ownership_fixture.adopt(root, notebook_path);
  const draft_path = 'reply.md';
  write(root, draft_path, reply('A-002', '## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n- The checkpointed round is complete.\n\n## Questions (batched — each with a suggested default)\n\n- None.'));
  const before = read_bytes(notebook_file);

  const result = run_writer(root, reply_command(root, notebook_path, draft_path, 'A-002'));

  node_assert.equal(result.status, 0, failure_text(result));
  const after = read_bytes(notebook_file);
  node_assert.deepEqual(after.subarray(0, before.length), before);
  const text = after.toString('utf8');
  node_assert.equal((text.match(/# ← Reply \/ A-002/g) || []).length, 1);
  node_assert.match(text, /# ← Reply \/ A-002[\s\S]*---\n\n# → Ask \/ A-003\n\n\+\n$/u);
  node_assert.equal(node_fs.statSync(notebook_file).mode & 0o7777, 0o640);
  node_assert.equal(node_fs.existsSync(node_path.join(root, draft_path)), false);
});

node_test.test('append-reply refuses a candidate with missing checkpoint evidence before replacement', () => {
  const fixture = setup({
    text: notebook({ body: `+ request\n\n${checkpoint(1, 'A-001')}` })
  });
  write(fixture.root, '.agentflow/ag.json', `${JSON.stringify(ag_settings.make_template('codex'), null, 2)}\n`);
  fixture.draft_file = write(fixture.root, 'reply.md', reply('A-001'));
  const before = read_bytes(fixture.notebook_file);
  const result = run_writer(fixture.root, reply_command(fixture.root, fixture.notebook_path, 'reply.md'));

  node_assert.equal(result.status, 1, failure_text(result));
  node_assert.match(failure_text(result), /candidate completion check failed|checkpoint|tracker/i);
  node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  node_assert.equal(node_fs.existsSync(fixture.draft_file), true);
});

node_test.test('successful write keeps a draft that was replaced before consume', () => {
  const fixture = setup();
  const original_rename = node_fs.renameSync;
  node_fs.renameSync = (from, to) => {
    original_rename(from, to);
    node_fs.writeFileSync(fixture.draft_file, 'replacement');
  };
  try {
    node_assert.throws(() => require('./notebook-write').append_wip({
      root: fixture.root,
      notebook: fixture.notebook_path,
      ask: 'A-001',
      input: fixture.draft_path
    }), /draft identity changed/i);
  } finally {
    node_fs.renameSync = original_rename;
  }
  node_assert.equal(node_fs.readFileSync(fixture.draft_file, 'utf8'), 'replacement');
});

node_test.test('append-reply rejects invalid targets and boundary-bearing drafts without changing bytes', () => {
  const cases = [
    ['wrong id', reply('A-002'), /does not match|Reply.*A-002/i],
    ['no heading', '## [SUMMARY]\n\n- Done.\n', /start|Reply heading/i],
    ['Ask heading', `${reply('A-001')}# → Ask / A-002\n`, /Ask heading|draft/i],
    ['STATUS heading', `${reply('A-001')}# STATUS\n`, /STATUS|draft/i],
    ['WIP heading', `${reply('A-001')}## [WIP-001] Checkpoint\n`, /WIP|draft/i],
    ['second Reply', `${reply('A-001')}# ← Reply / A-001\n`, /exactly one|second|Reply/i],
  ];
  for (const [label, content, pattern] of cases) {
    const fixture = setup();
    const draft_path = `${label.replaceAll(' ', '-')}.md`;
    write(fixture.root, draft_path, content);
    const before = read_bytes(fixture.notebook_file);
    const result = run_writer(fixture.root, reply_command(fixture.root, fixture.notebook_path, draft_path));
    node_assert.notEqual(result.status, 0, label);
    node_assert.match(failure_text(result), pattern, label);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before, label);
  }
});

node_test.test('append-reply rejects A-999 and a closed or older Ask without changing bytes', () => {
  const closed = setup({ text: notebook({ body: '+ done\n', reply: '# ← Reply / A-001\n\ndone\n' }) });
  write(closed.root, 'reply.md', reply('A-001'));
  let before = read_bytes(closed.notebook_file);
  let result = run_writer(closed.root, reply_command(closed.root, closed.notebook_path, 'reply.md'));
  node_assert.notEqual(result.status, 0);
  node_assert.deepEqual(read_bytes(closed.notebook_file), before);

  const last = setup({ text: notebook({ ask_id: 'A-999', body: '+ request\n' }) });
  write(last.root, 'reply.md', reply('A-999'));
  before = read_bytes(last.notebook_file);
  result = run_writer(last.root, reply_command(last.root, last.notebook_path, 'reply.md', 'A-999'));
  node_assert.notEqual(result.status, 0);
  node_assert.match(failure_text(result), /A-999|next Ask/i);
  node_assert.deepEqual(read_bytes(last.notebook_file), before);
});

node_test.test('cosmetic WIP footer wording is preserved without blocking the writer', () => {
  const fixture = setup();
  const body = '- **Finished:** First task.\n\n- **Running now:** Checking behavior.\n\n- **Still to do:** Second task.\n\n- **Next work action:** Run its test.\n\n- Checks: tracker, devlog RUN and scope checked.\n';
  const result = run_writer_stdin(fixture.root, ['append-wip', '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], body);
  node_assert.equal(result.status, 0, result.stderr);
  node_assert.ok(node_fs.readFileSync(fixture.notebook_file, 'utf8').includes(body.trim()));
});

node_test.test('close input rejects alternate field names and raw STATUS text without writing', () => {
  const fixture = close_fixture();
  const original = JSON.parse(close_input());
  const variants = [{ ...original, status: complete_status() }, { ...original, ask: undefined, ask_id: original.ask }, { ...original, run_events: undefined, runs: [] }, { ...original, status: undefined, status_fields: original.status }];
  const before = read_bytes(fixture.notebook_file);
  for (const value of variants) {
    const result = run_writer_stdin(fixture.root, close_command(), JSON.stringify(value));
    node_assert.notEqual(result.status, 0);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), before);
  }
});

node_test.test('closed retry matcher rejects retired runs alias and accepts canonical run_events', () => {
  const writer = require('./notebook-write.js');
  const fixture = close_fixture();
  const input = JSON.parse(close_input());
  const result = run_writer_stdin(fixture.root, close_command(), JSON.stringify(input));
  node_assert.equal(result.status, 0, result.stderr);
  const candidate = { candidate_text: node_fs.readFileSync(fixture.notebook_file, 'utf8') };
  node_assert.ok(writer.match_closed_close({ notebook_text: candidate.candidate_text, input }));
  node_assert.equal(writer.match_closed_close({ notebook_text: candidate.candidate_text, input: { ...input, run_events: undefined, runs: [] } }), null);
});

node_test.test('failed boundary validation does not poison the next in-process notebook operation', () => {
  const writer = require('./notebook-write.js');
  const fixture = close_fixture();
  const notebook = writer.read_regular_file(fixture.notebook_file, 'notebook');
  const ownership = require('./notebook-owner').guard({ root: fixture.root, notebook: fixture.notebook_path, text: notebook.text, host: 'codex', session: ownership_fixture.session, ask: 'A-001' });
  node_assert.throws(() => writer.prepare_close_candidate({
    notebook,
    notebook_path: fixture.notebook_path,
    root: fixture.root,
    ownership,
    input: { ...JSON.parse(close_input()), reply: '# ← Reply / A-001\n\n# → Ask / A-999\n' },
  }), /Ask heading|boundary|Reply/i);
  const prepared = writer.prepare_close_candidate({
    notebook,
    notebook_path: fixture.notebook_path,
    root: fixture.root,
    ownership,
    input: JSON.parse(close_input()),
  });
  node_assert.equal(prepared.next_ask, 'A-002');
});

node_test.test('suffix-free drafts use the selected Ask and preserve legacy records', () => {
  for (const [command_name, make_record] of [['append-run', run_event], ['append-wip', checkpoint]]) {
    const historical = notebook({ body: '+ earlier work\n\n' + make_record(1, 'A-001'), reply: '# ← Reply / A-001\n\nDone.\n' });
    const fixture = setup({ text: historical + '\n# → Ask / A-002\n\n+ current work\n' });
    const before = node_fs.readFileSync(fixture.notebook_file, 'utf8');
    const draft = make_record(1, 'A-002').replace(' (during round A-002)', '');
    const result = run_writer_stdin(fixture.root, [command_name, '--notebook', fixture.notebook_path, '--ask', 'A-002', '--input-stdin'], draft);
    node_assert.equal(result.status, 0, result.stderr);
    const updated = node_fs.readFileSync(fixture.notebook_file, 'utf8');
    node_assert.ok(updated.startsWith(before.trimEnd()));
    node_assert.ok(updated.includes(draft.trimEnd()));
    const saved = read_bytes(fixture.notebook_file);
    const duplicate = run_writer_stdin(fixture.root, [command_name, '--notebook', fixture.notebook_path, '--ask', 'A-002', '--input-stdin'], draft);
    node_assert.notEqual(duplicate.status, 0);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), saved);
    const closed = setup({ text: before + '\n# ← Reply / A-002\n\nDone.\n' });
    const closed_before = read_bytes(closed.notebook_file);
    const closed_result = run_writer_stdin(closed.root, [command_name, '--notebook', closed.notebook_path, '--ask', 'A-002', '--input-stdin'], draft);
    node_assert.notEqual(closed_result.status, 0);
    node_assert.deepEqual(read_bytes(closed.notebook_file), closed_before);
    const wrong_ask = run_writer_stdin(fixture.root, [command_name, '--notebook', fixture.notebook_path, '--ask', 'A-001', '--input-stdin'], draft);
    node_assert.notEqual(wrong_ask.status, 0);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), saved);
    const wrong_legacy = run_writer_stdin(fixture.root, [command_name, '--notebook', fixture.notebook_path, '--ask', 'A-002', '--input-stdin'], make_record(2, 'A-001'));
    node_assert.notEqual(wrong_legacy.status, 0);
    node_assert.deepEqual(read_bytes(fixture.notebook_file), saved);
  }
});

node_test.test('close publishes sidecar evidence before notebook and missing records fail later checks', () => {
  const fixture = close_fixture();
  const config = JSON.parse(node_fs.readFileSync(node_path.join(fixture.root, 'ag.json'), 'utf8'));
  config.switches['target-doc'] = fixture.notebook_path;
  node_fs.writeFileSync(node_path.join(fixture.root, 'ag.json'), JSON.stringify(config));
  const input = JSON.parse(close_input());
  input.reply += '\n```completion-metadata\nHost review: PASS — inspected the completed fixture.\n```\n';
  const result = run_writer_stdin(fixture.root, close_command(), JSON.stringify(input));
  node_assert.equal(result.status, 0, failure_text(result));
  const text = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.doesNotMatch(text, /Completion record:|sha256:|<!--/u);
  node_assert.doesNotMatch(text, /```completion-metadata/u);
  const ctx = { project_root: fixture.root, notebook_path: fixture.notebook_path, ask: 'A-001' };
  const round = require('./round-linter').parse_devlog(text).rounds.find(r => r.id === 'A-001');
  const metadata = require('./round-linter').completion_metadata(round.reply_text, ctx);
  node_assert.equal(metadata.error, '');
  node_assert.ok(require('./notebook-write').match_closed_close({ notebook_text: text, input, ...ctx }));
  const hook = () => node_child_process.spawnSync(process.execPath, [node_path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], { input: JSON.stringify({ cwd: fixture.root }), encoding: 'utf8', env: { ...process.env, AGENTFLOW_EXTERNAL_DELEGATE: '' } });
  node_assert.equal(hook().status, 0);
  node_fs.renameSync(metadata.record_file, metadata.record_file + '.saved');
  const missing_hook = hook();
  node_assert.equal(missing_hook.status, 2, missing_hook.stderr);
  node_assert.match(missing_hook.stderr, /records unavailable/i);
  const checked = require('./completion-context').validate_candidate({ devlog_text: text, context: { ...ctx, active_host: 'codex' } });
  node_assert.ok(checked.checks.some(c => c.status === 'fail' && /records unavailable/i.test(c.detail)));
});

node_test.test('append-reply publishes metadata and record-write failure leaves notebook unchanged', () => {
  for (const fail_write of [false, true]) {
    const fixture = close_fixture();
    const reply = JSON.parse(close_input()).reply + '\n```completion-metadata\nHost review: PASS — checked append fixture.\n```\n';
    const draft_path = write(fixture.root, 'reply.md', reply);
    const before = node_fs.readFileSync(fixture.notebook_file);
    const original = node_fs.renameSync;
    try {
      if (fail_write) node_fs.renameSync = (from, to) => { if (node_path.basename(to) === 'completion.json') throw Error('record publication failed'); return original(from, to); };
      const append = () => require('./notebook-write').append_reply({ root: fixture.root, notebook: fixture.notebook_path, ask: 'A-001', input: 'reply.md' });
      if (fail_write) { node_assert.throws(append, /record publication failed/); node_assert.deepEqual(node_fs.readFileSync(fixture.notebook_file), before); }
      else { append(); node_assert.doesNotMatch(node_fs.readFileSync(fixture.notebook_file, 'utf8'), /Completion record:|sha256:|<!--/u); }
    } finally { node_fs.renameSync = original; }
  }
});

node_test.test('new Replies use current transcript metadata and close retries preserve saved identity', () => {
  const fixture = close_fixture();
  const id = '01a0927f-421d-7263-ab12-083e0839d8ac';
  ownership_fixture.adopt(fixture.root, fixture.notebook_path, 'codex', id);
  const codex_home = node_path.join(fixture.root, 'runtime');
  const sessions = node_path.join(codex_home, 'sessions', '2026', '09', '12');
  node_fs.mkdirSync(sessions, { recursive: true });
  const transcript = node_path.join(sessions, `rollout-current-${id}.jsonl`);
  node_fs.writeFileSync(transcript, [
    { type: 'session_meta', payload: { id, cwd: fixture.root } },
    { type: 'turn_context', payload: { cwd: fixture.root, model: 'actual-model', effort: 'high' } },
  ].map(JSON.stringify).join('\n') + '\n');
  const input = close_input();
  const result = node_child_process.spawnSync(process.execPath, [SCRIPT, ...close_command()], {
    cwd: fixture.root, input, encoding: 'utf8', env: { ...process.env, CODEX_HOME: codex_home, CODEX_THREAD_ID: id, CODEX_SESSION_ID: id },
  });
  node_assert.equal(result.status, 0, result.stderr);
  const text = node_fs.readFileSync(fixture.notebook_file, 'utf8');
  node_assert.match(text, /\(actual-model\/high\)_/u);
  node_assert.ok(require('./notebook-write').match_closed_close({ notebook_text: text, input, project_root: fixture.root, notebook_path: fixture.notebook_path }));
});

node_test.test('legacy Codex receipt migrates without changing deduplication or the original file', () => {
  const fixture = setup({ text: notebook({ body: '+\n' }) });
  const writer = require('./notebook-write');
  const options = { root: fixture.root, notebook: fixture.notebook_path, host: 'codex', text: 'record this once', message_id: 'migration-turn' };
  writer.append_input(options);
  const runtime = node_path.join(fixture.root, '.agentflow', '.tmp');
  const current = node_path.join(runtime, node_fs.readdirSync(runtime).find(file => file.startsWith('agentflow-input-codex-')));
  const legacy_dir = node_path.join(fixture.root, '.codex');
  node_fs.mkdirSync(legacy_dir, { recursive: true });
  const legacy = node_path.join(legacy_dir, node_path.basename(current).replace('agentflow-input-codex-', 'agentflow-input-'));
  const original = node_fs.readFileSync(current);
  node_fs.writeFileSync(legacy, original);
  node_fs.unlinkSync(current);
  const saved = node_fs.readFileSync(fixture.notebook_file);
  node_assert.equal(writer.append_input(options).inserted, false);
  node_assert.deepEqual(node_fs.readFileSync(fixture.notebook_file), saved);
  writer.append_input({ ...options, text: 'new instruction', message_id: 'migration-next' });
  node_assert.deepEqual(node_fs.readFileSync(legacy), original);
  const migrated = JSON.parse(node_fs.readFileSync(current, 'utf8'));
  node_assert.deepEqual(migrated.scope, JSON.parse(original).scope);
  node_assert.equal(Object.keys(migrated.entries).length, 2);
});

node_test.test('receipt storage follows a custom nested workspace and its active notebook configuration', () => {
  const root = make_root();
  const notebook_path = 'notes/task.md';
  write(root, notebook_path, notebook({ body: '+\n' }));
  write(root, 'ag.json', JSON.stringify({ switches: { 'target-doc': notebook_path, 'workspace-dir': 'local/workflow' } }));
  const writer = require('./notebook-write');
  writer.append_input({ root, notebook: notebook_path, host: 'codex', text: 'custom workspace input', message_id: 'custom' });
  const runtime = node_path.join(root, 'local/workflow/.tmp');
  node_assert.ok(node_fs.readdirSync(runtime).some(name => name.startsWith('agentflow-input-codex-')));
  node_assert.equal(node_fs.existsSync(node_path.join(root, '.agentflow')), false);
  node_assert.equal(node_fs.existsSync(node_path.join(root, '.codex')), false);
});
