#!/usr/bin/env node
'use strict';

const node_crypto = require('node:crypto');
const node_fs = require('node:fs');
const node_path = require('node:path');
const { spawnSync } = require('node:child_process');
const { TextDecoder } = require('node:util');
const { lint_round_boundaries, parse_devlog, record_heading_has_valid_local_timestamp } = require('./round-linter');
const ag_settings = require('./ag-settings');
const { format_local_timestamp } = require('./local-time.js');
const notebook_owner = require('./notebook-owner');

const MAX_FILE_BYTES = 1024 * 1024;
const LOCK_WAIT_MS = 5000;
const LOCK_POLL_MS = 10;
const ask_heading_pattern = /^# → Ask \/ (A-\d+)(?: \([^\)\r\n]*\))?[ \t]*\r?$/gmu;
const ask_like_pattern = /^[ \t]*# → Ask \/[^\r\n]*$/gmu;
const reply_like_pattern = /^[ \t]*(?:# ← Reply \/|## Reply \/)[^\r\n]*$/gmu;
const status_heading_pattern = /^[ \t]*# STATUS[ \t]*$/gmu;
const wip_like_pattern = /^[ \t]*## \[WIP-[^\r\n]*$/gmu;
const existing_wip_heading_pattern = /^## \[WIP-(\d{3})\] Checkpoint\b[^\r\n]*$/gmu;
const run_like_pattern = /^[ \t]*## \[RUN-[^\r\n]*$/gmu;
const existing_run_heading_pattern = /^## \[RUN-(\d{3})\] Event\b[^\r\n]*$/gmu;
const draft_run_heading_pattern = /^## \[RUN-(\d{3})\] Event\b[^\r\n]*?(?:\((?:during round )?(A-\d+)\))?[ \t]*$/gmu;
const draft_wip_heading_pattern = /^## \[WIP-(\d{3})\] Checkpoint\b[^\r\n]*?(?:\((?:during round )?(A-\d+)\))?[ \t]*$/gmu;
const draft_reply_heading_pattern = /^# ← Reply \/ (A-\d{3})[ \t]*\r?$/gmu;
const pattern_test = (pattern, text) => {
  pattern.lastIndex = 0;
  const result = pattern.test(text);
  pattern.lastIndex = 0;
  return result;
};
const pattern_matches = (pattern, text) => {
  pattern.lastIndex = 0;
  const result = [...text.matchAll(pattern)];
  pattern.lastIndex = 0;
  return result;
};
const close_round_status_fields = Object.freeze([
  'project', 'notebook', 'notebook_kind', 'current_commit', 'tests_scenarios', 'config_path',
  'host', 'validation', 'proven', 'open', 'next', 'artifacts', 'archived_eras', 'streams'
]);

const fail = message => {
  throw new Error(message);
};

const stat_identity = stat => ({
  dev: String(stat.dev),
  ino: String(stat.ino),
  size: String(stat.size),
  mode: String(stat.mode),
  mtime: String(stat.mtimeNs ?? stat.mtimeMs),
  ctime: String(stat.ctimeNs ?? stat.ctimeMs)
});

const same_identity = (left, right) => Object.keys(left).every(key => left[key] === right[key]);
const same_object = (left, right) => String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);

const descriptor_flags = () => {
  let flags = node_fs.constants.O_RDONLY;
  if (typeof node_fs.constants.O_NOFOLLOW === 'number') flags |= node_fs.constants.O_NOFOLLOW;
  return flags;
};

const valid_relative_path = (value, label) => {
  if (typeof value !== 'string' || value.length === 0) fail(`${label} path is empty`);
  if (value.includes('\0') || /[\u0001-\u001f\u007f]/u.test(value)) fail(`${label} path contains a control character`);
  if (value.includes('\\') || node_path.posix.isAbsolute(value) || node_path.win32.isAbsolute(value) || /^[A-Za-z]:/u.test(value)) {
    fail(`${label} path must be repository-relative and not absolute`);
  }

  const parts = value.split('/');
  if (parts.some(part => part === '' || part === '.' || part === '..')) fail(`${label} path rejects traversal or empty path segments`);
  return parts;
};

const ensure_path_components = (root, absolute, label) => {
  const relative = node_path.relative(root, absolute);
  if (relative === '' || relative.startsWith(`..${node_path.sep}`) || relative === '..' || node_path.isAbsolute(relative)) {
    fail(`${label} path must stay inside the repository`);
  }

  let current = root;
  for (const part of relative.split(node_path.sep)) {
    current = node_path.join(current, part);
    let stat;
    try {
      stat = node_fs.lstatSync(current, { bigint: true });
    } catch (error) {
      fail(`${label} path is missing or unreadable`);
    }
    if (stat.isSymbolicLink()) fail(`${label} path contains a symbolic link`);
    if (current !== absolute && !stat.isDirectory()) fail(`${label} path has a non-directory parent`);
  }
};

const resolve_path = (root, value, label) => {
  valid_relative_path(value, label);
  const absolute = node_path.resolve(root, value);
  ensure_path_components(root, absolute, label);
  return absolute;
};

// Submitted drafts stay capped; a growing notebook must remain recoverable.
// Streaming archive consumers retain only their own state.
const read_regular_file = (file, label, consume) => {
  const limit = label === 'notebook' ? Infinity : MAX_FILE_BYTES;
  let checked;
  try {
    checked = node_fs.lstatSync(file, { bigint: true });
  } catch (error) {
    fail(`${label} is missing or unreadable`);
  }
  if (checked.isSymbolicLink()) fail(`${label} must be a regular non-symbolic-link file`);
  if (!checked.isFile()) fail(`${label} must be a regular non-symbolic-link file`);
  if (!consume && Number(checked.size) > limit) fail(`${label} is oversized; maximum is ${limit} bytes`);

  let descriptor = null;
  let content;
  let close_error = null;
  const hash = node_crypto.createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const decode = (bytes, stream) => {
    try { return decoder.decode(bytes, { stream }); } catch { fail(`${label} is not valid UTF-8`); }
  };
  try {
    descriptor = node_fs.openSync(file, descriptor_flags());
    const opened = node_fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !same_identity(stat_identity(checked), stat_identity(opened))) {
      fail(`${label} identity changed before reading`);
    }

    const chunks = [];
    let total = 0;
    while (true) {
      const buffer = Buffer.allocUnsafe(consume ? 64 * 1024 : Math.min(64 * 1024, limit + 1 - total));
      const bytes_read = node_fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytes_read === 0) break;
      total += bytes_read;
      if (!consume && total > limit) fail(`${label} is oversized; maximum is ${limit} bytes`);
      const bytes = buffer.subarray(0, bytes_read);
      hash.update(bytes);
      const text = decode(bytes, true);
      if (consume) consume(text);
      else chunks.push(bytes);
    }
    const ending = decode(undefined, false);
    if (consume) consume(ending);

    const final_stat = node_fs.fstatSync(descriptor, { bigint: true });
    if (!final_stat.isFile() || !same_identity(stat_identity(opened), stat_identity(final_stat)) || total !== Number(opened.size)) {
      fail(`${label} changed while reading`);
    }
    if (consume && !same_identity(stat_identity(checked), stat_identity(node_fs.lstatSync(file, { bigint: true })))) {
      fail(`${label} identity changed while reading`);
    }
    if (!consume) content = Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof Error && error.message) throw error;
    fail(`${label} is unreadable`);
  } finally {
    if (descriptor !== null) {
      try {
        node_fs.closeSync(descriptor);
      } catch (error) {
        close_error = error;
      }
    }
  }
  if (close_error !== null) fail(`${label} descriptor close failed`);

  return {
    content,
    text: content?.toString('utf8'),
    identity: stat_identity(checked),
    mode: Number(checked.mode & 0o7777n),
    hash: hash.digest('hex')
  };
};

