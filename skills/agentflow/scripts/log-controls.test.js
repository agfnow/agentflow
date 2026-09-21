'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const settings = require('./ag-settings');
const writer = require('./notebook-write');
const { parse_devlog, lint_checkpoint_verification } = require('./round-linter');
const { format_local_timestamp } = require('./local-time');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();
process.env.AGENTFLOW_SESSION_ID = ownership_fixture.session;

const write = (root, relative, text) => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), text);
};
const fixture = (switches = {}, notebook = '.agentflow/devlog.md') => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-log-controls-')));
  const config = settings.make_template('test-host');
  config.switches = { ...config.switches, 'target-doc': notebook, ...switches };
  const status = { project: 'log controls', notebook, notebook_kind: 'root', current_commit: 'not applicable', tests_scenarios: 'log controls', config_path: 'ag.json', host: 'test-host', validation: 'validated', proven: 'settings verified', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] };
  write(root, 'ag.json', JSON.stringify(config));
  write(root, notebook, settings.format_status(status) + '---\n\n# → Ask / A-001\n\n+ Keep my full answer.\n');
  ownership_fixture.adopt(root, notebook, 'test-host');
  const manifest = { version: 1, notebook, ask: 'A-001', run_events: ['- Final verification passed.'], reply: '## [SUMMARY]\n\n- Saved answer.\n\n## [FINAL REPORT]\n\n1. Full answer is retained.\n', status, allowed_paths: [notebook], commit_message: 'save answer', delivery: { mode: 'local' } };
  return { root, notebook, config, manifest, read: () => fs.readFileSync(path.join(root, notebook), 'utf8') };
};
const cli = (f, script, args, input) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: f.root, encoding: 'utf8', input, env: { ...process.env, CODEX_SESSION_ID: '', CODEX_THREAD_ID: '' } });
const progress = '- **Finished:** Settings checked.\n\n- **Running now:** Verification.\n\n- **Still to do:** Reply.\n\n- **Next work action:** Close.\n';

