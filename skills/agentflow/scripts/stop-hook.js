'use strict';

// Agentflow Stop-hook referee.
//
// The host CLI runs this after the model ends its turn. It is an independent
// final check of the facts that the host can read, and it fails open if its own
// infrastructure has an error. The same completion-context collector is used
// by the earlier candidate check, but this invocation gathers its own final
// snapshot after the Reply has been written.

const node_fs = require('node:fs');
const node_path = require('node:path');
const { lint_round, parse_devlog } = require('./round-linter');
const { collect } = require('./completion-context');

const external_delegate_marker_pattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const read_stdin = () => {
  try {
    return node_fs.readFileSync(0, 'utf8');
  } catch (error) {
    return '';
  }
};

const parse_json = text => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return {};
  }
};

let capturing_prompt = false;

const main = () => {
  const input = parse_json(read_stdin());
  capturing_prompt = input.hook_event_name === 'UserPromptSubmit';

  // Loop guard comes before host validation so a correcting turn launched by an
  // older, host-neutral installed command can still escape the one-retry cycle.
  if (input.stop_hook_active === true) return 0;

  const external_delegate_marker = process.env.AGENTFLOW_EXTERNAL_DELEGATE;
  // A command-scoped delegate must not be mistaken for an owner round. The
  // launcher owns provenance; this boundary validates syntax only. — I-044.
  if (typeof external_delegate_marker === 'string' && external_delegate_marker_pattern.test(external_delegate_marker)) return 0;

  const host_index = process.argv.indexOf('--host');
  const active_host = host_index >= 0 ? process.argv[host_index + 1] : undefined;

  // Installed hook commands MUST carry their owning host explicitly. Runtime
  // marker variables are not part of the shared Stop-hook payload. — I-043.
  if (active_host !== 'codex' && active_host !== 'claude') {
    throw new Error('Stop hook requires --host codex or --host claude');
  }

  // CLAUDE_PROJECT_DIR is Claude-Code-only; every host passes cwd on stdin.
  const project_dir = (active_host === 'claude' ? process.env.CLAUDE_PROJECT_DIR : '') || input.cwd || process.cwd();
  let notebook_path = '.agentflow/devlog.md';
  let config_path = node_path.join(project_dir, 'ag.json');
  const project_name = node_path.basename(project_dir);
  const in_named_worktree = node_path.basename(node_path.dirname(project_dir)) === '.worktrees' && /^[a-z0-9][a-z0-9-]*$/u.test(project_name);
  if (require('./notebook-owner').linked_worktree(project_dir)) {
    const branch = require('node:child_process').spawnSync('git', ['branch', '--show-current'], { cwd: project_dir, encoding: 'utf8' });
    notebook_path = branch.status === 0 ? require('./agf').stream_doc(project_dir, branch.stdout.trim()) : '';
    if (!notebook_path) throw Error('stream notebook is missing for this worktree; restore its canonical notebook before capture');
    config_path = require('./ag-settings').resolve_config_path(project_dir, notebook_path);
    if (!node_fs.existsSync(config_path)) throw Error('stream configuration is missing; restore its notebook/configuration pair before capture');
  } else if (in_named_worktree) {
    const stream_notebook = node_path.posix.join('.agentflow', 'features', project_name, `${project_name}.devlog.md`);
    const stream_config = node_path.join(project_dir, '.agentflow', 'features', project_name, 'ag.json');
    if (node_fs.existsSync(node_path.join(project_dir, stream_notebook)) && node_fs.existsSync(stream_config)) {
      notebook_path = stream_notebook;
      config_path = stream_config;
    }
  }
  if (node_fs.existsSync(config_path)) {
    try {
      const config = JSON.parse(node_fs.readFileSync(config_path, 'utf8'));
      if (typeof config?.switches?.['target-doc'] === 'string') notebook_path = config.switches['target-doc'];
    } catch (error) {
      // The linter reports malformed established configuration.
    }
  }
  const devlog_path = node_path.join(project_dir, notebook_path);

  // Not a devlog session — nothing to referee.
  if (!node_fs.existsSync(devlog_path)) return 0;

  if (input.hook_event_name === 'UserPromptSubmit') {
    const current = parse_devlog(node_fs.readFileSync(devlog_path, 'utf8')).rounds.at(-1);
    if (!current || current.reply_text.trim()) {
      // Missing bookkeeping must not prevent the owner from requesting repair.
      // Leave history and ownership untouched; the agent receives the prompt.
      process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `The user's instruction was not saved in ${notebook_path}: the notebook has no open Ask. Continue with the submitted request. Repair the missing Ask and capture the instruction before further notebook writes, preserving prior history and other sessions' ownership. Do not record this hook notice as user input.`,
      } }) + '\n');
      return 0;
    }
    let result;
    try {
      result = require('./notebook-write.js').append_input({
        root: project_dir, notebook: notebook_path, text: input.prompt,
        host: active_host,
        session: input.session_id,
        message_id: input.turn_id ? `${input.session_id || ''}:${input.turn_id}` : undefined,
      });
    } catch (error) {
      if (error.code !== 'AG_NOTEBOOK_OWNER') throw error;
      // Refuse unauthorized notebook writes, not delivery of the owner's request.
      process.stdout.write(JSON.stringify({ hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: `The user's instruction was not saved in ${notebook_path}: notebook ownership prevented capture. Continue with the submitted request, including any no-ag instruction. Do not mutate this notebook or adopt ownership without resolving the ownership conflict and establishing owner authorization. Inspect ownership before notebook recovery. Diagnostic: ${error.message}. Do not record this hook notice as user input.`,
      } }) + '\n');
      return 0;
    }
    const round = parse_devlog(node_fs.readFileSync(devlog_path, 'utf8')).rounds.at(-1);
    const fast_lane = require('./fast-lane.js').parse_fast_lane(round?.owner_text);
    const route_notice = fast_lane ? ` Fast-lane ${fast_lane.state}: work directly without AG, delegation, new streams, external review, or pipeline approval/artifact requirements. Keep host self-review, necessary tests, trackers, timed WIP checkpoints, detailed reports, and integrity checks. ${fast_lane.state === 'pending' ? 'Wait for the task; leave this Ask open without a Reply or closeout.' : 'This applies through this task’s closeout, then expires.'}` : '';
    const capture_state = result.inserted ? 'was saved' : 'was already present; no duplicate was written'
    const session_notice = input.session_id ? ` Hook session: ${input.session_id}.` : ''
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: `The user's instruction ${capture_state} in ${notebook_path}, ${result.ask}.${session_notice} Read the current Ask and address all its instructions together. Do not record this hook notice as user input.${route_notice}`,
    } }) + '\n');
    return 0;
  }

  const devlog_text = node_fs.readFileSync(devlog_path, 'utf8');
  const rounds = parse_devlog(devlog_text).rounds;
  if (rounds.length === 1 && ['', '+'].includes(rounds[0].ask_text.trim()) && !rounds[0].reply_text.trim() && !rounds[0].wip_text.trim()) return 0;
  const context = collect({
    project_root: project_dir,
    notebook_path,
    config_path: node_fs.existsSync(config_path) ? config_path : undefined,
    active_host,
    devlog_text,
    transcript_path: input.transcript_path,
    require_status_projection: true,
    now_ms: Date.now()
  });
  const result = lint_round(context);

  if (result.ok) {
    const cleanup = require('./completion-cleanup').sweep_completion_records({ project_root: project_dir, notebook_path, config_path });
    if (cleanup.status === 'error') process.stderr.write('Agentflow completion cleanup skipped: ' + cleanup.reason + '\n');
    return 0;
  }

  const parsed = parse_devlog(devlog_text);
  const current_round = parsed.rounds.filter(round => round.text === parsed.last_round).at(-1);
  const active_round = current_round !== undefined && current_round.reply_text.trim() === '';
  const active_blocking_ids = new Set(['round_boundaries', 'configuration_valid']);
  const failed = result.checks.filter(check => check.status === 'fail' && (!active_round || active_blocking_ids.has(check.id)));
  if (failed.length === 0) {
    const warnings = result.checks.filter(check => check.status === 'fail');
    process.stderr.write('Agentflow active-round warning — editable progress records need attention:\n');
    warnings.forEach(check => process.stderr.write(`  - ${check.id}: ${check.detail}\n`));
    return 0;
  }
  process.stderr.write('Agentflow round-linter blocked this round — a checked rule was broken:\n');
  failed.forEach(check => process.stderr.write(`  - ${check.id}: ${check.detail}\n`));
  process.stderr.write('Keep the current round open, fix these facts, and run the completion check again.\n');
  return 2;
};

// Fail-open: a bug in the referee must never brick the owner session.
let exit_code = 0;
try {
  exit_code = main();
} catch (error) {
  // Logging infrastructure must not prevent the owner from requesting repair.
  process.stderr.write(`Agentflow hook error: ${error.message}\n`);
  if (capturing_prompt) process.stdout.write(JSON.stringify({ hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: `Automatic notebook capture did not complete. Continue with the submitted request, including any no-ag instruction. The instruction may already be saved if a later step failed; inspect the current Ask before retrying capture. Preserve history, existing locks and other sessions' ownership; do not force a notebook write or ownership takeover. Diagnostic: ${error.message}. Do not record this hook notice as user input.`,
  } }) + '\n');
  exit_code = 0;
}

process.exit(exit_code);
