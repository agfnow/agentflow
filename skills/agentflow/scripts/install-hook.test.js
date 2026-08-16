'use strict';

// Tests for install-hook.js: both host targets, idempotent add, clean remove,
// host filtering, quiet mode, and preservation of unrelated settings.
// Each test runs the real script in a throwaway directory (project scope only,
// so the tester's own ~/.claude and ~/.codex are never touched).

const test = require('node:test');
const assert = require('node:assert');
const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = node_path.join(__dirname, 'install-hook.js');

const run = (cwd, args) => execFileSync('node', [script, ...args], { cwd, encoding: 'utf8' });

const fresh_dir = () => node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-hook-'));

const read_json = file_path => JSON.parse(node_fs.readFileSync(file_path, 'utf8'));

const has_our_stop_hook = config => Array.isArray(config.hooks && config.hooks.Stop)
  && config.hooks.Stop.some(entry => Array.isArray(entry.hooks)
    && entry.hooks.some(hook => typeof hook.command === 'string' && hook.command.includes('stop-hook.js')));

test('project install writes both host configs', () => {
  const dir = fresh_dir();

  run(dir, ['--project', '--quiet']);

  assert.ok(has_our_stop_hook(read_json(node_path.join(dir, '.claude', 'settings.json'))));
  assert.ok(has_our_stop_hook(read_json(node_path.join(dir, '.codex', 'hooks.json'))));
});

test('running twice never duplicates the entry', () => {
  const dir = fresh_dir();

  run(dir, ['--project', '--quiet']);
  run(dir, ['--project', '--quiet']);

  const claude = read_json(node_path.join(dir, '.claude', 'settings.json'));
  const codex = read_json(node_path.join(dir, '.codex', 'hooks.json'));

  assert.strictEqual(claude.hooks.Stop.length, 1);
  assert.strictEqual(codex.hooks.Stop.length, 1);
});

test('--off removes the entry from both hosts', () => {
  const dir = fresh_dir();

  run(dir, ['--project', '--quiet']);
  run(dir, ['--project', '--off', '--quiet']);

  assert.ok(!has_our_stop_hook(read_json(node_path.join(dir, '.claude', 'settings.json'))));
  assert.ok(!has_our_stop_hook(read_json(node_path.join(dir, '.codex', 'hooks.json'))));
});

test('--host codex touches only the codex config', () => {
  const dir = fresh_dir();

  run(dir, ['--project', '--host', 'codex', '--quiet']);

  assert.ok(has_our_stop_hook(read_json(node_path.join(dir, '.codex', 'hooks.json'))));
  assert.ok(!node_fs.existsSync(node_path.join(dir, '.claude', 'settings.json')));
});

test('unrelated settings survive an install and a removal', () => {
  const dir = fresh_dir();
  const settings_path = node_path.join(dir, '.claude', 'settings.json');

  node_fs.mkdirSync(node_path.dirname(settings_path), { recursive: true });
  node_fs.writeFileSync(settings_path, JSON.stringify({ model: 'opus', hooks: { PostToolUse: [{ hooks: [] }] } }));

  run(dir, ['--project', '--quiet']);
  run(dir, ['--project', '--off', '--quiet']);

  const config = read_json(settings_path);

  assert.strictEqual(config.model, 'opus');
  assert.ok(Array.isArray(config.hooks.PostToolUse));
  assert.ok(!has_our_stop_hook(config));
});

test('--quiet prints nothing; normal mode prints per-host lines', () => {
  const quiet_output = run(fresh_dir(), ['--project', '--quiet']);
  const loud_output = run(fresh_dir(), ['--project']);

  assert.strictEqual(quiet_output, '');
  assert.match(loud_output, /claude: added/);
  assert.match(loud_output, /codex: added/);
});