test('logging controls have compatible defaults, accept exact values and survive settings writes', () => {
  for (const host of ['codex', 'claude', 'test-host']) {
    const template = settings.make_template(host);
    assert.equal(template.switches['log-verbosity'], 'all');
    assert.equal(Object.hasOwn(template.switches, 'log_verbosity'), false);
    assert.equal(template.switches['inline-reply'], 'off');
  }
  const f = fixture();
  delete f.config.switches['log-verbosity'];
  delete f.config.switches['inline-reply'];
  write(f.root, 'ag.json', JSON.stringify(f.config));
  const options = { repo_root: f.root, active_host: 'test-host', check_executables: false };
  assert.equal(settings.validate_config(f.config, options).valid, true);
  const before = fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8');
  settings.read_json_config(path.join(f.root, 'ag.json'), options);
  assert.equal(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'), before);
  for (const level of ['off', 'wip', 'all']) {
    for (const inline of ['off', 'on']) {
      settings.change_configuration(path.join(f.root, 'ag.json'), `log-verbosity: ${level}\ninline-reply: ${inline}`, options);
      const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'));
      assert.equal(saved.switches['log-verbosity'], level);
      assert.equal(saved.switches['inline-reply'], inline);
    }
  }
  for (const [key, value] of [['log_verbosity', 'off'], ['log-verbosity', 'quiet'], ['inline-reply', true], ['log-verbosity', null]]) {
    const unchanged = fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8');
    assert.throws(() => settings.change_configuration(path.join(f.root, 'ag.json'), { [key]: value }, options));
    assert.equal(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'), unchanged);
  }
});

test('writer filters only future progress, preserving Ask, history, draft files and Reply', () => {
  for (const level of ['all', 'wip', 'off']) {
    const f = fixture({ 'log-verbosity': level });
    const before = f.read();
    write(f.root, 'run.md', '- Work checked.\n');
    write(f.root, 'wip.md', progress);
    const run = writer.append_run({ root: f.root, host: 'test-host', notebook: f.notebook, ask: 'A-001', input: 'run.md' });
    const wip = writer.append_wip({ root: f.root, host: 'test-host', notebook: f.notebook, ask: 'A-001', input: 'wip.md' });
    assert.equal(f.read().includes('[RUN-001]'), level === 'all');
    assert.equal(f.read().includes('[WIP-001]'), level !== 'off');
    assert.ok(f.read().startsWith(before.trimEnd()));
    if (level !== 'all') { assert.equal(run.skipped, true); assert.ok(fs.existsSync(path.join(f.root, 'run.md'))); }
    if (level === 'off') { assert.equal(wip.skipped, true); assert.equal(f.read(), before); }
    const prepared = writer.prepare_close_candidate({ notebook: writer.read_regular_file(path.join(f.root, f.notebook), 'notebook'), input: f.manifest, root: f.root, notebook_path: f.notebook, host: 'test-host' });
    assert.equal(prepared.runs.length, level === 'all' ? 1 : 0);
    assert.match(prepared.candidate_text, /Full answer is retained/);
    assert.ok(writer.match_closed_close({ notebook_text: prepared.candidate_text, input: f.manifest, project_root: f.root, notebook_path: f.notebook }));
    // A later preference never removes the records already saved in this Ask.
    f.config.switches['log-verbosity'] = 'off';
    write(f.root, 'ag.json', JSON.stringify(f.config));
    const history = f.read();
    const skipped = cli(f, 'notebook-write.js', ['append-run', '--notebook', f.notebook, '--ask', 'A-001', '--input-stdin'], '- Omit this event.');
    assert.equal(skipped.status, 0, skipped.stderr);
    assert.match(skipped.stdout, /skipped/);
    assert.equal(f.read(), history);
    write(f.root, 'run.md', '- Still a valid input.');
    assert.throws(() => writer.append_run({ root: f.root, host: 'test-host', notebook: f.notebook, ask: 'A-002', input: 'run.md' }), /Ask/);
  }
});

test('root defaults and adjacent stream settings are resolved without changing other notebooks', () => {
  const f = fixture({ 'log-verbosity': 'off' });
  const notebook = '.agentflow/features/topic/topic.devlog.md';
  const stream = { ...f.config, switches: { ...f.config.switches, 'target-doc': notebook, 'log-verbosity': 'wip' } };
  write(f.root, notebook, f.read());
  write(f.root, '.agentflow/features/topic/ag.json', JSON.stringify(stream));
  ownership_fixture.adopt(f.root, notebook, 'test-host');
  write(f.root, 'wip.md', progress);
  writer.append_wip({ root: f.root, host: 'test-host', notebook, ask: 'A-001', input: 'wip.md' });
  assert.match(fs.readFileSync(path.join(f.root, notebook), 'utf8'), /WIP-001/);
  assert.doesNotMatch(f.read(), /WIP-001/);
});

test('close always persists Reply, reports configured display and retries without duplication', () => {
  for (const level of ['all', 'wip', 'off']) for (const inline of ['off', 'on']) {
    const f = fixture({ 'log-verbosity': level, 'inline-reply': inline });
    const args = ['close', '--manifest-stdin'];
    const input = JSON.stringify(f.manifest);
    const first = cli(f, 'agf.js', args, input);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const result = JSON.parse(first.stdout);
    const saved = f.read();
    const round = parse_devlog(saved).rounds[0];
    assert.match(round.reply_text, /Full answer is retained/);
    assert.equal(saved.includes('[RUN-001]'), level === 'all');
    assert.deepEqual(result.display, { inline_reply: inline === 'on', text: inline === 'on' ? round.reply_text.replace(/\r?\n---\s*$/u, '').trim() : `${f.notebook} updated` });
    const retry = cli(f, 'agf.js', args, input);
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    assert.equal(f.read(), saved);
    assert.deepEqual(JSON.parse(retry.stdout).display, result.display);
  }
});

test('wip completion waives only RUN presence, retaining progress, tracker and scope checks', () => {
  const f = fixture({ 'log-verbosity': 'wip' });
  const stamp = format_local_timestamp();
  const text = f.read() + `\n## [WIP-001] Checkpoint — ${stamp} (A-001)\n\n${progress}\n- **Checks:** [x] tracker.md | [x] scope matches tracker\n`;
  const collected = require('./completion-context').collect({ project_root: f.root, notebook_path: f.notebook, devlog_text: text, active_host: 'test-host' });
  assert.equal(collected.checkpoint_verification.run_required, false);
  assert.equal(collected.checkpoint_verification.run_current, false);
  const facts = { ...collected.checkpoint_verification, tracker_current: true, scope_checked: true, scope_label_present: true };
  assert.equal(lint_checkpoint_verification(text, facts).status, 'pass');
  for (const field of ['tracker_current', 'progress_current', 'scope_checked']) assert.equal(lint_checkpoint_verification(text, { ...facts, [field]: false }).status, 'fail');
  assert.equal(lint_checkpoint_verification(text, { ...facts, run_required: true }).status, 'fail');
});

test('Git closeout with suppressed RUNs stays idempotent and exposes only published Reply', () => {
  for (const level of ['off', 'wip']) {
    const f = fixture({ 'log-verbosity': level, 'inline-reply': 'on' });
    const git = args => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' }).trim();
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.invalid']);
    git(['config', 'user.name', 'Log Test']);
    require('./agf').update_ignore_file(f.root);
    git(['add', '.']);
    git(['commit', '-qm', 'baseline']);
    writer.append_input({ root: f.root, notebook: f.notebook, text: 'Keep my full answer.', host: 'test-host' });
    f.manifest.reply += '\n```completion-metadata\nNon-behavioral change: note.txt — informational fixture\n```\n';
    const input = JSON.stringify(f.manifest);
    const first = cli(f, 'agf.js', ['close', '--manifest-stdin'], input);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    const output = JSON.parse(first.stdout);
    assert.equal(output.commit.state, 'created');
    assert.doesNotMatch(output.display.text, /completion-metadata|Non-behavioral change/);
    const retry = cli(f, 'agf.js', ['close', '--manifest-stdin'], input);
    assert.equal(retry.status, 0, retry.stdout + retry.stderr);
    assert.equal(JSON.parse(retry.stdout).commit.sha, output.commit.sha);
    assert.equal(git(['rev-list', '--count', 'HEAD']), '2');
  }
});

test('startup reports effective defaults without rewriting older settings', () => {
  const f = fixture();
  delete f.config.switches['log-verbosity'];
  delete f.config.switches['inline-reply'];
  write(f.root, 'ag.json', JSON.stringify(f.config));
  const before = fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8');
  const result = cli(f, 'agf.js', ['start', '--repo', f.root, '--host', 'test-host', '--message-stdin', '--json'], 'Keep my full answer.');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.configuration['log-verbosity'], 'all');
  assert.equal(output.configuration['inline-reply'], 'off');
  assert.equal(fs.readFileSync(path.join(f.root, 'ag.json'), 'utf8'), before);
});

test('existing configs without new controls retain first Git closeout behavior', () => {
  const f = fixture();
  delete f.config.switches['log-verbosity'];
  delete f.config.switches['inline-reply'];
  write(f.root, 'ag.json', JSON.stringify(f.config));
  const git = args => execFileSync('git', args, { cwd: f.root, encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Log Test']);
  require('./agf').update_ignore_file(f.root);
  git(['add', '.']);
  git(['commit', '-qm', 'existing setup']);
  const result = cli(f, 'agf.js', ['close', '--manifest-stdin'], JSON.stringify(f.manifest));
  const output = JSON.parse(result.stdout);
  assert.equal(result.status, 0, output.error?.message || result.stderr);
  assert.equal(output.display.inline_reply, false);
  assert.match(f.read(), /RUN-001/);
});

test('disabled progress still validates substantial final reports and inline display matches saved Reply', () => {
  const f = fixture({ 'log-verbosity': 'off', 'inline-reply': 'on' });
  const stamp = format_local_timestamp();
  const text = f.read() + '# ← Reply / A-001\n\n' + f.manifest.reply + '\n## Questions (batched — each with a suggested default)\n\n- None.\n';
  const coverage = { works: true, does_not_work: true, decisions: true, limitations: true, owner_action: true };
  const facts = { substantial: true, route: 'direct', devlog_path: f.notebook, first_substantive_action_at: stamp, completed_at: stamp, checkpoints: [], material_milestones: [], material_incidents: [], final_report_coverage: coverage };
  const linter = require('./round-linter');
  assert.equal(linter.lint_round_reporting(facts, text, 'off').status, 'pass');
  const context = { devlog_text: text, round_reporting: facts, 'log-verbosity': 'off' };
  assert.equal(linter.lint_round(context).checks.find(check => check.id === 'round_reporting').status, 'pass');
  assert.equal(linter.lint_round({ ...context, 'log-verbosity': 'all' }).checks.find(check => check.id === 'round_reporting').status, 'fail');
  assert.equal(linter.lint_round_reporting({ ...facts, final_report_coverage: { ...coverage, limitations: false } }, text, 'off').status, 'fail');
  const output = parse_devlog(text).rounds[0].reply_text.trim();
  assert.equal(linter.lint_round({ devlog_text: text, terminal_output: output, 'inline-reply': 'on' }).checks.find(check => check.id === 'terminal_one_line').status, 'pass');
  assert.notEqual(linter.lint_round({ devlog_text: text, terminal_output: 'Invented reply', 'inline-reply': 'on' }).checks.find(check => check.id === 'terminal_one_line').status, 'pass');
});
