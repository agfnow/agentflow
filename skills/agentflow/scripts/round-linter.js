'use strict';

const node_fs = require('node:fs');
const node_path = require('node:path');
const ag_settings = require('./ag-settings.js');
const delegation_route = require('./delegation-route.js');
const suite_evidence = require('./suite-evidence.js');
const queue_contract = require('./queue-contract.js');
const model_sensitive_harness = require('./model-sensitive-harness.js');
const model_stable_harness = require('./model-stable-harness.js');

const ask_heading_pattern = /^# → Ask \/ (A-\d+)(?: \([^)\r\n]*\))?[ \t]*\r?$/gm;
const stamp_pattern = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?/g;
const artifact_opening_stamp_pattern = /^\* _(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \(([^\/\r\n]+)\/([^\/\r\n]+)\)_$/;
const artifact_self_check_pattern = /^Self-check:\s+\S.*$/;
const artifact_identity_limits = { model: 128, effort: 32 };
const artifact_freshness_ms = 5 * 60 * 1000;
const max_artifact_bytes = 1024 * 1024;
const max_context_bytes = 1024 * 1024;
const advisor_roster = Object.freeze(['requirements', 'codewalk', 'explore', 'spike', 'spec', 'security-scan', 'acceptance', 'learn']);
const advisor_roster_text = advisor_roster.join(', ');
const push_claim_pattern = /\bpushed\b|\bpush succeeded\b/i;
const reply_heading_pattern = /^# ← Reply \/ A-\d+(?: \([^)\r\n]*\))?[ \t]*\r?$/m;
const section_heading_pattern = /^##[ \t]+(.+?)[ \t]*\r?$/gm;
const required_reply_headings = ['## [SUMMARY]', '## Questions (batched — each with a suggested default)'];
const final_report_heading = '[FINAL REPORT]';
const default_pipeline_files = ['requirements-report.md', 'spec-report.md', 'acceptance-report.md'];
const artifact_authorship_note = 'authorship (dispatched-worker vs coordinator) is not file-checkable; host dispatch-tracking must confirm it';
const max_review_attempts = 3;
const default_large_work_minutes = 120;
const max_checkpoint_count = 10;
const mandatory_security_classes = Object.freeze([
  'data-loss',
  'destructive-behavior',
  'credential-exposure',
  'central-requested-behavior-failure'
]);
const route_values = Object.freeze(['direct', 'selected_advisors', 'full_pipeline', 'blocked']);
const allow_ag_values = Object.freeze(['on', 'off', 'ask']);
const owner_confirmation_values = Object.freeze(['not_required', 'pending', 'approved', 'rejected']);
const executor_values = Object.freeze(['direct_coordinator', 'supported_internal', 'different_family_external', 'generic_external']);
const formal_repair_spans = Object.freeze([
  'opening stamp',
  'exact heading',
  'path label',
  'final boundary',
  'stamp',
  'heading',
  'path',
  'boundary'
]);
const defect_class_values = Object.freeze(['behavior', 'material-evidence-origin', 'cosmetic-record']);
const material_claim_kinds = Object.freeze([
  'changed_paths',
  'tests',
  'commits',
  'behavior',
  'security',
  'acceptance',
  'limitations',
  'push'
]);

const round_check_order = Object.freeze([
  'terminal_one_line',
  'timestamps_sane',
  'reply_structure',
  'round_boundaries',
  'next_ask_scaffold',
  'tracker',
  'checkpoint_still_to_do',
  'checkpoint_verification',
  'round_reporting',
  'direct_route_completion',
  'evidence_classification',
  'material_claims',
  'report_only_validation',
  'route_decision',
  'executor_decision',
  'large_work_route',
  'queue_contract',
  'review_preflight',
  'review_attempts',
  'progress_boundaries',
  'security_disposition',
  'acceptance_disposition',
  'formal_repair',
  'pipeline_artifacts',
  'quality_gate',
  'cross_check',
  'no_invented_ask',
  'push_claim_valid',
  'configuration_valid',
  'status_projection_valid'
]);

const make_check = (id, name, status, detail) => ({ id, name, status, detail });

const invalid_advisor_selection = detail => ({
  valid: false,
  selected: null,
  error: detail + '; accepted roster: ' + advisor_roster_text
});

const parse_advisor_selection = selection => {
  if (selection === undefined) {
    return { valid: true, selected: null, error: null };
  }

  if (typeof selection !== 'string') {
    return invalid_advisor_selection('advisors selection must be a comma-separated string');
  }

  if (selection.trim().length === 0) {
    return invalid_advisor_selection('advisors selection is empty');
  }

  const tokens = selection.split(',').map(token => token.trim());
  const empty_index = tokens.findIndex(token => token.length === 0);

  if (empty_index >= 0) {
    return invalid_advisor_selection('advisors selection has an empty token at position ' + (empty_index + 1));
  }

  const unknown = tokens.filter(token => !advisor_roster.includes(token));

  if (unknown.length > 0) {
    return invalid_advisor_selection('advisors selection has unknown name(s): ' + [...new Set(unknown)].join(', '));
  }

  return {
    valid: true,
    selected: [...new Set(tokens)],
    error: null
  };
};

// This is a pure validation seam for immutable controlling briefs and amendments.
// It does not store routing state or merge omitted advisors back into a selection.
const parse_advisor_authority = records => {
  if (!Array.isArray(records) || records.length === 0) {
    return invalid_advisor_selection('advisor authority must contain at least one immutable record');
  }

  const seen_ids = new Set();
  let previous_id;
  let resolved;

  for (const record of records) {
    if (record === null || typeof record !== 'object' || typeof record.id !== 'string' || record.id.trim().length === 0) {
      return invalid_advisor_selection('each advisor authority record needs a non-empty id');
    }

    if (seen_ids.has(record.id)) {
      return invalid_advisor_selection('advisor authority repeats immutable record id: ' + record.id);
    }

    if (previous_id === undefined) {
      if (record.supersedes !== undefined) {
        return invalid_advisor_selection('the first advisor authority record cannot supersede another record');
      }
    } else if (record.supersedes !== previous_id) {
      return invalid_advisor_selection('advisor authority amendment must supersede ' + previous_id);
    }

    const parsed = parse_advisor_selection(record.selection);

    if (!parsed.valid) {
      return invalid_advisor_selection('advisor authority ' + record.id + ' is invalid: ' + parsed.error);
    }

    seen_ids.add(record.id);
    previous_id = record.id;
    resolved = { selected: parsed.selected, source: record.id };
  }

  return { valid: true, selected: resolved.selected, source: resolved.source, error: null };
};

const nonempty_text = value => typeof value === 'string' && value.trim().length > 0;

const string_array = value => Array.isArray(value) && value.every(item => nonempty_text(item));

const explicit_pipeline_operations = new Set(['ag', 'agentflow', 'all-in', 'make-plans']);

const route_reduced_stage_evidence_valid = evidence => {
  if (!Array.isArray(evidence)) return false;
  return evidence.every(item => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return false;
    const stage_id = item.stage_id ?? item.stage ?? item.id;
    const evidence_id = item.accepted_evidence_identity ?? item.evidence_identity ?? item.evidence_id;
    const currentness = item.currentness_check ?? item.current;
    const answered_questions = item.answered_questions ?? item.questions_answered;
    return nonempty_text(stage_id) && nonempty_text(evidence_id) && currentness === true && string_array(answered_questions);
  });
};

const route_stage_id = record => String(record?.stage_id ?? record?.stage ?? record?.id ?? '').toLowerCase();

const codewalk_required = facts => queue_contract.codewalk_required(facts);

const lint_route_decision = facts => {
  if (facts === undefined) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'skip', 'route decision facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route decision must be an object');
  }

  const required = ['operation', 'allow_ag', 'route', 'material_risks', 'named_questions', 'owner_confirmation', 'reason'];
  const missing = required.filter(name => !Object.prototype.hasOwnProperty.call(facts, name));
  if (missing.length > 0) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', `route decision is missing ${missing.join(', ')}`);
  }

  if (!nonempty_text(facts.operation)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route operation must be a non-empty string');
  if (!allow_ag_values.includes(facts.allow_ag)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route allow_ag must be on, off, or ask');
  if (!route_values.includes(facts.route)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route must be exactly direct, selected_advisors, full_pipeline, or blocked');
  if (!string_array(facts.material_risks)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route material_risks must be an array of non-empty risk identifiers');
  if (!string_array(facts.named_questions)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route named_questions must be an array of non-empty questions');
  if (!owner_confirmation_values.includes(facts.owner_confirmation)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route owner_confirmation must be not_required, pending, approved, or rejected');
  if (!nonempty_text(facts.reason)) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'route reason must be a non-empty plain-language string');

  const operation = facts.operation.trim().toLowerCase();
  const explicit_pipeline = explicit_pipeline_operations.has(operation);
  const waiting_for_confirmation = facts.allow_ag === 'ask' && facts.route === 'blocked' && ['pending', 'rejected'].includes(facts.owner_confirmation);
  if (facts.route === 'selected_advisors' && facts.named_questions.length === 0) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'selected_advisors route requires at least one named material question');
  }
  if (facts.route === 'direct' && facts.material_risks.length > 0) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'direct route cannot leave named material risks without an advisor or full pipeline');
  }
  if (explicit_pipeline && facts.allow_ag !== 'off' && facts.route !== 'full_pipeline' && !waiting_for_confirmation) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', `${facts.operation} must select the full_pipeline route when Agentflow is allowed`);
  }
  if (facts.allow_ag === 'off' && explicit_pipeline && facts.route !== 'blocked') {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'allow_ag=off explicit operation must be blocked, not silently downgraded');
  }
  if (facts.allow_ag === 'off' && ['selected_advisors', 'full_pipeline'].includes(facts.route)) {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'allow_ag=off blocks selected-advisor and full-pipeline work before Agentflow starts');
  }
  if (facts.allow_ag === 'ask' && ['selected_advisors', 'full_pipeline'].includes(facts.route) && facts.owner_confirmation !== 'approved') {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'allow_ag=ask requires owner_confirmation=approved before Agentflow starts');
  }
  if (facts.route === 'direct' && facts.owner_confirmation !== 'not_required') {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'direct work must not ask for Agentflow confirmation');
  }

  const pipeline_route = facts.route === 'full_pipeline' || operation === 'make-plans';
  if (pipeline_route) {
    if (typeof facts.brownfield !== 'boolean') return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'full-pipeline and make-plans decisions require a boolean brownfield field');
    if (!Array.isArray(facts.mandatory_stages) || !string_array(facts.mandatory_stages)) {
      return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'full-pipeline and make-plans decisions require an ordered mandatory_stages array');
    }
    if (facts.mandatory_stages.length === 0) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'full-pipeline and make-plans decisions require at least one mandatory stage');
    const codewalk_needed = codewalk_required(facts);
    if (codewalk_needed === null) return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'codewalk trigger facts must be booleans for the named evidence triggers');
    if (facts.brownfield && !facts.mandatory_stages.includes('discovery')) {
      return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'brownfield full-pipeline route must include discovery');
    }
    if (codewalk_needed && !facts.mandatory_stages.includes('codewalk')) {
      return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'codewalk is required because a named evidence trigger is true');
    }
    if (facts.brownfield && codewalk_needed === false && facts.mandatory_stages.includes('codewalk')) {
      return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'brownfield route must not include codewalk when no named evidence trigger is true');
    }
    if (!route_reduced_stage_evidence_valid(facts.reduced_stage_evidence)) {
      return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'reduced_stage_evidence must be an array of current accepted evidence records with answered questions');
    }
    if (facts.brownfield && codewalk_needed === false) {
      if (facts.reduced_stage_evidence.some(record => route_stage_id(record) === 'codewalk')) {
        return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'brownfield route must not dispatch codewalk when no named evidence trigger is true');
      }
      const discovery_record = facts.reduced_stage_evidence.find(record => route_stage_id(record) === 'discovery');
      if (discovery_record === undefined) {
        return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'brownfield route needs one current discovery evidence record when no codewalk trigger is true');
      }
    }
    if (facts.brownfield && codewalk_needed === true) {
      const codewalk_record = facts.reduced_stage_evidence.find(record => route_stage_id(record) === 'codewalk');
      const shared_result = queue_contract.validate_shared_codewalk_record(codewalk_record);
      if (!shared_result.valid) {
        return make_check('route_decision', 'Route decision is explicit and safe', 'fail', `shared codewalk discovery coverage is invalid: ${shared_result.errors.join('; ')}`);
      }
      if (facts.reduced_stage_evidence.some(record => route_stage_id(record) === 'discovery')) {
        return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'triggered brownfield route must use one shared codewalk discovery record; overlapping discovery pass is not allowed');
      }
    }
  }

  if (facts.route === 'blocked' && (facts.owner_confirmation === 'approved' || facts.owner_confirmation === 'not_required') && facts.allow_ag === 'ask') {
    return make_check('route_decision', 'Route decision is explicit and safe', 'fail', 'a blocked allow_ag=ask decision must remain pending or rejected');
  }

  return make_check('route_decision', 'Route decision is explicit and safe', 'pass', `${facts.route} route is explicit; allow_ag=${facts.allow_ag}; ${facts.reason}`);
};

const adapter_supported = (facts, options = {}) => {
  const adapter_id = facts.adapter_id;
  const direct_value = facts.adapter_supported ?? facts.supported_adapter ?? facts.adapter_available;
  if (direct_value !== undefined) return direct_value === true;
  if (facts.adapter && typeof facts.adapter === 'object' && facts.adapter.supported !== undefined) return facts.adapter.supported === true;
  const supported = facts.supported_adapters ?? options.supported_adapters;
  return Array.isArray(supported) && supported.includes(adapter_id);
};

const lint_executor_record = (facts, options = {}) => {
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) return 'executor decision must be an object';

  if (!nonempty_text(facts.stage_id)) return 'executor decision stage_id must be a non-empty stable string';
  if (!executor_values.includes(facts.executor_class)) return 'executor decision executor_class is unsupported';
  if (!string_array(facts.material_risks)) return 'executor decision material_risks must be an array of non-empty risk identifiers';
  if (!nonempty_text(facts.reason)) return 'executor decision reason must be a non-empty plain-language string';
  if (typeof facts.substantive_delegated_capable !== 'boolean') {
    return 'executor decision substantive_delegated_capable must be an actual boolean';
  }
  if (facts.substantive_delegated_capable === true && facts.executor_class === 'direct_coordinator') {
    return 'substantive delegated-capable work must use external-runner-v1 instead of direct_coordinator';
  }

  const delegated = facts.executor_class !== 'direct_coordinator';
	if (facts.executor_class === 'generic_external') {
		const generic_record_error = delegation_route.validate_generic_external_record(facts);
		if (generic_record_error) return generic_record_error;
	} else {
		if (delegated && !nonempty_text(facts.adapter_id)) return 'delegated executor decision requires a non-empty adapter_id';
		if (!delegated && Object.prototype.hasOwnProperty.call(facts, 'adapter_id')) return 'direct_coordinator executor decision must not contain adapter_id';
		if (delegated && !adapter_supported(facts, options)) return 'delegated executor decision requires a supported adapter';
	}

  if (facts.executor_class === 'different_family_external') {
    if (facts.material_risks.length === 0) return 'different_family_external requires at least one named material risk';
    if (!nonempty_text(facts.independence_reason)) return 'different_family_external requires a non-empty independence reason';
  } else if (Object.prototype.hasOwnProperty.call(facts, 'independence_reason') && facts.independence_reason !== undefined && !nonempty_text(facts.independence_reason)) {
    return 'independence_reason must be non-empty when supplied';
  }

  return null;
};

const lint_executor_decision = (facts, options = {}) => {
  if (facts === undefined) {
    return make_check('executor_decision', 'Executor decision is justified and supported', 'skip', 'executor decision facts were not provided');
  }

  const records = Array.isArray(facts)
    ? facts
    : facts && typeof facts === 'object' && Array.isArray(facts.decisions)
      ? facts.decisions
      : [facts];
  if (records.length === 0) return make_check('executor_decision', 'Executor decision is justified and supported', 'fail', 'executor decision must contain at least one record');

  const errors = records.map((record, index) => {
    const error = lint_executor_record(record, options);
    return error === null ? null : `executor decision ${index + 1}: ${error}`;
  }).filter(Boolean);

  return errors.length === 0
    ? make_check('executor_decision', 'Executor decision is justified and supported', 'pass', `${records.length} executor decision(s) use direct or supported internal work unless justified different-family independence is recorded`)
    : make_check('executor_decision', 'Executor decision is justified and supported', 'fail', errors.join('; '));
};

