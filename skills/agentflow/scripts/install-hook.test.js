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
  const current = require('./install-hook.js').hook_command_for('codex');
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
  if (process.platform !== 'win32') assert.ok(node_fs.statSync(pre_commit_path(dir)).mode & 0o100, 'the hook is executable');

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

for (const host of ['codex', 'claude']) {
  test('equivalent double-quoted hooks preserve bytes without a backup for ' + host, () => {
    const dir = fresh_dir();
    const config_path = require('./install-hook.js').config_path_for(host, 'project', dir);
    node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
    const command = 'node "' + require('./install-hook.js').installed_script_for(host, 'stop-hook.js') + '" --host ' + host;
    const entry = { hooks: [{ type: 'command', command, timeout: 20 }] };
    const bytes = JSON.stringify({ hooks: { Stop: [entry], UserPromptSubmit: [entry] }, keep: true }, null, 4) + '\n';
    node_fs.writeFileSync(config_path, bytes);
    require('./install-hook.js').install({ scope: 'project', hosts: [host], cwd: dir, quiet: true });
    assert.equal(node_fs.readFileSync(config_path, 'utf8'), bytes);
    assert.equal(node_fs.existsSync(config_path + '.agentflow-backup'), false);
  });
}

for (const host of ['codex', 'claude']) {
  test('installed paths stay stable after a checkout moves for ' + host, () => {
    const dir = fresh_repo();
    const config_path = require('./install-hook.js').config_path_for(host, 'project', dir);
    node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
    const stale = `node '/gone/checkout/skills/agentflow/scripts/stop-hook.js' --host ${host}`;
    node_fs.writeFileSync(config_path, JSON.stringify({ keep: true, hooks: {
      Stop: [{ hooks: [{ type: 'command', command: stale, timeout: 42 }] }],
      UserPromptSubmit: [{ hooks: [{ type: 'command', command: stale }] }]
    } }));
    const guard = "#!/bin/sh\n# agentflow devlog-guard — blocks committing root devlog.md on a non-default branch (I-039).\n# Installed by install-hook.js; remove with: node install-hook.js --project --off\nnode '/gone/checkout/skills/agentflow/scripts/devlog-guard.js'\n";
    node_fs.writeFileSync(pre_commit_path(dir), guard, { mode: 0o755 });
    run(dir, ['--project', '--host', host, '--quiet']);
    const config = read_json(config_path);
    assert.equal(config.keep, true);
    assert.equal(config.hooks.Stop[0].hooks[0].timeout, 42);
    for (const event of ['Stop', 'UserPromptSubmit']) {
      assert.equal(config.hooks[event].length, 1);
      assert.equal(config.hooks[event][0].hooks[0].command, require('./install-hook.js').hook_command_for(host));
      assert.ok(!config.hooks[event][0].hooks[0].command.includes('/gone/checkout'));
    }
    assert.ok(!node_fs.readFileSync(pre_commit_path(dir), 'utf8').includes('/gone/checkout'));
    assert.equal(node_fs.readFileSync(pre_commit_path(dir) + '.agentflow-backup', 'utf8'), guard);
  });
}

test('path selection preserves lexical symlinks and falls back to the other installed host', () => {
  const home = fresh_dir();
  const scripts = node_path.join(home, '.claude', 'skills', 'agentflow', 'scripts');
  node_fs.mkdirSync(scripts, { recursive: true });
  node_fs.writeFileSync(node_path.join(scripts, 'stop-hook.js'), '');
  const resolver = require('./install-hook.js').installed_script_for;
  assert.equal(resolver('codex', 'stop-hook.js', home), node_path.join(scripts, 'stop-hook.js'));
  node_fs.mkdirSync(node_path.join(home, '.codex', 'skills'), { recursive: true });
  node_fs.symlinkSync(node_path.dirname(scripts), node_path.join(home, '.codex', 'skills', 'agentflow'));
  assert.equal(resolver('codex', 'stop-hook.js', home), node_path.join(home, '.codex', 'skills', 'agentflow', 'scripts', 'stop-hook.js'));
});

