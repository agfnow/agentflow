'use strict';

const node_fs = require('node:fs');
const node_path = require('node:path');

const ask_heading_pattern = /^# → Ask \/ (A-\d+)(?: \([^)\r\n]*\))?[ \t]*\r?$/gm;
const stamp_pattern = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?/g;
const artifact_stamp_pattern = /^\s*\* _.+ \(.+\)_\s*$/;
const push_claim_pattern = /\bpushed\b|\bpush succeeded\b/i;
const default_pipeline_files = ['requirements.md', 'spec.md', 'acceptance.md'];
const artifact_authorship_note = 'authorship (dispatched-worker vs coordinator) is not file-checkable; host dispatch-tracking must confirm it';

const make_check = (id, name, status, detail) => ({ id, name, status, detail });

const find_status_block = devlog_text => {
  const status_match = /^# STATUS[ \t]*\r?$/m.exec(devlog_text);

  if (!status_match) {
    return '';
  }

  const status_body = devlog_text.slice(status_match.index + status_match[0].length);
  const boundary_match = /^(?:---[ \t]*|# → Ask \/)/m.exec(status_body);

  return boundary_match ? status_body.slice(0, boundary_match.index) : status_body;
};

const parse_settings = devlog_text => {
  const settings_line = find_status_block(devlog_text)
    .split(/\r?\n/)
    .find(line => line.trim().startsWith('Settings:'));

  if (settings_line === undefined) {
    return null;
  }

  return settings_line
    .trim()
    .slice('Settings:'.length)
    .split(',')
    .reduce((settings, pair) => {
      const equals_index = pair.indexOf('=');

      if (equals_index < 0) {
        return settings;
      }

      const key = pair.slice(0, equals_index).trim();

      if (key.length > 0) {
        settings[key] = pair.slice(equals_index + 1).trim();
      }

      return settings;
    }, {});
};

// Stamps are read ONLY from stamp-shaped lines (the Reply stamp line and
// checkpoint headings), never from arbitrary prose: an owner ASKING about an
// old date must not fail a faithful reply as "too old".
const stamp_line_pattern = /^\s*(?:\*\s*_|##\s+Progress checkpoint|##\s*\[WIP-\d+\]\s*Checkpoint)/;

const extract_stamps = round_text =>
  round_text
    .split(/\r?\n/)
    .filter(line => stamp_line_pattern.test(line))
    .flatMap(line => [...line.matchAll(stamp_pattern)].map(match => match[0]));

const parse_devlog = devlog_text => {
  const ask_matches = [...devlog_text.matchAll(ask_heading_pattern)];
  const ask_ids = ask_matches.map(match => match[1]);
  const last_ask_match = ask_matches[ask_matches.length - 1];
  const last_round = last_ask_match ? devlog_text.slice(last_ask_match.index) : '';

  return {
    settings: parse_settings(devlog_text),
    ask_ids,
    last_round,
    stamps: extract_stamps(last_round)
  };
};

const lint_terminal_output = terminal_output => {
  if (terminal_output === undefined) {
    return make_check('terminal_one_line', 'Terminal output is one line', 'skip', 'terminal output was not provided');
  }

  const trimmed_output = String(terminal_output).trim();
  const line_count = trimmed_output.length === 0 ? 0 : trimmed_output.split(/\r\n|\r|\n/).length;
  const reasons = [];

  if (/[\r\n]/.test(trimmed_output)) {
    reasons.push(`found ${line_count} lines; expected one line`);
  }

  if (!trimmed_output.endsWith(' updated')) {
    reasons.push('output must end with " updated"');
  }

  return reasons.length === 0
    ? make_check('terminal_one_line', 'Terminal output is one line', 'pass', 'one line ending with " updated"')
    : make_check('terminal_one_line', 'Terminal output is one line', 'fail', reasons.join('; '));
};

const lint_timestamps = (devlog_text, now_ms, future_skew_min, max_age_hours) => {
  const stamps = parse_devlog(devlog_text).stamps;

  if (stamps.length === 0) {
    return make_check('timestamps_sane', 'Timestamps are sane', 'pass', 'no timestamps found');
  }

  const future_limit_ms = now_ms + future_skew_min * 60000;
  const age_limit_ms = now_ms - max_age_hours * 3600000;
  const bad_stamps = stamps.reduce((bad, stamp) => {
    const stamp_ms = Date.parse(`${stamp.replace(' ', 'T')}+08:00`);
    const reasons = [];

    if (!Number.isFinite(stamp_ms)) {
      reasons.push('not a real date');
    }

    if (stamp_ms > future_limit_ms) {
      reasons.push('future');
    }

    if (stamp_ms < age_limit_ms) {
      reasons.push('too old');
    }

    if (reasons.length > 0) {
      bad.push(`${stamp} (${reasons.join(', ')})`);
    }

    return bad;
  }, []);

  return bad_stamps.length === 0
    ? make_check('timestamps_sane', 'Timestamps are sane', 'pass', `${stamps.length} timestamp(s) are within the allowed window`)
    : make_check('timestamps_sane', 'Timestamps are sane', 'fail', `bad timestamps: ${bad_stamps.join('; ')}`);
};

const check_artifact = (artifact_dir, file_name) => {
  const file_path = node_path.join(artifact_dir, file_name);

  if (!node_fs.existsSync(file_path)) {
    return `${file_name}: missing`;
  }

  try {
    const file_stat = node_fs.statSync(file_path);

    if (!file_stat.isFile() || file_stat.size === 0) {
      return `${file_name}: empty`;
    }

    const file_text = node_fs.readFileSync(file_path, 'utf8');
    const first_lines = file_text.split(/\r\n|\r|\n/).slice(0, 5);

    if (!first_lines.some(line => artifact_stamp_pattern.test(line))) {
      return `${file_name}: unstamped`;
    }
  } catch (error) {
    return `${file_name}: unreadable`;
  }

  return null;
};

const lint_pipeline_artifacts = pipeline => {
  if (pipeline === undefined || pipeline === null) {
    return make_check('pipeline_artifacts', 'Pipeline artifacts exist', 'skip', 'pipeline context was not provided');
  }

  const required_files = Array.isArray(pipeline.require) && pipeline.require.length > 0
    ? pipeline.require
    : default_pipeline_files;
  const failures = required_files
    .map(file_name => check_artifact(pipeline.artifact_dir, file_name))
    .filter(Boolean);
  const detail = failures.length === 0
    ? `${required_files.length} required artifact(s) pass`
    : failures.join('; ');

  return make_check('pipeline_artifacts', 'Pipeline artifacts exist', failures.length === 0 ? 'pass' : 'fail', `${detail}; ${artifact_authorship_note}`);
};

const lint_no_invented_ask = (devlog_text, owner_ask_ids) => {
  if (owner_ask_ids === undefined) {
    return make_check('no_invented_ask', 'No invented Ask ids', 'skip', 'owner Ask ids were not provided');
  }

  const devlog_ask_ids = parse_devlog(devlog_text).ask_ids;
  const invented_ids = devlog_ask_ids.filter(ask_id => !owner_ask_ids.includes(ask_id));

  return invented_ids.length === 0
    ? make_check('no_invented_ask', 'No invented Ask ids', 'pass', 'all devlog Ask ids were delivered by the owner')
    : make_check('no_invented_ask', 'No invented Ask ids', 'fail', `Ask ids not delivered by the owner: ${invented_ids.join(', ')}`);
};

// An honest "not pushed / nothing is pushed / push pending" statement is a
// DENIAL, not a success claim; strip denials before looking for a claim.
const push_denial_pattern = /\b(?:not(?:hing)?(?:\s+\w+){0,2}\s+|never\s+|no\s+|n't\s+|cannot\s+be\s+|pending\s+)push(?:ed)?\b|\bpush(?:ed)?\s+(?:is\s+|was\s+)?(?:pending|refused|rejected|failed|blocked)\b/gi;

const lint_push_claim = (devlog_text, terminal_output, push) => {
  const last_round = parse_devlog(devlog_text).last_round;
  const claim_text = `${terminal_output === undefined ? '' : terminal_output}\n${last_round}`
    .replace(push_denial_pattern, '');

  if (!push_claim_pattern.test(claim_text)) {
    return make_check('push_claim_valid', 'Push claim is valid', 'pass', 'no push-success claim found');
  }

  if (push === undefined || push === null) {
    return make_check('push_claim_valid', 'Push claim is valid', 'skip', 'push context is required to verify the claim');
  }

  const push_is_valid = push.remote_exists === true && push.exit_code === 0;

  return push_is_valid
    ? make_check('push_claim_valid', 'Push claim is valid', 'pass', 'push claim matches the host result')
    : make_check('push_claim_valid', 'Push claim is valid', 'fail', 'push claim does not match the host result');
};

const lint_status_settings = (devlog_text, expected_settings) => {
  if (expected_settings === undefined) {
    return make_check('status_settings_match', 'STATUS settings match', 'skip', 'expected settings were not provided');
  }

  const found_settings = parse_devlog(devlog_text).settings;

  if (found_settings === null) {
    return make_check('status_settings_match', 'STATUS settings match', 'fail', 'the devlog has no Settings line');
  }

  const mismatches = Object.keys(expected_settings)
    .filter(key => String(found_settings[key]) !== String(expected_settings[key]))
    .map(key => `${key}: expected ${expected_settings[key]}, found ${found_settings[key] === undefined ? '<missing>' : found_settings[key]}`);

  return mismatches.length === 0
    ? make_check('status_settings_match', 'STATUS settings match', 'pass', 'all expected STATUS settings match')
    : make_check('status_settings_match', 'STATUS settings match', 'fail', `mismatched settings: ${mismatches.join('; ')}`);
};

const lint_round = context => {
  const devlog_text = context.devlog_text;
  const now_ms = context.now_ms === undefined ? Date.now() : context.now_ms;
  const future_skew_min = context.future_skew_min === undefined ? 5 : context.future_skew_min;
  const max_age_hours = context.max_age_hours === undefined ? 24 : context.max_age_hours;
  const checks = [
    lint_terminal_output(context.terminal_output),
    lint_timestamps(devlog_text, now_ms, future_skew_min, max_age_hours),
    lint_pipeline_artifacts(context.pipeline),
    lint_no_invented_ask(devlog_text, context.owner_ask_ids),
    lint_push_claim(devlog_text, context.terminal_output, context.push),
    lint_status_settings(devlog_text, context.expected_settings)
  ];

  return {
    ok: checks.every(check => check.status !== 'fail'),
    checks
  };
};

const run_cli = () => {
  const args = process.argv.slice(2);
  const devlog_path = args[0];
  const context_index = args.indexOf('--context');

  if (devlog_path === undefined) {
    console.error('Usage: node portal/round-linter.js <devlog-path> [--context <json-path>]');
    process.exit(1);
  }

  const devlog_text = node_fs.readFileSync(devlog_path, 'utf8');
  const context_json = context_index >= 0
    ? JSON.parse(node_fs.readFileSync(args[context_index + 1], 'utf8'))
    : {};
  const context = { ...context_json, devlog_text };
  const result = lint_round(context);

  result.checks.forEach(check => {
    console.log(`${check.status.toUpperCase()}  ${check.id}  ${check.detail}`);
  });

  console.log(`${result.ok ? 'PASS' : 'FAIL'}  summary  ${result.ok ? 'all checks passed' : 'one or more checks failed'}`);
  process.exit(result.ok ? 0 : 1);
};

module.exports = { parse_devlog, lint_round };

if (require.main === module) {
  run_cli();
}
