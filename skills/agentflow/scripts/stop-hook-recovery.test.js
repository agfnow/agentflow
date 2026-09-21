'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const hook = path.join(__dirname, 'stop-hook.js');

for (const host of ['codex', 'claude']) {
  for (const [label, notebook] of [
    ['completed round', '# → Ask / A-042\n\n+ previous request\n\n# ← Reply / A-042\n\nPrevious answer.\n'],
    ['alternate Reply heading', '# → Ask / A-042\n\n+ previous request\n\n## Reply / A-042 — accepted pilot\n\nPrevious answer.\n'],
    ['missing Ask', '# STATUS\n\nDamaged notebook without an Ask.\n'],
  ]) {
    test(`${host} lets an owner request repair of ${label} without changing history`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-prompt-recovery-'));
      const file = path.join(root, '.agentflow/devlog.md');
      fs.mkdirSync(path.dirname(file));
      fs.writeFileSync(file, notebook);
      const env = { ...process.env };
      for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[name];
      const input = JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'repair-session', turn_id: 'repair-turn', prompt: 'Fix the missing Ask now.' });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = spawnSync(process.execPath, [hook, '--host', host], { input, env, cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const context = JSON.parse(result.stdout).hookSpecificOutput;
        assert.equal(context.hookEventName, 'UserPromptSubmit');
        assert.match(context.additionalContext, /not saved.*no open Ask/i);
        assert.match(context.additionalContext, /repair/i);
        assert.doesNotMatch(context.additionalContext, /instruction was saved/i);
        assert.equal(fs.readFileSync(file, 'utf8'), notebook);
        assert.deepEqual(fs.readdirSync(path.dirname(file)), ['devlog.md']);
      }
    });
  }
}

for (const host of ['codex', 'claude']) {
  for (const owned of [false, true]) {
    test(host + ' delivers input when notebook ownership is ' + (owned ? 'foreign' : 'unknown'), () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-owner-recovery-'));
      const file = path.join(root, '.agentflow/devlog.md');
      fs.mkdirSync(path.dirname(file));
      fs.writeFileSync(file, '# → Ask / A-044\n\n+\n');
      if (owned) {
        const env = { ...process.env };
        for (const name of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID']) delete env[name];
        const setup = spawnSync(process.execPath, ['-e', "require(process.argv[1]).guard({ root: process.argv[2], notebook: '.agentflow/devlog.md', host: process.argv[3], session: 'other-session' })", path.join(__dirname, 'notebook-owner.js'), root, host], { env, encoding: 'utf8' });
        assert.equal(setup.status, 0, setup.stderr);
      }
      const notebook = '# → Ask / A-044\n\n+ manually entered request\n';
      fs.writeFileSync(file, notebook);
      const snapshot = () => fs.readdirSync(path.dirname(file), { recursive: true }).filter(name => fs.statSync(path.join(path.dirname(file), name)).isFile()).map(name => [name, fs.readFileSync(path.join(path.dirname(file), name), 'utf8')]);
      const before = snapshot();
      const env = { ...process.env };
      for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[name];
      for (const prompt of ['godev', 'no-ag, fix this hook', 'hello']) {
        const result = spawnSync(process.execPath, [hook, '--host', host], { input: JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'repair-session', prompt }), env, cwd: root, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
        const notice = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
        assert.match(notice, /not saved.*ownership/i);
        assert.match(notice, /Continue with the submitted request/);
        assert.deepEqual(snapshot(), before);
      }
    });
  }
}

for (const host of ['codex', 'claude']) {
  for (const fault of ['lock contention', 'notebook is a directory', 'oversized input']) {
    test(`${host} delivers repair requests despite ${fault}`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-intake-fault-'));
      const file = path.join(root, '.agentflow/devlog.md');
      fs.mkdirSync(path.dirname(file));
      const notebook = '# → Ask / A-044\n\n+\n';
      if (fault === 'notebook is a directory') fs.mkdirSync(file);
      else fs.writeFileSync(file, notebook);
      if (fault === 'lock contention') fs.writeFileSync(file + '.close-round.lock', 'existing lock\n');
      const env = { ...process.env };
      for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[name];
      // A regular stdin descriptor keeps this size-boundary test independent of
      // synchronous pipe transfer in the process-isolated Node test runner.
      const input_file = path.join(root, 'hook-input.json');
      fs.writeFileSync(input_file, JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'repair-session', prompt: fault === 'oversized input' ? 'x'.repeat(65537) : 'no-ag, repair intake' }));
      const input_fd = fs.openSync(input_file, 'r');
      let result;
      try {
        result = spawnSync(process.execPath, [hook, '--host', host], { stdio: [input_fd, 'pipe', 'pipe'], env, cwd: root, encoding: 'utf8', timeout: 30000 });
      } finally { fs.closeSync(input_fd); }
      assert.equal(result.status, 0, result.stderr);
      const notice = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(notice, /capture did not complete/i);
      assert.match(notice, /Continue with the submitted request/);
      assert.doesNotMatch(notice, /instruction was saved/i);
      if (fault !== 'notebook is a directory') assert.equal(fs.readFileSync(file, 'utf8'), notebook);
      if (fault === 'lock contention') assert.equal(fs.readFileSync(file + '.close-round.lock', 'utf8'), 'existing lock\n');
    });
  }
}

for (const host of ['codex', 'claude']) {
  test(`${host} reports uncertain capture after a post-save failure and preserves retry deduplication`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-post-save-'));
    const file = path.join(root, '.agentflow/devlog.md');
    fs.mkdirSync(path.dirname(file));
    fs.writeFileSync(file, '# → Ask / A-044\n\n+\n');
    const preload = path.join(root, 'fault.cjs');
    fs.writeFileSync(preload, `require(${JSON.stringify(path.join(__dirname, 'fast-lane.js'))}).parse_fast_lane = () => { throw Error('synthetic post-save failure'); };\n`);
    const env = { ...process.env };
    for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID', 'CLAUDE_PROJECT_DIR']) delete env[name];
    const input = JSON.stringify({ cwd: root, hook_event_name: 'UserPromptSubmit', session_id: 'repair-session', turn_id: 'same-turn', prompt: 'unique saved instruction' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = spawnSync(process.execPath, ['--require', preload, hook, '--host', host], { input, env, cwd: root, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const notice = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
      assert.match(notice, /may already be saved/);
      assert.equal(fs.readFileSync(file, 'utf8').split('+ unique saved instruction').length - 1, 1);
    }
  });
}