// Stamps are read ONLY from stamp-shaped lines (the Reply stamp line and
// checkpoint headings), never from arbitrary prose: an owner ASKING about an
// old date must not fail a faithful reply as "too old".
const stamp_line_pattern = /^\s*(?:\*\s*_|##\s+Progress checkpoint|##\s*\[(?:WIP|RUN)-\d+\]\s*(?:Checkpoint|Event))/;

const extract_stamps = round_text =>
  round_text
    .split(/\r?\n/)
    .filter(line => stamp_line_pattern.test(line))
    .flatMap(line => [...line.matchAll(stamp_pattern)].map(match => match[0]));

// A completed Reply always appends a fresh EMPTY next-Ask scaffold, so the final
// `# → Ask` heading is normally that scaffold (blank lines plus a bare `+`). An
// ask body counts as empty when every line is blank or a lone `+` bullet marker;
// such a trailing scaffold must be skipped, or the linter grades the empty
// scaffold instead of the Reply the model just wrote.
const is_empty_ask_body = body =>
  body.split(/\r?\n/).every(line => {
    const trimmed = line.trim();

    return trimmed === '' || trimmed === '+';
  });

const parse_devlog = devlog_text => {
  const ask_matches = [...devlog_text.matchAll(ask_heading_pattern)];
  const ask_ids = ask_matches.map(match => match[1]);

  // The round of ask i spans from its heading to the next ask heading (or EOF).
  const round_span = index => {
    const start = ask_matches[index].index;
    const end = index + 1 < ask_matches.length ? ask_matches[index + 1].index : devlog_text.length;

    return devlog_text.slice(start, end);
  };
  const body_of = index => round_span(index).slice(ask_matches[index][0].length);

  // Anchor on the last ask that actually carries round content, walking back over
  // trailing empty next-Ask scaffolds.
  let last_index = ask_matches.length - 1;

  while (last_index >= 0 && is_empty_ask_body(body_of(last_index))) {
    last_index -= 1;
  }

  const last_round = last_index >= 0 ? round_span(last_index) : '';
  const rounds = ask_matches.map((ask, index) => {
    const text = round_span(index);
    const body = text.slice(ask[0].length);
    const reply_match = /^(?:# ← Reply \/ A-\d+(?: \([^\)\r\n]*\))?[ \t]*\r?|## Reply \/ A-\d+\b[^\r\n]*\r?)$/mu.exec(body);
    const checkpoint_match = /^## \[WIP-\d+\] Checkpoint[^\r\n]*$/mu.exec(body);
    const run_match = /^## \[RUN-\d+\] Event[^\r\n]*$/mu.exec(body);
    const boundary = [reply_match?.index, checkpoint_match?.index, run_match?.index]
      .filter(index_value => index_value !== undefined)
      .sort((left, right) => left - right)[0] ?? body.length;
    const reply_start = reply_match?.index;
    const reply_text = reply_start === undefined ? '' : body.slice(reply_start + reply_match[0].length);

    return {
      id: ask[1],
      index,
      start: ask.index,
      end: ask.index + text.length,
      text,
      body,
      ask_text: body.slice(0, boundary),
      wip_text: body.slice(boundary, reply_start ?? body.length),
      reply_text
    };
  });

  return {
    ask_ids,
    last_round,
    stamps: extract_stamps(last_round),
    rounds
  };
};

const checkpoint_heading_line_pattern = /^## \[WIP-\d+\] Checkpoint[^\r\n]*$/gmu;
const run_heading_line_pattern = /^## \[RUN-(\d+)\] Event[^\r\n]*$/gmu;
const run_like_heading_line_pattern = /^## \[RUN-[^\r\n]*$/gmu;
const valid_run_heading_line_pattern = /^## \[RUN-\d+\] Event[^\r\n]*$/u;
const checkpoint_round_pattern = /\(during round (A-\d+)\)[ \t]*$/u;
const bare_scaffold_pattern = /^[ \t]*\+[ \t]*$/u;
const reply_heading_line_pattern = /^(?:# ← Reply \/ A-\d+|## Reply \/ A-\d+\b)/u;

const lint_round_boundaries = devlog_text => {
  const asks = [...devlog_text.matchAll(ask_heading_pattern)];
  const errors = [];
  asks.forEach((ask, index) => {
    const end = index + 1 < asks.length ? asks[index + 1].index : devlog_text.length;
    const body = devlog_text.slice(ask.index + ask[0].length, end);
    for (const checkpoint of body.matchAll(checkpoint_heading_line_pattern)) {
      const declared_round = checkpoint_round_pattern.exec(checkpoint[0])?.[1];
      if (declared_round === undefined) errors.push(`${ask[1]} checkpoint must declare its physical round`);
      else if (declared_round !== ask[1]) errors.push(`${declared_round} checkpoint is physically inside ${ask[1]}`);
    }
    const runs = [...body.matchAll(run_heading_line_pattern)];
    for (const run_like of body.matchAll(run_like_heading_line_pattern)) {
      if (!valid_run_heading_line_pattern.test(run_like[0])) errors.push(`${ask[1]} has a malformed RUN heading`);
    }
    for (const run of runs) {
      const declared_round = checkpoint_round_pattern.exec(run[0])?.[1];
      if (declared_round === undefined) errors.push(`${ask[1]} RUN event must declare its physical round`);
      else if (declared_round !== ask[1]) errors.push(`${declared_round} RUN event is physically inside ${ask[1]}`);
    }
    const run_numbers = runs.map(run => Number(run[1]));
    if (new Set(run_numbers).size !== run_numbers.length) errors.push(`${ask[1]} has duplicate RUN numbers`);
    if (run_numbers.some((number, run_index) => run_index > 0 && number < run_numbers[run_index - 1])) errors.push(`${ask[1]} RUN events are out of physical order`);
    const reply_index = body.search(/^(?:# ← Reply \/|## Reply \/)/mu);
    if (reply_index >= 0 && runs.some(run => run.index > reply_index)) errors.push(`${ask[1]} has a RUN event after its Reply`);

    const body_lines = body.split(/\r?\n/);
    const scaffold_index = body_lines.findIndex(line => bare_scaffold_pattern.test(line));
    if (scaffold_index >= 0 && body_lines.slice(scaffold_index + 1).some(line => line.trim() !== '')) {
      errors.push(`${ask[1]} has agent record material after a bare empty-scaffold marker`);
    }
  });
  return errors.length === 0
    ? make_check('round_boundaries', 'Devlog material stays in its physical Ask', 'pass', `checked ${asks.length} Ask span(s)`)
    : make_check('round_boundaries', 'Devlog material stays in its physical Ask', 'fail', errors.join('; '));
};

const tracker_headings = [
  '## Identity',
  '## Overall state',
  '## Accepted task checklist',
  '## Accepted scope changes',
  '## Current recovery',
  '## Completion proof',
  '## Update meaning'
];

const tracker_escape_regexp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const tracker_sections = text => {
  const headings = [...text.matchAll(/^## [^\r\n]+$/gmu)];
  const sections = {};
  const errors = [];
  let previous = -1;

  tracker_headings.forEach(heading => {
    const matches = headings.filter(match => match[0].trim() === heading);
    if (matches.length !== 1) {
      errors.push(matches.length === 0 ? `tracker is missing ${heading}` : `tracker repeats ${heading}`);
      return;
    }
    if (matches[0].index <= previous) errors.push(`tracker sections are out of order at ${heading}`);
    previous = matches[0].index;
  });

  if (errors.length > 0) return { sections: null, errors };

  tracker_headings.forEach((heading, index) => {
    const start = headings.find(match => match[0].trim() === heading);
    const next = tracker_headings[index + 1] === undefined
      ? { index: text.length }
      : headings.find(match => match[0].trim() === tracker_headings[index + 1]);
    sections[heading] = text.slice(start.index + start[0].length, next.index);
  });
  return { sections, errors };
};

const tracker_field = (section, label) => {
  const pattern = new RegExp(`^- \\*\\*${tracker_escape_regexp(label)}:\\*\\*[ \\t]*([^\\r\\n]*)[ \\t]*$`, 'gmu');
  const matches = [...section.matchAll(pattern)];
  if (matches.length === 0) return { value: undefined, error: `tracker is missing ${label}` };
  if (matches.length > 1) return { value: undefined, error: `tracker repeats ${label}` };
  const value = matches[0][1].trim();
  return value.length === 0
    ? { value: undefined, error: `tracker has an empty ${label}` }
    : { value, error: null };
};

const tracker_plain_value = value => String(value ?? '').trim().replace(/[.,;:]+$/u, '').trim().toLowerCase();
const tracker_is_none = value => ['none', 'no', 'not applicable', 'n/a'].includes(tracker_plain_value(value));
const tracker_is_yes = value => ['yes', 'true'].includes(tracker_plain_value(value));
const tracker_is_no = value => ['no', 'false'].includes(tracker_plain_value(value));
const tracker_source_pattern = /\bSource:\s*(?:A-\d+|WIP-\d+)\b/u;
const tracker_safe_relative_path = value => typeof value === 'string'
  && value.length > 0
  && !node_path.posix.isAbsolute(value)
  && !node_path.win32.isAbsolute(value)
  && !/^[A-Za-z]:/u.test(value)
  && !value.includes('\\')
  && !value.split('/').includes('..')
  && !value.split('/').includes('');

const tracker_file_evidence = facts => {
  const file = facts.file ?? facts.file_evidence;
  if (file === null || typeof file !== 'object' || Array.isArray(file)) return 'tracker file evidence is missing';
  if (file.exists === false || file.readable === false) return 'tracker file is missing or unreadable';
  const regular = file.regular ?? file.regular_file;
  const symlink = file.symlink ?? file.symbolic_link;
  if (regular !== true || symlink !== false) return 'tracker must be a regular non-symlink file';
  const identity = file.identity ?? facts.file_identity;
  const checked = file.checked_identity ?? file.entry_identity ?? identity;
  const opened = file.opened_identity ?? identity;
  const read = file.read_identity ?? identity;
  if (![checked, opened, read].every(nonempty_text)) return 'tracker file identity is missing';
  if (!(checked === opened && opened === read)) return 'tracker file identity changed while reading';
  return null;
};

const tracker_evidence_is_trusted = record => {
  if (record.stale === true || record.worker_only === true || record.origin === 'worker' || record.authored_by === 'worker') return false;
  const current = (record.current === true || record.currentness === true) && record.stale !== true;
  const trusted = record.trusted === true && (
    record.coordinator_read === true
    || record.coordinator_executed === true
    || record.source === 'trusted-tooling'
    || record.trusted_tool === true
    || record.source === 'coordinator' && (record.read === true || record.executed === true)
  );
  const file = record.file_evidence ?? (record.file !== null && typeof record.file === 'object' ? record.file : undefined);
  const file_error = file === undefined ? null : tracker_file_evidence({ file });
  const file_path = nonempty_text(record.path)
    ? record.path
    : file !== undefined && nonempty_text(file.path) ? file.path : undefined;
  const file_identity = record.identity ?? record.content_identity ?? record.sha256 ?? record.digest ?? file?.identity;
  const has_file_identity = tracker_safe_relative_path(file_path) && nonempty_text(file_identity) && file_error === null;
  const command = record.command ?? record.test_command;
  const command_present = nonempty_text(command) || command !== null && typeof command === 'object' && nonempty_text(command.text ?? command.shell)
    || Array.isArray(command) && command.length > 0 && command.every(nonempty_text);
  const has_command_result = command_present && (record.exit_code === 0 || record.success === true || record.passed === true);
  return current && trusted && (has_file_identity || has_command_result);
};

const lint_tracker = facts => {
  if (facts === undefined) return make_check('tracker', 'Durable tracker is honest', 'skip', 'tracker facts were not provided');
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts) || typeof facts.required !== 'boolean') {
    return make_check('tracker', 'Durable tracker is honest', 'fail', 'tracker facts need a boolean required value');
  }
  if (!facts.required) return make_check('tracker', 'Durable tracker is honest', 'pass', 'no task list was created');

  const path = facts.path;
  const work_root = facts.work_root;
  if (!tracker_safe_relative_path(path) || !tracker_safe_relative_path(work_root) || path !== `${work_root}/tracker.md`) {
    return make_check('tracker', 'Durable tracker is honest', 'fail', 'tracker path must be the safe canonical tracker.md directly inside its work root');
  }
  const alternate_paths = facts.alternate_paths ?? facts.additional_paths;
  if (facts.alternate_path !== undefined || alternate_paths !== undefined && (!Array.isArray(alternate_paths) || alternate_paths.length > 0)) {
    return make_check('tracker', 'Durable tracker is honest', 'fail', 'a required work item must have one canonical tracker path');
  }
  if (facts.current === false || facts.stale === true) return make_check('tracker', 'Durable tracker is honest', 'fail', 'tracker evidence is stale');
  const file_error = tracker_file_evidence(facts);
  if (file_error !== null) return make_check('tracker', 'Durable tracker is honest', 'fail', file_error);
  const text = facts.text;
  if (typeof text !== 'string' || text.trim() === '') return make_check('tracker', 'Durable tracker is honest', 'fail', 'required tracker text is missing');
  if (Buffer.byteLength(text, 'utf8') > max_artifact_bytes) return make_check('tracker', 'Durable tracker is honest', 'fail', 'tracker exceeds the maximum bounded file size');

  const parsed_sections = tracker_sections(text);
  if (parsed_sections.errors.length > 0) return make_check('tracker', 'Durable tracker is honest', 'fail', parsed_sections.errors.join('; '));
  const sections = parsed_sections.sections;
  const errors = [];
  const fields = {};
  const require_fields = (section_name, names) => names.forEach(name => {
    const result = tracker_field(sections[section_name], name);
    fields[name] = result.value;
    if (result.error !== null) errors.push(result.error);
  });

  require_fields('## Identity', ['Work key', 'Active Ask', 'Goal', 'Last update', 'Evidence commit']);
  require_fields('## Overall state', ['State', 'Reason', 'Total', 'Completed', 'Remaining']);
  require_fields('## Current recovery', ['Current item', 'Last proven result', 'Active blocker or running process', 'Next safe action', 'Expected changed files']);
  require_fields('## Completion proof', ['All accepted tasks checked', 'Blocking accepted decision', 'Operation running', 'Next action remaining', 'Evidence status', 'Judgment']);

  const last_update = fields['Last update']?.replace(/[.,;:]+$/u, '').trim();
  if (last_update !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} Asia\/Taipei$/u.test(last_update) || !Number.isFinite(parse_taipei_timestamp(last_update.slice(0, 19)))) {
      errors.push('Last update must be a real Asia/Taipei timestamp');
    }
  }

  const state = tracker_plain_value(fields.State);
  if (!['active', 'blocked', 'interrupted', 'complete'].includes(state)) errors.push('tracker State is invalid');

  const checklist_lines = sections['## Accepted task checklist'].split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  const checklist_pattern = /^- \[([ x])\] \*\*(T-\d+):\*\* (\S.*)$/u;
  const checklist_items = [];
  checklist_lines.forEach(line => {
    const match = checklist_pattern.exec(line);
    if (match !== null) {
      checklist_items.push({ id: match[2], checked: match[1] === 'x', body: match[3] });
    } else if (line.startsWith('- [') || /\bT-\d+\b/u.test(line)) {
      errors.push(`malformed tracker checklist item: ${line}`);
    }
  });
  if (checklist_items.length === 0) errors.push('tracker checklist must contain at least one T-N item');
  const ids = new Set();
  checklist_items.forEach(item => {
    if (ids.has(item.id)) errors.push(`tracker checklist repeats ${item.id}`);
    ids.add(item.id);
    if (!tracker_source_pattern.test(item.body)) errors.push(`${item.id} has no Ask/WIP source`);
    if (item.checked && !/\bProof:\s*\S+/u.test(item.body)) errors.push(`${item.id} has no proof`);
  });
  const total = Number.parseInt(tracker_plain_value(fields.Total), 10);
  const completed = Number.parseInt(tracker_plain_value(fields.Completed), 10);
  const remaining = Number.parseInt(tracker_plain_value(fields.Remaining), 10);
  const count_values = [fields.Total, fields.Completed, fields.Remaining].map(tracker_plain_value);
  if (!count_values.every(value => /^\d+$/u.test(value))) {
    errors.push('tracker counts must be non-negative integers');
  } else if (total !== checklist_items.length || completed !== checklist_items.filter(item => item.checked).length || remaining !== checklist_items.filter(item => !item.checked).length) {
    errors.push('tracker counts do not match the current checklist');
  }

  const scope_lines = sections['## Accepted scope changes'].split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (scope_lines.length === 0) errors.push('accepted scope changes must say None. or list a change');
  else if (!(scope_lines.length === 1 && tracker_is_none(scope_lines[0].replace(/^-\s*/u, '')))) {
    scope_lines.forEach(line => {
      const change = line.replace(/^-\s*/u, '').split(/\bSource:/u)[0].trim();
      if (!line.startsWith('- ') || change.length === 0 || !tracker_source_pattern.test(line) || !/\bEffect:\s*\S+/u.test(line)) {
        errors.push(`accepted scope change lacks change, source, or effect: ${line}`);
      }
    });
  }

  const format_only = facts.format_only === true;
  const evidence_records = facts.evidence ?? facts.proof_evidence;
  const evidence_by_id = new Map();
  if (format_only) {
    checklist_items.filter(item => item.checked).forEach(item => {
      const proof = /\bProof:\s*([^\r\n]+)/u.exec(item.body);
      if (proof !== null) proof[1].split(/[\s,;]+/u).map(value => value.replace(/[.,]+$/u, '')).filter(Boolean).forEach(reference => evidence_by_id.set(reference, {}));
    });
  } else if (!Array.isArray(evidence_records)) {
    if (checklist_items.some(item => item.checked)) errors.push('checked tracker items need current trusted evidence records');
  } else {
    evidence_records.forEach((record, index) => {
      if (record === null || typeof record !== 'object' || Array.isArray(record) || !nonempty_text(record.id)) {
        errors.push(`tracker evidence ${index + 1} is malformed`);
      } else if (evidence_by_id.has(record.id)) {
        errors.push(`tracker evidence repeats ${record.id}`);
      } else {
        evidence_by_id.set(record.id, record);
        if (!tracker_evidence_is_trusted(record)) errors.push(`tracker evidence ${record.id} is not current trusted proof`);
      }
    });
  }
  checklist_items.filter(item => item.checked).forEach(item => {
    const proof = /\bProof:\s*([^\r\n]+)/u.exec(item.body);
    if (proof === null) return;
    const references = proof[1].split(/[\s,;]+/u).map(value => value.replace(/[.,]+$/u, '')).filter(Boolean);
    references.forEach(reference => {
      if (!evidence_by_id.has(reference)) errors.push(`${item.id} references missing proof ${reference}`);
    });
  });

  const judgment = tracker_plain_value(fields.Judgment);
  if (state !== judgment) errors.push('tracker Judgment must match State');
  const unfinished = checklist_items.filter(item => !item.checked).length;
  const complete = state === 'complete';
  if (complete) {
    if (unfinished > 0) errors.push('complete tracker contains unfinished tasks');
    if (!tracker_is_yes(fields['All accepted tasks checked'])) errors.push('complete tracker does not confirm all accepted tasks are checked');
    if (!tracker_is_none(fields['Active blocker or running process']) || !tracker_is_none(fields['Blocking accepted decision'])) errors.push('complete tracker has a blocker or blocking decision');
    if (!tracker_is_no(fields['Operation running']) && !tracker_is_none(fields['Operation running'])) errors.push('complete tracker has a running operation');
    if (!tracker_is_none(fields['Next safe action']) || !tracker_is_none(fields['Next action remaining'])) errors.push('complete tracker has a next action');
    if (tracker_plain_value(fields['Evidence status']) !== 'complete') errors.push('complete tracker lacks complete evidence status');
    if (!/\b[0-9a-f]{40}\b/iu.test(fields['Evidence commit'] ?? '') || !format_only && facts.evidence_commit_verified !== true) errors.push('complete tracker lacks a verified evidence commit');
  } else {
    if (unfinished === 0) errors.push('nonterminal tracker needs unfinished work');
    if (tracker_is_none(fields['Next safe action'])) errors.push('nonterminal tracker needs a next safe action');
  }

  const update_meaning = sections['## Update meaning'];
  if (!/recovery checkpoint/i.test(update_meaning) || !/not a stop signal/i.test(update_meaning) || !/continues? with the next unfinished item/i.test(update_meaning) || !/independent stop condition/i.test(update_meaning)) {
    errors.push('Update meaning must explain recovery, continuation, and independent stops');
  }

  return errors.length === 0
    ? format_only
      ? make_check('tracker', 'Tracker has the canonical format', 'pass', `${state} tracker has the canonical sections, fields, checklist, counts, recovery values, and internally consistent judgment; evidence truth is checked separately`)
      : make_check('tracker', 'Durable tracker is honest', 'pass', `${state} tracker has one canonical file, a complete checklist, current proof, recovery fields, and an honest completion judgment`)
    : make_check('tracker', 'Durable tracker is honest', 'fail', errors.join('; '));
};

const checkpoint_segments = round => {
  const checkpoints = [...round.matchAll(checkpoint_heading_line_pattern)];
  return checkpoints.map((checkpoint, index) => {
    const next_checkpoint = checkpoints[index + 1]?.index ?? round.length;
    const following_text = round.slice(checkpoint.index, next_checkpoint);
    const reply = /^(?:# ← Reply \/ A-\d+|## Reply \/ A-\d+\b)/mu.exec(following_text);
    const end = reply === null ? next_checkpoint : checkpoint.index + reply.index;
    return round.slice(checkpoint.index, end);
  });
};

const lint_checkpoint_verification = (devlog_text, facts) => {
  if (facts === undefined) return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'skip', 'verification facts were not provided');
  if (facts === null || typeof facts !== 'object' || facts.required !== true) return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'skip', 'new checkpoint verification is not required');
  const boolean_facts = ['tracker_current', 'run_current', 'progress_current', 'scope_checked'];
  if (boolean_facts.some(name => facts[name] !== true)) return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'fail', 'one or more checked checkpoint claims lack current evidence');
  const segments = checkpoint_segments(parse_devlog(devlog_text).last_round);
  if (segments.length === 0) return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'fail', 'current round has no checkpoint');
  const combined = '- **Checks:** [x] tracker.md | [x] devlog RUN | [x] scope matches tracker';
  for (const segment of segments) {
    const nonempty_lines = segment.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (nonempty_lines[nonempty_lines.length - 1] === '---') nonempty_lines.pop();
    const combined_valid = nonempty_lines.filter(line => line === combined).length === 1 && nonempty_lines[nonempty_lines.length - 1] === combined;
    if (!combined_valid) {
      return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'fail', 'every checkpoint must end with the exact combined verification line');
    }
  }
  return make_check('checkpoint_verification', 'Latest checkpoint claims have evidence', 'pass', `all ${segments.length} checkpoint(s) end with labels that match supplied current evidence`);
};

const lint_next_ask_scaffold = devlog_text => {
  const ask_matches = [...devlog_text.matchAll(ask_heading_pattern)];

  if (ask_matches.length === 0) {
    return make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'skip', 'the notebook has no Ask block');
  }

  const last_index = ask_matches.length - 1;
  const last_start = ask_matches[last_index].index;
  const last_body = devlog_text.slice(last_start + ask_matches[last_index][0].length);
  const reply_pattern = /^# ← Reply \/ A-\d{3}\s*$/mu;

  if (!is_empty_ask_body(last_body)) {
    return reply_pattern.test(last_body)
      ? make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'fail', 'a completed Reply must be followed by a fresh empty Ask scaffold')
      : make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'skip', 'the last Ask is still open');
  }

  if (last_index === 0) {
    return make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'skip', 'the notebook contains only its initial empty Ask scaffold');
  }

  if (!/^\s*\+\s*$/u.test(last_body)) {
    return make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'fail', 'the trailing empty Ask scaffold must contain one bare + marker');
  }

  const previous_start = ask_matches[last_index - 1].index;
  const previous_round = devlog_text.slice(previous_start, last_start);

  if (!reply_pattern.test(previous_round)) {
    return make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'skip', 'the preceding Ask has no completed Reply');
  }

  const previous_number = Number.parseInt(ask_matches[last_index - 1][1].slice(2), 10);
  const next_number = Number.parseInt(ask_matches[last_index][1].slice(2), 10);

  return next_number === previous_number + 1
    ? make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'pass', `the notebook ends with empty ${ask_matches[last_index][1]}`)
    : make_check('next_ask_scaffold', 'Completed Reply has the next empty Ask scaffold', 'fail', 'the trailing empty Ask scaffold does not use the next sequential Ask id');
};

