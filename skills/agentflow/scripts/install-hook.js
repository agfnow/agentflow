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

const hook_command = `node "${node_path.join(__dirname, 'stop-hook.js')}"`;

const HOSTS = ['claude', 'codex'];

const parse_args = argv => {
  const args = argv.slice(2);
  const flags = new Set(args);
  const scope = flags.has('--global') ? 'global' : 'project';
  const off = flags.has('--off');
  const quiet = flags.has('--quiet');
  const host_index = args.indexOf('--host');
  const host_value = host_index >= 0 ? args[host_index + 1] : 'all';
  const hosts = host_value === 'all' ? HOSTS : [host_value];

  if (!hosts.every(host => HOSTS.includes(host))) {
    console.error(`Unknown --host value: ${host_value} (use claude, codex, or all)`);
    process.exit(1);
  }

  return { scope, off, quiet, hosts };
};

const config_path_for = (host, scope) => {
  const base = scope === 'global' ? node_os.homedir() : process.cwd();
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

const is_our_entry = entry => Array.isArray(entry.hooks)
  && entry.hooks.some(hook => typeof hook.command === 'string' && hook.command.includes('stop-hook.js'));

const add_hook = config => {
  const stop_entries = Array.isArray(config.hooks && config.hooks.Stop) ? config.hooks.Stop : [];

  if (stop_entries.some(is_our_entry)) {
    return { config, changed: false };
  }

  const next_entry = { hooks: [{ type: 'command', command: hook_command }] };
  const next_config = {
    ...config,
    hooks: { ...(config.hooks || {}), Stop: [...stop_entries, next_entry] }
  };

  return { config: next_config, changed: true };
};

const remove_hook = config => {
  const stop_entries = Array.isArray(config.hooks && config.hooks.Stop) ? config.hooks.Stop : [];
  const kept = stop_entries.filter(entry => !is_our_entry(entry));

  if (kept.length === stop_entries.length) {
    return { config, changed: false };
  }

  const next_hooks = { ...(config.hooks || {}) };

  if (kept.length === 0) {
    delete next_hooks.Stop;
  } else {
    next_hooks.Stop = kept;
  }

  const next_config = { ...config, hooks: next_hooks };

  if (Object.keys(next_hooks).length === 0) {
    delete next_config.hooks;
  }

  return { config: next_config, changed: true };
};

const apply_to_host = (host, scope, off, say) => {
  const config_path = config_path_for(host, scope);
  const config = read_config(config_path);
  const { config: next_config, changed } = off ? remove_hook(config) : add_hook(config);

  if (!changed) {
    say(`${host}: no change — the Stop hook was already ${off ? 'absent from' : 'present in'} ${config_path}`);
    return;
  }

  const backup_path = backup(config_path);

  node_fs.mkdirSync(node_path.dirname(config_path), { recursive: true });
  node_fs.writeFileSync(config_path, `${JSON.stringify(next_config, null, 2)}\n`);

  say(`${host}: ${off ? 'removed' : 'added'} the Agentflow Stop hook ${off ? 'from' : 'in'} ${config_path}`);

  if (backup_path) {
    say(`${host}: backup of the previous file: ${backup_path}`);
  }
};

const main = () => {
  const { scope, off, quiet, hosts } = parse_args(process.argv);
  const say = quiet ? () => {} : message => console.log(message);

  hosts.forEach(host => apply_to_host(host, scope, off, say));

  say(`Hook command: ${hook_command}`);
};

main();