for (const layout of ['.agents/skills/agentflow', '.claude/plugins/cache/agentflow/agentflow/8.4.10/skills/agentflow']) {
  test(`isolated ${layout} installation repairs and executes both hosts' hooks`, { skip: process.platform === 'win32' }, () => {
    const root = node_fs.realpathSync(fresh_repo());
    const home = node_path.join(root, 'empty-home');
    const skill = node_path.join(root, layout);
    node_fs.mkdirSync(home);
    node_fs.cpSync(node_path.dirname(__dirname), skill, { recursive: true });
    const installer = node_path.join(skill, 'scripts', 'install-hook.js');
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    const install = args => execFileSync(process.execPath, [installer, '--project', '--quiet', ...args], { cwd: root, env, encoding: 'utf8' });
    for (const host of ['codex', 'claude']) {
      const file = node_path.join(root, host === 'codex' ? '.codex/hooks.json' : '.claude/settings.json');
      const stale = `node '${node_path.join(home, `.${host}`, 'skills/agentflow/scripts/stop-hook.js')}' --host ${host}`;
      const foreign = { type: 'command', command: 'foreign-command --keep' };
      node_fs.mkdirSync(node_path.dirname(file), { recursive: true });
      node_fs.writeFileSync(file, JSON.stringify({ keep: true, hooks: { Stop: [{ matcher: 'keep', hooks: [{ type: 'command', command: stale }, foreign] }] } }));
      install(['--host', host]);
      const config = read_json(file);
      assert.equal(config.keep, true);
      assert.equal(config.hooks.Stop[0].matcher, 'keep');
      assert.deepEqual(config.hooks.Stop[0].hooks[1], foreign);
      for (const event of ['Stop', 'UserPromptSubmit']) {
        const command = config.hooks[event][0].hooks[0].command;
        const parsed = require('./install-hook.js').parse_owned_command(command);
        assert.equal(parsed.script, node_path.join(skill, 'scripts', 'stop-hook.js'));
        execFileSync('/bin/sh', ['-c', command], { cwd: root, env, input: JSON.stringify({ cwd: root, hook_event_name: event, prompt: 'hello' }), encoding: 'utf8' });
      }
      const before = node_fs.readFileSync(file, 'utf8');
      install(['--host', host]);
      assert.equal(node_fs.readFileSync(file, 'utf8'), before);
      install(['--host', host, '--off']);
      assert.deepEqual(read_json(file), { keep: true, hooks: { Stop: [{ matcher: 'keep', hooks: [foreign] }] } });
    }
    install(['--host', 'codex']);
    const guard = node_fs.readFileSync(pre_commit_path(root), 'utf8');
    assert.ok(guard.includes(node_path.join(skill, 'scripts', 'devlog-guard.js')));
    execFileSync('/bin/sh', [pre_commit_path(root)], { cwd: root, env, encoding: 'utf8' });
  });
}


test('real PTY installation and hook execution use installed skill paths', { skip: process.platform === 'win32' || !node_fs.existsSync('/usr/bin/expect') }, () => {
  const dir = fresh_repo();
  const journey = `set timeout 20
spawn /bin/sh -c {test -t 0 && test -t 1 && printf 'PTY confirmed\\n' && node "$1" --project --host codex} journey $env(AGF_JOURNEY_SCRIPT)
expect "PTY confirmed"
expect "Hook command (codex):"
expect eof
set result [wait]
exit [lindex $result 3]
`;
  const output = execFileSync('/usr/bin/expect', ['-c', journey], { cwd: dir, encoding: 'utf8', env: { ...process.env, AGF_JOURNEY_SCRIPT: script } });
  assert.match(output, /PTY confirmed/);
  const config = read_json(node_path.join(dir, '.codex', 'hooks.json'));
  const hooks = require('./install-hook.js');
  assert.equal(config.hooks.Stop[0].hooks[0].command, hooks.hook_command_for('codex'));
  assert.ok(node_fs.readFileSync(pre_commit_path(dir), 'utf8').includes(hooks.installed_script_for('codex', 'devlog-guard.js')));
  execFileSync('/bin/sh', [pre_commit_path(dir)], { cwd: dir, encoding: 'utf8' });
  execFileSync('node', [hooks.installed_script_for('codex', 'stop-hook.js'), '--host', 'codex'], { cwd: dir, input: JSON.stringify({ cwd: dir, hook_event_name: 'Stop' }), encoding: 'utf8' });
});