const lint_terminal_output = terminal_output => {
  if (terminal_output === undefined) {
    return make_check('terminal_one_line', 'Terminal output is one line', 'skip', 'terminal output was not provided');
  }

	const trimmed_output = String(terminal_output).trim();
	const line_count = trimmed_output.length === 0 ? 0 : trimmed_output.split(/\r\n|\r|\n/).length;
	const reasons = [];
	const update_lines = trimmed_output.split(/\r\n|\r|\n/);
	const establishes_update = update_lines.some(line =>
	  line.length > 0 && /\S+\s+updated(?:\s|$)/i.test(line) && !/\b(?:not|never|failed|unable|cannot)\s+updated\b/i.test(line)
	);

	if (!establishes_update) return make_check('terminal_one_line', 'Terminal output establishes completion', 'fail', 'completion evidence must contain a path update ending in " updated"');
	if (/\r|\n/.test(trimmed_output)) reasons.push(`found ${line_count} lines; the completion evidence is not one line`);
	if (!trimmed_output.endsWith(' updated')) reasons.push('completion evidence has extra framing after the required update fact');

	return reasons.length === 0
		? make_check('terminal_one_line', 'Terminal output establishes completion', 'pass', 'one line ending with " updated"')
		: make_check('terminal_one_line', 'Terminal output establishes completion', 'warn', reasons.join('; '));
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

const split_artifact_lines = file_text => {
  const lines = file_text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  return lines;
};

const parse_taipei_timestamp = timestamp => {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(timestamp);
  if (match === null) {
    return NaN;
  }

  const stamp_ms = Date.parse(timestamp.replace(' ', 'T') + '+08:00');
  const local = new Date(stamp_ms + 8 * 60 * 60 * 1000);
  return Number.isFinite(stamp_ms)
    && local.getUTCFullYear() === Number(match[1])
    && local.getUTCMonth() + 1 === Number(match[2])
    && local.getUTCDate() === Number(match[3])
    && local.getUTCHours() === Number(match[4])
    && local.getUTCMinutes() === Number(match[5])
    && local.getUTCSeconds() === Number(match[6])
    ? stamp_ms
    : NaN;
};

const validate_artifact_identity = (model, effort) => {
  const errors = [];

  [['model', model], ['effort', effort]].forEach(([label, value]) => {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push(label + ' must be a non-empty single-line value');
      return;
    }

    if (value.length > artifact_identity_limits[label]) {
      errors.push(label + ' exceeds ' + artifact_identity_limits[label] + ' characters');
    }

    if (/[\r\n\u2028\u2029]/u.test(value)) {
      errors.push(label + ' must be a single-line value');
    }

    if (value.includes('/')) {
      errors.push(label + ' cannot contain "/" in the frozen stamp identity');
    }
  });

  return errors;
};

const normalize_artifact_requirement = (requirement, pipeline) => {
  if (typeof requirement === 'string') {
    return {
      file_name: requirement,
      model: pipeline.model,
      effort: pipeline.effort,
      now_ms: pipeline.now_ms,
      trusted_metadata: pipeline.trusted_metadata
    };
  }

  if (requirement !== null && typeof requirement === 'object') {
    return {
      file_name: requirement.file_name,
      model: requirement.model,
      effort: requirement.effort,
      now_ms: requirement.now_ms,
      trusted_metadata: requirement.trusted_metadata ?? pipeline.trusted_metadata
    };
  }

  return { file_name: '<invalid artifact requirement>', model: undefined, effort: undefined, now_ms: undefined, trusted_metadata: undefined };
};

const artifact_descriptor_flags = () => {
  let flags = node_fs.constants.O_RDONLY;

  if (typeof node_fs.constants.O_NOFOLLOW === 'number') {
    flags |= node_fs.constants.O_NOFOLLOW;
  }

  return flags;
};

const same_artifact_identity = (left, right) =>
  left.dev === right.dev && left.ino === right.ino && left.size === right.size;

const same_context_identity = (left, right) =>
  left.dev === right.dev &&
  left.ino === right.ino &&
  left.size === right.size &&
  left.mtimeNs === right.mtimeNs &&
  left.ctimeNs === right.ctimeNs;

const read_context_json = file_path => {
  if (typeof file_path !== 'string' || file_path.length === 0) {
    throw new Error('context path is missing');
  }

  const checked_stat = node_fs.lstatSync(file_path, { bigint: true });
  if (!checked_stat.isFile() || checked_stat.isSymbolicLink()) {
    throw new Error('context file must be a regular non-symlink file');
  }
  if (checked_stat.size > BigInt(max_context_bytes)) {
    throw new Error(`context file exceeds maximum size of ${max_context_bytes} bytes`);
  }

  let descriptor = null;
  let close_error = null;
  let file_text;

  try {
    descriptor = node_fs.openSync(file_path, artifact_descriptor_flags());
    const opened_stat = node_fs.fstatSync(descriptor, { bigint: true });
    if (!opened_stat.isFile() || !same_context_identity(opened_stat, checked_stat)) {
      throw new Error('context file identity changed before reading');
    }

    const chunks = [];
    let total_bytes = 0;
    while (true) {
      const remaining = max_context_bytes + 1 - total_bytes;
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, remaining));
      const bytes_read = node_fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes_read === 0) break;
      total_bytes += bytes_read;
      if (total_bytes > max_context_bytes) {
        throw new Error(`context file exceeds maximum size of ${max_context_bytes} bytes`);
      }
      chunks.push(buffer.subarray(0, bytes_read));
    }

    const final_stat = node_fs.fstatSync(descriptor, { bigint: true });
    if (!same_context_identity(final_stat, opened_stat) || BigInt(total_bytes) !== opened_stat.size) {
      throw new Error('context file changed while reading');
    }
    file_text = Buffer.concat(chunks, total_bytes).toString('utf8');
  } finally {
    if (descriptor !== null) {
      try {
        node_fs.closeSync(descriptor);
      } catch (error) {
        close_error = error;
      }
    }
  }

  if (close_error !== null) {
    const detail = close_error && close_error.message ? close_error.message : String(close_error);
    throw new Error(`context file descriptor close failed: ${detail}`);
  }

  const value = JSON.parse(file_text);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('context JSON must contain one object');
  }
  return value;
};

const check_artifact = (artifact_dir, requirement) => {
  const { file_name, model, effort, now_ms } = requirement;

  if (typeof file_name !== 'string' || file_name.length === 0) {
    return 'invalid artifact requirement: file name is missing';
  }

  if (
    file_name === '.' ||
    file_name === '..' ||
    file_name.includes('/') ||
    file_name.includes('\\') ||
    node_path.posix.isAbsolute(file_name) ||
    node_path.win32.isAbsolute(file_name) ||
    /^[A-Za-z]:/.test(file_name)
  ) {
    return file_name + ': invalid artifact file name; require a same-directory basename';
  }

  const identity_errors = validate_artifact_identity(model, effort);

  if (identity_errors.length > 0) {
    return file_name + ': invalid immutable identity: ' + identity_errors.join(', ');
  }

  if (!Number.isFinite(now_ms)) {
    return file_name + ': verified generation timestamp reference is missing or invalid';
  }

  if (typeof artifact_dir !== 'string') {
    return file_name + ': artifact directory is missing';
  }

  let artifact_root;
  let file_stat;
  let file_path;
  let real_file_path;

  try {
    artifact_root = node_fs.realpathSync(node_path.resolve(artifact_dir));
    file_path = node_path.join(artifact_root, file_name);
    file_stat = node_fs.lstatSync(file_path);
  } catch (error) {
    return error && error.code === 'ENOENT' ? file_name + ': missing' : file_name + ': unreadable';
  }

  if (!file_stat.isFile() || file_stat.isSymbolicLink()) {
    return file_name + ': must be a regular non-symlink file';
  }

  try {
    real_file_path = node_fs.realpathSync(file_path);
  } catch (error) {
    return file_name + ': unreadable';
  }

  if (node_path.dirname(real_file_path) !== artifact_root || node_path.basename(real_file_path) !== file_name) {
    return file_name + ': resolved path is outside the allocated artifact directory';
  }

  if (file_stat.size > max_artifact_bytes) {
    return file_name + ': exceeds maximum artifact size of ' + max_artifact_bytes + ' bytes';
  }

  if (file_stat.size === 0) {
    return file_name + ': empty';
  }

  let descriptor = null;
  let failure = null;
  let warning = null;
  let close_failure = null;

  try {
    descriptor = node_fs.openSync(file_path, artifact_descriptor_flags());
    const descriptor_stat = node_fs.fstatSync(descriptor);

    if (!descriptor_stat.isFile() || !same_artifact_identity(descriptor_stat, file_stat)) {
      failure = file_name + ': opened object identity does not match the checked immediate-child entry';
    } else if (descriptor_stat.size > max_artifact_bytes) {
      failure = file_name + ': exceeds maximum artifact size of ' + max_artifact_bytes + ' bytes';
    } else if (descriptor_stat.size === 0) {
      failure = file_name + ': empty';
    } else {
      const file_text = node_fs.readFileSync(descriptor, 'utf8');
      const final_stat = node_fs.fstatSync(descriptor);

      if (!same_artifact_identity(final_stat, descriptor_stat)) {
        failure = file_name + ': opened object changed while reading';
      } else {
        const content_lines = split_artifact_lines(file_text);
        const opening_match = artifact_opening_stamp_pattern.exec(content_lines[0] || '');

        if (opening_match === null) {
          failure = file_name + ': opening stamp must be the exact first line';
        } else {
          const stamp_ms = parse_taipei_timestamp(opening_match[1]);

          if (!Number.isFinite(stamp_ms)) {
            failure = file_name + ': opening stamp timestamp is not a valid Asia/Taipei time';
          } else if (stamp_ms < now_ms - artifact_freshness_ms || stamp_ms > now_ms + artifact_freshness_ms) {
            failure = file_name + ': opening stamp timestamp is not fresh';
          } else {
            if (opening_match[2] !== model || opening_match[3] !== effort) {
              warning = file_name + ': opening stamp identity does not match the immutable context';
            }
            const self_check_lines = content_lines.filter(line => line.startsWith('Self-check:'));

            if (self_check_lines.length === 0) {
              failure = file_name + ': missing final Self-check boundary';
            } else if (self_check_lines.length !== 1) {
              failure = file_name + ': duplicate Self-check boundaries';
            } else if (!artifact_self_check_pattern.test(self_check_lines[0])) {
              failure = file_name + ': malformed Self-check boundary';
            } else if (content_lines[content_lines.length - 1] !== self_check_lines[0]) {
              failure = file_name + ': content follows the final Self-check boundary';
            }
          }
        }
      }
    }
  } catch (error) {
    failure = file_name + ': unreadable';
  } finally {
    if (descriptor !== null) {
      try {
        node_fs.closeSync(descriptor);
      } catch (error) {
        close_failure = error;
      }
    }
  }

  if (failure !== null) return failure;
  if (close_failure !== null) {
    const detail = close_failure && close_failure.message ? close_failure.message : String(close_failure);
    return file_name + ': descriptor close failed: ' + detail;
  }

  return warning;
};

const cosmetic_artifact_failure_pattern = /opening stamp must be the exact first line|opening stamp timestamp is not valid|opening stamp timestamp is not fresh|opening stamp identity does not match|missing final Self-check boundary|duplicate Self-check boundaries|malformed Self-check boundary|content follows the final Self-check boundary/;

const trusted_artifact_metadata = value => {
  if (value === true) return true;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return value.trusted === true || value.trusted_tool === true || value.origin_proved === true;
};

const artifact_failure_is_cosmetic = (failure, requirement) =>
  /opening stamp identity does not match/.test(failure) ||
  (cosmetic_artifact_failure_pattern.test(failure) && trusted_artifact_metadata(requirement.trusted_metadata));

const lint_pipeline_artifacts = pipeline => {
  if (pipeline === undefined || pipeline === null) {
    return make_check('pipeline_artifacts', 'Pipeline artifacts exist', 'skip', 'pipeline context was not provided');
  }

  const required_files = Array.isArray(pipeline.require) && pipeline.require.length > 0
    ? pipeline.require
    : default_pipeline_files;
  const results = required_files.map(requirement => {
    const normalized = normalize_artifact_requirement(requirement, pipeline);
    return {
      failure: check_artifact(pipeline.artifact_dir, normalized),
      normalized
    };
  }).filter(result => result.failure !== null);
  const failures = results.filter(result => !artifact_failure_is_cosmetic(result.failure, result.normalized));
  const warnings = results.filter(result => artifact_failure_is_cosmetic(result.failure, result.normalized));
  const detail = failures.length === 0 && warnings.length === 0
    ? `${required_files.length} required artifact(s) pass`
    : [...failures.map(result => result.failure), ...warnings.map(result => `cosmetic record warning: ${result.failure}`)].join('; ');

  return make_check('pipeline_artifacts', 'Pipeline artifacts exist', failures.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass', `${detail}; ${artifact_authorship_note}`);
};

const cross_check_review_pattern = /^Cross-check review:\s+`?([^`\r\n]+?)`?\s*$/imu;
const cross_check_implementation_pattern = /^Cross-check implementation:\s+([0-9a-f]{40})\s*$/imu;
const reviewed_commit_pattern = /^Reviewed implementation commit:\s+([0-9a-f]{40})\s*$/imu;
const verdict_pattern = /^Verdict:\s+(PASS|BLOCKING)\s*$/gimu;
const cross_check_dimension_patterns = Object.freeze({
  outcome: /^Outcome:\s+(PASS|BLOCKING)\s*$/gimu,
  minimality: /^Minimality:\s+(PASS|BLOCKING)\s*$/gimu,
  conformance: /^Conformance:\s+(PASS|BLOCKING)\s*$/gimu
});

const quality_gate_fields = Object.freeze([
  'plan_commit',
  'plan_only',
  'design_decision',
  'journey',
  'review',
  'host_gate',
  'repeated_concept_block',
  'away_gates',
  'result_decision',
  'final_implementation_commit'
]);
const quality_journey_fields = Object.freeze(['path', 'red_proven', 'green_proven', 'implementation_commit']);
const quality_review_fields = Object.freeze(['report_path', 'implementation_commit', 'outcome', 'minimality', 'conformance']);
const quality_commit_pattern = /^[0-9a-f]{40}$/u;
const quality_cross_check_implementation_pattern = /^Cross-check implementation:\s+([0-9a-f]{40})\s*$/gimu;
const quality_decision_values = Object.freeze(['go', 'stop', 'pending']);
const quality_verdict_values = Object.freeze(['pass', 'blocking']);
const quality_questions_heading = '## Questions (batched — each with a suggested default)';

const quality_is_object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const quality_has = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const quality_valid_commit = value => typeof value === 'string' && quality_commit_pattern.test(value);
const quality_safe_relative_path = value => tracker_safe_relative_path(value) && !value.includes('\0');

const quality_unknown_fields = (value, allowed, label) => Object.keys(value)
  .filter(key => !allowed.includes(key))
  .map(key => `${label} has unknown field ${key}`);

const quality_missing_fields = (value, required, label) => required
  .filter(key => !quality_has(value, key))
  .map(key => `${label} is missing ${key}`);

const quality_questions_body = reply_text => {
  const lines = reply_text.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === quality_questions_heading);
  if (start < 0) return '';
  const end = lines.findIndex((line, index) => index > start && /^##\s+/u.test(line.trim()));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join('\n');
};

const quality_reply_decisions = (rounds, kind) => {
  const pattern = new RegExp(`\\b${kind} Go:\\s*([0-9a-f]{40})(?![0-9a-f])`, 'gu');
  return rounds.flatMap(round => [...quality_questions_body(round.reply_text).matchAll(pattern)].map(match => ({
    kind,
    commit: match[1],
    round_index: round.index,
    round
  })));
};

const quality_owner_decisions = (rounds, kind) => {
  const go_pattern = new RegExp(`^${kind} Go: ([0-9a-f]{40})$`, 'u');
  const stop_pattern = new RegExp(`^${kind} Stop: (\\S.*)$`, 'u');
  return rounds.flatMap(round => {
    let fenced = false;
    return round.ask_text.split(/\r?\n/).flatMap(line => {
      if (/^\s*(?:`{3,}|~{3,})/u.test(line)) {
        fenced = !fenced;
        return [];
      }
      if (fenced) return [];
      const go = go_pattern.exec(line);
      if (go !== null) return [{ kind, decision: 'go', commit: go[1], round_index: round.index, round }];
      const stop = stop_pattern.exec(line);
      return stop === null
        ? []
        : [{ kind, decision: 'stop', reason: stop[1], round_index: round.index, round }];
    });
  });
};

const quality_blocked_concepts = rounds => rounds.flatMap(round => {
  const pattern = /^(?:- )?Blocked concept: (\S.*)$/gmu;
  return [...round.wip_text.matchAll(pattern)].map(match => ({
    name: match[1].trim(),
    round_index: round.index,
    round
  }));
});

const quality_latest_nonempty_round = rounds => [...rounds].reverse().find(round => !is_empty_ask_body(round.body));

