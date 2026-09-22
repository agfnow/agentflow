'use strict';

// Cooperative round ownership. Call guard/release/transfer while holding the
// notebook's close-round lock. Session IDs are attribution, not authentication.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const writer = () => require('./notebook-write');
const safe_id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
const path_key = value => process.platform === 'win32' ? value.toLowerCase() : value;
const fail = message => { const error = new Error(`notebook ownership: ${message}`); error.code = 'AG_NOTEBOOK_OWNER'; throw error; };

// realpathSync preserves the caller's spelling for an existing final path on
// macOS. Resolve each existing directory entry to the spelling the filesystem
// stores, while leaving absent paths and ambiguous case-sensitive siblings
// untouched.
const filesystem_spelling = value => {
  const absolute = path.resolve(value);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  const parts = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const part of parts) {
    const requested = path.join(current, part);
    // A directory entry with only a case-nearby spelling is an alias only
    // when the requested path itself resolves on this filesystem. On a
    // case-sensitive volume, existsSync is false and the requested spelling
    // must remain independent even if a sibling differs only by case.
    if (!fs.existsSync(requested)) {
      current = requested;
      continue;
    }
    let entries;
    try { entries = fs.readdirSync(current); } catch { entries = []; }
    const exact = entries.find(entry => entry === part);
    if (exact !== undefined) {
      current = path.join(current, exact);
      continue;
    }
    const aliases = entries.filter(entry => entry.toLowerCase() === part.toLowerCase());
    if (aliases.length === 1) {
      const candidate = path.join(current, aliases[0]);
      try {
        const requested_stat = fs.statSync(requested);
        const candidate_stat = fs.statSync(candidate);
        if (String(requested_stat.dev) === String(candidate_stat.dev) && String(requested_stat.ino) === String(candidate_stat.ino)) {
          current = candidate;
          continue;
        }
      } catch {}
    }
    current = requested;
  }
  return current;
};

const linked_worktree = root => {
  if (!fs.lstatSync(path.join(root, '.git'), { throwIfNoEntry: false })?.isFile()) return false;
  const result = require('node:child_process').spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) return false; // Existing repository diagnostics handle unavailable Git.
  const directories = result.stdout.trim().split(/\r?\n/u);
  if (directories.length !== 2) return false;
  try { return path_key(fs.realpathSync(directories[0])) !== path_key(fs.realpathSync(directories[1])); }
  catch { return false; }
};

const identity = ({ host, session, env = process.env } = {}) => {
  host = host || require('./ag-settings').detect_host({ env });
  if (!/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(host)) fail('host must be a safe lowercase ID');
  const native = host === 'codex' ? [env.CODEX_THREAD_ID, env.CODEX_SESSION_ID] : host === 'claude' ? [env.CLAUDE_SESSION_ID] : [];
  const candidates = [...native, session || env.AGENTFLOW_SESSION_ID].filter(value => value !== undefined && value !== '');
  if (candidates.some(value => !safe_id(value))) fail('session ID must contain 1–128 safe letters, digits, dots, colons, underscores or hyphens');
  if (new Set(candidates).size > 1) fail('conflicting session IDs; pass the current host session and remove conflicting inherited markers');
  if (!candidates.length) fail(`session identity is missing for ${host}; retain one unique session ID and pass --session <id> (or AGENTFLOW_SESSION_ID) to every writer`);
  return { host, session: candidates[0] };
};

const safe_path = (root, relative, create_parents = false) => {
  if (typeof relative !== 'string' || !relative || /[\\\u0000-\u001f\u007f]/u.test(relative) || path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative) || /^[A-Za-z]:/u.test(relative) || relative.split('/').some(part => ['', '.', '..'].includes(part))) fail('path must be canonical and inside the checkout');
  const parts = relative.split('/');
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part);
    let stat = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!stat && create_parents && index < parts.length - 1) {
      try { fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      stat = fs.lstatSync(current);
    }
    if (stat && (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))) fail('path contains a symbolic link or non-directory parent');
  }
  return current;
};

const canonical_relative = (root, relative) => path.relative(root, filesystem_spelling(path.join(root, relative))).split(path.sep).join('/');
const same_notebook = (root, left, right) => {
  safe_path(root, left);
  safe_path(root, right);
  return path_key(filesystem_spelling(path.join(root, left))) === path_key(filesystem_spelling(path.join(root, right)));
};