const read_standard_input = () => {
  const chunks = [];
  let total = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_FILE_BYTES + 1 - total));
    const bytes_read = node_fs.readSync(0, buffer, 0, buffer.length, null);
    if (bytes_read === 0) break;
    total += bytes_read;
    if (total > MAX_FILE_BYTES) fail(`standard input is oversized; maximum is ${MAX_FILE_BYTES} bytes`);
    chunks.push(buffer.subarray(0, bytes_read));
  }
  const content = Buffer.concat(chunks, total);
  if (!Buffer.from(content.toString('utf8'), 'utf8').equals(content)) fail('standard input is not valid UTF-8');
  return { content, text: content.toString('utf8') };
};

const line_ending_for = content => content.includes(Buffer.from('\r\n')) ? '\r\n' : '\n';

const normalized_lines = text => {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
};

const reject_draft_boundaries = draft_text => {
  if (pattern_test(ask_like_pattern, draft_text)) fail('draft contains an Ask heading');
  if (pattern_test(reply_like_pattern, draft_text)) fail('draft contains a Reply heading');
  if (pattern_test(status_heading_pattern, draft_text)) fail('draft contains a STATUS heading');
};

const parse_draft = (draft_text, ask_id, expected_number) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  reject_draft_boundaries(draft_text);

  const candidates = pattern_matches(wip_like_pattern, draft_text);
  const headings = pattern_matches(draft_wip_heading_pattern, draft_text);
  if (candidates.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete WIP heading');
  if (headings[0].index !== 0) fail('draft must start with its WIP heading');

  const [heading] = headings;
  if (!record_heading_has_valid_local_timestamp(heading[0], Date.now(), true)) fail('draft WIP heading must have a real current YYYY-MM-DD HH:MM:SS ±HHMM timestamp');
  const number = Number(heading[1]);
  const declared_round = heading[2] ?? ask_id;
  if (declared_round !== ask_id) fail(`draft declared round ${declared_round} does not match ${ask_id}`);
  if (number !== expected_number) fail(`draft WIP number must be WIP-${String(expected_number).padStart(3, '0')}`);

  const lines = normalized_lines(draft_text);
  const final_line = lines.at(-1);
  // Footer wording is advisory in the shared completion check, not a write gate.
  if (lines.length === 0 || final_line === undefined) fail('draft is empty');
  return { number };
};

const parse_reply_draft = (draft_text, ask_id) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  const replies = pattern_matches(reply_like_pattern, draft_text);
  const headings = pattern_matches(draft_reply_heading_pattern, draft_text);
  if (replies.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete Reply heading');
  if (headings[0].index !== 0) fail('draft must start with its Reply heading');
  if (headings[0][1] !== ask_id) fail(`draft Reply ${headings[0][1]} does not match ${ask_id}`);
  const body = draft_text.slice(headings[0][0].length);
  if (pattern_test(ask_like_pattern, body)) fail('draft contains an Ask heading');
  if (pattern_test(status_heading_pattern, body)) fail('draft contains a STATUS heading');
  if (pattern_test(wip_like_pattern, body)) fail('draft contains a WIP heading');
};

const parse_run_draft = (draft_text, ask_id, expected_number) => {
  if (draft_text.trim().length === 0) fail('draft is empty');
  reject_draft_boundaries(draft_text);
  if (pattern_test(wip_like_pattern, draft_text)) fail('RUN draft contains a WIP heading');
  const candidates = pattern_matches(run_like_pattern, draft_text);
  const headings = pattern_matches(draft_run_heading_pattern, draft_text);
  if (candidates.length !== 1 || headings.length !== 1) fail('draft must contain exactly one complete RUN heading');
  if (headings[0].index !== 0) fail('draft must start with its RUN heading');
  if (!record_heading_has_valid_local_timestamp(headings[0][0], Date.now(), true)) fail('draft RUN heading must have a real current YYYY-MM-DD HH:MM:SS ±HHMM timestamp');
  if (headings[0][2] !== undefined && headings[0][2] !== ask_id) fail(`draft declared round ${headings[0][2]} does not match ${ask_id}`);
  if (Number(headings[0][1]) !== expected_number) fail(`draft RUN number must be RUN-${String(expected_number).padStart(3, '0')}`);
  if (draft_text.slice(headings[0][0].length).trim().length === 0) fail('RUN event body is empty');
};

const inspect_notebook = (notebook_text, ask_id) => {
  const boundary_check = lint_round_boundaries(notebook_text);
  if (boundary_check.status === 'fail') fail(`notebook round-boundary check failed: ${boundary_check.detail}`);
  const parsed = parse_devlog(notebook_text);
  const asks = pattern_matches(ask_heading_pattern, notebook_text);
  const ask_like = pattern_matches(ask_like_pattern, notebook_text);
  if (ask_like.length !== asks.length) fail('notebook contains an ambiguous Ask heading');

  const matching = asks.filter(match => match[1] === ask_id);
  if (matching.length === 0) fail(`notebook has no Ask ${ask_id}`);
  if (matching.length > 1) fail(`notebook has duplicate Ask ${ask_id}`);
  const target = matching[0];
  const target_index = asks.indexOf(target);
  if (target_index !== asks.length - 1) fail(`Ask ${ask_id} is non-final; an existing later Ask prevents the write`);

  const span_end = target_index + 1 < asks.length ? asks[target_index + 1].index : notebook_text.length;
  const target_span = notebook_text.slice(target.index, span_end);
  const target_body = target_span.slice(target[0].length);
  if (parsed.last_round !== target_span) fail(`Ask ${ask_id} is not the final unresolved round`);
  if (target_body.trim() === '' || target_body.trim() === '+') fail(`Ask ${ask_id} is empty`);
  if (pattern_test(reply_like_pattern, target_body)) fail(`Ask ${ask_id} is closed because it already has a Reply`);

  const target_round = parsed.rounds[target_index];
  const record_text = target_round?.wip_text || '';
  const existing_candidates = pattern_matches(wip_like_pattern, record_text);
  const existing_headings = pattern_matches(existing_wip_heading_pattern, record_text);
  if (existing_candidates.length !== existing_headings.length) fail(`Ask ${ask_id} has an ambiguous WIP heading`);
  const numbers = existing_headings.map(match => Number(match[1]));
  if (numbers.some(number => number === 0)) fail(`Ask ${ask_id} contains invalid WIP-000`);
  if (new Set(numbers).size !== numbers.length) fail(`Ask ${ask_id} contains duplicate WIP numbers`);
  if (numbers.some((number, index) => index > 0 && number < numbers[index - 1])) fail(`Ask ${ask_id} WIPs are out of physical order`);
  const run_candidates = pattern_matches(run_like_pattern, record_text);
  const run_headings = pattern_matches(existing_run_heading_pattern, record_text);
  if (run_candidates.length !== run_headings.length) fail(`Ask ${ask_id} has an ambiguous RUN heading`);
  const run_numbers = run_headings.map(match => Number(match[1]));
  if (run_numbers.some(number => number === 0)) fail(`Ask ${ask_id} contains invalid RUN-000`);
  if (new Set(run_numbers).size !== run_numbers.length) fail(`Ask ${ask_id} contains duplicate RUN numbers`);
  if (run_numbers.some((number, index) => index > 0 && number < run_numbers[index - 1])) fail(`Ask ${ask_id} RUN events are out of physical order`);

  return {
    ask: target,
    span_end,
    target_span,
    next_number: numbers.length === 0 ? 1 : Math.max(...numbers) + 1,
    next_run_number: run_numbers.length === 0 ? 1 : Math.max(...run_numbers) + 1
  };
};