const lint_quality_gate = (facts, devlog_text) => {
  if (facts === undefined) {
    return make_check('quality_gate', 'Consequential quality gate is current', 'skip', 'quality-gate facts were not provided');
  }
  if (!quality_is_object(facts)) {
    return make_check('quality_gate', 'Consequential quality gate is current', 'fail', 'quality_gate must be an object');
  }

  const errors = [
    ...quality_unknown_fields(facts, quality_gate_fields, 'quality_gate'),
    ...quality_missing_fields(facts, quality_gate_fields.filter(field => field !== 'away_gates'), 'quality_gate')
  ];
  const add_commit_error = (value, label) => {
    if (!quality_has(facts, label) || quality_valid_commit(value)) return;
    errors.push(`${label} must be a 40-character lowercase Git commit`);
  };
  const add_enum_error = (value, label, values) => {
    if (!quality_has(facts, label) || values.includes(value)) return;
    errors.push(`${label} must be exactly ${values.join(', ')}`);
  };

  add_commit_error(facts.plan_commit, 'plan_commit');
  if (quality_has(facts, 'plan_only') && typeof facts.plan_only !== 'boolean') errors.push('plan_only must be an actual boolean');
  if (facts.plan_only === false) errors.push('consequential implementation requires a plan-only round before Design Go');
  add_enum_error(facts.design_decision, 'design_decision', quality_decision_values);
  add_enum_error(facts.host_gate, 'host_gate', quality_verdict_values);
  add_enum_error(facts.result_decision, 'result_decision', quality_decision_values);
  if (quality_has(facts, 'repeated_concept_block') && typeof facts.repeated_concept_block !== 'boolean') {
    errors.push('repeated_concept_block must be an actual boolean');
  }
  if (quality_has(facts, 'away_gates') && typeof facts.away_gates !== 'boolean') errors.push('away_gates must be an actual boolean');
  add_commit_error(facts.final_implementation_commit, 'final_implementation_commit');

  const journey = facts.journey;
  if (quality_has(facts, 'journey') && !quality_is_object(journey)) {
    errors.push('journey must be an object');
  } else if (quality_is_object(journey)) {
    errors.push(...quality_unknown_fields(journey, quality_journey_fields, 'journey'));
    errors.push(...quality_missing_fields(journey, quality_journey_fields, 'journey'));
    if (quality_has(journey, 'path') && !quality_safe_relative_path(journey.path)) errors.push('journey.path must be a repository-relative path');
    for (const name of ['red_proven', 'green_proven']) {
      if (quality_has(journey, name) && typeof journey[name] !== 'boolean') errors.push(`journey.${name} must be an actual boolean`);
    }
    if (quality_has(journey, 'implementation_commit') && !quality_valid_commit(journey.implementation_commit)) {
      errors.push('journey.implementation_commit must be a 40-character lowercase Git commit');
    }
  }

  const review = facts.review;
  if (quality_has(facts, 'review') && !quality_is_object(review)) {
    errors.push('review must be an object');
  } else if (quality_is_object(review)) {
    errors.push(...quality_unknown_fields(review, quality_review_fields, 'review'));
    errors.push(...quality_missing_fields(review, quality_review_fields, 'review'));
    if (quality_has(review, 'report_path') && !quality_safe_relative_path(review.report_path)) errors.push('review.report_path must be a repository-relative path');
    if (quality_has(review, 'implementation_commit') && !quality_valid_commit(review.implementation_commit)) {
      errors.push('review.implementation_commit must be a 40-character lowercase Git commit');
    }
    for (const name of ['outcome', 'minimality', 'conformance']) {
      if (quality_has(review, name) && !quality_verdict_values.includes(review[name])) {
        errors.push(`review.${name} must be exactly pass or blocking`);
      }
    }
  }

  const final_commit = facts.final_implementation_commit;
  if (quality_is_object(journey) && quality_valid_commit(journey.implementation_commit) && quality_valid_commit(final_commit) && journey.implementation_commit !== final_commit) {
    errors.push('journey.implementation_commit must match final_implementation_commit');
  }
  if (quality_is_object(review) && quality_valid_commit(review.implementation_commit) && quality_valid_commit(final_commit) && review.implementation_commit !== final_commit) {
    errors.push('review.implementation_commit must match final_implementation_commit');
  }
  if (quality_is_object(review) && quality_verdict_values.includes(review.outcome) && review.outcome !== 'pass') errors.push('review.outcome is blocking');
  if (quality_is_object(review) && quality_verdict_values.includes(review.minimality) && review.minimality !== 'pass') errors.push('review.minimality is blocking');
  if (quality_is_object(review) && quality_verdict_values.includes(review.conformance) && review.conformance !== 'pass') errors.push('review.conformance is blocking');
  if (quality_has(facts, 'host_gate') && facts.host_gate === 'blocking') errors.push('host gate is blocking');

  const parsed = typeof devlog_text === 'string' ? parse_devlog(devlog_text) : { rounds: [] };
  const rounds = parsed.rounds ?? [];
  if (typeof devlog_text !== 'string') errors.push('devlog text is required for owner decision validation');
  const current_round = quality_latest_nonempty_round(rounds);
  const away_authorized = facts.away_gates === true && current_round?.ask_text.split(/\r?\n/u).includes('away: gates');
  if (facts.away_gates === true && !away_authorized) errors.push('away_gates requires exact current owner Ask input away: gates');
  const plan_replies = quality_reply_decisions(rounds, 'Design');
  const result_replies = quality_reply_decisions(rounds, 'Result');
  const design_decisions = quality_owner_decisions(rounds, 'Design');
  const result_decisions = quality_owner_decisions(rounds, 'Result');
  const plan_commit = facts.plan_commit;

  if (facts.design_decision === 'stop') {
    errors.push('Design Stop keeps consequential implementation blocked');
  } else if (facts.design_decision === 'pending') {
    errors.push('Design Go is still pending');
  } else if (facts.design_decision === 'go' && quality_valid_commit(plan_commit)) {
    const latest_plan_reply = plan_replies.at(-1);
    const matching_design_go = design_decisions
      .filter(decision => decision.decision === 'go' && decision.commit === plan_commit)
      .at(-1);
    if (design_decisions.at(-1)?.decision === 'stop') {
      errors.push('Design Stop is the latest owner decision');
    } else if (latest_plan_reply === undefined || latest_plan_reply.commit !== plan_commit) {
      errors.push('Design Go must match the latest plan-only Reply and plan_commit');
    } else if (!away_authorized && (matching_design_go === undefined || matching_design_go.round_index <= latest_plan_reply.round_index)) {
      errors.push('a later owner Ask must contain Design Go for plan_commit');
    }
  }

  if (facts.result_decision === 'stop') {
    errors.push('Result Stop keeps consequential completion blocked');
  } else if (facts.result_decision === 'pending') {
    errors.push('Result Go is still pending');
  } else if (facts.result_decision === 'go' && quality_valid_commit(final_commit)) {
    const latest_result_reply = result_replies.at(-1);
    const matching_result_go = result_decisions
      .filter(decision => decision.decision === 'go' && decision.commit === final_commit)
      .at(-1);
    if (result_decisions.at(-1)?.decision === 'stop') {
      errors.push('Result Stop is the latest owner decision');
    } else if (latest_result_reply === undefined || latest_result_reply.commit !== final_commit) {
      errors.push('Result Go must match the latest result-review Reply and final_implementation_commit');
    } else if (!away_authorized && (matching_result_go === undefined || matching_result_go.round_index <= latest_result_reply.round_index)) {
      errors.push('a later owner Ask must contain Result Go for final_implementation_commit');
    } else if (!away_authorized && (current_round === undefined || matching_result_go.round_index !== current_round.index)) {
      errors.push('Result Go must be in the current owner Ask');
    }
  }

  const cross_check_commits = rounds.flatMap(round => [...round.reply_text.matchAll(quality_cross_check_implementation_pattern)].map(match => ({ commit: match[1], round_index: round.index })));
  const existing_cross_check = cross_check_commits.at(-1)?.commit;
  if (quality_valid_commit(existing_cross_check) && quality_valid_commit(final_commit) && existing_cross_check !== final_commit) {
    errors.push('cross-check implementation commit must match final_implementation_commit');
  }

  if (facts.repeated_concept_block === true) {
    const concepts = quality_blocked_concepts(rounds);
    const repeated = [...concepts.reduce((groups, record) => {
      const group = groups.get(record.name) ?? [];
      group.push(record);
      groups.set(record.name, group);
      return groups;
    }, new Map()).values()].find(group => group.length >= 2);
    if (repeated === undefined) {
      errors.push('repeated_concept_block=true requires a second Blocked concept with the same stable name');
    } else if (quality_valid_commit(plan_commit)) {
      const second_block = repeated[1];
      const prior_plan_commits = plan_replies
        .filter(reply => reply.round_index < second_block.round_index)
        .map(reply => reply.commit);
      if (!prior_plan_commits.some(commit => commit !== plan_commit)) {
        errors.push('repeated concept requires a new plan commit after the second Blocked concept');
      }
      const replacement_reply = plan_replies.find(reply => reply.round_index >= second_block.round_index && reply.commit === plan_commit);
      if (replacement_reply === undefined) {
        errors.push('repeated concept requires a later plan-only Reply for the new plan commit');
      } else if (!design_decisions.some(decision => decision.decision === 'go' && decision.commit === plan_commit && decision.round_index > replacement_reply.round_index)) {
        errors.push('repeated concept requires a still-later owner Ask containing Design Go for the new plan commit');
      }
    }
  }

  return errors.length === 0
    ? make_check('quality_gate', 'Consequential quality gate is current', 'pass', 'journey, three review verdicts, host gate, current Design Go, and current Result Go agree for the final implementation commit')
    : make_check('quality_gate', 'Consequential quality gate is current', 'fail', errors.join('; '));
};

const lint_cross_check = (devlog_text, project_root, decision) => {
  const last_round = parse_devlog(devlog_text).last_round;
  if (decision === undefined) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'skip', 'a host-recorded review decision was not supplied');
  }
  if (decision === null || typeof decision !== 'object' || Array.isArray(decision)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'review decision must be one explicit object');
  }
  if (nonempty_text(decision.error)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', decision.error);
  }
  if (!['required', 'not-requested', 'skip-review'].includes(decision.status) || !nonempty_text(decision.reason)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'review decision must contain a valid status and plain reason');
  }
  if (!reply_heading_pattern.test(last_round)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'skip', 'the triggered round is still in progress');
  }
  if (decision.status === 'not-requested') {
    const changed_files = Array.isArray(decision.changed_files) && decision.changed_files.every(nonempty_text) ? decision.changed_files : null;
    const record_files = Array.isArray(decision.record_files) && decision.record_files.every(nonempty_text) ? decision.record_files : [];
    const record_roots = Array.isArray(decision.record_roots) && decision.record_roots.every(nonempty_text) ? decision.record_roots : [];
    const configuration_files = Array.isArray(decision.configuration_files) && decision.configuration_files.every(nonempty_text) ? decision.configuration_files : [];
    const bootstrap_bookkeeping_only = decision.bootstrap_bookkeeping_only === true && changed_files !== null && changed_files.length > 0 && changed_files.every(file =>
      file === '.gitignore' || configuration_files.includes(file) || record_files.includes(file) || record_roots.some(root => file.startsWith(root))
    );
    const implementation_changed = changed_files === null || (!bootstrap_bookkeeping_only && changed_files.some(file =>
      configuration_files.includes(file) || (!record_files.includes(file) && !record_roots.some(root => file.startsWith(root)))
    ));
    return implementation_changed === false
      ? make_check('cross_check', 'Requested implementation has an external cross-check', 'pass', bootstrap_bookkeeping_only ? 'the host recorded no review because a first-time empty project changed only Agentflow bookkeeping' : 'the host recorded no review because no source, test, configuration, or user-document change exists')
      : make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', changed_files === null ? 'not-requested requires Git-derived changed-file facts' : 'not-requested conflicts with a changed path outside the declared Agentflow record boundary');
  }
  if (decision.status === 'skip-review') {
    return decision.owner_authorized === true
      ? make_check('cross_check', 'Requested implementation has an external cross-check', 'pass', 'the owner authorized the recorded final-review skip')
      : make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'skip-review requires owner authorization and a recorded reason');
  }
  const review_match = cross_check_review_pattern.exec(last_round);
  if (review_match === null) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'completed cross-check round is missing its external review report path');
  }
  const implementation_match = cross_check_implementation_pattern.exec(last_round);
  if (implementation_match === null) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'completed cross-check round is missing its exact implementation commit');
  }
  if (!nonempty_text(project_root)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'project root is unavailable for external review report verification');
  }

  const relative_path = review_match[1].trim();
  let root;
  try {
    root = node_fs.realpathSync(node_path.resolve(project_root));
  } catch (error) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'project root is unavailable for external review report verification');
  }
  const report_path = node_path.resolve(root, relative_path);
  if (report_path === root || !report_path.startsWith(root + node_path.sep)) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report path must stay inside the repository');
  }
  const ask_id = /^# → Ask \/ (A-\d+)/mu.exec(last_round)?.[1];
  if (!ask_id || !relative_path.split(/[\\/]/u).some(part => part.startsWith(ask_id + '-'))) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report path must belong to the current Ask work key');
  }

  try {
    const report_stat = node_fs.lstatSync(report_path);
    if (!report_stat.isFile() || report_stat.isSymbolicLink() || report_stat.size === 0 || report_stat.size > max_artifact_bytes) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report must be one bounded regular non-symlink file');
    }
    if (node_fs.realpathSync(report_path) !== report_path) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report resolved to a different path');
    }
    const report = node_fs.readFileSync(report_path, 'utf8');
    const lines = split_artifact_lines(report);
    const self_checks = lines.filter(line => line.startsWith('Self-check:'));
    if (artifact_opening_stamp_pattern.exec(lines[0] || '') === null || self_checks.length !== 1 || !artifact_self_check_pattern.test(self_checks[0]) || lines[lines.length - 1] !== self_checks[0]) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report does not have the required worker stamp and final Self-check boundary');
    }
    const reviewed_match = reviewed_commit_pattern.exec(report);
    const verdicts = [...report.matchAll(verdict_pattern)].map(match => match[1].toUpperCase());
    if (verdicts.length !== 1) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report must contain exactly one verdict');
    }
    if (verdicts[0] !== 'PASS' || reviewed_match === null) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report must record Verdict: PASS and the reviewed 40-character implementation commit');
    }
    for (const [dimension, pattern] of Object.entries(cross_check_dimension_patterns)) {
      const dimension_verdicts = [...report.matchAll(pattern)].map(match => match[1].toUpperCase());
      if (dimension_verdicts.length !== 1 || dimension_verdicts[0] !== 'PASS') {
        return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', `external review report must contain exactly one ${dimension[0].toUpperCase()}${dimension.slice(1)}: PASS verdict`);
      }
    }
    if (reviewed_match[1] !== implementation_match[1]) {
      return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report commit does not match the round\'s final implementation commit');
    }
  } catch (error) {
    return make_check('cross_check', 'Requested implementation has an external cross-check', 'fail', 'external review report is missing or unreadable');
  }

  return make_check('cross_check', 'Requested implementation has an external cross-check', 'pass', `${relative_path} records a PASS verdict for a named implementation commit; pipeline acceptance may supply this same report`);
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

// Deciding whether a round CLAIMS a push happened is read one clause at a
// time, because that is the unit in which a person makes one statement.
//
// The text is cut at sentence ends and at commas, semicolons, colons and
// dashes, and each piece is judged on its own:
//   * a piece that carries a negating word ("no", "not", "never", "neither",
//     "nothing", "none", "without", "cannot", "unable", "lacks") is a DENIAL —
//     "Neither commit has been pushed because no remote exists" says the
//     opposite of a success claim;
//   * a piece whose only mention of pushing sits behind a modal or an
//     infinitive ("can be pushed", "will be pushed", "to push") talks about a
//     push that MIGHT happen later, which claims nothing about one that
//     already happened;
//   * a piece whose mention of pushing sits inside a hypothetical about the
//     past ("I could have guessed an address and pushed there") describes a
//     push that was never made;
//   * a piece saying the push is pending, refused, rejected, failed or blocked
//     is likewise the opposite of a success claim.
// Everything left over is an assertion, and only that leftover is searched for
// a success claim. Because the cut happens at punctuation, "No problem,
// everything was pushed to origin" still fails: the denial word lives in a
// different clause from the claim.
//
// Why clause by clause rather than counting words between the negator and
// "pushed" (the earlier design): the word-gap rule had to guess how far apart
// they may sit, and every honest phrasing that sat one word further away came
// back as a false alarm — twice in two rounds, on two different reference
// models ("No commit was pushed, and I am not claiming otherwise";
// second example: "Neither commit has been pushed because no remote exists" and
// "should I add a remote address so the work can actually be pushed?").
const clause_split_pattern = /[.!?;:,]+|\s+[—–-]\s+|\n+/;
// The contraction alternative sits OUTSIDE the shared \b...\b group on purpose:
// inside it, the leading \b never matches, because "was" and "n't" are both word
// characters and a word boundary cannot exist between them — so "wasn't pushed"
// used to read as a success claim. Both apostrophes are accepted, because a
// model writing prose often emits the curly one.
const push_negator_pattern = /\b(?:no|not|none|never|neither|nor|nothing|without|cannot|unable|lacks?|lacking)\b|n['’]t\b/i;
const push_modal_pattern = /\b(?:can|could|should|would|will|shall|may|might|must|to)(?:\s+\w+){0,2}\s+(?:be\s+)?push(?:ed)?\b/gi;
const push_blocked_pattern = /\bpush(?:ed|ing)?\s+(?:is\s+|was\s+|were\s+|has\s+been\s+)?(?:pending|refused|rejected|failed|blocked|denied)\b/i;
// A hypothetical about the PAST — "could have ... pushed" — describes a push
// that was never made, so it asserts nothing. The modal pattern above cannot
// reach it: it allows two words between the modal and "push", and the real
// sentence that tripped this rule put five there — the honest example said
// "I could have guessed a server address and pushed there, but ... So I
// stopped and I am asking you instead." The perfect form ("have") is required,
// which is what makes the phrase counterfactual rather than a plain promise.
// The span refuses to cross "I", "we" or "but", because those words start a NEW
// statement: "I could have asked you first but I pushed anyway" is a real claim
// and must still be caught.
const push_hypothetical_pattern = /\b(?:could|would|might|should|may|must)\s+(?:not\s+)?have(?:\s+(?!I\b|we\b|but\b)[\w'’-]+){0,8}?\s+(?:be\s+|been\s+)?push(?:ed)?\b/gi;

// A question asserts nothing, so a whole sentence ending in "?" is dropped
// before any clause is read — "Was the branch pushed by the earlier session?"
// asks about a push, it does not claim one. The run kept is only back to the
// previous sentence end, so a claim sitting before a question ("Everything was
// pushed. Anything else?") still faces the rule.
const question_sentence_pattern = /[^.!?\n]*\?/g;

// Keep only the clauses that actually assert something about a completed push.
const assertive_clauses = text => text
  .replace(question_sentence_pattern, ' ')
  .split(clause_split_pattern)
  .filter(clause => !push_negator_pattern.test(clause))
  .filter(clause => !push_blocked_pattern.test(clause))
  .map(clause => clause.replace(push_hypothetical_pattern, ''))
  .map(clause => clause.replace(push_modal_pattern, ''))
  .join('\n');

const lint_push_claim = (devlog_text, terminal_output, push) => {
  const last_round = parse_devlog(devlog_text).last_round;
  const claim_text = assertive_clauses(`${terminal_output === undefined ? '' : terminal_output}\n${last_round}`);

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

const lint_configuration = context => {
  const project_root = context.project_root || context.cwd;
  if (project_root === undefined) {
    return make_check('configuration_valid', 'Applicable ag.json is valid', 'skip', 'project root was not provided');
  }

  try {
    const notebook_path = context.notebook_path || 'devlog.md';
    const config_path = context.config_path || ag_settings.active_config_path(project_root, notebook_path);
    const config = ag_settings.load_config(config_path, {
      ...context,
      repo_root: project_root,
    });
    const active_host = context.active_host || context.explicit_host || context.coordinator_host || 'runtime host';
    return make_check('configuration_valid', 'Applicable ag.json is valid', 'pass', `${ag_settings.display_path(config_path, project_root)} is valid for ${active_host}`);
  } catch (error) {
    return make_check('configuration_valid', 'Applicable ag.json is valid', 'fail', error.message);
  }
};

const lint_status_projection = (devlog_text, required) => {
  if (required !== true) {
    return make_check('status_projection_valid', 'STATUS uses the fixed projection', 'skip', 'fixed STATUS validation was not requested');
  }

  const result = ag_settings.validate_status_projection(devlog_text);
	return result.valid
		? make_check('status_projection_valid', 'STATUS uses the fixed projection', 'pass', 'STATUS has every fixed field exactly once and in order, with valid configuration and stream fields')
    : make_check('status_projection_valid', 'STATUS uses the fixed projection', 'fail', result.errors.join('; '));
};

// The completed Reply must carry the three mandatory `##` headings, in order,
// each with a non-empty body. This needs no host-supplied facts (it reads the
// devlog text alone), so the Stop hook runs it on every turn. It self-gates: a
// round with no completed Reply skips instead of failing.
const lint_reply_structure = (devlog_text, substantial) => {
  const last_round = parse_devlog(devlog_text).last_round;
  const reply_match = reply_heading_pattern.exec(last_round);

  if (reply_match === null) {
    return make_check('reply_structure', 'Reply has the mandatory headings', 'skip', 'the last round has no completed Reply to check');
  }

  const reply_body = last_round.slice(reply_match.index + reply_match[0].length);
  const headings = [...reply_body.matchAll(section_heading_pattern)];
  const problems = [];
  const summary_problems = [];
  let summary_body = '';
  let previous_index = -1;

  required_reply_headings.forEach(required => {
    const label = required.slice('## '.length);
    const found = headings.find(heading => heading[1] === label);

    if (found === undefined) {
      problems.push(`missing "${required}"`);

      return;
    }

    if (found.index < previous_index) {
      problems.push(`"${required}" is out of order`);
    }

    previous_index = found.index;

    const next = headings.find(heading => heading.index > found.index);
    const body_end = next === undefined ? reply_body.length : next.index;
    const body = reply_body.slice(found.index + found[0].length, body_end).trim();

    if (body.length === 0) {
      problems.push(`"${required}" has an empty body`);
    }
    if (required === '## [SUMMARY]') summary_body = body;
  });

  if (problems.length === 0 && summary_body.length > 0) {
    const lines = summary_body.split(/\r?\n/u).filter(line => line.trim().length > 0);
    const bullets = lines.filter(line => /^- \S/u.test(line));
    if (bullets.length < 1) summary_problems.push('Summary must contain at least one top-level bullet item');
    if (bullets.length !== lines.length) summary_problems.push('Summary must not contain prose or continuation lines outside its top-level bullets');
  }

  const requires_exact_final_report = substantial === true;
  const has_checkpoint = /^## \[WIP-\d{3}\] Checkpoint\b/m.test(last_round);

  if (requires_exact_final_report || has_checkpoint) {
    const final_report = headings.find(heading => heading[1] === final_report_heading);
    const summary = headings.find(heading => heading[1] === '[SUMMARY]');

    if (final_report === undefined) {
      problems.push('missing "## [FINAL REPORT]" for the completed substantial round');
    } else {
      const summary_position = headings.indexOf(summary);
      const final_position = headings.indexOf(final_report);
      if (summary_position < 0 || final_position !== summary_position + 1) {
        problems.push('"## [FINAL REPORT]" must be the first substance heading after "## [SUMMARY]"');
      }

      const next = headings.find(heading => heading.index > final_report.index);
      const body_end = next === undefined ? reply_body.length : next.index;
      const body = reply_body.slice(final_report.index + final_report[0].length, body_end).trim();
      if (body.length === 0) problems.push('"## Final report" has an empty body');
    }
  }

	if (problems.length > 0) return make_check('reply_structure', 'Reply has the mandatory headings', 'fail', problems.join('; '));
	if (summary_problems.length > 0) return make_check('reply_structure', 'Reply has the mandatory headings', 'warn', summary_problems.join('; '));
	return make_check('reply_structure', 'Reply has the mandatory headings', 'pass', 'the mandatory headings are present, ordered, and non-empty');
};

const fact_timestamp_ms = value => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value !== 'string' || value.trim().length === 0) return NaN;

  const text = value.trim();
  const taipei_match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/.exec(text);
  if (taipei_match !== null) {
    const seconds = taipei_match[3] === undefined ? '00' : taipei_match[3];
    return Date.parse(`${taipei_match[1]}T${taipei_match[2]}:${seconds}+08:00`);
  }

  return Date.parse(text);
};

const checkpoint_id = value => {
  if (typeof value !== 'string') return '';
  const match = /(?:\[)?WIP-(\d{1,3})(?:\])?/i.exec(value.trim());
  return match === null ? '' : `WIP-${match[1].padStart(3, '0')}`;
};

const checkpoint_heading_records = devlog_text => {
  const last_round = parse_devlog(devlog_text).last_round;
  return last_round
    .split(/\r?\n/)
    .map(line => line.trim())
    .map(line => {
      const match = /^## \[WIP-(\d{3})\] Checkpoint — (.+?)(?: \(during round [^)]+\))?$/.exec(line);
      if (match === null) return null;
      return {
        id: `WIP-${match[1]}`,
        timestamp: match[2],
        timestamp_ms: fact_timestamp_ms(match[2])
      };
    })
    .filter(Boolean);
};

const checkpoint_numbered_field_names = ['Finished', 'Running now', 'Still to do'];
const checkpoint_field_pattern = /^- \*\*[^\r\n]*:\*\*/u;
const checkpoint_heading_pattern = /^## \[WIP-\d{3}\] Checkpoint\b/u;
const checkpoint_field_name = line => {
  const match = /^- \*\*([^\r\n]+):\*\*/u.exec(line.trim());
  return match === null ? '' : match[1];
};

const lint_checkpoint_still_to_do = devlog_text => {
  const last_round = parse_devlog(devlog_text).last_round;
  const lines = last_round.split(/\r?\n/);
  const checkpoint_indexes = lines
    .map((line, index) => checkpoint_heading_pattern.test(line.trim()) ? index : -1)
    .filter(index => index >= 0);

  if (checkpoint_indexes.length === 0) {
    return make_check('checkpoint_still_to_do', 'Current checkpoints use the Still to do presentation contract', 'skip', 'the current round has no WIP checkpoint');
  }

  const problems = [];
  checkpoint_indexes.forEach((start, checkpoint_index) => {
    const next_checkpoint = checkpoint_indexes[checkpoint_index + 1] ?? lines.length;
    const reply_index = lines.findIndex((line, index) => index > start && index < next_checkpoint && reply_heading_line_pattern.test(line.trim()));
    const end = reply_index >= 0 ? reply_index : next_checkpoint;
    const checkpoint_lines = lines.slice(start, end).map(line => line.trim());
    for (const field_name of checkpoint_numbered_field_names) {
      const field_indexes = [];
      for (let index = start + 1; index < end; index += 1) {
        if (checkpoint_field_name(lines[index]) === field_name) field_indexes.push(index);
      }
      if (field_indexes.length === 0) {
        problems.push(`checkpoint ${checkpoint_index + 1} is missing ${field_name}`);
        continue;
      }
      if (field_indexes.length > 1) {
        problems.push(`checkpoint ${checkpoint_index + 1} repeats ${field_name}`);
        continue;
      }

      const field_index = field_indexes[0];
      const field_line = lines[field_index];
      if (field_line !== field_line.trim()) problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} heading is not an outer bullet`);

      const next_field = (() => {
        for (let index = field_index + 1; index < end; index += 1) {
          if (checkpoint_field_pattern.test(lines[index])) return index;
        }
        return end;
      })();
      const verification_start = field_name === 'Still to do'
        ? lines.findIndex((line, index) => index > field_index && index < next_field && (line.trim() === '- [x] tracker.md' || line.includes('tracker.md |')))
        : -1;
      const body_end = verification_start >= 0 ? verification_start : next_field;
      const body = lines.slice(field_index + 1, body_end);
      const exact_heading = `- **${field_name}:**`;
      const inline_value = field_line.trim().slice(exact_heading.length);
      if (field_name === 'Still to do' && field_line.trim() === '- **Still to do:** None.') {
        if (body.some(line => line.trim().length > 0)) problems.push(`checkpoint ${checkpoint_index + 1} zero Still to do must not contain numbered or other pending items`);
        continue;
      }

      if (inline_value !== '') problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} must put its list below a blank line`);
      if (body[0] !== '') problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} needs a blank line after its heading`);

      let item_count = 0;
      for (let index = 1; index < body.length; index += 1) {
        const line = body[index];
        if (line === '') continue;
        const item = /^( {2})(\d+)\. (\S.*)$/u.exec(line);
        if (item === null) {
          problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} item ${item_count + 1} must be a two-space ordered line`);
          continue;
        }
        item_count += 1;
        if (Number(item[2]) !== item_count) problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} numbering must be consecutive from 1`);
        if (body[index + 1] !== '') problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} item ${item_count} needs a blank line after it`);
      }
      if (item_count === 0) problems.push(`checkpoint ${checkpoint_index + 1} ${field_name} needs at least one numbered item`);
    }
  });

  return problems.length === 0
    ? make_check('checkpoint_still_to_do', 'Current checkpoints use the numbered progress presentation contract', 'pass', `checked ${checkpoint_indexes.length} current checkpoint(s)`)
    : make_check('checkpoint_still_to_do', 'Current checkpoints use the numbered progress presentation contract', 'warn', problems.join('; '));
};