// A first claim can precede creation of the notebook itself. Once the file (or
// its operation lock) exists, retain the spelling already recorded by the
// owner metadata. This avoids case-folding absent paths, which would merge
// genuinely distinct files on a case-sensitive volume.
const recorded_notebook = (root, workspace, notebook) => {
  let directory;
  try { directory = safe_path(root, path.posix.join(workspace, '.tmp')); } catch { return notebook; }
  if (!fs.existsSync(directory)) return notebook;
  let entries;
  try { entries = fs.readdirSync(directory); } catch { return notebook; }
  const requested_lock = filesystem_spelling(path.join(root, `${notebook}.close-round.lock`));
  for (const entry of entries.filter(value => /^agentflow-owner-[a-f0-9]{64}\.json$/u.test(value))) {
    const file = safe_path(root, path.posix.join(workspace, '.tmp', entry));
    const stat = fs.lstatSync(file, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) fail('owner record contains a symbolic link');
    if (!stat.isFile() || stat.size > 4096) fail('owner record must be a bounded regular file');
    let record;
    try { record = JSON.parse(writer().read_regular_file(file, 'notebook owner').text); } catch (error) { fail(`owner record is unreadable or malformed: ${error.message}`); }
    if (typeof record?.root !== 'string' || typeof record.notebook !== 'string') continue;
    if (path_key(filesystem_spelling(record.root)) !== path_key(root)) continue;
    let matches = false;
    try { matches = same_notebook(root, record.notebook, notebook); } catch {}
    if (!matches) {
      const recorded_lock = filesystem_spelling(path.join(root, `${record.notebook}.close-round.lock`));
      matches = fs.existsSync(requested_lock) && fs.existsSync(recorded_lock) && path_key(requested_lock) === path_key(recorded_lock);
    }
    if (matches) return record.notebook;
  }
  return notebook;
};

const location = ({ root = process.cwd(), notebook, workspace: selected_workspace }) => {
  root = filesystem_spelling(fs.realpathSync(root));
  safe_path(root, notebook);
  notebook = canonical_relative(root, notebook);
  const settings = require('./ag-settings');
  const config_path = settings.active_config_path(root, notebook);
  let workspace = selected_workspace || '.agentflow';
  if (selected_workspace === undefined && fs.existsSync(config_path)) {
    safe_path(root, path.relative(root, config_path).split(path.sep).join('/'));
    workspace = JSON.parse(writer().read_regular_file(config_path, 'configuration').text)?.switches?.['workspace-dir'] || workspace;
  }
  if (typeof workspace !== 'string' || settings.workspace_dir_errors(workspace, root).length) fail('configured workspace is invalid');
  workspace = canonical_relative(root, workspace);
  notebook = recorded_notebook(root, workspace, notebook);
  const relative = path.posix.join(workspace, '.tmp', `agentflow-owner-${crypto.createHash('sha256').update(path_key(notebook)).digest('hex')}.json`);
  return { root, notebook, workspace, relative, file: safe_path(root, relative) };
};

