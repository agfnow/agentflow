'use strict';

// Turn the Agentflow Stop-hook referee on (or off) for one or both host CLIs.
// It backs up each config file first, then adds (or removes) exactly one
// Stop-hook entry. Running it twice never makes a duplicate.
//
//   node install-hook.js --project              add for both hosts, this repo
//   node install-hook.js --global               add for both hosts, machine-wide
//   node install-hook.js --project --off        remove again
//   node install-hook.js --project --host codex only touch the codex config
//   node install-hook.js --project --quiet      no output (for scripted use)
//
// Host config targets (both use the same {hooks: {Stop: [...]}} JSON shape):
//   claude  project ./.claude/settings.json   global ~/.claude/settings.json
//   codex   project ./.codex/hooks.json       global ~/.codex/hooks.json
//
// Writing a project file for a host that never runs in this repo is harmless:
// each CLI only reads its own file, and the hook itself no-ops without a
// devlog.md. Any other coding client (e.g. opencode) that can run a command
// after a turn and pass {cwd} on stdin can reuse stop-hook.js the same way.
//
// Scope reminder: a --global hook runs on EVERY session of that CLI on this
// machine. The hook no-ops when a session has no devlog.md, but --project is
// the safer default.

const node_fs = require('node:fs');
const node_os = require('node:os');
const node_path = require('node:path');
const { execFileSync } = require('node:child_process');
const ag_settings = require('./ag-settings.js');

const shell_literal = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const hook_command_for = host => `node ${shell_literal(node_path.join(__dirname, 'stop-hook.js'))} --host ${host}`;

// The git pre-commit devlog guard (I-039). Project scope only — git hooks are
// per-repo; worktrees share the main checkout's hooks, so one install covers all.
const guard_marker = 'agentflow devlog-guard';
const guard_command = `node ${shell_literal(node_path.join(__dirname, 'devlog-guard.js'))}`;
const guard_script = `#!/bin/sh\n# ${guard_marker} — blocks committing root devlog.md on a non-default branch (I-039).\n# Installed by install-hook.js; remove with: node install-hook.js --project --off\n${guard_command}\n`;

const HOSTS = ['claude', 'codex'];
const SAFE_HOST = /^[a-z0-9][a-z0-9_-]{0,127}$/u;
const safe_host = host => typeof host === 'string' && SAFE_HOST.test(host);

const manual_instructions = host => {
  const capture = `Automatic prompt/stop hooks are unavailable for ${host}; retain the startup session ID and run notebook-write.js append-input --notebook <path> --host ${host} --session <id> --input-stdin for each owner message.`;
  const closeout = `Prepare the bounded closeout manifest and run agf close --host ${host} --session <id> --manifest-stdin using that same session ID; automatic stop-hook enforcement is unavailable for ${host}.`;
  return { capture, closeout, manual_capture: capture, manual_closeout: closeout };
};

const parse_owned_command = command => {
  if (typeof command !== 'string') return null;

  const match = command.trim().match(/^node\s+('(?:[^']|'\\'')*'|"[^"]*"|[^\s]+)\s+--host\s+(claude|codex)$/);
  if (!match) return null;
  const token = match[1];
  const script = token.startsWith("'") ? token.slice(1, -1).replaceAll("'\\''", "'") : token.startsWith('"') ? token.slice(1, -1) : token;
  return { script: node_path.resolve(script), host: match[2] };
};

const is_our_command = (command, host) => {
  const parsed = parse_owned_command(command);
  const installed_script = node_path.resolve(node_path.join(__dirname, 'stop-hook.js'));
  return parsed !== null && parsed.host === host && parsed.script === installed_script;
};

const canonical_path = value => {
  const missing = [];
  let cursor = node_path.resolve(value);
  while (!node_fs.existsSync(cursor)) {
    const parent = node_path.dirname(cursor);
    if (parent === cursor) return node_path.resolve(value);
    missing.unshift(node_path.basename(cursor));
    cursor = parent;
  }
  return node_path.join(node_fs.realpathSync(cursor), ...missing);
};

const is_project_worktree_command = (command, host, cwd) => {
  const parsed = parse_owned_command(command);
  if (parsed === null || parsed.host !== host) return false;
  const worktrees = `${canonical_path(node_path.resolve(cwd, '.worktrees'))}${node_path.sep}`;
  const suffix = node_path.join('skills', 'agentflow', 'scripts', 'stop-hook.js');
  const script = canonical_path(parsed.script);
  return script.startsWith(worktrees)
    && script.endsWith(`${node_path.sep}${suffix}`)
    && script.slice(worktrees.length, -suffix.length - 1).split(node_path.sep).length === 1;
};