const build_candidate = (notebook, draft) => {
  const separator = notebook.content.length === 0
    ? ''
    : notebook.content.subarray(-2).equals(Buffer.from('\n\n'))
      ? ''
      : notebook.content.subarray(-1).equals(Buffer.from('\n'))
        ? line_ending_for(notebook.content)
        : line_ending_for(notebook.content).repeat(2);
  const ending = draft.content.subarray(-1).equals(Buffer.from('\n')) ? '' : line_ending_for(notebook.content);
  return Buffer.concat([notebook.content, Buffer.from(separator), draft.content, Buffer.from(ending)]);
};

const lock_wait_ms = () => {
  const value = Number(process.env.AGF_TEST_LOCK_WAIT_MS);
  return Number.isFinite(value) && value >= 0 ? value : LOCK_WAIT_MS;
};

const acquire_lock = lock_path => {
  const started = Date.now();
  while (true) {
    try {
      return node_fs.openSync(lock_path, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY, 0o600);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() - started >= lock_wait_ms()) fail('another notebook writer is still active');
      if (typeof Atomics.wait === 'function') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, LOCK_POLL_MS);
    }
  }
};

const acquire_close_round_lock = lock_path => {
  const descriptor = acquire_lock(lock_path);
  return { descriptor, identity: node_fs.fstatSync(descriptor), path: lock_path };
};