const read = info => {
  safe_path(info.root, info.relative);
  const stat = fs.lstatSync(info.file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (!stat.isFile() || stat.size > 4096) fail('owner record must be a bounded regular file');
  let record;
  try { record = JSON.parse(writer().read_regular_file(info.file, 'notebook owner').text); } catch (error) { fail(`owner record is unreadable or malformed: ${error.message}`); }
  let same_target = false;
  try { same_target = typeof record?.notebook === 'string' && same_notebook(info.root, record.notebook, info.notebook); } catch {}
  if (!record || record.version !== 1 || typeof record.root !== 'string' || path_key(filesystem_spelling(record.root)) !== path_key(info.root) || !same_target || !/^A-\d{3}$/u.test(record.ask) || !/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(record.host) || !safe_id(record.session) || !/^[a-f0-9]{32}$/u.test(record.token) || !['active', 'released', 'moved'].includes(record.state)) fail('owner record is malformed or belongs to another notebook');
  if (record.state === 'moved') safe_path(info.root, record.moved_to);
  return record;
};

const save = (info, record) => {
  safe_path(info.root, info.relative, true);
  const ignore = safe_path(info.root, path.posix.join(info.workspace, '.tmp', '.gitignore'));
  try { fs.writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; safe_path(info.root, path.posix.join(info.workspace, '.tmp', '.gitignore')); }
  writer().atomic_replace(info.file, Buffer.from(JSON.stringify(record) + '\n'), 0o600);
};

const rounds = text => require('./round-linter').parse_devlog(text).rounds;
const recovery = (info, current, record, text) => `run agf owner inspect --notebook ${info.notebook}; after owner-authorized handoff, run agf owner adopt --notebook ${info.notebook} --ask ${current?.id || record?.ask || 'A-NNN'} --expect ${record?.token || 'unowned'} --sha256 ${crypto.createHash('sha256').update(text || '').digest('hex')} --host <host> --session <id>`;

// agf new commits an empty first Ask before the owner writes their request.
// Reuse that baseline instead of treating a fresh stream as a legacy notebook.
const first_stream_request = (info, text, parsed) => {
  if (parsed.length !== 1 || parsed[0].id !== 'A-001' || parsed[0].wip_text.trim() || parsed[0].reply_text.trim()) return false;
  const result = require('node:child_process').spawnSync('git', ['show', `HEAD:${info.notebook}`], {
    cwd: info.root, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return false;
  const baseline = rounds(result.stdout);
  if (baseline.length !== 1 || baseline[0].id !== 'A-001' || baseline[0].ask_text.trim() !== '+' || baseline[0].wip_text.trim() || baseline[0].reply_text.trim()) return false;
  const { final_ask_span } = require('./resume-intake');
  const before = final_ask_span(result.stdout);
  const after = final_ask_span(text);
  return before !== null && after !== null && result.stdout.slice(0, before.body_start) === text.slice(0, after.body_start);
};

const guard = ({ root = process.cwd(), notebook, text, host, session, ask, workspace, allow_missing = false, allow_closed = false, resume_unclaimed = false } = {}) => {
  const who = identity({ host, session });
  const info = location({ root, notebook, workspace });
  const stream = linked_worktree(info.root);
  if (stream) {
    const branch = require('node:child_process').spawnSync('git', ['branch', '--show-current'], { cwd: info.root, encoding: 'utf8' });
    const expected = branch.status === 0 ? require('./agf').stream_doc(info.root, branch.stdout.trim()) : null;
    if (!expected || path_key(canonical_relative(info.root, expected)) !== path_key(info.notebook)) fail('a stream worktree may write only its canonical stream notebook; the checked-out main notebook belongs to the main session');
  }
  if (text === undefined) {
    const file = safe_path(info.root, info.notebook);
    text = fs.existsSync(file) ? writer().read_regular_file(file, 'notebook').text : allow_missing ? '# → Ask / A-001\n\n+\n' : fail('notebook is missing');
  }
  const parsed = rounds(text);
  const current = parsed.at(-1);
  if (!current || !/^A-\d{3}$/u.test(current.id)) fail('notebook has no unambiguous current Ask');
  const record = read(info);
  if (record?.state === 'moved') fail(`notebook moved to ${record.moved_to}; use its current notebook path`);
  const target = ask || current.id;
  const closed_target = allow_closed && parsed.some(round => round.id === target && round.reply_text.trim());
  if (record && record.ask === target && (record.state === 'active' || closed_target)) {
    if (record.host !== who.host || record.session !== who.session) fail(`${notebook} ${record.ask} belongs to ${record.host} session ${record.session}; ${recovery(info, current, record, text)}`);
    if (target !== current.id && !closed_target) fail('requested Ask is no longer the current round');
    return { ...info, record, identity: who };
  }
  if (record?.state === 'active') fail(`${notebook} ${record.ask} is still owned; ${recovery(info, current, record, text)}`);
  const predecessor = parsed.at(-2);
  // Only explicit startup opts in; hooks and ordinary writers cannot claim a
  // populated successor from a released predecessor on their own.
  const resumed = resume_unclaimed === true && record?.state === 'released' && predecessor?.id === record.ask && predecessor.reply_text.trim() && current.id === `A-${String(Number(record.ask.slice(2)) + 1).padStart(3, '0')}`;
  const empty = ['', '+'].includes(current.ask_text.trim()) && !current.wip_text.trim();
  const first_stream = !empty && resume_unclaimed === true && record === null && stream && first_stream_request(info, text, parsed);
  if (target !== current.id || current.reply_text.trim() || (!empty && !resumed && !first_stream)) fail(`ownership is unknown for ${notebook} ${current.id}; ${recovery(info, current, record, text)}`);
  if (record && !parsed.some(round => round.id === record.ask && round.reply_text.trim())) fail('released owner does not match a completed notebook round');
  const claimed = { version: 1, root: info.root, notebook: info.notebook, ask: current.id, ...who, token: crypto.randomBytes(16).toString('hex'), state: 'active' };
  save(info, claimed);
  return { ...info, record: claimed, identity: who };
};

const verify = (context, target = {}) => {
  if (!context?.record) fail('guarded owner context is required');
  if (target.root !== undefined && path_key(filesystem_spelling(fs.realpathSync(target.root))) !== path_key(context.root)) fail('owner context belongs to another checkout, notebook or Ask');
  if (target.notebook !== undefined && !same_notebook(context.root, target.notebook, context.notebook)) fail('owner context belongs to another checkout, notebook or Ask');
  if (target.ask !== undefined && target.ask !== context.record.ask) fail('owner context belongs to another checkout, notebook or Ask');
  const current = read(context);
  if (!current || current.token !== context.record.token || current.host !== context.identity.host || current.session !== context.identity.session || current.ask !== context.record.ask || current.state !== context.record.state) fail('owner changed after the guard; retry from the current notebook');
  if (target.active === true && current.state !== 'active') fail('completed ownership cannot authorize another mutation');
  return current;
};

const release = (context, text) => {
  const current = verify(context);
  if (current.state === 'released') return;
  const parsed = rounds(text);
  const index = parsed.findIndex(round => round.id === current.ask);
  if (index < 0 || !parsed[index].reply_text.trim() || index !== parsed.length - 2 || parsed.at(-1).id !== `A-${String(Number(current.ask.slice(2)) + 1).padStart(3, '0')}` || parsed.at(-1).reply_text.trim() || !['', '+'].includes(parsed.at(-1).ask_text.trim())) fail('release requires the completed owned Ask and the next empty scaffold');
  save(context, { ...current, state: 'released' });
};

// Both notebook path locks are held by the dedicated rename operation.
const relocate = (context, notebook) => {
  const record = verify(context);
  const destination = location({ root: context.root, notebook, workspace: context.workspace });
  if (read(destination)) fail('rename destination already has ownership metadata; inspect it before recovery');
  const next = { ...record, notebook: destination.notebook, token: crypto.randomBytes(16).toString('hex') };
  save(destination, next);
  save(context, { ...record, state: 'moved', moved_to: destination.notebook });
  return { ...destination, record: next, identity: context.identity };
};

const inspect = ({ root = process.cwd(), notebook }) => {
  const info = location({ root, notebook });
  const snapshot = writer().read_regular_file(safe_path(info.root, info.notebook), 'notebook');
  return { notebook: info.notebook, ask: rounds(snapshot.text).at(-1)?.id, sha256: snapshot.hash, owner: read(info) };
};

const transfer = ({ root = process.cwd(), notebook, host, session, ask, expected, sha256 }) => {
  const who = identity({ host, session });
  const info = location({ root, notebook });
  const snapshot = writer().read_regular_file(safe_path(info.root, info.notebook), 'notebook');
  const record = read(info);
  const current = rounds(snapshot.text).at(-1);
  if (!current || current.id !== ask || current.reply_text.trim() || snapshot.hash !== sha256 || (record?.token || 'unowned') !== expected) fail('adoption precondition changed; inspect the current owner, Ask and notebook hash again');
  const next = { version: 1, root: info.root, notebook: info.notebook, ask, ...who, token: crypto.randomBytes(16).toString('hex'), state: 'active' };
  save(info, next);
  return { notebook: info.notebook, ask, owner: next };
};

const cli = (argv, cwd) => {
  const [action, ...args] = argv;
  if (!['inspect', 'adopt'].includes(action)) fail('usage: agf owner <inspect|adopt> --notebook <path> [--host <host> --session <id> --ask <A-NNN> --expect <token|unowned> --sha256 <hash>]');
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!['--notebook', '--host', '--session', '--ask', '--expect', '--sha256'].includes(flag) || values[flag] !== undefined || !args[index + 1] || args[index + 1].startsWith('--')) fail('invalid owner command argument');
    values[flag] = args[index + 1];
  }
  const options = { root: cwd, notebook: values['--notebook'], host: values['--host'], session: values['--session'], ask: values['--ask'], expected: values['--expect'], sha256: values['--sha256'] };
  if (action === 'inspect') return { json: inspect(options) };
  const file = writer().resolve_path(fs.realpathSync(cwd), options.notebook, 'notebook');
  const lock = writer().acquire_close_round_lock(`${file}.close-round.lock`);
  try { return { json: transfer(options) }; } finally { writer().release_close_round_lock(lock); }
};

module.exports = { identity, location, read, guard, verify, release, relocate, inspect, transfer, cli, safe_path, linked_worktree };