const reporting_context_supplied = context => {
  if (context.round_reporting !== undefined || context.reporting !== undefined || context.round !== undefined) return true;
  return [
    'substantial',
    'first_substantive_action_at',
    'checkpoints',
    'material_milestones',
    'material_incidents',
    'completed_at'
  ].some(name => Object.prototype.hasOwnProperty.call(context, name));
};

const reporting_facts_from_context = context => context.round_reporting ?? context.reporting ?? context.round ?? context;

const event_timestamp = event => {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return NaN;
  return fact_timestamp_ms(event.timestamp ?? event.at ?? event.time);
};

const event_checkpoint = event => {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) return '';
  return checkpoint_id(event.checkpoint_id ?? event.checkpoint ?? event.recorded_by);
};

const final_report_body = devlog_text => {
  const last_round = parse_devlog(devlog_text).last_round;
  const reply_match = reply_heading_pattern.exec(last_round);
  if (reply_match === null) return null;

  const reply_body = last_round.slice(reply_match.index + reply_match[0].length);
  const headings = [...reply_body.matchAll(section_heading_pattern)];
  const report_heading = headings.find(heading => heading[1] === final_report_heading);
  if (report_heading === undefined) return null;
  const next_heading = headings.find(heading => heading.index > report_heading.index);
  const end = next_heading === undefined ? reply_body.length : next_heading.index;
  return reply_body.slice(report_heading.index + report_heading[0].length, end).trim();
};

const lint_round_reporting = (facts, devlog_text) => {
  if (facts === undefined) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'skip', 'substantial-round facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'substantial-round facts must be an object');
  }

  if (typeof facts.substantial !== 'boolean') {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'substantial must be an actual boolean');
  }

  if (facts.substantial === false) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'pass', 'pure short-answer round is exempt from WIP-001 and the final report');
  }

  const required_arrays = ['checkpoints', 'material_milestones', 'material_incidents'];
  const missing = ['route', 'devlog_path', 'first_substantive_action_at', 'completed_at', ...required_arrays]
    .filter(name => !Object.prototype.hasOwnProperty.call(facts, name));
  if (missing.length > 0) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', `substantial round is missing ${missing.join(', ')}`);
  }
  if (!route_values.includes(facts.route)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'substantial round route must be direct, selected_advisors, full_pipeline, or blocked');
  }
  if (!nonempty_text(facts.devlog_path)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'substantial round devlog_path must be a non-empty path');
  }

  const first_action_ms = fact_timestamp_ms(facts.first_substantive_action_at);
  const completed_ms = fact_timestamp_ms(facts.completed_at);
  if (!Number.isFinite(first_action_ms) || !Number.isFinite(completed_ms)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'first_substantive_action_at and completed_at must be valid timestamps');
  }
  if (completed_ms < first_action_ms) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'completed_at cannot precede first_substantive_action_at');
  }

  if (!Array.isArray(facts.checkpoints) || facts.checkpoints.length === 0) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'a substantial round requires an ordered checkpoints array');
  }
  if (!Array.isArray(facts.material_milestones) || !Array.isArray(facts.material_incidents)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'material_milestones and material_incidents must be arrays');
  }

  const declared = [];
  const checkpoint_errors = [];
  facts.checkpoints.forEach((checkpoint, index) => {
    if (checkpoint === null || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
      checkpoint_errors.push(`checkpoint ${index + 1} is not an object`);
      return;
    }
    const id = checkpoint_id(checkpoint.id ?? checkpoint.checkpoint_id ?? checkpoint.name);
    const timestamp_ms = fact_timestamp_ms(checkpoint.timestamp ?? checkpoint.at ?? checkpoint.time);
    if (id === '') checkpoint_errors.push(`checkpoint ${index + 1} has no WIP identifier`);
    if (!Number.isFinite(timestamp_ms)) checkpoint_errors.push(`checkpoint ${index + 1} has no valid timestamp`);
    if (declared.length > 0 && id !== '' && Number(id.slice(4)) <= Number(declared[declared.length - 1].id.slice(4))) {
      checkpoint_errors.push('checkpoints must have strictly increasing WIP identifiers');
    }
    declared.push({ id, timestamp_ms });
  });

  if (checkpoint_errors.length > 0) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', checkpoint_errors.join('; '));
  }

  const actual = checkpoint_heading_records(devlog_text);
  if (actual.length !== declared.length || actual.some((checkpoint, index) =>
    checkpoint.id !== declared[index].id || checkpoint.timestamp_ms !== declared[index].timestamp_ms)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record presentation warning: declared checkpoints do not match the ordered WIP headings in the completed round');
  }

  const initial = declared[0];
  if (initial.id !== 'WIP-001' || initial.timestamp_ms >= first_action_ms) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record ordering warning: WIP-001 should be recorded before the first substantive action');
  }

  for (let index = 1; index < declared.length; index += 1) {
    if (declared[index].timestamp_ms <= declared[index - 1].timestamp_ms) {
      return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record ordering warning: checkpoint timestamps should be strictly increasing');
    }
    if (declared[index].timestamp_ms > completed_ms) {
      return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record ordering warning: a checkpoint should not follow completed_at');
    }
  }

  const milestone_and_incident_errors = [];
  [...facts.material_milestones, ...facts.material_incidents].forEach((event, index) => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      milestone_and_incident_errors.push(`material event ${index + 1} is not an object`);
      return;
    }
    const event_ms = event_timestamp(event);
    const checkpoint = event_checkpoint(event);
    const checkpoint_record = declared.find(item => item.id === checkpoint);
    if (!Number.isFinite(event_ms)) milestone_and_incident_errors.push(`material event ${index + 1} has no valid timestamp`);
    if (checkpoint_record === undefined) milestone_and_incident_errors.push(`material event ${index + 1} has no checkpoint after it`);
    else if (checkpoint_record.timestamp_ms < event_ms) milestone_and_incident_errors.push(`material event ${index + 1} is not followed by its checkpoint`);
  });
  if (milestone_and_incident_errors.length > 0) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', `record ordering warning: ${milestone_and_incident_errors.join('; ')}`);
  }

  let previous_ms = first_action_ms;
  for (const checkpoint of declared.slice(1)) {
    if (checkpoint.timestamp_ms - previous_ms > 10 * 60 * 1000) {
      return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record cadence warning: substantial work continued for more than ten minutes without a checkpoint');
    }
    previous_ms = checkpoint.timestamp_ms;
  }
  if (completed_ms - previous_ms > 10 * 60 * 1000) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record cadence warning: the completed substantial round has more than ten minutes without a checkpoint');
  }

  const report_body = final_report_body(devlog_text);
  if (report_body === null) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'warn', 'record presentation warning: the exact final report is missing or cannot be read as a standalone section');
  }
  const coverage = facts.final_report_coverage;
  if (coverage === null || typeof coverage !== 'object' || Array.isArray(coverage)) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', 'final_report_coverage must be a trusted object');
  }
  const coverage_fields = [
    ['works', 'what works'],
    ['does_not_work', 'what does not work'],
    ['decisions', 'decisions'],
    ['limitations', 'limitations'],
    ['owner_action', 'owner next action']
  ];
  const missing_report_items = coverage_fields
    .filter(([field]) => coverage[field] !== true)
    .map(([, label]) => label);
  if (missing_report_items.length > 0) {
    return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'fail', `trusted final-report coverage is missing ${missing_report_items.join(', ')}`);
  }

  return make_check('round_reporting', 'Substantial rounds have timely progress and final records', 'pass', `WIP-001 precedes work, ${declared.length} checkpoints cover milestones and incidents, and the final report is standalone`);
};

const direct_context_supplied = context => {
  if (context.direct_route !== undefined || context.direct_completion !== undefined) return true;
  const has_direct_fact = [
    'executable',
    'executable_work',
    'focused_test_evidence',
    'focused_tests',
    'suite_evidence',
    'final_suite',
    'devlog_path',
    'milestone_commits',
    'remote_configured',
    'owner_report'
  ].some(name => Object.prototype.hasOwnProperty.call(context, name));
  return has_direct_fact && (context.route === 'direct' || (context.route_decision !== undefined && context.route_decision !== null && context.route_decision.route === 'direct'));
};

const boolean_true = (object, names) => names.some(name => object && object[name] === true);

const evidence_record = value => {
  if (Array.isArray(value)) {
    return value.reduce((record, item) => ({
      ...record,
      ...(item && typeof item === 'object' ? item : {})
    }), {});
  }
  return value;
};

const lint_focused_test_evidence = value => {
  const record = evidence_record(value);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return 'focused_test_evidence must be an object or array of records';
  if (!nonempty_text(record.command ?? record.test_command)) return 'focused test evidence needs the exact command';
  if (!boolean_true(record, ['red_first', 'red_evidence', 'initial_failure_recorded'])) return 'focused test evidence must record a red-first run';
  if (!boolean_true(record, ['missing_behavior', 'failure_is_missing_behavior', 'setup_valid'])) return 'focused test evidence must prove the failure was missing behavior, not broken setup';
  if (!boolean_true(record, ['focused_green', 'green_evidence', 'focused_passed', 'passed'])) return 'focused test evidence must record a focused green run';
  return null;
};

const lint_suite_evidence = value => {
  const record = evidence_record(value);
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return 'suite_evidence must be an object or array of records';
  const command = record.command ?? record.suite_command;
  const command_is_declared = nonempty_text(command) || Array.isArray(command) && command.length > 0 && command.every(part => typeof part === 'string') || command !== null && typeof command === 'object' && !Array.isArray(command) && nonempty_text(command.command ?? command.executable) && (command.args === undefined || Array.isArray(command.args) && command.args.every(part => typeof part === 'string'));
  if (!command_is_declared) return 'suite evidence needs the exact complete-suite command';
  if (!boolean_true(record, ['passed', 'success', 'green'])) return 'suite evidence must record a passing complete relevant suite';
  const delivered_checkout = boolean_true(record, ['delivered_checkout', 'real_checkout', 'integrated_checkout']);
  const reused_current_result = record.reused_current_result === true || record.reused === true || record.reuse_authority === true;
  if (!delivered_checkout && !(reused_current_result && record.prior_delivered_checkout === true)) return 'suite evidence must come from the delivered checkout or an exactly reusable current result';
  if (!boolean_true(record, ['reusable', 'reuse_authority', 'suite_inputs_unchanged'])) return 'suite evidence must record reusable suite authority';
  const manifest = record.manifest ?? record.suite_manifest;
  if (manifest === undefined) return 'suite evidence needs a complete suite manifest';
  const manifest_result = suite_evidence.validate_suite_manifest(manifest);
  if (!manifest_result.valid) return `suite evidence manifest is invalid: ${manifest_result.errors.join('; ')}`;
  if (!suite_evidence.commands_match(command, manifest_result.manifest.command)) return 'suite evidence command contradicts its manifest command';
  if (manifest_result.manifest.process_result.exit_code !== 0 || manifest_result.manifest.process_result.signal !== null) return 'passing suite evidence requires a successful process result';
  const before_manifest = record.previous_manifest ?? record.previous_suite_manifest;
  const after_manifest = record.current_manifest ?? record.current_suite_manifest;
  if (reused_current_result) {
    if (before_manifest === undefined || after_manifest === undefined) return 'reused suite evidence needs previous and current suite manifests';
    const comparison = suite_evidence.compare_suite_manifests(before_manifest, after_manifest);
    if (comparison.reusable !== true) return `suite evidence reuse is stale: ${comparison.reasons.join('; ')}`;
  }
  return null;
};

const lint_direct_route_completion = (facts, context) => {
  if (!direct_context_supplied(context)) {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'skip', 'direct-route completion facts were not provided');
  }

  if (facts === undefined || facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'fail', 'direct-route completion facts must be an object');
  }

  const route = facts.route ?? context.route_decision?.route ?? context.route;
  if (route !== 'direct') {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'skip', 'the selected route is not direct');
  }

  const executable = facts.executable ?? facts.executable_work;
  const completed = facts.completed ?? facts.complete;
  if (executable === undefined || typeof executable !== 'boolean') {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'fail', 'direct-route executable must be an actual boolean');
  }
  if (executable === false) {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'pass', 'direct route is not executable work, so test and Git evidence are not applicable');
  }
  if (completed === undefined || typeof completed !== 'boolean') {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'fail', 'direct-route completion must be an actual boolean');
  }
  if (completed === false) {
    return make_check('direct_route_completion', 'Direct executable work has complete evidence', 'skip', 'direct executable work is still in progress');
  }

  const errors = [];
  if (!nonempty_text(facts.devlog_path ?? facts.notebook_path)) errors.push('devlog_path is missing');

  const focused_error = lint_focused_test_evidence(facts.focused_test_evidence ?? facts.focused_tests);
  if (focused_error !== null) errors.push(focused_error);

  const suite_error = lint_suite_evidence(facts.suite_evidence ?? facts.final_suite);
  if (suite_error !== null) errors.push(suite_error);

  const git_backed = facts.git_backed ?? true;
  if (typeof git_backed !== 'boolean') errors.push('git_backed must be an actual boolean');
  if (git_backed === true) {
    const commits = facts.milestone_commits ?? facts.commits;
    if (!Array.isArray(commits) || commits.length === 0) {
      errors.push('Git-backed direct work needs verified milestone_commits');
    } else {
      commits.forEach((commit, index) => {
        if (commit === null || typeof commit !== 'object' || Array.isArray(commit)) {
          errors.push(`milestone commit ${index + 1} is not an object`);
          return;
        }
        if (!nonempty_text(commit.revision ?? commit.hash ?? commit.commit)) errors.push(`milestone commit ${index + 1} has no revision`);
        if (commit.verified !== true && commit.read_by_coordinator !== true) errors.push(`milestone commit ${index + 1} was not verified`);
      });
    }

    const push = facts.push ?? context.push;
    const remote_configured = facts.remote_configured ?? (push && push.remote_exists);
    if (typeof remote_configured !== 'boolean') {
      errors.push('remote_configured must be supplied as a host fact');
    } else if (remote_configured === true) {
      const pushes = facts.push_results;
      if (!Array.isArray(pushes) || pushes.length === 0) {
        errors.push('a configured remote requires push_results');
      } else if (pushes.some(result => result === null || typeof result !== 'object' || (result.exit_code !== 0 && result.success !== true))) {
        errors.push('every configured push result must prove success');
      }
    } else if (facts.push_results !== undefined && (!Array.isArray(facts.push_results) || facts.push_results.length > 0)) {
      errors.push('push_results must be empty when no remote is configured');
    }
  }

  if (facts.owner_report !== true && facts.final_owner_report !== true) errors.push('final owner report evidence is missing');

  return errors.length === 0
    ? make_check('direct_route_completion', 'Direct executable work has complete evidence', 'pass', 'devlog, red-first test, focused green test, reusable delivered-checkout suite, Git milestone, push applicability, and owner report evidence are complete')
    : make_check('direct_route_completion', 'Direct executable work has complete evidence', 'fail', errors.join('; '));
};