const parse_args = argv => {
  const args = argv.slice(2);
  const flags = new Set(args);
  const scope = flags.has('--global') ? 'global' : 'project';
  const off = flags.has('--off');
  const quiet = flags.has('--quiet');
  const host_index = args.indexOf('--host');
  const host_value = host_index >= 0 ? args[host_index + 1] : 'all';
  const hosts = host_value === 'all' ? HOSTS : [host_value];

  if (!hosts.every(host => host === 'all' || safe_host(host))) {
    console.error(`Unknown --host value: ${host_value} (use a safe lowercase host id or all)`);
    process.exit(1);
  }

  return { scope, off, quiet, hosts };
};

const config_path_for = (host, scope, cwd = process.cwd()) => {
  const base = scope === 'global' ? node_os.homedir() : cwd;
  const file = host === 'claude' ? node_path.join('.claude', 'settings.json') : node_path.join('.codex', 'hooks.json');

  return node_path.join(base, file);
};

const read_config = config_path => {
  if (!node_fs.existsSync(config_path)) {
    return {};
  }

  const text = node_fs.readFileSync(config_path, 'utf8').trim();

  return text.length === 0 ? {} : JSON.parse(text);
};

const backup = config_path => {
  if (!node_fs.existsSync(config_path)) {
    return null;
  }

  // No Date.* here (kept simple + deterministic); a fixed suffix is enough because
  // we only ever keep the one pre-change copy.
  const backup_path = `${config_path}.agentflow-backup`;

  node_fs.copyFileSync(config_path, backup_path);

  return backup_path;
};

const add_hook = (config, host, { scope = 'project', cwd = process.cwd(), event = 'Stop' } = {}) => {
  const stop_entries = Array.isArray(config.hooks && config.hooks[event]) ? config.hooks[event] : [];
  const desired_command = hook_command_for(host);
  const owned = command => is_our_command(command, host)
    || (scope === 'project' && is_project_worktree_command(command, host, cwd));
  let kept_one = false;
  const next_entries = stop_entries.flatMap(entry => {
    if (!Array.isArray(entry.hooks)) return [entry];
    const hooks = entry.hooks.flatMap(hook => {
      if (!owned(hook.command)) return [hook];
      if (kept_one) return [];
      kept_one = true;
      return [{ ...hook, command: desired_command }];
    });
    return hooks.length === 0 ? [] : [{ ...entry, hooks }];
  });
  if (!kept_one) next_entries.push({ hooks: [{ type: 'command', command: desired_command }] });
  const next_config = {
    ...config,
    hooks: { ...(config.hooks || {}), [event]: next_entries }
  };
  return JSON.stringify(next_config) === JSON.stringify(config)
    ? { config, changed: false }
    : { config: next_config, changed: true };
};

const remove_hook = (config, host, { scope = 'project', cwd = process.cwd(), event = 'Stop' } = {}) => {
  const stop_entries = Array.isArray(config.hooks && config.hooks[event]) ? config.hooks[event] : [];
  let changed = false;
  const kept = [];

  for (const entry of stop_entries) {
    if (!Array.isArray(entry.hooks)) {
      kept.push(entry);
      continue;
    }

    const hooks = entry.hooks.filter(hook => !(is_our_command(hook.command, host)
      || (scope === 'project' && is_project_worktree_command(hook.command, host, cwd))));
    if (hooks.length === entry.hooks.length) {
      kept.push(entry);
      continue;
    }

    changed = true;
    if (hooks.length > 0) kept.push({ ...entry, hooks });
  }

  if (!changed) {
    return { config, changed: false };
  }

  const next_hooks = { ...(config.hooks || {}) };

  if (kept.length === 0) {
    delete next_hooks[event];
  } else {
    next_hooks[event] = kept;
  }

  const next_config = { ...config, hooks: next_hooks };

  if (Object.keys(next_hooks).length === 0) {
    delete next_config.hooks;
  }

  return { config: next_config, changed: true };
};

