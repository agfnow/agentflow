'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { test } = require('node:test');
const settings = require('./ag-settings');
const writer = require('./notebook-write');
const agf = require('./agf');
const ownership_fixture = require('./fixtures/notebook-owner');
ownership_fixture.configure();

const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-ask-names-'));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Named Owner']);
  const initialized = settings.initialize_project({ repo_root: root, active_host: 'codex' });
  return { root, ...initialized };
};

const status = () => ({ project: 'names', notebook: '.agentflow/devlog.md', notebook_kind: 'root', current_commit: 'none', tests_scenarios: 'names', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'names', open: 'none', next: 'await owner', artifacts: 'none', archived_eras: 'none', streams: [] });
const reply = '# ← Reply / A-001\n\n## [SUMMARY]\n\n- Done.\n\n## [FINAL REPORT]\n\n1. Done.\n\n```completion-metadata\nHost review: PASS — inspected disposable heading fixture.\n```\n\n## Questions (batched — each with a suggested default)\n\n- None.\n';

test('ask-names initialization resolves the repository owner', () => {
  const f = fixture();
  assert.match(fs.readFileSync(f.notebook_path, 'utf8'), /# → Ask \/ A-001 \(Named Owner\)/u);
});

test('ask-names controls stream headings with and without a wish', () => {
  const f = fixture();
  for (const setting of ['on', 'off']) {
    f.config.switches['ask-names'] = setting;
    for (const wish of ['', 'build search']) {
      const text = agf.devlog_template({ taskkey: 'names', name: 'Names', project_line: 'Project: names', config: f.config, repo_root: f.root, wish });
      const headings = text.split('\n').filter(line => line.startsWith('# → Ask /'));
      assert.equal(headings.length, wish ? 2 : 1);
      assert.ok(headings.every(line => setting === 'on' ? line.endsWith(' (Named Owner)') : !line.includes('(')));
    }
  }
});

test('ask-names close and reply append honor on/off, preserve history and support close retry', () => {
  for (const operation of ['close-round', 'append-reply', 'agf-close']) {
    for (const setting of ['on', 'off']) {
      for (const newline of ['\n', '\r\n']) {
        const f = fixture();
        f.config.switches['ask-names'] = setting;
        fs.writeFileSync(f.config_path, JSON.stringify(f.config));
        const old = '# → Ask / A-001 (Historical Owner)\n\n+ skip-review: disposable heading test\n';
        const before = (settings.format_status(status()) + '\n---\n\n' + old).replace(/\n/g, newline);
        fs.writeFileSync(f.notebook_path, before);
        ownership_fixture.adopt(f.root, '.agentflow/devlog.md');
        const document = { ask: 'A-001', run_events: [], reply, status: status() };
        const manifest = { version: 1, notebook: '.agentflow/devlog.md', ...document, allowed_paths: ['.agentflow/devlog.md'], commit_message: 'record names', delivery: { mode: 'local' } };
        const script = operation === 'agf-close' ? 'agf.js' : 'notebook-write.js';
        const args = operation === 'agf-close' ? ['close', '--manifest-stdin'] : [operation, '--notebook', '.agentflow/devlog.md', ...(operation === 'append-reply' ? ['--ask', 'A-001'] : []), '--input-stdin'];
        const invoke = () => spawnSync(process.execPath, [path.join(__dirname, script), ...args], { cwd: f.root, input: operation === 'append-reply' ? reply : JSON.stringify(operation === 'agf-close' ? manifest : document), encoding: 'utf8' });
        const result = invoke();
        assert.equal(result.status, 0, `${operation}/${setting}: ${result.stdout}\n${result.stderr}`);
        const saved = fs.readFileSync(f.notebook_path, 'utf8');
        const heading = '# → Ask / A-002' + (setting === 'on' ? ' (Named Owner)' : '');
        assert.ok(saved.endsWith(`${heading}${newline}${newline}+${newline}`), `${operation}/${setting}`);
        assert.ok(saved.includes(old.replace(/\n/g, newline)));
        if (operation !== 'append-reply') assert.ok(writer.match_closed_close({ notebook_text: saved, input: document, project_root: f.root, notebook_path: '.agentflow/devlog.md' }));
        if (operation === 'agf-close') {
          const retried = invoke();
          assert.equal(retried.status, 0, retried.stdout + retried.stderr);
          assert.equal(fs.readFileSync(f.notebook_path, 'utf8'), saved);
        }
      }
    }
  }
});

test('ask-names startup recognizes named headings and captures the next request', () => {
  const f = fixture();
  const result = spawnSync(process.execPath, [path.join(__dirname, 'agf.js'), 'start', '--repo', f.root, '--host', 'codex', '--message-stdin', '--json'], { input: 'continue named round', encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).current_ask_identifier, 'A-001');
  assert.match(fs.readFileSync(f.notebook_path, 'utf8'), /# → Ask \/ A-001 \(Named Owner\)\n\n\+ continue named round/u);
});

test('ask-names handles unavailable identity and heading delimiters without malformed headings', t => {
  const child = require('node:child_process');
  const config = settings.make_template('codex');
  t.mock.method(child, 'spawnSync', () => ({ status: 0, stdout: 'Owner (team)\nsecond\tline' }));
  assert.equal(settings.format_ask_heading('A-001', { config }), '# → Ask / A-001 (Owner team second line)');
  child.spawnSync.mock.mockImplementation(() => ({ status: 1 }));
  t.mock.method(os, 'userInfo', () => ({ username: 'local-owner' }));
  assert.equal(settings.format_ask_heading('A-001', { config }), '# → Ask / A-001 (local-owner)');
  os.userInfo.mock.mockImplementation(() => { throw new Error('unavailable'); });
  assert.equal(settings.format_ask_heading('A-001', { config }), '# → Ask / A-001');
  config.switches['ask-names'] = 'off';
  const calls = child.spawnSync.mock.callCount();
  assert.equal(settings.format_ask_heading('A-001', { config }), '# → Ask / A-001');
  assert.equal(child.spawnSync.mock.callCount(), calls);
});
