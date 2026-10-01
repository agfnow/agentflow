'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { verified_closed_round } = require('./closed-round');

test('a verified close survives later working edits but not a changed Reply or missing receipt', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'closed-round-'));
  const notebook = '.agentflow/devlog.md';
  const close_id = 'a'.repeat(64);
  const closed = '# → Ask / A-001\n\n+ task\n\n# ← Reply / A-001\n\nDone.\n\n---\n\n# → Ask / A-002\n\n+\n';
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  try {
    fs.mkdirSync(path.join(root, '.agentflow/.tmp'), { recursive: true });
    fs.writeFileSync(path.join(root, notebook), closed);
    fs.writeFileSync(path.join(root, 'ag.json'), '{}\n');
    git(['init', '-q']);
    git(['config', 'user.email', 'test@example.test']);
    git(['config', 'user.name', 'Test']);
    git(['add', notebook, 'ag.json']);
    git(['commit', '-qm', `close\n\nAgentflow-Close-Id: ${close_id}`]);
    const commit = git(['rev-parse', 'HEAD']);
    const hash = crypto.createHash('sha256').update(closed).digest('hex');
    const key = crypto.createHash('sha256').update(notebook).digest('hex');
    const receipt = path.join(root, '.agentflow/.tmp', `agentflow-input-codex-${key}.json.A-001.${close_id}.close.json`);
    fs.writeFileSync(receipt, JSON.stringify({ version: 1, repository: root, notebook, host: 'codex', ask: 'A-001', close_id, commit, notebook_hash: hash, paths: {} }));
    fs.writeFileSync(path.join(root, 'ag.json'), '{"later":true}\n');
    const stop = () => spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', 'codex'], {
      cwd: root, input: JSON.stringify({ cwd: root, hook_event_name: 'Stop' }), encoding: 'utf8'
    });
    assert.equal(verified_closed_round(root, notebook, 'codex', closed), true);
    assert.equal(stop().status, 0);
    assert.equal(verified_closed_round(root, notebook, 'codex', closed.replace('Done.', 'Altered.')), false);
    assert.equal(verified_closed_round(root, notebook, 'codex', closed.replace('# → Ask / A-002\n\n+', '# → Ask / A-002\n\n+ new task')), false);
    fs.writeFileSync(path.join(root, notebook), closed.replace('Done.', 'Altered.'));
    assert.equal(stop().status, 2);
    fs.writeFileSync(path.join(root, notebook), closed);
    fs.rmSync(receipt);
    assert.equal(verified_closed_round(root, notebook, 'codex', closed), false);
    assert.equal(stop().status, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