const apply_to_host = (host, scope, off, say, cwd = process.cwd()) => {
  if (!HOSTS.includes(host)) {
    const result = { status: 'not_available', host, reason: 'no_host_hook_integration', instructions: manual_instructions(host) };
    say(`${host}: hooks not_available — use explicit manual capture and closeout instructions`);
    return result;
  }
  const config_path = config_path_for(host, scope, cwd);
  const config = read_config(config_path);
  let next_config = config;
  let changed = false;
  for (const event of ['Stop', 'UserPromptSubmit']) {
    const result = (off ? remove_hook : add_hook)(next_config, host, { scope, cwd, event });
    next_config = result.config;
    changed = changed || result.changed;
  }

  if (!changed) {
    say(`${host}: no change — the Agentflow hooks were already ${off ? 'absent from' : 'present in'} ${config_path}`);
    return { status: 'available', host, changed: false, config_path };
  }

  const backup_path = backup(config_path);

  ag_settings.write_text_atomic(config_path, `${JSON.stringify(next_config, null, 2)}\n`);

  say(`${host}: ${off ? 'removed' : 'added'} the Agentflow Stop and UserPromptSubmit hooks ${off ? 'from' : 'in'} ${config_path}. Restart the host to load this change.`);

  if (backup_path) {
    say(`${host}: backup of the previous file: ${backup_path}`);
  }
  return { status: 'available', host, changed: true, config_path };
};

const apply_guard = (off, say, cwd = process.cwd()) => {
  let hooks_dir;

  try {
    hooks_dir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    say('git: not a repository — the pre-commit devlog guard was skipped');
    return;
  }

  const hook_path = node_path.join(hooks_dir, 'pre-commit');
  let hook_stat = null;
  try {
    hook_stat = node_fs.lstatSync(hook_path);
  } catch {}
  const existing = hook_stat && hook_stat.isFile() ? node_fs.readFileSync(hook_path, 'utf8') : null;

  if (off) {
    if (existing === guard_script) {
      node_fs.unlinkSync(hook_path);
      say(`git: removed the pre-commit devlog guard from ${hook_path}`);
    } else if (hook_stat) {
      say(`git: pre-commit hook at ${hook_path} was left untouched because Agentflow ownership could not be verified; inspect it and remove the guard manually if appropriate`);
    } else {
      say('git: no pre-commit devlog guard to remove');
    }
    return;
  }

  if (!hook_stat) {
    ag_settings.write_text_atomic(hook_path, guard_script);
    node_fs.chmodSync(hook_path, 0o755);
    say(`git: added the pre-commit devlog guard at ${hook_path}`);
  } else if (existing === guard_script) {
    say('git: no change — the pre-commit devlog guard is already present');
  } else {
    // Refuse rather than damage: a hook someone else wrote is never edited.
    say(`git: a pre-commit hook already exists at ${hook_path} — left untouched; add this line to it yourself for the devlog guard: ${guard_command}`);
  }
};

const nudge_setup = () => {
  const marker = node_path.join(__dirname, '..', '.setup-checked');
  if (!node_fs.existsSync(marker)) {
    const setup_script = node_path.join(__dirname, 'setup.js');
    process.stderr.write(`agentflow: shell shortcuts (agf) not set up yet — run: ${JSON.stringify(process.execPath)} ${JSON.stringify(setup_script)}\n`);
  }
};

const install = ({ scope = 'project', off = false, quiet = false, hosts = HOSTS, cwd = process.cwd(), say: supplied_say } = {}) => {
  const say = quiet ? () => {} : message => console.log(message);
  const output = supplied_say || say;

  const results = hosts.map(host => apply_to_host(host, scope, off, output, cwd));

  if (scope === 'project' && hosts.some(host => HOSTS.includes(host))) {
    apply_guard(off, output, cwd);
  }

  if (!off && hosts.some(host => HOSTS.includes(host))) nudge_setup();

  hosts.filter(host => HOSTS.includes(host)).forEach(host => output(`Hook command (${host}): ${hook_command_for(host)}`));
  return results.length === 1 ? results[0] : { status: 'available', hosts: results };
};

const inspect = ({ cwd = process.cwd(), scope = 'project', hosts = HOSTS } = {}) => {
  const found = [];
  for (const host of hosts) {
    const config_path = config_path_for(host, scope, cwd);
    const config = read_config(config_path);
    if (['Stop', 'UserPromptSubmit'].some(event => remove_hook(config, host, { scope, cwd, event }).changed)) {
      found.push(`remove the verified Agentflow Stop hook from ${config_path}`);
    }
  }
  if (scope === 'project') {
    try {
      const hooks_dir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      const hook_path = node_path.join(hooks_dir, 'pre-commit');
      if (node_fs.existsSync(hook_path) && node_fs.readFileSync(hook_path, 'utf8') === guard_script) {
        found.push(`remove the verified Agentflow pre-commit guard from ${hook_path}`);
      }
    } catch {}
  }
  return found;
};

const main = () => {
  const options = parse_args(process.argv);
  install(options);
};

module.exports = { install, inspect, config_path_for, apply_guard, hook_command_for, parse_owned_command };

if (require.main === module) main();