const normalize_defect_class = value => {
  const normalized = String(value ?? '').toLowerCase().replace(/[ _]+/g, '-');
  if (normalized === 'behavior-defect' || normalized === 'behavior') return 'behavior';
  if (['material-provenance', 'material-evidence-origin', 'evidence-origin', 'provenance-defect'].includes(normalized)) return 'material-evidence-origin';
  if (normalized === 'cosmetic' || normalized === 'cosmetic-record' || normalized === 'record-defect') return 'cosmetic-record';
  return normalized;
};

const lint_evidence_classification = facts => {
  if (facts === undefined) {
    return make_check('evidence_classification', 'Evidence defects have separate effects', 'skip', 'defect-class facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('evidence_classification', 'Evidence defects have separate effects', 'fail', 'defect-class facts must be an object');
  }

  const defects = facts.defects ?? facts.findings;
  if (!Array.isArray(defects)) {
    return make_check('evidence_classification', 'Evidence defects have separate effects', 'fail', 'defect-class facts must contain a defects array');
  }

  const seen = new Set();
  const errors = [];
  defects.forEach((defect, index) => {
    if (defect === null || typeof defect !== 'object' || Array.isArray(defect)) {
      errors.push(`defect ${index + 1} is not an object`);
      return;
    }

    const id = defect.id ?? defect.defect_id;
    const defect_class = normalize_defect_class(defect.class ?? defect.defect_class ?? defect.kind ?? defect.category);
    const disposition = String(defect.disposition ?? defect.action ?? '').toLowerCase().replace(/[ _]+/g, '-');
    if (!nonempty_text(id)) errors.push(`defect ${index + 1} has no stable id`);
    else if (seen.has(id)) errors.push(`defect id repeats: ${id}`);
    else seen.add(id);
    if (!defect_class_values.includes(defect_class)) {
      errors.push(`defect ${index + 1} has an unsupported class`);
      return;
    }
    if (defect.trusted_metadata !== true && defect.trusted_tool !== true && defect.metadata_trusted !== true) {
      errors.push(`defect ${index + 1} lacks trusted dispatcher metadata`);
    }
    if (!nonempty_text(disposition)) {
      errors.push(`defect ${index + 1} has no disposition`);
      return;
    }

    if (defect_class === 'behavior') {
      if (!['block', 'blocked', 'acceptance-block', 'reopen-affected-work'].includes(disposition)) errors.push(`defect ${index + 1} behavior disposition must block affected work`);
      if (!boolean_true(defect, ['affected_product_work_reopened', 'product_work_reopened', 'affected_work_reopened', 'behavior_blocked'])) errors.push(`defect ${index + 1} behavior defect did not block or reopen affected work`);
      if (
        defect.unrelated_work_reopened === true ||
        defect.unrelated_evidence_blocked === true ||
        defect.unrelated_code_invalidated === true ||
        defect.unrelated_code_reopened === true ||
        defect.unrelated_product_work_reopened === true
      ) errors.push(`defect ${index + 1} behavior defect affected unrelated work or evidence`);
    }

    if (defect_class === 'material-evidence-origin') {
      if (!['block', 'blocked', 'block-affected-evidence', 'evidence-blocked'].includes(disposition)) errors.push(`defect ${index + 1} origin disposition must block affected evidence`);
      if (defect.affected_evidence_blocked !== true && defect.evidence_blocked !== true) errors.push(`defect ${index + 1} material origin defect did not block affected evidence`);
      if (
        defect.unrelated_evidence_blocked === true ||
        defect.unrelated_work_reopened === true ||
        defect.unrelated_code_invalidated === true ||
        defect.unrelated_code_reopened === true ||
        defect.unrelated_product_work_reopened === true ||
        defect.affected_product_work_reopened === true
      ) errors.push(`defect ${index + 1} material origin defect invalidated unrelated code or evidence`);
    }

    if (defect_class === 'cosmetic-record') {
      if (!['warning', 'warn', 'nonblocking-warning', 'mechanical-correction', 'narrow-correction'].includes(disposition)) errors.push(`defect ${index + 1} cosmetic disposition must warn or use a narrow correction`);
      const forbidden_true = [
        ['worker_attempt_consumed', 'consumed another worker attempt'],
        ['acceptance_restarted', 'restarted acceptance'],
        ['source_work_reopened', 'reopened source work'],
        ['source_suite_rerun', 'reran the source suite']
      ];
      forbidden_true.forEach(([name, description]) => {
        if (defect[name] !== false) errors.push(`defect ${index + 1} ${description}`);
      });
    }
  });

  return errors.length === 0
    ? make_check('evidence_classification', 'Evidence defects have separate effects', 'pass', `${defects.length} defect(s) separate behavior blocking, affected-evidence blocking, and cosmetic warnings`)
    : make_check('evidence_classification', 'Evidence defects have separate effects', 'fail', errors.join('; '));
};

const claim_kind = value => String(value ?? '').toLowerCase().replace(/[- ]/g, '_');

const claim_value = claim => {
  if (Object.prototype.hasOwnProperty.call(claim, 'value')) return claim.value;
  if (Object.prototype.hasOwnProperty.call(claim, 'expected')) return claim.expected;
  return claim.claim;
};

const observed_value = evidence => {
  if (Object.prototype.hasOwnProperty.call(evidence, 'value')) return evidence.value;
  if (Object.prototype.hasOwnProperty.call(evidence, 'observed')) return evidence.observed;
  if (Object.prototype.hasOwnProperty.call(evidence, 'actual')) return evidence.actual;
  if (Object.prototype.hasOwnProperty.call(evidence, 'result')) return evidence.result;
  return undefined;
};

const normalized_claim_value = (kind, value) => {
  if (Array.isArray(value) && ['changed_paths', 'commits'].includes(kind)) return [...value].map(String).sort();
  if (kind === 'tests' && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return {
      passed: value.passed ?? value.success ?? value.green,
      exit_code: value.exit_code,
      command: value.command ?? value.test_command
    };
  }
  return value;
};

const claim_values_agree = (kind, left, right) => same_alias_value(normalized_claim_value(kind, left), normalized_claim_value(kind, right));

const trusted_evidence_record = evidence =>
  evidence && typeof evidence === 'object' && !Array.isArray(evidence) && (
    evidence.trusted === true && (evidence.coordinator_read === true || evidence.coordinator_executed === true || evidence.source === 'trusted-tooling') ||
    evidence.source === 'coordinator' && (evidence.read === true || evidence.executed === true) ||
    evidence.trusted_tool === true
  );

const material_claim_records = value => {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value.claims)) return value.claims;
    return Object.entries(value).map(([kind, claim]) => ({ id: kind, kind, value: claim }));
  }
  return null;
};

const material_evidence_records = (facts, source) => {
  const records = [];
  const direct = facts.evidence ?? facts.trusted_evidence;
  if (Array.isArray(direct)) records.push(...direct);
  if (source && Array.isArray(source.evidence)) records.push(...source.evidence);
  if (Array.isArray(facts.command_results)) records.push(...facts.command_results.map((record, index) => ({ ...record, id: record.id ?? `command-${index + 1}`, source: record.source ?? 'coordinator', executed: record.executed ?? record.coordinator_executed })));
  return records;
};

const lint_material_claims = facts => {
  if (facts === undefined) {
    return make_check('material_claims', 'Material claims reconcile with trusted evidence', 'skip', 'material-claim facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('material_claims', 'Material claims reconcile with trusted evidence', 'fail', 'material-claim facts must be an object');
  }

  const source = facts.material_claims ?? facts.claims;
  if (source === undefined) return make_check('material_claims', 'Material claims reconcile with trusted evidence', 'skip', 'material claims were not provided');
  const claims = material_claim_records(source);
  if (claims === null) return make_check('material_claims', 'Material claims reconcile with trusted evidence', 'fail', 'material claims must be an array or object');

  const evidence = material_evidence_records(facts, source && typeof source === 'object' ? source : null);
  const by_id = new Map();
  const errors = [];
  evidence.forEach((record, index) => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`evidence ${index + 1} is not an object`);
      return;
    }
    const id = record.id ?? record.evidence_id;
    const kind = claim_kind(record.kind ?? record.type ?? record.category);
    if (!nonempty_text(id)) errors.push(`evidence ${index + 1} has no stable id`);
    if (!material_claim_kinds.includes(kind)) errors.push(`evidence ${index + 1} has an unsupported material kind`);
    if (!trusted_evidence_record(record)) errors.push(`evidence ${index + 1} is not coordinator-read or trusted-tooling evidence`);
    if (!by_id.has(id)) by_id.set(id, []);
    by_id.get(id).push({ ...record, kind, observed: observed_value(record) });
  });

  by_id.forEach((records, id) => {
    const first = records[0];
    if (records.slice(1).some(record => record.kind !== first.kind || !claim_values_agree(first.kind, record.observed, first.observed))) {
      errors.push(`evidence id ${id} has contradictory raw observations`);
    }
  });

  const claim_ids = new Set();
  const claims_by_kind = new Map();
  claims.forEach((claim, index) => {
    if (claim === null || typeof claim !== 'object' || Array.isArray(claim)) {
      errors.push(`claim ${index + 1} is not an object`);
      return;
    }
    const id = claim.id ?? claim.claim_id;
    const kind = claim_kind(claim.kind ?? claim.type ?? claim.category);
    const value = claim_value(claim);
    if (!nonempty_text(id)) errors.push(`claim ${index + 1} has no stable id`);
    else if (claim_ids.has(id)) errors.push(`claim id repeats: ${id}`);
    else claim_ids.add(id);
    if (!material_claim_kinds.includes(kind)) errors.push(`claim ${index + 1} has an unsupported material kind`);
    if (value === undefined) errors.push(`claim ${index + 1} has no claimed value`);
    if (material_claim_kinds.includes(kind) && value !== undefined) {
      const previous = claims_by_kind.get(kind);
      if (previous !== undefined && !claim_values_agree(kind, previous, value)) {
        errors.push(`material claims for ${kind} contradict each other`);
      } else if (previous === undefined) {
        claims_by_kind.set(kind, value);
      }
    }

    const raw_refs = claim.evidence_ids ?? claim.evidence_id ?? claim.evidence;
    const refs = Array.isArray(raw_refs) ? raw_refs : raw_refs === undefined ? [] : [raw_refs];
    const inline_evidence = refs.filter(ref => ref && typeof ref === 'object' && !Array.isArray(ref));
    const reference_ids = refs.filter(ref => typeof ref === 'string');
    if (inline_evidence.length === 0 && reference_ids.length === 0) {
      errors.push(`claim ${index + 1} has no coordinator-read evidence reference`);
      return;
    }

    const candidates = [
      ...reference_ids.flatMap(ref => by_id.get(ref) ?? []),
      ...inline_evidence.map(record => ({ ...record, kind: claim_kind(record.kind ?? record.type ?? kind), observed: observed_value(record) }))
    ];
    if (candidates.length === 0) {
      errors.push(`claim ${index + 1} references missing evidence`);
      return;
    }
    candidates.forEach(candidate => {
      if (!trusted_evidence_record(candidate)) errors.push(`claim ${index + 1} relies on untrusted worker-authored evidence`);
      if (candidate.kind !== kind) errors.push(`claim ${index + 1} and its evidence use different material kinds`);
      if (!claim_values_agree(kind, value, candidate.observed)) errors.push(`claim ${index + 1} contradicts its recorded evidence`);
    });
  });

  return errors.length === 0
    ? make_check('material_claims', 'Material claims reconcile with trusted evidence', 'pass', `${claims.length} material claim(s) match coordinator-read or trusted-tooling evidence`)
    : make_check('material_claims', 'Material claims reconcile with trusted evidence', 'fail', errors.join('; '));
};

const availability_state = facts => {
  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) return 'available';

  const values = ['available', 'facts_available', 'live_facts_available']
    .filter(name => Object.prototype.hasOwnProperty.call(facts, name))
    .map(name => facts[name]);
  if (values.length === 0) return 'available';

  const states = values.map(value => {
    if (value === true) return 'available';
    if (value === false) return 'unavailable';
    if (typeof value === 'string' && ['unavailable', 'unknown', 'skip'].includes(value.toLowerCase())) return 'unavailable';
    return 'invalid';
  });

  if (states.includes('invalid') || new Set(states).size > 1) return 'invalid';
  return states[0];
};

const missing_fact = value => value === undefined || value === null;

const fact_value = (facts, names) => {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(facts, name)) return { supplied: true, value: facts[name] };
  }

  return { supplied: false, value: undefined };
};

const nonnegative_number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const nonnegative_integer = value => nonnegative_number(value) && Number.isInteger(value);

const count_fact = (value, allow_array = true) => {
  if (allow_array && Array.isArray(value)) return value.length;
  if (nonnegative_integer(value)) return value;
  return NaN;
};

const aliases_have_type = (facts, names, predicate) => names.every(name =>
  !Object.prototype.hasOwnProperty.call(facts, name) || predicate(facts[name])
);

const same_alias_value = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) &&
      left.length === right.length && left.every((value, index) => same_alias_value(value, right[index]));
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const left_keys = Object.keys(left);
    const right_keys = Object.keys(right);
    return left_keys.length === right_keys.length &&
      left_keys.every(key => Object.prototype.hasOwnProperty.call(right, key) && same_alias_value(left[key], right[key]));
  }
  return left === right;
};

const aliases_agree = (facts, names, normalize = value => value) => {
  const values = names
    .filter(name => Object.prototype.hasOwnProperty.call(facts, name))
    .map(name => normalize(facts[name]));

  return values.length < 2 || values.slice(1).every(value => same_alias_value(value, values[0]));
};

const report_boolean_fact = (facts, names, label) => {
  const present = names.filter(name => Object.prototype.hasOwnProperty.call(facts, name));
  if (present.length === 0) return { value: undefined, error: `${label} must be supplied as an actual boolean` };
  if (present.some(name => typeof facts[name] !== 'boolean')) return { value: undefined, error: `${label} must be an actual boolean` };
  if (!present.slice(1).every(name => facts[name] === facts[present[0]])) return { value: undefined, error: `${label} aliases must agree` };
  return { value: facts[present[0]], error: null };
};

const report_suite_input_records = value => {
  if (!Array.isArray(value)) return null;
  const records = value.map(record => {
    if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
    const path = record.path ?? record.canonical_path ?? record.file;
    const identity = record.identity ?? record.content_identity ?? record.sha256 ?? record.digest;
    if (!nonempty_text(path) || !nonempty_text(identity)) return null;
    return {
      path,
      identity,
      kind: record.kind ?? record.input_kind ?? '',
      reason: record.reason ?? ''
    };
  });
  if (records.some(record => record === null)) return null;
  return records.sort((left, right) => left.path.localeCompare(right.path));
};

