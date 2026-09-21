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

  const claude = read_json(node_path.join(dir, '.claude', 'settings.json'));
  const codex = read_json(node_path.join(dir, '.codex', 'hooks.json'));
  assert.ok(has_our_stop_hook(claude));
  assert.ok(has_our_stop_hook(codex));
  assert.equal(codex.hooks.UserPromptSubmit.length, 1);
  assert.equal(claude.hooks.UserPromptSubmit.length, 1);
  assert.match(claude.hooks.Stop[0].hooks[0].command, /--host claude$/);
  assert.match(codex.hooks.Stop[0].hooks[0].command, /--host codex$/);
});

test('project install does not claim an old host-neutral hook command', () => {
  const dir = fresh_dir();
  const config_path = node_path.join(dir, '.codex', 'hooks.json');
  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  const old_command = 'node "/old/stop-hook.js"';
  node_fs.writeFileSync(config_path, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: old_command }] }] } }));

  run(dir, ['--project', '--host', 'codex', '--quiet']);

  const config = read_json(config_path);
  assert.equal(config.hooks.Stop[0].hooks[0].command, old_command);
  assert.equal(config.hooks.Stop.length, 2);
  assert.match(config.hooks.Stop[1].hooks[0].command, /stop-hook\.js['"] --host codex$/);
});

