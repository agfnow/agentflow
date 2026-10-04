'use strict';

// Run in a PTY to exercise the prompt-to-Stop boundary for both host commands.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
assert.equal(process.stdin.isTTY, true, 'run this journey in a PTY');
assert.equal(process.stdout.isTTY, true, 'run this journey in a PTY');
for (const host of ['codex', 'claude']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'no-ag-journey-'));
  const notebook = path.join(root, '.agentflow/devlog.md');
  fs.mkdirSync(path.dirname(notebook));
  const original = '# → Ask / A-001\n\n+ prior ordinary task\n';
  fs.writeFileSync(notebook, original);
  fs.writeFileSync(path.join(root, 'ag.json'), '{ malformed configuration');
  const env = { ...process.env };
  for (const name of ['AGENTFLOW_EXTERNAL_DELEGATE', 'CLAUDE_PROJECT_DIR', 'CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_SESSION_ID', 'AGENTFLOW_SESSION_ID']) delete env[name];
  const run = input => {
    console.log(`${host} input: ${JSON.stringify(input)}`);
    const result = spawnSync(process.execPath, [path.join(__dirname, 'stop-hook.js'), '--host', host], { cwd: root, env, input: JSON.stringify({ cwd: root, session_id: 'journey-owner', ...input }), encoding: 'utf8' });
    console.log(`${host} exit: ${result.status}; stdout: ${JSON.stringify(result.stdout)}; stderr: ${JSON.stringify(result.stderr)}`);
    return result;
  };
  const prompt = run({ hook_event_name: 'UserPromptSubmit', prompt: 'no-ag: repair this directly' });
  assert.equal(prompt.status, 0, prompt.stderr);
  assert.equal(prompt.stdout, '');
  assert.equal(fs.readFileSync(notebook, 'utf8'), original);
  const stop = run({ hook_event_name: 'Stop', prompt: 'no-ag: repair this directly' });
  assert.equal(stop.status, 0, stop.stderr);
  assert.equal(stop.stderr, '');
  assert.equal(run({ hook_event_name: 'Stop', session_id: 'different-owner' }).status, 2);
  const quoted = run({ hook_event_name: 'UserPromptSubmit', prompt: '"no-ag: example"' });
  assert.match(quoted.stdout, /instruction was saved/);
  assert.equal(run({ hook_event_name: 'Stop' }).status, 2);
  const ordinary = run({ hook_event_name: 'UserPromptSubmit', prompt: 'ordinary follow-up' });
  assert.match(ordinary.stdout, /instruction was saved/);
  assert.equal(run({ hook_event_name: 'Stop' }).status, 2);
  assert.match(fs.readFileSync(notebook, 'utf8'), /ordinary follow-up/);
  assert.equal(fs.readFileSync(path.join(root, 'ag.json'), 'utf8'), '{ malformed configuration');
  console.log(`${host}: PASS — bypass preserves notebook/config; Stop bypasses only owner session; quoted and ordinary input resume capture/checks.`);
}