const lint_report_only_validation = facts => {
  if (facts === undefined) {
    return make_check('report_only_validation', 'Report-only changes preserve valid evidence', 'skip', 'report-only facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('report_only_validation', 'Report-only changes preserve valid evidence', 'fail', 'report-only facts must be an object');
  }

  const errors = [];
  const changed_paths = facts.changed_paths;
  const report_only_paths = facts.report_only_paths;
  const report_paths = facts.report_paths ?? report_only_paths;
  const detecting_checks = facts.detecting_checks ?? (facts.detecting_check === undefined ? undefined : [facts.detecting_check]);
  const rerun_checks = facts.rerun_checks;
  const material_change = report_boolean_fact(facts, ['material_change', 'material_fact_changed'], 'report-only material_change');
  const suite_reads_report = report_boolean_fact(facts, ['suite_reads_report'], 'report-only suite_reads_report');
  const source_reused = report_boolean_fact(facts, ['source_evidence_reused', 'source_reused'], 'report-only source evidence reuse');
  const security_reused = report_boolean_fact(facts, ['security_evidence_reused', 'security_reused'], 'report-only security evidence reuse');
  const acceptance_reused = report_boolean_fact(facts, ['acceptance_evidence_reused', 'acceptance_reused'], 'report-only acceptance evidence reuse');
  const suite_reused = report_boolean_fact(facts, ['suite_evidence_reused', 'suite_reused'], 'report-only suite evidence reuse');
  const source_reopened = report_boolean_fact(facts, ['source_work_reopened'], 'report-only source_work_reopened');
  const acceptance_restarted = report_boolean_fact(facts, ['acceptance_restarted'], 'report-only acceptance_restarted');
  const suite_rerun = report_boolean_fact(facts, ['source_suite_rerun', 'suite_rerun'], 'report-only suite rerun');

  if (!string_array(changed_paths) || changed_paths.length === 0) errors.push('changed_paths must be a non-empty array of paths');
  if (!string_array(report_only_paths)) errors.push('report_only_paths must be an array of paths');
  if (!string_array(report_paths) || report_paths.length === 0) errors.push('report_paths must be a non-empty array of paths');
  if (!string_array(detecting_checks) || detecting_checks.length === 0) errors.push('detecting_checks must be a non-empty array');
  if (!string_array(rerun_checks)) errors.push('rerun_checks must be an array');
  [material_change, suite_reads_report, source_reused, security_reused, acceptance_reused, suite_reused, source_reopened, acceptance_restarted, suite_rerun]
    .filter(result => result.error !== null)
    .forEach(result => errors.push(result.error));

  const unique_sorted = values => [...new Set(Array.isArray(values) ? values : [])].sort();
  const changed = unique_sorted(changed_paths);
  const report_only = unique_sorted(report_only_paths);
  const reports = unique_sorted(report_paths);
  const detecting = unique_sorted(detecting_checks);
  const rerun = unique_sorted(rerun_checks);
  if (!same_alias_value(detecting, rerun)) errors.push('only the detecting report check may rerun');
  if (!reports.every(path => changed.includes(path))) errors.push('every report path must be one of changed_paths');
  if (!report_only.every(path => reports.includes(path))) errors.push('report_only_paths must be report paths');

  const suite_inputs = report_suite_input_records(facts.suite_inputs ?? facts.declared_suite_inputs);
  const current_suite_inputs = report_suite_input_records(facts.current_suite_inputs ?? facts.observed_suite_inputs);
  if (suite_inputs === null) errors.push('suite_inputs must contain canonical paths and content identities');
  if (current_suite_inputs === null) errors.push('current_suite_inputs must contain canonical paths and content identities');
  if (suite_inputs !== null && current_suite_inputs !== null) {
    const old_paths = new Set(suite_inputs.map(record => record.path));
    const new_paths = new Set(current_suite_inputs.map(record => record.path));
    if (old_paths.size !== suite_inputs.length || new_paths.size !== current_suite_inputs.length) errors.push('suite input paths must be unique');

    const suite_report_paths = reports.filter(path => old_paths.has(path) || new_paths.has(path));
    if (suite_reads_report.value === true) {
      if (changed.some(path => !reports.includes(path))) errors.push('a report-only change may not include a non-report path when the suite reads reports');
      if (suite_report_paths.length === 0) errors.push('a suite that reads a report must list that report in suite_inputs');
      if (report_only.some(path => suite_report_paths.includes(path))) errors.push('a report read by the suite belongs in suite_inputs, not report_only_paths');
      if (suite_reused.value === true) errors.push('a changed suite input cannot reuse the prior suite result');
      if (suite_rerun.value !== true) errors.push('a changed report read by the suite requires a suite rerun');
      if (same_alias_value(suite_inputs, current_suite_inputs)) errors.push('a suite-read report change did not change suite input identity');
    } else {
      if (changed.some(path => !report_only.includes(path))) errors.push('every changed path must remain a report-only path when the suite does not read reports');
      if (suite_report_paths.length > 0) errors.push('a report-only path marked outside suite inputs is read by the suite');
      if (!same_alias_value(suite_inputs, current_suite_inputs)) errors.push('suite input identities changed during a report-only reuse');
      if (suite_reused.value !== true) errors.push('unchanged suite inputs must keep suite evidence reusable');
      if (suite_rerun.value !== false) errors.push('report-only work must not rerun the source suite');
    }
  }

  const previous_manifest = facts.previous_suite_manifest ?? facts.previous_manifest;
  const current_manifest = facts.current_suite_manifest ?? facts.current_manifest;
  if (previous_manifest !== undefined || current_manifest !== undefined) {
    if (previous_manifest === undefined || current_manifest === undefined) {
      errors.push('report-only suite comparison needs previous and current suite manifests');
    } else {
      const comparison = suite_evidence.compare_suite_manifests(previous_manifest, current_manifest);
      if (suite_reads_report.value === true) {
        if (comparison.reusable === true) errors.push('a suite-read report change must invalidate the suite manifest');
        if (suite_reused.value === true) errors.push('a changed suite manifest cannot reuse the prior suite result');
        if (suite_rerun.value !== true) errors.push('a changed suite manifest requires a suite rerun');
      } else {
        if (comparison.reusable !== true) errors.push(`report-only suite manifest changed: ${comparison.reasons.join('; ')}`);
        if (suite_reused.value !== true) errors.push('unchanged suite inputs must keep suite evidence reusable');
        if (suite_rerun.value !== false) errors.push('report-only work must not rerun the source suite');
      }
    }
  }

  const runtime_fact_pairs = [
    ['runtime_facts', 'current_runtime_facts'],
    ['environment_facts', 'current_environment_facts'],
    ['execution_facts', 'current_execution_facts']
  ];
  runtime_fact_pairs.forEach(([before_name, after_name]) => {
    if (facts[before_name] !== undefined || facts[after_name] !== undefined) {
      if (!same_alias_value(facts[before_name], facts[after_name])) errors.push(`${before_name} changed during report-only reuse`);
    }
  });

  if (material_change.value !== false) errors.push('material changes cannot use report-only treatment');
  if (source_reused.value !== true) errors.push('source evidence must remain reusable for a nonmaterial report-only change');
  if (security_reused.value !== true) errors.push('security evidence must remain reusable for a nonmaterial report-only change');
  if (acceptance_reused.value !== true) errors.push('acceptance evidence must remain reusable for a nonmaterial report-only change');
  if (source_reopened.value !== false) errors.push('report-only work must not reopen source work');
  if (acceptance_restarted.value !== false) errors.push('report-only work must not restart acceptance');

  return errors.length === 0
    ? make_check('report_only_validation', 'Report-only changes preserve valid evidence', 'pass', 'only the detecting report check reran and reusable source, security, acceptance, and suite evidence stayed valid')
    : make_check('report_only_validation', 'Report-only changes preserve valid evidence', 'fail', errors.join('; '));
};

const normalize_review_stage_list = facts => {
  if (Array.isArray(facts)) return facts;
  if (facts !== null && typeof facts === 'object' && Array.isArray(facts.stages)) return facts.stages;
  if (facts !== null && typeof facts === 'object' && Array.isArray(facts.review_stages)) return facts.review_stages;
  return facts;
};

const process_started_record = record => {
  if (typeof record === 'boolean') return { valid: true, started: record };
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return { valid: false, started: false };

  const names = ['worker_started', 'model_started', 'process_started', 'started'];
  if (!aliases_have_type(record, names, value => typeof value === 'boolean')) return { valid: false, started: false };
  if (!aliases_agree(record, names)) return { valid: false, started: false };
  return { valid: true, started: names.some(name => record[name] === true) };
};

const lint_large_work_route = facts => {
  if (facts === undefined) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'skip', 'large-work facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large-work facts must be an object');
  }

  const availability = availability_state(facts);
  if (availability === 'invalid') return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large-work availability must be an actual boolean or documented unavailable token');
  if (availability === 'unavailable') return make_check('large_work_route', 'Large work uses a controller-only route', 'skip', 'large-work facts are unavailable to the live check');

  const coherent_names = ['one_coherent_accepted_item', 'one_coherent_accepted_result', 'can_form_one_coherent_accepted_item', 'request_is_coherent', 'complete_request_coherent', 'coherent'];
  const coherent_fact = fact_value(facts, coherent_names);
  const estimate_names = ['estimated_active_hours', 'estimated_hours', 'active_hours_estimate'];
  const estimate_fact = fact_value(facts, estimate_names);
  if (!coherent_fact.supplied || !aliases_have_type(facts, coherent_names, value => typeof value === 'boolean')) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large-work coherence must be an actual boolean');
  }
  if (!estimate_fact.supplied || !aliases_have_type(facts, estimate_names, nonnegative_number)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large-work estimate must be a finite non-negative number');
  }
  if (!aliases_agree(facts, coherent_names) || !aliases_agree(facts, estimate_names)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large-work aliases must agree');
  }

  const coherent = coherent_fact.value;
  const estimated_hours = estimate_fact.value;
  const large_work_minutes = facts.large_work_minutes === undefined ? default_large_work_minutes : facts.large_work_minutes;
  if (!Number.isInteger(large_work_minutes) || large_work_minutes < 1 || large_work_minutes > 10080) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large_work_minutes must be an integer from 1 through 10080');
  }
  const qualifies = coherent === false || (Number.isFinite(estimated_hours) && estimated_hours * 60 > large_work_minutes);
  const master_plan = facts.master_plan;
  const queue_plans = facts.queue_plans === undefined ? [] : facts.queue_plans;
  const queue_count_names = ['open_queue_plan_count', 'active_queue_plan_count'];
  const visible_queue_count_fact = fact_value(facts, queue_count_names);
  const visible_queue_count = visible_queue_count_fact.value;

  if (!Array.isArray(queue_plans)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'queue plans must be an array');
  }
  if (!aliases_have_type(facts, queue_count_names, nonnegative_integer)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'visible queue count must be a non-negative integer');
  }
  if (!aliases_agree(facts, queue_count_names)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'visible queue-count aliases must agree');
  }

  if (!qualifies) {
    const has_master = master_plan !== undefined && master_plan !== null;
    const has_queue = queue_plans.length > 0 || (visible_queue_count_fact.supplied && visible_queue_count > 0);

    return has_master || has_queue
      ? make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'ordinary work must stay on the normal route without a master or queue plan')
      : make_check('large_work_route', 'Large work uses a controller-only route', 'pass', 'ordinary coherent work has no controller-only plan');
  }

  if (master_plan === null || typeof master_plan !== 'object' || Array.isArray(master_plan)) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'qualifying large work requires one controller-only master plan');
  }

  const master_errors = [];

  if (!aliases_have_type(master_plan, ['controller_only', 'executor_visible', 'exposed_to_executor'], value => typeof value === 'boolean')) {
    master_errors.push('master plan decision flags must be actual booleans');
  }
  if (!aliases_agree(master_plan, ['executor_visible', 'exposed_to_executor'])) master_errors.push('master plan exposure aliases disagree');
  if (master_plan.controller_only !== true) master_errors.push('master plan is not controller-only');
  if (master_plan.executor_visible === true || master_plan.exposed_to_executor === true) master_errors.push('master plan is exposed to executor state');
  if (typeof master_plan.complete_outcome !== 'string' || master_plan.complete_outcome.trim().length === 0) master_errors.push('complete outcome is missing');
  if (!Array.isArray(master_plan.ordered_items) || master_plan.ordered_items.length === 0) master_errors.push('ordered items are missing');
  if (master_plan.dependencies === undefined) master_errors.push('dependencies are missing');
  if (master_plan.requirement_ownership === undefined) master_errors.push('requirement ownership is missing');
  if (master_plan.progress === undefined) master_errors.push('progress state is missing');
  if (master_plan.final_integrated_check === undefined) master_errors.push('final integrated check is missing');

  if (master_errors.length > 0) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', master_errors.join('; '));
  }

  if (queue_plans.length === 0) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'large work requires at least one self-contained queue plan');
  }

  if (visible_queue_count_fact.supplied && visible_queue_count > 1) {
    return make_check('large_work_route', 'Large work uses a controller-only route', 'fail', 'queue plans must be opened one at a time');
  }

  const queue_errors = [];

  queue_plans.forEach((plan, index) => {
    if (plan === null || typeof plan !== 'object' || Array.isArray(plan)) {
      queue_errors.push(`queue plan ${index + 1} is not an object`);
      return;
    }

    if (plan.self_contained !== true) queue_errors.push(`queue plan ${index + 1} is not self-contained`);
    if (plan.independently_checkable !== true) queue_errors.push(`queue plan ${index + 1} is not independently checkable`);
    if (plan.master_plan !== undefined || plan.controller_state !== undefined || plan.controller_only_state !== undefined) {
      queue_errors.push(`queue plan ${index + 1} exposes controller-only state`);
    }

    const plan_hour_names = ['active_hours_estimate', 'estimated_active_hours', 'estimated_hours'];
    const plan_hours = fact_value(plan, plan_hour_names);
    if (!aliases_have_type(plan, plan_hour_names, nonnegative_number)) queue_errors.push(`queue plan ${index + 1} has an invalid active-hours estimate`);
    if (!aliases_agree(plan, plan_hour_names)) queue_errors.push(`queue plan ${index + 1} active-hours aliases disagree`);
    if (plan_hours.supplied && plan_hours.value * 60 > large_work_minutes) queue_errors.push(`queue plan ${index + 1} exceeds the configured ${large_work_minutes}-minute target`);
    if (plan.boundaries === undefined) queue_errors.push(`queue plan ${index + 1} boundaries are missing`);
    if (plan.evidence === undefined) queue_errors.push(`queue plan ${index + 1} evidence is missing`);
  });

  return queue_errors.length === 0
    ? make_check('large_work_route', 'Large work uses a controller-only route', 'pass', `controller-only master plan has ${queue_plans.length} self-contained queue plan(s)`)
    : make_check('large_work_route', 'Large work uses a controller-only route', 'fail', queue_errors.join('; '));
};

const lint_queue_contract = facts => {
  if (facts === undefined) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'skip', 'queue-contract facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', 'queue-contract facts must be an object');
  }

  if (String(facts.operation ?? 'make-plans').toLowerCase() !== 'make-plans') {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', 'queue-contract facts must describe the make-plans operation');
  }

  const contract = queue_contract.validate_contract_gate({ ...facts, contract: facts.contract });
  if (!contract.valid) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', contract.errors.join('; '));
  }

  let envelope = facts.envelope;
  let plan_bytes = facts.plan_bytes;
  if (facts.tasks_dir !== undefined) {
    try {
      const frozen = queue_contract.read_frozen_queue(facts.tasks_dir, { contract: contract.contract });
      envelope = frozen.envelope;
      plan_bytes = frozen.plan_bytes;
    } catch (error) {
      return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', `frozen queue could not be read safely: ${error.message}`);
    }
  }
  if (envelope === undefined) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', 'make-plans facts must include the frozen queue envelope or tasks_dir');
  }

  for (const name of ['original_request_sha256', 'requirements_sha256', 'specification_sha256']) {
    if (envelope[name] !== contract.contract[name]) {
      return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', `frozen queue ${name} does not match the accepted contract identity`);
    }
  }

  const envelope_result = queue_contract.validate_queue_envelope(envelope, { plan_bytes });
  if (!envelope_result.valid) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', envelope_result.errors.join('; '));
  }

  const publication = facts.publication ?? {};
  const required_boolean = ['published', 'implementation_started'];
  const missing = required_boolean.filter(name => typeof publication[name] !== 'boolean');
  if (missing.length > 0) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', `publication facts need boolean ${missing.join(', ')}`);
  }
  if (publication.published !== true) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', 'make-plans did not publish a frozen queue');
  }
  if (publication.implementation_started !== false) {
    return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'fail', 'make-plans must stop before implementation');
  }

  return make_check('queue_contract', 'make-plans freezes trusted queue authority', 'pass', `frozen envelope validates ${envelope.plans.length} self-contained plan(s); publication stopped before implementation`);
};

const lint_review_preflight = facts => {
  if (facts === undefined) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'skip', 'preflight facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'preflight facts must be an object');
  }

  const availability = availability_state(facts);
  if (availability === 'invalid') return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'preflight availability must be an actual boolean or documented unavailable token');
  if (availability === 'unavailable') return make_check('review_preflight', 'Review launch preflight is complete', 'skip', 'preflight facts are unavailable to the live check');

  const fields = [
    ['working directory', facts.working_directory ?? facts.working_dir],
    ['test access', facts.test_access ?? facts.tests_accessible],
    ['executable availability', facts.executable_available ?? facts.executable],
    ['authentication', facts.authentication ?? facts.authenticated]
  ];
  const capability_names = [
    'working_directory', 'working_dir', 'test_access', 'tests_accessible',
    'executable_available', 'executable', 'authentication', 'authenticated'
  ];
  const launch_names = ['launch_started', 'worker_started', 'process_started'];
  if (fields.some(([, value]) => typeof value !== 'boolean') || !aliases_have_type(facts, capability_names, value => typeof value === 'boolean')) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'all four preflight checks must be actual booleans');
  }
  if (!aliases_have_type(facts, launch_names, value => typeof value === 'boolean')) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'launch-started facts must be actual booleans');
  }
  if (Object.prototype.hasOwnProperty.call(facts, 'completed') && typeof facts.completed !== 'boolean') {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'preflight completion must be an actual boolean');
  }
  const capability_groups = [
    ['working_directory', 'working_dir'],
    ['test_access', 'tests_accessible'],
    ['executable_available', 'executable'],
    ['authentication', 'authenticated']
  ];
  if (capability_groups.some(names => !aliases_agree(facts, names)) || !aliases_agree(facts, launch_names)) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'preflight aliases must agree');
  }

  const launch_started = launch_names.some(name => facts[name] === true);
  const missing = fields.filter(([, value]) => missing_fact(value)).map(([label]) => label);
  const failed = fields.filter(([, value]) => value === false).map(([label]) => label);

  if (missing.length > 0 && launch_started) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', `preflight was incomplete before launch: ${missing.join(', ')}`);
  }

  if (missing.length > 0) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'skip', `manual preflight facts are missing: ${missing.join(', ')}`);
  }

  if (failed.length > 0) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', `preflight failed: ${failed.join(', ')}`);
  }

  if (launch_started && facts.completed !== true) {
    return make_check('review_preflight', 'Review launch preflight is complete', 'fail', 'a worker started before preflight completed');
  }

  return make_check('review_preflight', 'Review launch preflight is complete', 'pass', 'working directory, test access, executable availability, and authentication were checked before launch');
};

const lint_review_attempts = facts => {
  if (facts === undefined) {
    return make_check('review_attempts', 'Review stages use bounded stable attempts', 'skip', 'review-stage facts were not provided');
  }

  if (!Array.isArray(facts)) {
    if (facts === null || typeof facts !== 'object') {
      return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'review-stage facts must contain a stages array');
    }
    const availability = availability_state(facts);
    if (availability === 'invalid') return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'review-stage availability must be an actual boolean or documented unavailable token');
    if (availability === 'unavailable') return make_check('review_attempts', 'Review stages use bounded stable attempts', 'skip', 'review-stage facts are unavailable to the live check');
    if (!aliases_have_type(facts, ['stages', 'review_stages'], Array.isArray)) {
      return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'review-stage aliases must be arrays');
    }
    if (!aliases_agree(facts, ['stages', 'review_stages'])) {
      return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'review-stage list aliases must agree');
    }
  }

  const stage_list = Array.isArray(facts)
    ? facts
    : facts && Array.isArray(facts.stages)
      ? facts.stages
      : facts && Array.isArray(facts.review_stages)
        ? facts.review_stages
        : null;

  if (stage_list === null) {
    return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'review-stage facts must contain a stages array');
  }

  const errors = [];

  stage_list.forEach((stage, index) => {
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) {
      errors.push(`stage ${index + 1} is not an object`);
      return;
    }

    const stage_id = stage.stable_id ?? stage.stage_id ?? stage.id;
    if (typeof stage_id !== 'string' || stage_id.trim().length === 0) errors.push(`stage ${index + 1} has no stable identity`);
    if (!aliases_have_type(stage, ['stable_id', 'stage_id', 'id'], value => typeof value === 'string' && value.trim().length > 0)) {
      errors.push(`stage ${index + 1} has an invalid stable identity alias`);
    }
    if (!aliases_agree(stage, ['stable_id', 'stage_id', 'id'])) errors.push(`stage ${index + 1} stable identity aliases disagree`);

    const identities = stage.identity_history ?? stage.identities;
    const identity_history_names = ['identity_history', 'identities'];
    if (
      identities !== undefined &&
      !aliases_have_type(stage, identity_history_names, value => Array.isArray(value) && value.every(identity => typeof identity === 'string' && identity.trim().length > 0))
    ) {
      errors.push(`stage ${index + 1} identity history must be an array of non-empty strings`);
    }
    if (!aliases_agree(stage, identity_history_names)) errors.push(`stage ${index + 1} identity history aliases disagree`);
    if (Array.isArray(identities) && new Set(identities).size > 1) errors.push(`stage ${index + 1} changed stable identity`);
    const decision_flags = [
      'identity_stable', 'count_reset', 'renamed_reset', 'attempt_count_reset',
      'exhausted', 'unresolved', 'preserved_unresolved', 'automatic_cycle_stopped', 'auto_cycle_stopped',
      'worker_started', 'model_started', 'process_started', 'started'
    ];
    if (!aliases_have_type(stage, decision_flags, value => typeof value === 'boolean')) {
      errors.push(`stage ${index + 1} has a non-boolean decision flag`);
    }
    if (!aliases_agree(stage, ['count_reset', 'attempt_count_reset'])) errors.push(`stage ${index + 1} reset aliases disagree`);
    if (!aliases_agree(stage, ['unresolved', 'preserved_unresolved'])) errors.push(`stage ${index + 1} unresolved aliases disagree`);
    if (!aliases_agree(stage, ['automatic_cycle_stopped', 'auto_cycle_stopped'])) errors.push(`stage ${index + 1} automatic-cycle aliases disagree`);
    if (!aliases_agree(stage, ['worker_started', 'model_started', 'process_started', 'started'])) errors.push(`stage ${index + 1} process-start aliases disagree`);
    if (stage.identity_stable === false || stage.count_reset === true || stage.renamed_reset === true || stage.attempt_count_reset === true) {
      errors.push(`stage ${index + 1} reset its attempt count when renamed or restored`);
    }

    const start_names = ['worker_starts', 'process_starts', 'starts', 'attempts_started'];
    const starts_value = fact_value(stage, start_names).value ?? 0;
    if (!aliases_have_type(stage, start_names, nonnegative_integer)) errors.push(`stage ${index + 1} has an invalid worker-start alias`);
    if (!aliases_agree(stage, start_names)) errors.push(`stage ${index + 1} worker-start aliases disagree`);
    const starts = count_fact(starts_value, false);
    if (!Number.isFinite(starts)) errors.push(`stage ${index + 1} has an invalid worker-start count`);
    if (Number.isFinite(starts) && starts > max_review_attempts) errors.push(`stage ${index + 1} started more than three workers`);

    const preflight_failures = stage.preflight_failures ?? [];
    if (!Array.isArray(preflight_failures)) {
      errors.push(`stage ${index + 1} preflight failures must be an array`);
      return;
    }

    const preflight_records = preflight_failures.map(process_started_record);
    if (preflight_records.some(record => !record.valid)) errors.push(`stage ${index + 1} preflight failures have a non-boolean process-start flag`);
    const free_failures = preflight_records.filter(record => record.valid && !record.started);
    const charged_failures = preflight_records.filter(record => record.valid && record.started);
    if (free_failures.length > 1) errors.push(`stage ${index + 1} used more than one free preflight failure`);

    const post_failure_names = ['failures_after_start', 'post_start_failures', 'failures'];
    const post_start_failures_value = fact_value(stage, post_failure_names).value;
    if (!aliases_have_type(stage, post_failure_names, value => Array.isArray(value) || nonnegative_integer(value))) {
      errors.push(`stage ${index + 1} has an invalid post-start failure alias`);
    }
    if (!aliases_agree(stage, post_failure_names)) errors.push(`stage ${index + 1} post-start failure aliases disagree`);
    const post_start_failures = post_start_failures_value === undefined
      ? 0
      : Array.isArray(post_start_failures_value)
        ? (() => {
            const records = post_start_failures_value.map(process_started_record);
            if (records.some(record => !record.valid)) return NaN;
            return records.filter(record => record.started).length || records.length;
          })()
        : count_fact(post_start_failures_value, false);
    if (!Number.isFinite(post_start_failures)) errors.push(`stage ${index + 1} has an invalid post-start failure count`);

    const computed_attempts = Number.isFinite(starts) && Number.isFinite(post_start_failures)
      ? Math.max(starts, charged_failures.length, post_start_failures)
      : NaN;
    const attempt_names = ['total_attempts', 'attempt_count', 'attempts'];
    const declared_attempts_value = fact_value(stage, attempt_names).value;
    if (!aliases_have_type(stage, attempt_names, nonnegative_integer)) errors.push(`stage ${index + 1} has an invalid total attempt alias`);
    if (!aliases_agree(stage, attempt_names)) errors.push(`stage ${index + 1} total-attempt aliases disagree`);
    const declared_attempts = declared_attempts_value === undefined ? computed_attempts : declared_attempts_value;

    if (!Number.isInteger(declared_attempts) || declared_attempts < 0) {
      errors.push(`stage ${index + 1} has an invalid total attempt count`);
    } else if (declared_attempts > max_review_attempts) {
      errors.push(`stage ${index + 1} exceeded the three-total-attempt limit`);
    } else if (Number.isFinite(computed_attempts) && declared_attempts < computed_attempts) {
      errors.push(`stage ${index + 1} omitted charged failures from its attempt count`);
    }

    if (stage.exhausted === true) {
      const unresolved = stage.unresolved === true || stage.result === 'unresolved' || stage.preserved_unresolved === true;
      const stopped = stage.automatic_cycle_stopped === true || stage.auto_cycle_stopped === true;
      if (!unresolved || !stopped) errors.push(`stage ${index + 1} exhaustion did not preserve the unresolved result and stop automatic cycling`);
    }
  });

  return errors.length === 0
    ? make_check('review_attempts', 'Review stages use bounded stable attempts', 'pass', `${stage_list.length} stage(s) keep one identity and at most three charged attempts`)
    : make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', errors.join('; '));
};