test('owned hook parsing recognizes shell-literal paths with metacharacters and apostrophes', () => {
  const hooks = require('./install-hook.js');
  const script_path = "/tmp/agentflow-$draft`id`'quote/stop-hook.js";
  const escaped = `'${script_path.replaceAll("'", "'\\''")}'`;
  const parsed = hooks.parse_owned_command(`node ${escaped} --host claude`);
  assert.equal(parsed.host, 'claude');
  assert.equal(parsed.script, node_path.resolve(script_path));
  assert.match(hooks.hook_command_for('claude'), /^node '/);
});

test('running twice never duplicates the entry', () => {
  const dir = fresh_dir();

  run(dir, ['--project', '--quiet']);
  run(dir, ['--project', '--quiet']);

  const claude = read_json(node_path.join(dir, '.claude', 'settings.json'));
  const codex = read_json(node_path.join(dir, '.codex', 'hooks.json'));

  assert.strictEqual(claude.hooks.Stop.length, 1);
  assert.strictEqual(codex.hooks.Stop.length, 1);
  assert.strictEqual(codex.hooks.UserPromptSubmit.length, 1);
});

test('project install replaces stale worktree hooks and collapses owned duplicates', () => {
  const dir = node_fs.realpathSync(fresh_dir());
  const config_path = node_path.join(dir, '.codex', 'hooks.json');
  const stale = `node "${node_path.join(dir, '.worktrees', 'fix-2', 'skills', 'agentflow', 'scripts', 'stop-hook.js')}" --host codex`;
  const current = `node '${node_path.join(__dirname, 'stop-hook.js')}' --host codex`;
  const foreign = { type: 'command', command: 'foreign-command --keep' };
  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  node_fs.writeFileSync(config_path, `${JSON.stringify({ hooks: { Stop: [
    { matcher: 'stale', hooks: [{ type: 'command', command: stale }, foreign] },
    { hooks: [{ type: 'command', command: current }] }
  ] } }, null, 2)}\n`);

  run(dir, ['--project', '--host', 'codex', '--quiet']);

  const config = read_json(config_path);
  assert.strictEqual(config.hooks.Stop.length, 1);
  assert.deepEqual(config.hooks.Stop[0], {
    matcher: 'stale',
    hooks: [{ type: 'command', command: current }, foreign]
  });
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

test('--off removes only the owned nested command and preserves siblings and entry metadata', () => {
  const dir = fresh_dir();
  const config_path = node_path.join(dir, '.claude', 'settings.json');
  const owned_command = `node "${node_path.join(__dirname, 'stop-hook.js')}" --host claude`;
  const retained_entry = {
    matcher: 'mixed',
    description: 'keep this metadata',
    hooks: [
      { type: 'command', command: owned_command },
      { type: 'command', command: 'foreign-command --keep' },
    ],
  };
  const other_entry = { matcher: 'other', hooks: [{ type: 'command', command: 'other-command --keep' }] };
  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  node_fs.writeFileSync(config_path, `${JSON.stringify({ hooks: { Stop: [retained_entry, other_entry] } }, null, 2)}\n`);

  run(dir, ['--project', '--host', 'claude', '--off', '--quiet']);

  const config = read_json(config_path);
  assert.deepEqual(config.hooks.Stop, [
    { ...retained_entry, hooks: [retained_entry.hooks[1]] },
    other_entry,
  ]);
});

test('--off retains a same-filename foreign Stop command', () => {
  const dir = fresh_dir();
  const config_path = node_path.join(dir, '.claude', 'settings.json');
  const foreign = `node "/foreign/stop-hook.js" --host claude`;
  const original = { hooks: { Stop: [{ hooks: [{ type: 'command', command: foreign }] }] } };
  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  node_fs.writeFileSync(config_path, `${JSON.stringify(original, null, 2)}\n`);

  run(dir, ['--project', '--host', 'claude', '--off', '--quiet']);

  assert.deepEqual(read_json(config_path), original);
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
  assert.match(loud_output, /not a repository — the pre-commit devlog guard was skipped/);
});

// ---------- the git pre-commit devlog guard ----------

const fresh_repo = () => {
  const dir = fresh_dir();

  execFileSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' });

  return dir;
};

const pre_commit_path = dir => node_path.join(dir, '.git', 'hooks', 'pre-commit');

test('project install writes the pre-commit guard in a git repo, idempotently', () => {
  const dir = fresh_repo();

  run(dir, ['--project', '--quiet']);

  const written = node_fs.readFileSync(pre_commit_path(dir), 'utf8');

  assert.match(written, /agentflow devlog-guard/);
  assert.match(written, /devlog-guard\.js/);
  assert.ok(node_fs.statSync(pre_commit_path(dir)).mode & 0o100, 'the hook is executable');

  run(dir, ['--project', '--quiet']);
  assert.strictEqual(node_fs.readFileSync(pre_commit_path(dir), 'utf8'), written);
});

test('--off removes the guard; a foreign pre-commit hook is never touched', () => {
  const dir = fresh_repo();

  run(dir, ['--project', '--quiet']);
  run(dir, ['--project', '--off', '--quiet']);
  assert.ok(!node_fs.existsSync(pre_commit_path(dir)));

  node_fs.writeFileSync(pre_commit_path(dir), '#!/bin/sh\necho mine\n', { mode: 0o755 });

  const output = run(dir, ['--project']);

  assert.match(output, /left untouched/);
  assert.strictEqual(node_fs.readFileSync(pre_commit_path(dir), 'utf8'), '#!/bin/sh\necho mine\n');

  run(dir, ['--project', '--off', '--quiet']);
  assert.strictEqual(node_fs.readFileSync(pre_commit_path(dir), 'utf8'), '#!/bin/sh\necho mine\n');
});

test('--off leaves a changed Agentflow guard untouched and gives manual-removal instructions', () => {
  const dir = fresh_repo();

  run(dir, ['--project', '--quiet']);
  const changed = `${node_fs.readFileSync(pre_commit_path(dir), 'utf8')}echo user command\n`;
  node_fs.writeFileSync(pre_commit_path(dir), changed, { mode: 0o755 });

  const output = run(dir, ['--project', '--off']);

  assert.match(output, /left untouched/i);
  assert.match(output, /manual/i);
  assert.strictEqual(node_fs.readFileSync(pre_commit_path(dir), 'utf8'), changed);
});

test('inspect lists only verified owned hooks and --off removes a stale project-worktree Stop hook', () => {
  const dir = fresh_repo();
  const config_path = node_path.join(dir, '.codex', 'hooks.json');
  const stale = `node "${node_path.join(dir, '.worktrees', 'old', 'skills', 'agentflow', 'scripts', 'stop-hook.js')}" --host codex`;
  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  node_fs.writeFileSync(config_path, `${JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: stale }] }] } }, null, 2)}\n`);

  assert.deepEqual(require('./install-hook.js').inspect({ cwd: dir, hosts: ['codex'] }), [
    `remove the verified Agentflow Stop hook from ${config_path}`,
  ]);
  run(dir, ['--project', '--host', 'codex', '--off', '--quiet']);
  assert.deepEqual(require('./install-hook.js').inspect({ cwd: dir, hosts: ['codex'] }), []);
});