const release_close_round_lock = lock => {
  try {
    node_fs.closeSync(lock.descriptor);
  } finally {
    let current = null;
    try {
      current = node_fs.lstatSync(lock.path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (current !== null && same_object(lock.identity, current)) remove_if_present(lock.path);
  }
};

const close_status_text = (status, notebook_text) => {
  if (status === null || typeof status !== 'object' || Array.isArray(status)) fail('close-round STATUS must be a fields object');
  const unsupported = Object.keys(status).filter(name => !close_round_status_fields.includes(name));
  if (unsupported.length) fail(`close-round STATUS has unsupported fields: ${unsupported.join(', ')}`);
  const missing = close_round_status_fields.filter(name => status[name] === undefined);
  if (missing.length > 0) fail(`close-round STATUS is missing ${missing.join(', ')}`);
  const options = Object.fromEntries(close_round_status_fields.map(name => [name, status[name]]));
  const generated = ag_settings.format_status(options);
  return generated.replace(/\r\n?/gu, line_ending_for(Buffer.from(notebook_text)));
};

const replace_status = (notebook_text, status_text) => {
  let region;
  try { region = ag_settings.status_region(notebook_text); } catch (error) { fail(error.message); }
  const heading = /^# STATUS[ \t]*\r?$/mu.exec(notebook_text);
  if (heading === null || !status_text.startsWith('# STATUS')) fail('close-round replacement must start with # STATUS');
  return `${notebook_text.slice(0, heading.index)}${status_text}${notebook_text.slice(region.body_end)}`;
};

const parse_close_document = (document, notebook_text, ask, root, host) => {
  if (document === null || typeof document !== 'object' || Array.isArray(document)) fail('close-round input must be a JSON object');
  for (const field of ['ask_id', 'runs', 'status_fields']) if (Object.hasOwn(document, field)) fail(`close-round unsupported field: ${field}`);
  const document_ask = document.ask;
  if (document_ask !== ask) fail(`close-round input Ask ${document_ask || '(missing)'} does not match ${ask}`);
  const runs = document.run_events;
  if (!Array.isArray(runs) || !runs.every(run => typeof run === 'string')) fail('close-round run_events must be an ordered array of text events');
  if (typeof document.reply !== 'string') fail('close-round reply must be complete text');
  return {
    runs,
    reply: render_reply(document.reply, ask, root, host || document.host || document.status?.host),
    status: close_status_text(document.status, notebook_text),
  };
};

const render_record = (text, ask, kind, number) => {
  if (!text.trim() || /^#/u.test(text.trimStart())) return text;
  return `## [${kind}-${String(number).padStart(3, '0')}] ${kind === 'RUN' ? 'Event' : 'Checkpoint'} — ${format_local_timestamp()} (${ask})\n\n${text.trim()}\n`;
};

const render_reply = (text, ask, root = process.cwd(), host) => {
  if (!text.trim()) return text;
  const identity = require('./reply-identity').detect_reply_identity({ root, ...(host ? { host } : {}) });
  if (/^[ \t]*(?:# ← Reply \/|## Reply \/)/mu.test(text)) {
    return text.replace(/^(#{1,2} (?:← )?Reply \/[^\n]+\r?\n)(?:\s*\* _[^\n]+_\r?\n)?/u, `$1\n* _${format_local_timestamp()} (${identity})_\n`);
  }
  const questions = /^#{1,6}\s+\[?Questions\b/imu.test(text) ? '' : '\n\n## Questions (batched — each with a suggested default)\n\n- None.\n';
  return `# ← Reply / ${ask}\n\n* _${format_local_timestamp()} (${identity})_\n\n${text.trimEnd()}${questions}\n`;
};

const prepare_close_candidate = ({ notebook, input, root = process.cwd(), notebook_path, host, session, ownership } = {}) => {
  if (input === undefined) fail('close-round input is missing');
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  const ask = document?.ask;
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('close-round Ask must use the exact A-NNN form');
  if (ask === 'A-999') fail('A-999 cannot be closed because the next Ask identifier is unavailable');

  if (!ownership) {
    const file = resolve_path(node_fs.realpathSync(root), notebook_path, 'notebook');
    const lock = acquire_close_round_lock(`${file}.close-round.lock`);
    try {
      verify_notebook_unchanged(file, notebook);
      const owned = notebook_owner.guard({ root, notebook: notebook_path, text: notebook.text, ask, host: host || document.status?.host, session });
      return prepare_close_candidate({ notebook, input: document, root, notebook_path, host, session, ownership: owned });
    } finally { release_close_round_lock(lock); }
  }
  notebook_owner.verify(ownership, { root, notebook: notebook_path, ask, active: true });

  const inspected = inspect_notebook(notebook.text, ask);
  const parsed = parse_close_document(document, notebook.text, ask, root, host);
  if (root && notebook_path) parsed.reply = require('./completion-record').publish_reply(parsed.reply, { project_root: root, notebook_path, ask, ownership });
  const runs = [];
  const run_texts = new Set();
  let expected_number = inspected.next_run_number;
  for (const content of ag_settings.read_notebook_controls(root, notebook_path)['log-verbosity'] === 'all' ? parsed.runs : []) {
    const run = render_record(content, ask, 'RUN', expected_number);
    const trimmed = run.trimEnd();
    const run_id = /^## \[(RUN-\d{3})\]/u.exec(trimmed)?.[1] || 'RUN';
    if (run_texts.has(trimmed)) fail(`close-round ${run_id} appears more than once in run_events`);
    if (notebook.text.includes(trimmed)) fail(`close-round ${run_id} is already present in the notebook; remove it from run_events`);
    parse_run_draft(run, ask, expected_number);
    run_texts.add(trimmed);
    runs.push(run);
    expected_number += 1;
  }
  parse_reply_draft(parsed.reply, ask);

  const newline = line_ending_for(notebook.content);
  let candidate_text = replace_status(notebook.text, parsed.status);
  for (const [index, run] of runs.entries()) {
    const content = index === 0 && inspected.next_run_number === 1
      ? `---${newline.repeat(2)}${run}`
      : run;
    candidate_text = build_candidate({ content: Buffer.from(candidate_text), mode: notebook.mode }, { content: Buffer.from(content) }).toString('utf8');
  }
  candidate_text = build_candidate({ content: Buffer.from(candidate_text), mode: notebook.mode }, { content: Buffer.from(parsed.reply) }).toString('utf8');
  const next_id = `A-${String(Number(ask.slice(2)) + 1).padStart(3, '0')}`;
  const next_heading = ag_settings.format_ask_heading(next_id, { repo_root: root, notebook_path, active_host: host || document.status?.host });
  candidate_text += `${newline}---${newline}${newline}${next_heading}${newline}${newline}+${newline}`;
  const boundary_check = lint_round_boundaries(candidate_text);
  if (boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${boundary_check.detail}`);
  if (!candidate_text.endsWith(`${next_heading}${newline}${newline}+${newline}`)) fail('candidate notebook did not end with the exact next empty Ask scaffold');
  const status_check = ag_settings.validate_status_projection(candidate_text);
  if (!status_check.valid) fail(`candidate STATUS validation failed: ${status_check.errors.join('; ')}`);

  return {
    ask,
    runs,
    reply: parsed.reply,
    status: parsed.status,
    next_ask: next_id,
    candidate: Buffer.from(candidate_text),
    candidate_text,
  };
};

const count_exact = (text, fragment) => {
  if (fragment.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const found = text.indexOf(fragment, offset);
    if (found < 0) return count;
    count += 1;
    offset = found + fragment.length;
  }
};

const match_closed_close = ({ notebook_text, input, project_root, notebook_path } = {}) => {
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  const ask = document?.ask;
  const runs = document?.run_events;
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask) || ask === 'A-999') return null;
  if (!Array.isArray(runs) || !runs.every(run => typeof run === 'string') || typeof document.reply !== 'string') return null;

  const asks = pattern_matches(ask_heading_pattern, notebook_text);
  const target = asks.filter(match => match[1] === ask);
  if (target.length !== 1) return null;
  const target_index = asks.indexOf(target[0]);
  const next_ask = `A-${String(Number(ask.slice(2)) + 1).padStart(3, '0')}`;
  if (target_index >= asks.length - 1) return null;
  const next = asks[target_index + 1];
  if (next[1] !== next_ask || target_index + 2 !== asks.length) return null;
  const span_end = next.index;
  const target_span = notebook_text.slice(target[0].index, span_end);
  let expected_reply = document.reply;
  if (project_root && notebook_path) {
    try { expected_reply = require('./completion-record').publish_reply(expected_reply, { project_root, notebook_path, ask, read_only: true }); } catch { return null; }
  }
  // Retry compares authored content; the writer-owned stamp is frozen in the saved Reply.
  const without_stamp = text => text.replace(/^(#{1,2} (?:← )?Reply \/[^\n]+)\r?\n(?:[ \t]*\r?\n)*\* _[^\n]+_\r?\n(?:[ \t]*\r?\n)*/mu, '$1\n\n');
  if (count_exact(without_stamp(target_span), without_stamp(expected_reply).trimEnd()) !== 1) return null;
  const keep_runs = !project_root || !notebook_path || ag_settings.read_notebook_controls(project_root, notebook_path)['log-verbosity'] === 'all';
  if (keep_runs && runs.some(run => count_exact(target_span, run.trimEnd()) !== 1)) return null;
  if (!/^\r?\n\r?\n\+\r?\n$/u.test(notebook_text.slice(next.index + next[0].length))) return null;

  let expected_status;
  try {
    expected_status = close_status_text(document.status, notebook_text);
    const region = ag_settings.status_region(notebook_text);
    if (notebook_text.slice(0, region.body_end) !== expected_status) return null;
  } catch (error) {
    return null;
  }
  return { ask, next_ask, status: expected_status };
};

const close_round = ({ root = process.cwd(), notebook: notebook_path, input, host, session } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const document = typeof input === 'string' ? JSON.parse(input) : input;
  let prepared;

  const lock_path = `${notebook_file}.close-round.lock`;
  let close_lock = null;
  try {
    close_lock = acquire_close_round_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    const ownership = notebook_owner.guard({ root: repository_root, notebook: notebook_path, text: notebook.text, ask: document?.ask, host: host || document?.host || document?.status?.host, session });
    prepared = prepare_close_candidate({ notebook, input: document, root: repository_root, notebook_path, host: ownership.identity.host, session, ownership });
      const { validate_candidate } = require('./completion-context');
      const repository_notebook = node_path.relative(repository_root, notebook_file).split(node_path.sep).join('/');
      const config_file = ag_settings.active_config_path(repository_root, repository_notebook);
      const candidate_result = validate_candidate({
      devlog_text: prepared.candidate_text,
      context: {
        project_root: repository_root,
        notebook_path: repository_notebook,
        config_path: node_fs.existsSync(config_file) ? config_file : undefined,
        active_host: host || document?.host || document?.status?.host,
        require_status_projection: true,
        ignore_paths: [node_path.relative(repository_root, lock_path)],
      },
    });
    const blocking = candidate_result.checks.filter(check => check.status === 'fail');
    if (blocking.length > 0) fail(`candidate completion check failed: ${blocking.map(check => `${check.id}: ${check.detail}`).join('; ')}`);
    atomic_replace(notebook_file, prepared.candidate, notebook.mode);
    notebook_owner.release(ownership, read_regular_file(notebook_file, 'notebook').text);
  } finally {
    if (close_lock !== null) release_close_round_lock(close_lock);
  }

  const replaced = read_regular_file(notebook_file, 'notebook');
  return { notebook: notebook_path, ask: prepared.ask, runs_inserted: prepared.runs.length, reply_inserted: true, status_replaced: true, next_ask: prepared.next_ask, identity: replaced.identity };
};

const remove_if_present = file => {
  try {
    node_fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
};

const verify_notebook_unchanged = (file, original) => {
  let current;
  try {
    current = read_regular_file(file, 'notebook');
  } catch (error) {
    fail(`notebook identity changed before replace: ${error.message}`);
  }
  if (!same_identity(current.identity, original.identity) || current.hash !== original.hash) {
    fail('notebook identity changed between read and replace');
  }
};

const consume_unchanged_draft = (file, original) => {
  let current;
  try {
    current = read_regular_file(file, 'draft');
  } catch (error) {
    fail(`draft identity changed before consume: ${error.message}`);
  }
  if (!same_identity(current.identity, original.identity) || current.hash !== original.hash) {
    fail('draft identity changed before consume');
  }
  node_fs.unlinkSync(file);
};

const atomic_replace = (file, content, mode) => {
  const temporary = `${file}.${process.pid}.${Date.now()}.${node_crypto.randomBytes(8).toString('hex')}.tmp`;
  let descriptor = null;
  let renamed = false;
  try {
    descriptor = node_fs.openSync(temporary, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY, 0o600);
    node_fs.writeFileSync(descriptor, content);
    node_fs.fsyncSync(descriptor);
    node_fs.closeSync(descriptor);
    descriptor = null;
    node_fs.chmodSync(temporary, mode);
    const temporary_stat = node_fs.lstatSync(temporary, { bigint: true });
    // Windows chmod only controls the writable attribute, exposed as owner-write.
    const mode_mask = process.platform === 'win32' ? 0o200 : 0o7777;
    const actual_mode = Number(temporary_stat.mode & 0o7777n);
    if ((actual_mode & mode_mask) !== (mode & mode_mask)) {
      fail(`temporary notebook mode could not be preserved for ${file} (requested ${mode.toString(8)}, observed ${actual_mode.toString(8)})`);
    }
    node_fs.renameSync(temporary, file);
    renamed = true;
  } finally {
    if (descriptor !== null) {
      try { node_fs.closeSync(descriptor); } catch (error) { /* keep the write error */ }
    }
    if (!renamed) remove_if_present(temporary);
  }
};

const format_owner_input = text => text.replace(/\r\n?/gu, '\n').trim().split(/\n(?:[\t ]*\n)+/gu)
  .map(paragraph => `+ ${paragraph.replace(/^\+ /u, '').split('\n').join('\n  ')}`).join('\n\n');

const safe_host = host => typeof host === 'string' && /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(host);

const configured_workspace_tmp = (root, notebook) => {
  let workspace = '.agentflow';
  try {
    const config = JSON.parse(node_fs.readFileSync(ag_settings.active_config_path(root, notebook), 'utf8'));
    workspace = config?.switches?.['workspace-dir'] || workspace;
    if (typeof ag_settings.workspace_dir_for === 'function') workspace = ag_settings.workspace_dir_for(config);
  } catch {}
  const workspace_parts = typeof workspace === 'string' ? workspace.split('/') : [];
  if (!workspace_parts.length || workspace.includes('\\') || node_path.posix.isAbsolute(workspace)
    || workspace_parts.some(part => part === '' || part === '.' || part === '..' || !/^[A-Za-z0-9._-]+$/u.test(part))) {
    workspace = '.agentflow';
  }
  return node_path.join(root, workspace, '.tmp');
};

const input_receipt_path = (root, notebook, host) => {
  if (!safe_host(host)) fail('input receipt host must be a safe lowercase id');
  const key = node_crypto.createHash('sha256').update(notebook).digest('hex');
  return node_path.join(configured_workspace_tmp(root, notebook), `agentflow-input-${host}-${key}.json`);
};

const read_input_receipt = (root, notebook, host) => {
  const file = input_receipt_path(root, notebook, host);
  const key = node_crypto.createHash('sha256').update(notebook).digest('hex');
  const candidates = [file, ...(['codex', 'claude'].includes(host)
    ? [node_path.join(root, `.${host}`, `agentflow-input-${key}.json`)] : [])];
  for (const candidate of candidates) {
    if (!node_fs.lstatSync(candidate, { throwIfNoEntry: false })) continue;
    ensure_path_components(root, candidate, 'input receipts');
    return JSON.parse(read_regular_file(candidate, 'input receipts').text);
  }
  return undefined;
};

const input_receipts = (root, notebook, host, ask) => {
  if (!safe_host(host)) fail('input receipt host must be a safe lowercase id');
  const directory = configured_workspace_tmp(root, notebook);
  let current = root;
  for (const part of node_path.relative(root, directory).split(node_path.sep)) {
    current = node_path.join(current, part);
    try { node_fs.mkdirSync(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    ensure_path_components(root, current, 'input receipts');
    if (!node_fs.lstatSync(current).isDirectory()) fail('input receipts parent must be a directory');
  }
  {
    const ignore = node_path.join(directory, '.gitignore');
    try {
      const descriptor = node_fs.openSync(ignore, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY, 0o600);
      try { node_fs.writeFileSync(descriptor, '*\n'); node_fs.fsyncSync(descriptor); } finally { node_fs.closeSync(descriptor); }
    } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  const file = input_receipt_path(root, notebook, host);
  const saved = read_input_receipt(root, notebook, host);
  if (saved && (typeof saved.ask !== 'string' || !saved.entries || typeof saved.entries !== 'object' || Array.isArray(saved.entries))) fail('input receipts are malformed');
  return { file, data: saved?.ask === ask ? saved : { ask, entries: {} } };
};

const scope_git = (root, args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: MAX_FILE_BYTES });
  return result.status === 0 ? result.stdout : null;
};

const scope_path_identity = (root, relative) => {
  let descriptor;
  try {
    const parts = valid_relative_path(relative, 'scope');
    let current = root;
    let missing = false;
    for (const part of parts) {
      current = node_path.join(current, part);
      let stat;
      try { stat = node_fs.lstatSync(current); } catch (error) {
        if (error.code !== 'ENOENT') return null;
        missing = true;
        break;
      }
      if (stat.isSymbolicLink()) return null;
    }
    const index = scope_git(root, ['ls-files', '--stage', '-z', '--', relative]);
    if (index === null) return null;
    const hash = node_crypto.createHash('sha256');
    if (missing) return hash.update('missing\0').update(index).digest('hex');
    const file = resolve_path(root, relative, 'scope');
    const before = node_fs.lstatSync(file, { bigint: true });
    if (!before.isFile()) return null;
    descriptor = node_fs.openSync(file, descriptor_flags());
    const opened = node_fs.fstatSync(descriptor, { bigint: true });
    if (!same_identity(stat_identity(before), stat_identity(opened))) return null;
    hash.update(String(Number(opened.mode & 0o7777n))).update('\0').update(index);
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let count;
    while ((count = node_fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
    if (!same_identity(stat_identity(opened), stat_identity(node_fs.fstatSync(descriptor, { bigint: true })))) return null;
    resolve_path(root, relative, 'scope');
    if (!same_identity(stat_identity(opened), stat_identity(node_fs.lstatSync(file, { bigint: true })))) return null;
    if (scope_git(root, ['ls-files', '--stage', '-z', '--', relative]) !== index) return null;
    return hash.digest('hex');
  } catch { return null; } finally {
    if (descriptor !== undefined) node_fs.closeSync(descriptor);
  }
};

const snapshot_scope_paths = (root, paths) => Object.fromEntries(paths.map(relative =>
  [relative, scope_path_identity(root, relative)]).filter(([, identity]) => identity !== null));

const close_delivery_path = (root, notebook, host, ask, close_id) => `${input_receipt_path(root, notebook, host)}.${ask}.${close_id}.close.json`;

const save_close_scope = (root, notebook, host, ask, commit, notebook_hash, paths, { ownership, session, close_id } = {}) => {
  if (!ownership) {
    const file = resolve_path(node_fs.realpathSync(root), notebook, 'notebook');
    const lock = acquire_close_round_lock(`${file}.close-round.lock`);
    try {
      const owned = notebook_owner.guard({ root, notebook, host, session, ask, allow_closed: true });
      return save_close_scope(root, notebook, host, ask, commit, notebook_hash, paths, { ownership: owned, session, close_id });
    } finally { release_close_round_lock(lock); }
  }
  notebook_owner.verify(ownership, { root, notebook, ask, active: true });
  const receipt = input_receipts(root, notebook, host, ask);
  const saved = receipt.data;
  const receipt_path = node_path.relative(root, receipt.file).split(node_path.sep).join('/');
  // Outside work may continue during close; recheck path safety, not its content version.
  const retained = Object.fromEntries(Object.entries(paths).filter(([relative]) =>
    relative !== notebook && relative !== receipt_path && scope_path_identity(root, relative) !== null));
  if (typeof close_id === 'string' && /^[a-f0-9]{64}$/u.test(close_id)) {
    atomic_replace(close_delivery_path(root, notebook, host, ask, close_id), Buffer.from(JSON.stringify({
      version: 1, repository: root, notebook, host, ask, close_id, commit, notebook_hash, paths: retained,
    }) + '\n'), 0o600);
  }
  if (!saved.scope || saved.repository !== root || saved.notebook !== notebook || saved.host !== host || saved.scope.close) return;
  saved.scope.close = { commit, notebook_hash, paths: retained };
  atomic_replace(receipt.file, Buffer.from(JSON.stringify(saved) + '\n'), 0o600);
};

const capture_input_scope = (root, notebook, host, ask, { ownership, session } = {}) => {
  if (!ownership) {
    const file = resolve_path(node_fs.realpathSync(root), notebook, 'notebook');
    const lock = acquire_close_round_lock(`${file}.close-round.lock`);
    try {
      const owned = notebook_owner.guard({ root, notebook, host, session, ask });
      return capture_input_scope(root, notebook, host, ask, { ownership: owned, session });
    } finally { release_close_round_lock(lock); }
  }
  notebook_owner.verify(ownership, { root, notebook, ask, active: true });
  const receipt = input_receipts(root, notebook, host, ask);
  if (receipt.data.scope) return receipt;
  const records = (scope_git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']) || '').split('\0');
  const paths = {};
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (record.length < 4) continue;
    const relative = record.slice(3);
    const identity = scope_path_identity(root, relative);
    if (identity !== null) paths[relative] = identity;
    if (/[RC]/u.test(record.slice(0, 2))) i += 1;
  }
  Object.assign(receipt.data, { repository: root, notebook, host,
    scope: { head: scope_git(root, ['rev-parse', '--verify', 'HEAD'])?.trim() || null, paths } });
  atomic_replace(receipt.file, Buffer.from(JSON.stringify(receipt.data) + '\n'), 0o600);
  return receipt;
};

const read_input_scope = (root, notebook, host, ask) => {
  if (!safe_host(host)) return null;
  try {
    const file = input_receipt_path(root, notebook, host);
    const saved = read_input_receipt(root, notebook, host);
    if (saved.ask !== ask || saved.repository !== root || saved.notebook !== notebook || saved.host !== host) return null;
    const head = saved.scope?.head;
    if (head !== null && (!/^[0-9a-f]{40}$/u.test(head) || scope_git(root, ['merge-base', '--is-ancestor', head, 'HEAD']) === null)) return null;
    const paths = saved.scope.paths;
    if (!paths || typeof paths !== 'object' || Array.isArray(paths)) return null;
    let ignored_paths = Object.entries(paths).filter(([relative, identity]) =>
      /^[0-9a-f]{64}$/u.test(identity) && scope_path_identity(root, relative) === identity).map(([relative]) => relative);
    const closed = saved.scope.close;
    if (closed && /^[0-9a-f]{40}$/u.test(closed.commit) && /^[0-9a-f]{64}$/u.test(closed.notebook_hash) &&
        closed.paths && typeof closed.paths === 'object' && !Array.isArray(closed.paths) &&
        scope_git(root, ['merge-base', '--is-ancestor', closed.commit, 'HEAD']) !== null) {
      const committed = scope_git(root, ['show', `${closed.commit}:${notebook}`]);
      const message = scope_git(root, ['log', '-1', '--format=%B', closed.commit]);
      if (committed !== null && /^Agentflow-Close-Id: [a-f0-9]{64}$/mu.test(message || '') &&
          node_crypto.createHash('sha256').update(committed).digest('hex') === closed.notebook_hash &&
          read_regular_file(resolve_path(root, notebook, 'notebook'), 'notebook').hash === closed.notebook_hash) {
        // A verified close records outside ownership; intake versions no longer decide it.
        ignored_paths = Object.entries(closed.paths).filter(([relative, identity]) =>
          relative !== notebook && /^[0-9a-f]{64}$/u.test(identity) && scope_path_identity(root, relative) !== null).map(([relative]) => relative);
      }
    }
    return { head, ignored_paths, file: node_path.relative(root, file) };
  } catch { return null; }
};

// A verified closeout remains deliverable after the next Ask is captured. This
// lookup deliberately does not require the live notebook hash to match the
// close snapshot; it only trusts the saved commit after re-verifying its
// close marker and notebook bytes.
const read_close_scope = (root, notebook, host, ask, close_id) => {
  if (!safe_host(host) || typeof close_id !== 'string' || !/^[a-f0-9]{64}$/u.test(close_id)) return null;
  try {
    let saved;
    try { saved = JSON.parse(node_fs.readFileSync(close_delivery_path(root, notebook, host, ask, close_id), 'utf8')); }
    catch { saved = read_input_receipt(root, notebook, host); }
    const closed = saved?.version === 1 && saved?.close_id === close_id ? saved : saved?.scope?.close;
    if (saved?.repository !== root || saved?.notebook !== notebook || saved?.host !== host || saved?.ask !== ask) return null;
    if (!closed || !/^[0-9a-f]{40}$/u.test(closed.commit) || !/^[0-9a-f]{64}$/u.test(closed.notebook_hash)) return null;
    const message = scope_git(root, ['log', '-1', '--format=%B', closed.commit]);
    if (!message || !new RegExp(`^Agentflow-Close-Id: ${close_id}$`, 'mu').test(message)) return null;
    const committed = scope_git(root, ['show', `${closed.commit}:${notebook}`]);
    if (committed === null || node_crypto.createHash('sha256').update(committed).digest('hex') !== closed.notebook_hash) return null;
    if (!closed.paths || typeof closed.paths !== 'object' || Array.isArray(closed.paths)) return null;
    return { commit: closed.commit, notebook_hash: closed.notebook_hash, paths: closed.paths };
  } catch { return null; }
};

const append_input = ({ root = process.cwd(), notebook: notebook_path, text, message_id, host, session } = {}) => {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 65536) fail('owner input must contain 1–65536 bytes');
  const repository_root = node_fs.realpathSync(root);
  const file = resolve_path(repository_root, notebook_path, 'notebook');
  const lock = acquire_close_round_lock(`${file}.close-round.lock`);
  try {
    let original = read_regular_file(file, 'notebook');
    const ownership = notebook_owner.guard({ root: repository_root, notebook: notebook_path, text: original.text, host, session });
    host = ownership.identity.host;
    original = require('./notebook-compact').compact_locked({ root: repository_root, notebook: notebook_path, original, force: false }).snapshot;
    const round = parse_devlog(original.text).rounds.at(-1);
    if (!round || round.reply_text.trim()) fail('owner input requires a current open Ask');
    if (/^\/?godev$/iu.test(text.trim())) return { notebook: notebook_path, ask: round.id, inserted: false, reason: 'activation_only' };
    const id = node_crypto.createHash('sha256').update(String(message_id || '') + '\0' + text).digest('hex');
    const marker = `<!-- agentflow-input: ${id} -->`;
    // Plain list paragraphs keep pasted headings and dividers inside owner input.
    const listed = format_owner_input(text);
    const ask_content = `\n\n${round.ask_text.trim()}\n\n`;
    const scope_receipt = capture_input_scope(repository_root, notebook_path, host, round.id, { ownership, session });
    const receipts = message_id ? scope_receipt : null;
    const prior = receipts?.data.entries[id];
    const delivered = prior && Number.isSafeInteger(prior.start) && prior.start >= 0
      && round.ask_text.slice(prior.start, prior.start + listed.length) === listed;
    if (round.ask_text.includes(marker) || delivered || (!message_id && (ask_content.includes(`\n\n${listed}\n\n`) || round.ask_text.trim() === text.trim()))) return { notebook: notebook_path, ask: round.id, inserted: false, reason: 'already_present' };
    // Manual/startup capture may precede the hook's submission ID. Adopt an
    // unclaimed copy once; another real submission ID still records a repeat.
    if (receipts) {
      const needle = '\n\n' + listed + '\n\n';
      for (let match = ask_content.indexOf(needle); match >= 0; match = ask_content.indexOf(needle, match + 1)) {
        const start = round.ask_text.length - round.ask_text.trimStart().length + match;
        if (Object.values(receipts.data.entries).some(entry =>
          entry.start < start + listed.length && start < entry.start + (Number.isSafeInteger(entry.length) ? entry.length : Infinity))) continue;
        receipts.data.entries[id] = { start, length: listed.length };
        atomic_replace(receipts.file, Buffer.from(JSON.stringify(receipts.data) + '\n'), 0o600);
        return { notebook: notebook_path, ask: round.id, inserted: false, reason: 'already_present' };
      }
    }
    const ask_start = round.start + round.text.length - round.body.length;
    const divider = /(?:^|\n)---(?:\r?\n)?$/u.exec(round.ask_text);
    const offset = ask_start + (divider ? divider.index : round.ask_text.length);
    const prefix = original.text.slice(0, round.ask_text.trim() === '+' ? ask_start : offset);
    const candidate = `${prefix.trimEnd()}\n\n${listed}\n\n${original.text.slice(offset).trimStart()}`.trimEnd() + '\n';
    verify_notebook_unchanged(file, original);
    if (receipts) {
      // Save the expected position first. A retry counts it only if the notebook
      // actually contains that submission there, even after a failed replacement.
      receipts.data.entries[id] = { start: parse_devlog(candidate).rounds.at(-1).ask_text.lastIndexOf(listed), length: listed.length };
      atomic_replace(receipts.file, Buffer.from(JSON.stringify(receipts.data) + '\n'), 0o600);
    }
    atomic_replace(file, Buffer.from(candidate.endsWith('\n') ? candidate : candidate + '\n'), original.mode);
    return { notebook: notebook_path, ask: round.id, inserted: true, reason: 'owner_input_saved' };
  } finally { release_close_round_lock(lock); }
};

const append_wip = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false, host, session } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');

  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (!input_stdin && notebook_file === draft_file) fail('notebook and draft paths must be different');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');

  const inspected = inspect_notebook(notebook.text, ask);
  if (ag_settings.read_notebook_controls(repository_root, notebook_path)['log-verbosity'] === 'off') return { notebook: notebook_path, ask, skipped: true, reason: 'log-verbosity: off' };
  const rendered = render_record(draft.text, ask, 'WIP', inspected.next_number);
  parse_draft(rendered, ask, inspected.next_number);
  const candidate = build_candidate(notebook, { ...draft, content: Buffer.from(rendered) });
  const candidate_text = candidate.toString('utf8');
  const candidate_parse = parse_devlog(candidate_text);
  if (!candidate_parse.last_round.includes(rendered.trimEnd())) fail('candidate notebook did not preserve the complete WIP draft');
  const candidate_boundary_check = lint_round_boundaries(candidate_text);
  if (candidate_boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${candidate_boundary_check.detail}`);

  const lock_path = `${notebook_file}.close-round.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    notebook_owner.guard({ root: repository_root, notebook: notebook_path, text: notebook.text, ask, host, session });
    atomic_replace(notebook_file, candidate, notebook.mode);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }

  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const append_run = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false, host, session } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');
  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');
  const inspected = inspect_notebook(notebook.text, ask);
  const verbosity = ag_settings.read_notebook_controls(repository_root, notebook_path)['log-verbosity'];
  if (verbosity !== 'all') return { notebook: notebook_path, ask, skipped: true, reason: `log-verbosity: ${verbosity}` };
  const rendered = render_record(draft.text, ask, 'RUN', inspected.next_run_number);
  parse_run_draft(rendered, ask, inspected.next_run_number);
  const candidate_draft = inspected.next_run_number === 1
    ? { ...draft, content: Buffer.from(`---${line_ending_for(notebook.content).repeat(2)}${rendered}`) }
    : { ...draft, content: Buffer.from(rendered) };
  const candidate = build_candidate(notebook, candidate_draft);
  const boundary_check = lint_round_boundaries(candidate.toString('utf8'));
  if (boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${boundary_check.detail}`);
  const lock_path = `${notebook_file}.close-round.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    notebook_owner.guard({ root: repository_root, notebook: notebook_path, text: notebook.text, ask, host, session });
    atomic_replace(notebook_file, candidate, notebook.mode);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }
  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const append_reply = ({ root = process.cwd(), notebook: notebook_path, ask, input: draft_path, input_stdin = false, host, session } = {}) => {
  const repository_root = node_fs.realpathSync(root);
  const notebook_file = resolve_path(repository_root, notebook_path, 'notebook');
  const notebook = read_regular_file(notebook_file, 'notebook');
  const draft_file = input_stdin ? null : resolve_path(repository_root, draft_path, 'draft');
  const draft = input_stdin ? read_standard_input() : read_regular_file(draft_file, 'draft');

  if (!input_stdin && same_object(notebook.identity, draft.identity)) fail('notebook and draft refer to the same file identity');
  if (!input_stdin && notebook_file === draft_file) fail('notebook and draft paths must be different');
  if (typeof ask !== 'string' || !/^A-\d{3}$/u.test(ask)) fail('Ask must use the exact A-NNN form');
  if (ask === 'A-999') fail('A-999 cannot be closed because the next Ask identifier is unavailable');

  inspect_notebook(notebook.text, ask);
  parse_reply_draft(draft.text, ask);
  draft.text = render_reply(draft.text, ask, repository_root, host);
  draft.content = Buffer.from(draft.text);
  parse_reply_draft(draft.text, ask);
  const newline = line_ending_for(notebook.content);
  const base = build_candidate(notebook, draft);
  const next_id = `A-${String(Number(ask.slice(2)) + 1).padStart(3, '0')}`;
  const next_heading = ag_settings.format_ask_heading(next_id, { repo_root: repository_root, notebook_path, active_host: host });
  const scaffold = `${newline}---${newline}${newline}${next_heading}${newline}${newline}+${newline}`;
  let candidate = Buffer.concat([base, Buffer.from(scaffold)]);
  let candidate_text = candidate.toString('utf8');
  const boundary_check = lint_round_boundaries(candidate_text);
  if (boundary_check.status === 'fail') fail(`candidate round-boundary check failed: ${boundary_check.detail}`);
  if (!candidate_text.endsWith(`${next_heading}${newline}${newline}+${newline}`)) {
    fail('candidate notebook did not end with the exact next empty Ask scaffold');
  }

  const lock_path = `${notebook_file}.close-round.lock`;
  let lock_descriptor = null;
  try {
    lock_descriptor = acquire_lock(lock_path);
    verify_notebook_unchanged(notebook_file, notebook);
    const ownership = notebook_owner.guard({ root: repository_root, notebook: notebook_path, text: notebook.text, ask, host, session });
    const linked = require('./completion-record').publish_reply(draft.text, { project_root: repository_root, notebook_path, ask, ownership });
    candidate = Buffer.concat([build_candidate(notebook, { ...draft, content: Buffer.from(linked), text: linked }), Buffer.from(scaffold)]);
    candidate_text = candidate.toString('utf8');
    const { validate_candidate } = require('./completion-context');
    const repository_notebook = node_path.relative(repository_root, notebook_file).split(node_path.sep).join('/');
    const config_file = ag_settings.active_config_path(repository_root, repository_notebook);
    const draft_relative = input_stdin ? null : node_path.relative(repository_root, draft_file);
    const untracked_draft = draft_relative !== null && spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z', '--', draft_relative], { cwd: repository_root, encoding: 'utf8' }).stdout === `${draft_relative}\0`;
    const candidate_result = validate_candidate({
      devlog_text: candidate_text,
      context: node_fs.existsSync(config_file)
        ? {
          project_root: repository_root,
          notebook_path: repository_notebook,
          config_path: config_file,
          active_host: host,
          ignore_paths: [node_path.relative(repository_root, lock_path), ...(untracked_draft ? [draft_relative] : [])]
        }
        : {}
    });
    const blocking = candidate_result.checks.filter(check => check.status === 'fail');
    if (blocking.length > 0) fail(`candidate completion check failed: ${blocking.map(check => `${check.id}: ${check.detail}`).join('; ')}`);
    atomic_replace(notebook_file, candidate, notebook.mode);
    notebook_owner.release(ownership, read_regular_file(notebook_file, 'notebook').text);
    if (!input_stdin) consume_unchanged_draft(draft_file, draft);
  } finally {
    if (lock_descriptor !== null) {
      try { node_fs.closeSync(lock_descriptor); } finally { remove_if_present(lock_path); }
    }
  }

  return { notebook: notebook_path, ask, input: input_stdin ? 'stdin' : draft_path };
};

const parse_args = argv => {
  const command = argv[0];
  const usage = 'usage: node skills/agentflow/scripts/notebook-write.js <append-input|append-run|append-wip|append-reply|close-round> --notebook <path> [--host <safe-id>] --ask <A-NNN> --input-stdin; append-input needs no --ask; fallback only after --input-stdin fails: --input <draft>';
  if (!['append-run', 'append-wip', 'append-reply', 'append-input', 'close-round'].includes(command)) fail(usage);
  const values = {};
  for (let index = 1; index < argv.length;) {
    const flag = argv[index];
    if (!['--notebook', '--host', '--session', '--ask', '--input', '--input-stdin'].includes(flag)) fail(usage);
    if (Object.hasOwn(values, flag)) fail(`duplicate option ${flag}`);
    if (flag === '--input-stdin') {
      values[flag] = true;
      index += 1;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) fail(usage);
    values[flag] = value;
    index += 2;
  }
  if (!Object.hasOwn(values, '--notebook') || !['close-round', 'append-input'].includes(command) && !Object.hasOwn(values, '--ask')) fail(usage);
  if (Boolean(values['--input']) === Boolean(values['--input-stdin'])) fail(`${usage}; --input and --input-stdin are mutually exclusive`);
  return { command, notebook: values['--notebook'], host: values['--host'], session: values['--session'], ask: values['--ask'], input: values['--input'], input_stdin: values['--input-stdin'] === true };
};

const run = argv => {
  try {
    const args = parse_args(argv);
    if (args.command === 'append-input') {
      const text = args.input_stdin ? read_standard_input().text : read_regular_file(resolve_path(node_fs.realpathSync(process.cwd()), args.input, 'input'), 'input').text;
      console.log(JSON.stringify(append_input({ notebook: args.notebook, text, host: args.host, session: args.session })));
    } else if (args.command === 'close-round') {
      const input = args.input_stdin ? read_standard_input().text : read_regular_file(resolve_path(node_fs.realpathSync(process.cwd()), args.input, 'input'), 'input').text;
      const result = close_round({ root: process.cwd(), notebook: args.notebook, input, host: args.host, session: args.session });
      console.log(JSON.stringify(result, null, 2));
    } else {
      const result = args.command === 'append-reply' ? append_reply(args) : args.command === 'append-run' ? append_run(args) : append_wip(args);
      console.log(result.skipped ? `${result.notebook}: progress record skipped (${result.reason})` : `${result.notebook} updated`);
    }
    return 0;
  } catch (error) {
    const message = String(error?.message ?? error).replace(/[\r\n]+/gu, ' ');
    console.error(`Error: ${message}`);
    return 1;
  }
};

module.exports = {
  format_owner_input,
  append_input,
  append_run,
  append_wip,
  append_reply,
  capture_input_scope,
  read_input_scope,
  read_close_scope,
  snapshot_scope_paths,
  save_close_scope,
  close_round,
  parse_args,
  run,
  prepare_close_candidate,
  match_closed_close,
  resolve_path,
  read_regular_file,
  acquire_close_round_lock,
  release_close_round_lock,
  verify_notebook_unchanged,
  atomic_replace,
};

if (require.main === module) process.exitCode = run(process.argv.slice(2));