const lint_review_context = context => {
  const review_supplied = context.review !== undefined;
  const stages_supplied = context.review_stages !== undefined;

  if (!review_supplied || !stages_supplied) {
    return lint_review_attempts(stages_supplied ? context.review_stages : context.review);
  }

  const review_result = lint_review_attempts(context.review);
  const stages_result = lint_review_attempts(context.review_stages);

  if (review_result.status === 'fail' || stages_result.status === 'fail') {
    return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'top-level review aliases must each be valid');
  }

  if (review_result.status !== stages_result.status) {
    return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'top-level review aliases must agree');
  }

  if (review_result.status === 'skip') return review_result;

  if (!same_alias_value(normalize_review_stage_list(context.review), normalize_review_stage_list(context.review_stages))) {
    return make_check('review_attempts', 'Review stages use bounded stable attempts', 'fail', 'top-level review aliases must agree');
  }

  return stages_result;
};

const lint_progress_boundaries = facts => {
  if (facts === undefined) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'skip', 'progress facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'progress facts must be an object');
  }

  const availability = availability_state(facts);
  if (availability === 'invalid') return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'progress availability must be an actual boolean or documented unavailable token');
  if (availability === 'unavailable') return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'skip', 'progress facts are unavailable to the live check');

  const estimated_names = ['estimated_active_hours', 'estimated_hours'];
  const actual_names = ['actual_active_hours', 'actual_hours'];
  const checkpoint_names = ['checkpoint_count', 'checkpoints'];
  const estimated_fact = fact_value(facts, estimated_names);
  const actual_fact = fact_value(facts, actual_names);
  const checkpoint_fact = fact_value(facts, checkpoint_names);
  const estimated_hours = estimated_fact.value;
  const actual_hours = actual_fact.value;
  const checkpoint_count = checkpoint_fact.value;

  if (
    !estimated_fact.supplied || !actual_fact.supplied || !checkpoint_fact.supplied ||
    !aliases_have_type(facts, estimated_names, nonnegative_number) ||
    !aliases_have_type(facts, actual_names, nonnegative_number) ||
    !aliases_have_type(facts, checkpoint_names, nonnegative_integer)
  ) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'estimated active hours, actual active hours, and checkpoint count must be recorded separately');
  }
  if (!aliases_agree(facts, estimated_names) || !aliases_agree(facts, actual_names) || !aliases_agree(facts, checkpoint_names)) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'progress measurement aliases must agree');
  }

  const warning_names = ['warning_recorded', 'visible_warning', 'progress_warning'];
  const split_names = ['split_assessment_recorded', 'split_assessment'];
  if (!aliases_have_type(facts, warning_names, value => typeof value === 'boolean') || !aliases_have_type(facts, split_names, value => typeof value === 'boolean')) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'warning and split-assessment facts must be actual booleans');
  }
  if (!aliases_agree(facts, warning_names) || !aliases_agree(facts, split_names)) {
    return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'warning and split-assessment aliases must agree');
  }

  const warning_needed = checkpoint_count > max_checkpoint_count;
  const warning_recorded = facts.warning_recorded === true || facts.visible_warning === true || facts.progress_warning === true;
  const split_recorded = facts.split_assessment_recorded === true || facts.split_assessment === true;

  if (warning_needed && !warning_recorded) return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'crossing ten checkpoints should record a visible warning');
  if (warning_needed && !split_recorded) return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'warn', 'crossing ten checkpoints should record a split assessment');

  return make_check('progress_boundaries', 'Progress records separate estimates and actual time', 'pass', `estimated ${estimated_hours}h, actual ${actual_hours}h, checkpoints ${checkpoint_count}; warnings are soft thresholds`);
};

const normalize_security_class = value => String(value ?? '').toLowerCase().replace(/[ _]+/g, '-');

const is_mandatory_security_class = value => {
  const normalized = normalize_security_class(value);
  return mandatory_security_classes.includes(normalized) ||
    (normalized.includes('data') && normalized.includes('loss')) ||
    (normalized.includes('destructive') && normalized.includes('behavior')) ||
    (normalized.includes('credential') && normalized.includes('exposure')) ||
    (normalized.includes('central') && normalized.includes('behavior') && normalized.includes('failure'));
};

const lint_security_disposition = facts => {
  if (facts === undefined) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'skip', 'security facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security facts must be an object');
  }

  const availability = availability_state(facts);
  if (availability === 'invalid') return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security availability must be an actual boolean or documented unavailable token');
  if (availability === 'unavailable') return make_check('security_disposition', 'Security review has one advisory disposition', 'skip', 'security facts are unavailable to the live check');

  const pass_names = ['pass_count', 'review_passes', 'passes'];
  const pass_fact = fact_value(facts, pass_names);
  const pass_count = pass_fact.value;
  if (!pass_fact.supplied || !aliases_have_type(facts, pass_names, nonnegative_integer) || pass_count !== 1) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security requires exactly one planned advisory pass');
  }
  if (!aliases_agree(facts, pass_names)) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security pass-count aliases must agree');
  }

  if (Object.prototype.hasOwnProperty.call(facts, 'automatic_repair_loop') && typeof facts.automatic_repair_loop !== 'boolean') {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'automatic-repair-loop must be an actual boolean');
  }
  if (Object.prototype.hasOwnProperty.call(facts, 'repair_rounds') && !nonnegative_integer(facts.repair_rounds)) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'repair rounds must be a non-negative integer');
  }
  if (facts.automatic_repair_loop === true || (facts.repair_rounds ?? 0) > 0) {
    return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security findings must not start an automatic repair loop');
  }

  const findings = facts.findings === undefined ? [] : facts.findings;
  if (!Array.isArray(findings)) return make_check('security_disposition', 'Security review has one advisory disposition', 'fail', 'security findings must be an array');

  const errors = [];
  findings.forEach((finding, index) => {
    if (finding === null || typeof finding !== 'object' || Array.isArray(finding)) {
      errors.push(`finding ${index + 1} is not an object`);
      return;
    }

    const class_fact = fact_value(finding, ['class', 'category', 'kind']);
    const disposition_fact = fact_value(finding, ['disposition', 'action']);
    if (!class_fact.supplied || !aliases_have_type(finding, ['class', 'category', 'kind'], value => typeof value === 'string' && value.trim().length > 0)) {
      errors.push(`finding ${index + 1} has no non-empty class`);
      return;
    }
    if (!disposition_fact.supplied || !aliases_have_type(finding, ['disposition', 'action'], value => typeof value === 'string' && value.trim().length > 0)) {
      errors.push(`finding ${index + 1} has no non-empty disposition`);
      return;
    }
    if (!aliases_agree(finding, ['class', 'category', 'kind'], normalize_security_class)) {
      errors.push(`finding ${index + 1} class aliases disagree`);
      return;
    }
    if (!aliases_agree(finding, ['disposition', 'action'], normalize_security_class)) {
      errors.push(`finding ${index + 1} disposition aliases disagree`);
      return;
    }

    const disposition = normalize_security_class(disposition_fact.value);
    if (is_mandatory_security_class(class_fact.value)) {
      if (!['owner-decision', 'owner-pause', 'pause-owner', 'escalate-owner'].includes(disposition)) {
        errors.push(`finding ${index + 1} requires an owner decision`);
      }
    } else if (!['follow-up', 'recorded-follow-up', 'defer', 'deferred'].includes(disposition)) {
      errors.push(`finding ${index + 1} must become recorded follow-up work`);
    }
  });

  return errors.length === 0
    ? make_check('security_disposition', 'Security review has one advisory disposition', 'pass', `${findings.length} finding(s) have owner-decision or follow-up dispositions`)
    : make_check('security_disposition', 'Security review has one advisory disposition', 'fail', errors.join('; '));
};

const lint_acceptance_disposition = facts => {
  if (facts === undefined) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'skip', 'acceptance facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'acceptance facts must be an object');
  }

  const availability = availability_state(facts);
  if (availability === 'invalid') return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'acceptance availability must be an actual boolean or documented unavailable token');
  if (availability === 'unavailable') return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'skip', 'acceptance facts are unavailable to the live check');

  const behavior_names = ['behavior', 'behavior_result', 'owner_visible_behavior'];
  const record_names = ['record_quality', 'record_result', 'record_quality_result'];
  const behavior = fact_value(facts, behavior_names).value;
  const record_quality = fact_value(facts, record_names).value;
  const nonempty_string = value => typeof value === 'string' && value.trim().length > 0;
  if (!aliases_have_type(facts, behavior_names, nonempty_string) || !aliases_have_type(facts, record_names, nonempty_string) || !nonempty_string(behavior) || !nonempty_string(record_quality)) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'acceptance must record separate behavior and record-quality results');
  }
  if (!aliases_agree(facts, behavior_names, normalize_security_class) || !aliases_agree(facts, record_names, normalize_security_class)) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'acceptance result aliases must agree');
  }

  if (Object.prototype.hasOwnProperty.call(facts, 'automatic_repair_loop') && typeof facts.automatic_repair_loop !== 'boolean') {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'automatic-repair-loop must be an actual boolean');
  }
  if (Object.prototype.hasOwnProperty.call(facts, 'repair_rounds') && !nonnegative_integer(facts.repair_rounds)) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'repair rounds must be a non-negative integer');
  }
  if (facts.automatic_repair_loop === true || (facts.repair_rounds ?? 0) > 0) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', 'acceptance must not start an automatic repair loop');
  }

  const behavior_result = normalize_security_class(behavior);
  if (!['pass', 'accepted', 'covered', 'satisfied'].includes(behavior_result)) {
    return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'fail', `owner-visible behavior result is ${behavior}; acceptance cannot pass it`);
  }

  return make_check('acceptance_disposition', 'Acceptance separates behavior from record quality', 'pass', `owner-visible behavior is ${behavior}; record quality is ${record_quality}; no automatic repair loop`);
};

const lint_formal_repair = facts => {
  if (facts === undefined) {
    return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'skip', 'formal-repair facts were not provided');
  }

  if (facts === null || typeof facts !== 'object' || Array.isArray(facts)) {
    return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'formal-repair facts must be an object');
  }

  const span_fact = fact_value(facts, ['span', 'span_type']);
  const span = typeof span_fact.value === 'string' ? span_fact.value.toLowerCase() : '';
  if (!aliases_have_type(facts, ['span', 'span_type'], value => typeof value === 'string' && value.trim().length > 0)) {
    return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair span must be a non-empty string');
  }
  if (!aliases_agree(facts, ['span', 'span_type'], value => value.toLowerCase())) {
    return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair span aliases must agree');
  }
  if (!formal_repair_spans.includes(span)) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair span is not a fixed stamp, heading, path label, or final boundary');
  const proof_names = ['source_authoritative', 'outside_bytes_unchanged', 'complete_gate_rerun'];
  const judgment_names = ['judgment_required', 'substantive_change'];
  if (!aliases_have_type(facts, proof_names, value => typeof value === 'boolean') || !aliases_have_type(facts, judgment_names, value => typeof value === 'boolean')) {
    return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair proof and judgment facts must be actual booleans');
  }
  if (facts.source_authoritative !== true) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair replacement source is not authoritative');
  const replacement_source = facts.replacement_source ?? facts.source;
  const before_identity = facts.before_content_identity ?? facts.before_identity ?? facts.before_sha256;
  const after_identity = facts.after_content_identity ?? facts.after_identity ?? facts.after_sha256;
  if (!nonempty_text(replacement_source)) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair replacement source is missing');
  if (!nonempty_text(before_identity) || !nonempty_text(after_identity)) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair must record before and after content identities');
  if (before_identity === after_identity) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'repair before and after content identities must differ');
  if (facts.outside_bytes_unchanged !== true) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'bytes outside the authorized span were not proven unchanged');
  if (facts.complete_gate_rerun !== true) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'complete artifact gate was not rerun');
  if (facts.judgment_required === true || facts.substantive_change === true) return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'fail', 'judgment-bearing correction must return to the responsible reviewer');

  return make_check('formal_repair', 'Formal repair stays within fixed byte-preserving spans', 'pass', `fixed ${span} span repaired with unchanged outside bytes and a complete gate rerun`);
};

const lint_round = context => {
  const devlog_text = context.devlog_text;
  const now_ms = context.now_ms === undefined ? Date.now() : context.now_ms;
  const future_skew_min = context.future_skew_min === undefined ? 5 : context.future_skew_min;
  const max_age_hours = context.max_age_hours === undefined ? 24 : context.max_age_hours;
  const reporting_facts = reporting_context_supplied(context) ? reporting_facts_from_context(context) : undefined;
  const substantial = reporting_facts && typeof reporting_facts === 'object' && !Array.isArray(reporting_facts)
    ? reporting_facts.substantial
    : undefined;
  const direct_facts = context.direct_route ?? context.direct_completion ?? (direct_context_supplied(context) ? context : undefined);
  const material_claim_facts = context.material_claims !== undefined
    ? (context.material_claims !== null && typeof context.material_claims === 'object' && !Array.isArray(context.material_claims)
      ? { ...context.material_claims, evidence: context.material_claims.evidence ?? context.evidence, repository_state: context.repository_state }
      : { material_claims: context.material_claims, evidence: context.evidence, repository_state: context.repository_state })
    : context.claims !== undefined
      ? { claims: context.claims, evidence: context.evidence, repository_state: context.repository_state }
      : undefined;
  const implementations = {
    terminal_one_line: () => lint_terminal_output(context.terminal_output),
    timestamps_sane: () => lint_timestamps(devlog_text, now_ms, future_skew_min, max_age_hours),
    reply_structure: () => lint_reply_structure(devlog_text, substantial),
    round_boundaries: () => lint_round_boundaries(devlog_text),
    next_ask_scaffold: () => lint_next_ask_scaffold(devlog_text),
    tracker: () => lint_tracker(context.tracker),
    checkpoint_still_to_do: () => lint_checkpoint_still_to_do(devlog_text),
    checkpoint_verification: () => lint_checkpoint_verification(devlog_text, context.checkpoint_verification),
    round_reporting: () => lint_round_reporting(reporting_facts, devlog_text),
    direct_route_completion: () => lint_direct_route_completion(direct_facts, context),
    evidence_classification: () => lint_evidence_classification(context.evidence_classification ?? context.defect_classes),
    material_claims: () => lint_material_claims(material_claim_facts),
    report_only_validation: () => lint_report_only_validation(context.report_only ?? context.report_only_validation),
    route_decision: () => lint_route_decision(context.route_decision),
    executor_decision: () => lint_executor_decision(context.executor_decision ?? context.executor_decisions),
    large_work_route: () => lint_large_work_route(context.large_work),
    queue_contract: () => lint_queue_contract(context.queue_contract ?? context.make_plans),
    review_preflight: () => lint_review_preflight(context.preflight),
    review_attempts: () => lint_review_context(context),
    progress_boundaries: () => lint_progress_boundaries(context.progress),
    security_disposition: () => lint_security_disposition(context.security),
    acceptance_disposition: () => lint_acceptance_disposition(context.acceptance),
    formal_repair: () => lint_formal_repair(context.formal_repair),
    pipeline_artifacts: () => lint_pipeline_artifacts(context.pipeline),
    quality_gate: () => lint_quality_gate(context.quality_gate, devlog_text),
    cross_check: () => lint_cross_check(devlog_text, context.project_root, context.review_decision),
    no_invented_ask: () => lint_no_invented_ask(devlog_text, context.owner_ask_ids),
    push_claim_valid: () => lint_push_claim(devlog_text, context.terminal_output, context.push),
    configuration_valid: () => lint_configuration(context),
    status_projection_valid: () => lint_status_projection(devlog_text, context.require_status_projection)
  };
  const harnesses = {
    model_sensitive: model_sensitive_harness.run(implementations),
    model_stable: model_stable_harness.run(implementations)
  };
  const grouped_checks = new Map(
    [...harnesses.model_sensitive, ...harnesses.model_stable].map(check => [check.id, check])
  );
  if (grouped_checks.size !== round_check_order.length || round_check_order.some(id => !grouped_checks.has(id))) {
    throw new TypeError('round harnesses must partition every check exactly once');
  }
  const checks = round_check_order.map(id => grouped_checks.get(id));

  return {
    ok: checks.every(check => check.status !== 'fail'),
    checks,
    harnesses
  };
};

const run_cli = () => {
  const args = process.argv.slice(2);
  const devlog_path = args[0];
  const context_index = args.indexOf('--context');

  if (devlog_path === undefined || context_index < 0 || args[context_index + 1] === undefined) {
    console.error('Usage: node portal/round-linter.js <devlog-path> --context <json-path>');
    process.exit(1);
  }

  const devlog_text = node_fs.readFileSync(devlog_path, 'utf8');
  const context_json = read_context_json(args[context_index + 1]);
  const context = { ...context_json, devlog_text };
  const result = lint_round(context);

  result.checks.forEach(check => {
    console.log(`${check.status.toUpperCase()}  ${check.id}  ${check.detail}`);
  });

  console.log(`${result.ok ? 'PASS' : 'FAIL'}  summary  ${result.ok ? 'all checks passed' : 'one or more checks failed'}`);
  process.exit(result.ok ? 0 : 1);
};

module.exports = {
  lint_configuration,
  lint_cross_check,
  lint_quality_gate,
  lint_checkpoint_still_to_do,
  lint_checkpoint_verification,
  lint_round_boundaries,
  lint_tracker,
  lint_direct_route_completion,
  lint_evidence_classification,
  lint_executor_decision,
  lint_material_claims,
  lint_queue_contract,
  lint_report_only_validation,
  lint_suite_evidence,
  lint_route_decision,
  lint_round_reporting,
  lint_round,
  parse_advisor_authority,
  parse_advisor_selection,
  parse_devlog,
  read_context_json
};

if (require.main === module) {
  run_cli();
}
