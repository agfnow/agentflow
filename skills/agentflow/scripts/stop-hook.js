'use strict';

// Agentflow Stop-hook referee.
//
// The host CLI runs this AFTER the model ends its turn — the CLI runs it, not the
// model, so the model cannot skip it, edit its verdict, or argue it out of failing.
// Claude Code and Codex share the same Stop-hook contract (stdin JSON, exit 2
// blocks with stderr fed back to the model, stop_hook_active loop guard), so one
// script serves both; any other coding client (e.g. opencode) that can run a
// command after a turn and pass the same fields works too. The hook gathers the
// true facts only the host can see (the real wall clock and the real git-push
// state), then asks round-linter.js whether the last devlog round told the truth
// about them. A dishonest round makes the hook exit 2, and the host hands the
// linter's complaint back to the model so it must write a correcting round.
//
// Input: Stop-hook JSON on stdin (session_id, transcript_path, cwd,
//        stop_hook_active, hook_event_name). See scripts/README.md.
// Exit:  0 = let the turn end (honest, or nothing to check).
//        2 = block; stderr text is fed back to the model.
//
// Safety: the referee NEVER wedges a session over its own bug — any internal error
// exits 0 (fail-open). It only ever BLOCKS on a fact the linter confirmed dishonest.

const node_fs = require('node:fs');
const node_path = require('node:path');
const { execFileSync } = require('node:child_process');
const { lint_round } = require('./round-linter');

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

const git = (project_dir, args) => {
  try {
    return execFileSync('git', args, { cwd: project_dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    return '';
  }
};

// True facts the host can read for free: does a remote exist, and is local HEAD
// fully pushed to its upstream. exit_code 0 means "everything committed is pushed".
const gather_push = project_dir => {
  const remote_exists = git(project_dir, ['remote']).length > 0;

  if (!remote_exists) {
    return { remote_exists: false, exit_code: 0 };
  }

  const has_upstream = git(project_dir, ['rev-parse', '--abbrev-ref', '@{u}']).length > 0;

  if (!has_upstream) {
    return { remote_exists: true, exit_code: 1 };
  }

  const unpushed = git(project_dir, ['rev-list', '@{u}..HEAD', '--count']);

  return { remote_exists: true, exit_code: unpushed === '0' ? 0 : 1 };
};

const main = () => {
  const input = parse_json(read_stdin());

  // Loop guard: if we already blocked once and the model is re-running because of
  // this very hook, do not block again — let the corrected turn end.
  if (input.stop_hook_active === true) {
    return 0;
  }

  // CLAUDE_PROJECT_DIR is Claude-Code-only; every host passes cwd on stdin.
  const project_dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const devlog_path = node_path.join(project_dir, 'devlog.md');

  // Not a devlog session — nothing to referee.
  if (!node_fs.existsSync(devlog_path)) {
    return 0;
  }

  const devlog_text = node_fs.readFileSync(devlog_path, 'utf8');

  // Only the always-safe, self-gating facts run on every turn:
  //  - now_ms lets the linter reject a faked (future / stale) timestamp.
  //  - push  lets the linter reject a false "pushed" claim (the check self-gates
  //          on the word "pushed", so honest rounds without the word always pass).
  // Terminal-one-line, invented-Ask, pipeline-artifact, and settings checks need
  // facts the hook cannot supply safely yet (they would false-block plain chat
  // turns), so they stay "skip". See README — deepening these is future work.
  const context = {
    devlog_text,
    now_ms: Date.now(),
    push: gather_push(project_dir)
  };

  const result = lint_round(context);

  if (result.ok) {
    return 0;
  }

  const failed = result.checks.filter(check => check.status === 'fail');

  process.stderr.write('Agentflow round-linter blocked this round — the devlog record is not honest:\n');
  failed.forEach(check => process.stderr.write(`  - ${check.id}: ${check.detail}\n`));
  process.stderr.write('Open a correcting round that fixes these facts, then end your turn again.\n');

  return 2;
};

// Fail-open: a bug in the referee must never brick the owner's session.
let exit_code = 0;

try {
  exit_code = main();
} catch (error) {
  exit_code = 0;
}

process.exit(exit_code);
