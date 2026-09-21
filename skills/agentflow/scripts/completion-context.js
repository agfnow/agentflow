'use strict';

const node_fs = require('node:fs');
const node_path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { lint_round, parse_devlog, review_eligible, plain_record_text, completion_metadata } = require('./round-linter');
const { parse_numeric_timestamp } = require('./local-time.js');
const tracker_contract = require('./tracker-contract.js');
const ag_settings = require('./ag-settings.js');

const edit_tool_names = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const devlog_file_pattern = /(^|[\\/])[^\\/]*devlog[^\\/]*\.md$/i;

const git = (project_root, args) => {
  try {
    return execFileSync('git', args, {
      cwd: project_root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trimEnd();
  } catch (error) {
    return '';
  }
};

const git_succeeds = (project_root, args) => {
  try {
    execFileSync('git', args, { cwd: project_root, stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
};

const regular_files_named = (root, name, depth = 0) => {
  if (depth > 5) return [];
  let entries;
  try {
    entries = node_fs.readdirSync(root, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.worktrees' || entry.name === 'node_modules') continue;
    const file = node_path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...regular_files_named(file, name, depth + 1));
    else if (entry.isFile() && entry.name === name) files.push(file);
  }
  return files;
};

const parse_porcelain_paths = output => {
  const paths = [];
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const file = record.slice(3);
    if (file.length > 0) paths.push(file);
    if (status.includes('R') || status.includes('C')) index += 1;
  }
  return paths;
};

const changed_line_count = (project_root, baseline, working_files) => {
  if (!/^[0-9a-f]{40}$/u.test(baseline)) return Number.POSITIVE_INFINITY;
  const rows = git(project_root, ['diff', '--numstat', baseline]).split(/\r?\n/u).filter(Boolean);
  let total = 0;
  for (const row of rows) {
    const [added, removed] = row.split('\t');
    if (!/^\d+$/u.test(added) || !/^\d+$/u.test(removed)) return Number.POSITIVE_INFINITY;
    total += Number(added) + Number(removed);
  }
  const untracked = new Set(git(project_root, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/u).filter(Boolean));
  for (const relative of working_files.filter(file => untracked.has(file))) {
    try {
      const stat = node_fs.statSync(node_path.join(project_root, relative));
      if (!stat.isFile() || stat.size > 1024 * 1024) return Number.POSITIVE_INFINITY;
      const text = node_fs.readFileSync(node_path.join(project_root, relative), 'utf8');
      total += text.length === 0 ? 0 : text.split(/\r?\n/u).length;
    } catch (error) {
      return Number.POSITIVE_INFINITY;
    }
  }
  return total;
};

const current_round_info = devlog_text => {
  const parsed = parse_devlog(devlog_text);
  const current_round = parsed.rounds.find(round => round.text === parsed.last_round);
  const ask_id = current_round?.id;
  return { parsed, current_round, ask_id };
};

const escape_regexp = value => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const completed_cleanup_boundary = (project_root, current_round, workspace_dir, committed_files) => {
  const ask_text = current_round?.ask_text ?? '';
  if (!/\bclean(?:up|ed|ing)?\b/iu.test(ask_text) || typeof workspace_dir !== 'string' || workspace_dir.length === 0) return undefined;
  const root = workspace_dir.replace(/\/+$/u, '');
  const feature_pattern = new RegExp(`^${escape_regexp(root)}/features/([^/]+)/\\1\\.devlog\\.md$`, 'u');
  const candidates = committed_files.flatMap(file => {
    const match = feature_pattern.exec(file);
    return match === null ? [] : [{ file, key: match[1] }];
  }).filter(({ key }) => new RegExp(`(^|[^A-Za-z0-9_-])${escape_regexp(key)}($|[^A-Za-z0-9_-])`, 'u').test(ask_text));
  if (candidates.length !== 1) return undefined;

  const { file, key } = candidates[0];
  let text;
  try {
    text = node_fs.readFileSync(node_path.join(project_root, file), 'utf8');
  } catch (error) {
    return undefined;
  }
  const marker = `Feature: ${key} — closed`;
  if (text.split(/\r?\n/u).filter(line => line === marker).length !== 1) return undefined;
  if (git_succeeds(project_root, ['show-ref', '--verify', '--quiet', `refs/heads/${key}`])) return undefined;
  if (node_fs.existsSync(node_path.join(project_root, '.worktrees', key))) return undefined;

  const boundary = git(project_root, ['log', '-1', '--format=%H', '-S', marker, '--', file]);
  if (!/^[0-9a-f]{40}$/u.test(boundary)) return undefined;
  if (!git_succeeds(project_root, ['merge-base', '--is-ancestor', boundary, 'HEAD'])) return undefined;
  return boundary;
};

const read_transcript_entries = transcript_path => {
  try {
    return node_fs
      .readFileSync(transcript_path, 'utf8')
      .split(/\r?\n/u)
      .reduce((entries, line) => {
        if (line.trim().length === 0) return entries;
        try {
          entries.push(JSON.parse(line));
        } catch (error) {
          // A malformed transcript line is skipped, never fatal.
        }
        return entries;
      }, []);
  } catch (error) {
    return [];
  }
};

const content_blocks = entry => {
  const content = entry && entry.message && entry.message.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [];
};

const is_owner_prompt = entry =>
  entry && entry.type === 'user' && !content_blocks(entry).some(block => block && block.type === 'tool_result');

const gather_terminal_output = transcript_path => {
  if (!transcript_path) return undefined;
  const entries = read_transcript_entries(transcript_path);
  if (entries.length === 0) return undefined;

  let turn_start = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (is_owner_prompt(entries[index])) {
      turn_start = index + 1;
      break;
    }
  }

  const turn = entries.slice(turn_start);
  const devlog_edited = turn.some(entry =>
    entry.type === 'assistant' &&
    content_blocks(entry).some(block =>
      block &&
      block.type === 'tool_use' &&
      edit_tool_names.has(block.name) &&
      block.input &&
      typeof block.input.file_path === 'string' &&
      devlog_file_pattern.test(block.input.file_path)));
  if (!devlog_edited) return undefined;

  const last_assistant = [...turn].reverse().find(entry => entry.type === 'assistant');
  if (!last_assistant) return undefined;
  const text = content_blocks(last_assistant)
    .filter(block => block && block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim();
  return text.length === 0 ? undefined : text;
};

const gather_push = project_root => {
  const remote_exists = git(project_root, ['remote']).length > 0;
  const head = git(project_root, ['rev-parse', 'HEAD']);
  const branch = git(project_root, ['branch', '--show-current']);

  if (!remote_exists) return { remote_exists: false, exit_code: 0, head, branch, upstream: '', unpushed_count: 0 };

  const upstream = git(project_root, ['rev-parse', '--abbrev-ref', '@{u}']);
  if (upstream.length === 0) return { remote_exists: true, exit_code: 1, head, branch, upstream, unpushed_count: null };

  const unpushed = git(project_root, ['rev-list', '@{u}..HEAD', '--count']);
  return {
    remote_exists: true,
    exit_code: unpushed === '0' ? 0 : 1,
    head,
    branch,
    upstream,
    unpushed_count: /^\d+$/u.test(unpushed) ? Number(unpushed) : null
  };
};

const tracker_candidates = (search_root, ask_id) => regular_files_named(search_root, 'tracker.md').filter(file => {
  try {
    return new RegExp(`^[-*+] (?:\\*\\*)?Active Ask:(?:\\*\\*)?.*\\b${ask_id}\\b`, 'imu').test(node_fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return false;
  }
});

const stream_tracker_scope = (project_root, notebook_path, workspace_dir) => {
  if (typeof notebook_path !== 'string' || typeof workspace_dir !== 'string' || workspace_dir.length === 0) return undefined;
  const root = workspace_dir.replace(/\/+$/u, '');
  const match = new RegExp(`^${escape_regexp(root)}/features/([^/]+)/\\1\\.devlog\\.md$`, 'u').exec(notebook_path);
  return match === null ? undefined : node_path.join(project_root, root, 'features', match[1]);
};

const tracker_facts = (project_root, current_round, ask_id, notebook_path, workspace_dir, repository) => {
  if (ask_id === undefined || current_round === undefined) return { tracker: undefined, work: undefined };
  const has_checkpoint = /^## \[WIP-\d+\] Checkpoint\b/mu.test(current_round.wip_text);
  const search_root = stream_tracker_scope(project_root, notebook_path, workspace_dir) ?? project_root;
  const matches = tracker_candidates(search_root, ask_id);
  if (matches.length === 0) {
    return {
      tracker: has_checkpoint ? { required: true, path: 'missing', work_root: 'missing' } : undefined,
      work: has_checkpoint ? { ask_id, work_key: undefined, root: undefined, tracker_path: undefined } : undefined
    };
  }
  if (matches.length > 1) {
    return {
      tracker: { required: true, path: 'ambiguous', work_root: 'ambiguous' },
      work: { ask_id, work_key: undefined, root: undefined, tracker_path: undefined }
    };
  }

  const tracker_path = matches[0];
  const relative = node_path.relative(project_root, tracker_path).split(node_path.sep).join('/');
  const root = node_path.posix.dirname(relative);
  return {
    tracker: tracker_contract.validation_facts({ repo: project_root, tracker: tracker_path, repository }),
    work: {
      ask_id,
      work_key: node_path.posix.basename(root),
      root,
      tracker_path: relative
    }
  };
};

const gather_checkpoint_verification = (project_root, devlog_text, work, notebook_path) => {
  const { current_round, ask_id } = current_round_info(devlog_text);
  if (current_round === undefined || ask_id === undefined) return undefined;
  const checkpoints = [...current_round.wip_text.matchAll(/^## \[WIP-\d+\] Checkpoint — (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: [+-]\d{4}| Asia\/Taipei)?)/gmu)];
  if (checkpoints.length === 0) return undefined;

  const latest_checkpoint_minute = checkpoints.at(-1)[1];
  const before_checkpoint = current_round.wip_text.slice(0, checkpoints.at(-1).index);
  const run_events = [...before_checkpoint.matchAll(/^## \[RUN-\d+\] Event — \d{4}-\d{2}-\d{2} \d{2}:\d{2}[^\r\n]*$/gmu)];
  const tracker_path = work?.tracker_path === undefined ? undefined : node_path.resolve(project_root, work.tracker_path);
  let tracker_text = '';
  try {
    tracker_text = tracker_path === undefined ? '' : node_fs.readFileSync(tracker_path, 'utf8');
  } catch (error) {
    tracker_text = '';
  }
  const tracker_stamp = /^[-*+] (?:\*\*)?Last update:(?:\*\*)? (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?: [+-]\d{4}| Asia\/Taipei)?)\.?$/imu.exec(tracker_text)?.[1];
  const timestamp_ms = parse_numeric_timestamp;

  return {
    required: true,
    tracker_current: tracker_stamp !== undefined && timestamp_ms(tracker_stamp) >= timestamp_ms(latest_checkpoint_minute),
    run_required: ag_settings.read_notebook_controls(project_root, notebook_path)['log-verbosity'] === 'all',
    run_current: run_events.length > 0,
    progress_current: ['Finished', 'Running now', 'Still to do', 'Next work action'].every(label => current_round.wip_text.slice(checkpoints.at(-1).index).includes(`${label}:`)),
    // A prose label is presentation, not proof that the changed scope was checked.
    scope_label_present: /^- \*\*Scope check:\*\*\s+\S/mu.test(before_checkpoint)
  };
};

const same_config_except_language = (actual, expected, project_root, active_host) => {
  try { ag_settings.detect_host({ explicit_host: active_host }); } catch { return false; }
  const options = { repo_root: project_root, active_host, check_executables: false };
  if (![actual, expected].every(config => ag_settings.validate_config(config, options).valid)) return false;
  return isDeepStrictEqual(actual, { ...expected, switches: { ...expected.switches, lang: actual.switches.lang } });
};

const canonical_bootstrap_config = (project_root, notebook_path, config_path, active_host) => {
  if (config_path === undefined) return false;
  const relative_config = node_path.relative(project_root, config_path).split(node_path.sep).join('/');
  if (relative_config !== 'ag.json') return false;
  try {
    const actual = JSON.parse(node_fs.readFileSync(config_path, 'utf8'));
    const expected = ag_settings.make_template(active_host);
    for (const key of Object.keys(ag_settings.notebook_control_defaults)) {
      if (!Object.hasOwn(actual.switches || {}, key)) delete expected.switches[key];
    }
    if (Object.hasOwn(actual.switches || {}, 'workspace-dir')) expected.switches['workspace-dir'] = '.agentflow';
    expected.switches['target-doc'] = notebook_path;
    return same_config_except_language(actual, expected, project_root, active_host);
  } catch (error) {
    return false;
  }
};

const language_only_config_change = (project_root, config_path, baseline, active_host) => {
  if (!config_path || !/^[0-9a-f]{40}$/u.test(baseline || '')) return false;
  try {
    const relative = node_path.relative(project_root, config_path).split(node_path.sep).join('/');
    const actual = JSON.parse(node_fs.readFileSync(config_path, 'utf8'));
    const expected = JSON.parse(git(project_root, ['show', `${baseline}:${relative}`]));
    return same_config_except_language(actual, expected, project_root, active_host)
      && actual.switches.lang !== expected.switches.lang;
  } catch {
    return false;
  }
};

// no-ag is an owner control for this Ask, not a persistent configuration edit.
// Read controls in order so a later explicit review request or reactivation wins.
const no_ag_review_waiver = owner_text => {
  const commands = plain_record_text(owner_text.replace(/<!--[\s\S]*?-->/gu, '').replace(/^(?: {4}|\t).*$/gmu, ''))
    .replace(/"[^"]*"|“[^”]*”|‘[^’]*’|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])/gu, quoted => quoted.replace(/[^\r\n]+/gu, ' [quoted] '));
  let active = false;
  for (const raw of commands.split(/\r?\n/u)) {
    const line = raw.trim();
    if (/^[>›]/u.test(line) || /^\/?no-ag\s*[,，;:]\s*(?:if|unless)\b/iu.test(line)) continue;
    if (/^for (?:the )?remaining tasks\s*[,，:]\s*(?:please )?use cross[- ]?check[.!]?$/iu.test(line)) { active = false; continue; }
    const unquoted = line.replace(/`[^`]*`|"[^"\n]*"|“[^”\n]*”|'[^'\n]*'/gu, ' [quoted] ');
    let first = true;
    for (const part of unquoted.split(/[,，;]|[.!]\s+/u)) {
      const command = part.trim().replace(/[.!]$/u, '');
      const opt_out = /^\/?no-ag(?:\s*:\s*\S.*)?$/iu.test(command);
      const opt_in = /^\/?(?:godev|ag|agentflow)(?:\s*:\s*\S.*)?$/iu.test(command)
        || /^(?:please\s+)?(?:require|use)\s+(?:an?\s+)?(?:independent|external|separate|second)\s+review(?:er)?$/iu.test(command)
        || /^(?:please\s+)?(?:run|perform|do|get|request|use)\s+(?:(?:one|an?|independent|external|separate|final)\s+)*(?:cross[- ]?check|review)(?:\s+for\s+(?:this|the)\s+(?:task|change))?$/iu.test(command)
        || /^review-requirement:\s*(?:independent|fresh-context|enforced-read-only)$/iu.test(command)
        || /^(?:do not|don't|never)\s+skip\s+(?:external\s+)?review$/iu.test(command);
      if (first && !opt_out && !opt_in) break;
      first = false;
      if (opt_out || opt_in) active = opt_out;
    }
  }
  return active;
};

const review_decision = (project_root, notebook_path, devlog_text, workspace_dir, config_path, active_host, git_facts) => {
  if (node_path.isAbsolute(notebook_path)) notebook_path = node_path.relative(project_root, notebook_path).split(node_path.sep).join('/');
  const notebook_name = node_path.basename(notebook_path, node_path.extname(notebook_path));
  const notebook_directory = node_path.posix.dirname(notebook_path);
  const { current_round, ask_id } = current_round_info(devlog_text);
  if (current_round === undefined || ask_id === undefined) {
    return { error: 'completed round has no Ask identifier for its review decision' };
  }
  const ask_text = current_round.owner_text ?? current_round.ask_text ?? '';
  if (no_ag_review_waiver(ask_text)) {
    return { status: 'skip-review', reason: 'owner selected no-ag for this Ask; host self-review remains required', owner_authorized: true };
  }
  if (require('./fast-lane.js').parse_fast_lane(ask_text)) {
    return { status: 'skip-review', reason: 'owner selected fast-lane for this round', owner_authorized: true };
  }
  const prior_replies = git_facts.parsed.rounds.slice(0, current_round.index).filter(round => round.reply_text.length > 0).map(round => round.id);
  const has_captured_baseline = /^[0-9a-f]{40}$/u.test(git_facts.captured_baseline || '');
  let changed_files = git_facts.changed_files;
  if (prior_replies.length === 0 && !has_captured_baseline) {
    const committed = git(project_root, ['ls-files']).split('\n').filter(Boolean);
    changed_files = [...new Set([...committed, ...git_facts.working_files])];
  }
  const record_files = [
    notebook_path,
    node_path.posix.join(notebook_directory, `.${notebook_name}.audit.md`),
    node_path.posix.join(notebook_directory, `${notebook_name}.archive.md`),
    ...(git_facts.record_files || [])
  ];
  const configuration_files = [config_path === undefined
    ? 'ag.json'
    : node_path.relative(project_root, config_path).split(node_path.sep).join('/')];
  const bootstrap_files = prior_replies.length === 0 && !has_captured_baseline
    ? [
        ...(changed_files.includes('.gitignore') ? ['.gitignore'] : []),
        ...(canonical_bootstrap_config(project_root, notebook_path, config_path, active_host) ? configuration_files : [])
      ]
    : [];
  const { document_effects, error: metadata_error } = completion_metadata(current_round.reply_text || '', { project_root, notebook_path, workspace_dir, config_path, ask: current_round.id });
  if (metadata_error) return { status: 'required', reason: 'invalid completion metadata', error: metadata_error };
  if (changed_files.includes(configuration_files[0]) && language_only_config_change(project_root, config_path, git_facts.baseline, active_host)) {
    document_effects.push({ path: configuration_files[0], effect: 'non-behavioral', reason: 'validated configuration differs from the Git baseline only in reply language' });
  }
  // Recognize bounded imperative clauses, never quoted or hypothetical text.
  // Other clear contextual waivers retain the host-recorded control fallback.
  const owner_commands = plain_record_text(ask_text);
  const natural_skip = owner_commands.split(/\r?\n/u).map(line => line.trim()).find(line => {
    const unquoted = line.replace(/`[^`]*`|"[^"\n]*"|“[^”\n]*”|'[^'\n]*'/gu, ' [quoted] ');
    if (/^[>]|[?]|\b(?:example|hypothetical|if|unless|should|would|could)\b|\b(?:do not|don't|never)\s+(?:skip|implement|fix|build|create|add|update)/iu.test(unquoted)) return false;
    const clauses = /^(?:implement|fix|build|create|add|update)\b/iu.test(unquoted)
      ? unquoted.split(/[.!;]\s+/u) : [unquoted];
    return clauses.some(clause => {
      const command = clause.trim().replace(/[,;]\s*never over[- ](?:engineering|egnieering)[.!]?$/iu, '').replace(/[.!]$/u, '').trim();
      if (/^(?:please\s+)?(?:skip[- ](?:the\s+)?(?:final\s+)?(?:external\s+)?(?:review|cross[- ]check)|no\s+(?:external\s+)?(?:review|cross[- ]check)|(?:stop|cancel)\s+(?:the\s+)?(?:background\s+)?reviewer\s+and\s+(?:continue|finish))$/iu.test(command)) return true;
      const list = /^(?:please\s+)?skip\s+(.+)$/iu.exec(command)?.[1];
      if (!list) return false;
      const items = list.split(/\s*,\s*(?:and\s+)?|\s+and\s+/iu);
      return items.length > 1 && items.some(item => /^(?:external review|cross[- ]check)$/iu.test(item))
        && items.every(item => /^(?:ag(?: pipeline)?|delegation|streams?|external review|cross[- ]check)$/iu.test(item));
    });
  });
  const skip_tradeoff = /^skip-review:\s*(\S[^\r\n]*)$/imu.exec(owner_commands)?.[1]?.trim() || natural_skip;
  if (skip_tradeoff) {
    return {
      status: 'skip-review',
      reason: `owner authorized final review skip: ${skip_tradeoff}`,
      owner_authorized: true
    };
  }
  let switches = {};
  try { switches = JSON.parse(node_fs.readFileSync(config_path || node_path.join(project_root, 'ag.json'), 'utf8')).switches || {}; } catch { /* Configuration validation reports missing or malformed settings separately. */ }
  const allowed_worker = switches['allowed-worker'] || ['external', 'host'];
  const review_policy = switches['review-policy'] || 'require-independent';
  const independent_required = /^(?:review-requirement:\s*independent|(?:please\s+)?(?:require|use)\s+(?:an?\s+)?(?:independent|separate|second)\s+review(?:er)?)[.!]?$/imu.test(owner_commands);
  const enforced_read_only_required = /^review-requirement:\s*enforced-read-only[.!]?$/imu.test(owner_commands);
  const fresh_context_required = /^review-requirement:\s*fresh-context[.!]?$/imu.test(owner_commands);
  const facts = { changed_files, record_files, configuration_files, bootstrap_files, document_effects, ignored_working_paths: git_facts.ignored_working_paths || [], allowed_worker, review_policy, independent_required, enforced_read_only_required, fresh_context_required };
  const implementation_changed = changed_files.some(file => review_eligible(file, facts));
  if (implementation_changed || /^Review record:/imu.test(completion_metadata(current_round.reply_text || '', { project_root, notebook_path, workspace_dir, config_path, ask: current_round.id }).text) || independent_required || enforced_read_only_required || fresh_context_required) return { ...facts, status: 'required', reason: implementation_changed ? 'source, test, behavior-changing configuration, software instructions, or undeclared document effect detected from Git' : 'current review evidence or explicit review requirement needs validation' };
  return {
    status: 'not-requested',
    reason: 'no review-eligible change detected from Git',
    ...facts
  };
};

const collect = ({
  project_root = process.cwd(),
  notebook_path = 'devlog.md',
  config_path,
  active_host,
  devlog_text,
  transcript_path,
  terminal_output,
  require_status_projection,
  now_ms = Date.now(),
  ignore_paths = [],
  candidate_paths = []
} = {}) => {
  const root = node_path.resolve(project_root);
  const { parsed, current_round, ask_id } = current_round_info(devlog_text ?? '');
  const config_file = config_path === undefined ? node_path.join(root, 'ag.json') : config_path;
  let workspace_dir;
  try {
    workspace_dir = JSON.parse(node_fs.readFileSync(config_file, 'utf8'))?.switches?.['workspace-dir'];
  } catch (error) {
    workspace_dir = undefined;
  }

  const repository = require('./repository-state').detect(root);
  const record = tracker_facts(root, current_round, ask_id, notebook_path, workspace_dir, repository);
  const push = gather_push(root);
  const status_output = terminal_output !== undefined ? terminal_output : gather_terminal_output(transcript_path);
  const git_status = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const scope = require('./notebook-write.js').read_input_scope(root, notebook_path, active_host, ask_id);
  const ignored = new Set([...ignore_paths, ...(scope?.ignored_paths || []), ...(scope ? [scope.file] : [])]
    .map(file => String(file).split(node_path.sep).join('/')));
  const baseline_round = current_round?.index === undefined ? undefined : parsed.rounds.slice(0, current_round.index).filter(round => round.reply_text.length > 0).at(-1);
  const baseline = scope?.head || (baseline_round === undefined
    ? ''
    : git(root, ['log', '-1', '--format=%H', '-S', `# ← Reply / ${baseline_round.id}`, '--', notebook_path]));
  const baseline_committed_files = /^[0-9a-f]{40}$/u.test(baseline)
    ? git(root, ['diff', '--name-only', `${baseline}..HEAD`]).split('\n').filter(Boolean)
    : [];
  const cleanup_boundary = completed_cleanup_boundary(root, current_round, workspace_dir, baseline_committed_files);
  const effective_baseline = cleanup_boundary ?? baseline;
  const committed_files = /^[0-9a-f]{40}$/u.test(effective_baseline)
    ? git(root, ['diff', '--name-only', `${effective_baseline}..HEAD`]).split('\n').filter(Boolean)
    : baseline_committed_files;
  // 本輪已提交或即將提交的檔案，都不能因輸入時已存在而漏審。
  for (const file of [...committed_files, ...candidate_paths]) ignored.delete(file);
  const working_files = parse_porcelain_paths(git_status).filter(file => !ignored.has(file));
  const changed_files = [...new Set([...committed_files, ...working_files])];
  const changed_lines = changed_line_count(root, effective_baseline, working_files);
  const repository_state = {
    ...repository,
    head: push.head,
    branch: push.branch,
    status: git_status,
    baseline: effective_baseline,
    committed_files,
    working_files,
    changed_files,
    push
  };
  const decision = review_decision(root, notebook_path, devlog_text ?? '', workspace_dir, node_fs.existsSync(config_file) ? config_file : undefined, active_host, {
    parsed,
    changed_files,
    working_files,
    changed_lines,
    captured_baseline: scope?.head,
    baseline: effective_baseline,
    ignored_working_paths: [...ignored],
    record_files: record.tracker?.path && record.tracker.path !== 'ambiguous' ? [record.tracker.path] : []
  });

  return {
    devlog_text,
    project_root: root,
    notebook_path,
    config_path: node_fs.existsSync(config_file) ? config_file : undefined,
    active_host,
    require_status_projection,
    now_ms,
    push,
    repository_state,
    terminal_output: status_output,
    ...ag_settings.read_notebook_controls(root, notebook_path),
    tracker: record.tracker,
    checkpoint_verification: gather_checkpoint_verification(root, devlog_text ?? '', record.work, notebook_path),
    review_decision: decision,
    current_ask: ask_id,
    work_key: record.work?.work_key,
    work_root: record.work?.root,
    review_artifact_location: record.work?.root === undefined ? undefined : `${record.work.root}/`,
    git_paths: { baseline: effective_baseline, committed: committed_files, working: working_files, changed: changed_files, changed_lines }
  };
};

const validate_candidate = ({ devlog_text, context = {} } = {}) => {
  if (context.captured_context === true) return validate_candidate_facts({ devlog_text, context });
  const can_collect = typeof context.project_root === 'string' || typeof context.notebook_path === 'string' || typeof context.config_path === 'string';
  const derived = can_collect
    ? collect({
      ...context,
      devlog_text,
      terminal_output: context.terminal_output,
      require_status_projection: context.require_status_projection
    })
    : {};
  return lint_round({ ...context, ...derived, devlog_text });
};

const validate_candidate_facts = ({ devlog_text, context = {} } = {}) => lint_round({ ...context, devlog_text });

module.exports = { collect, validate_candidate, validate_candidate_facts };
