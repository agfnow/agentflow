'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const writer = require('./notebook-write');
const { parse_devlog, lint_round_boundaries } = require('./round-linter');
const { archive_path_for_notebook } = require('./ag-settings');

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a, b) => a.hash === b.hash && JSON.stringify(a.identity) === JSON.stringify(b.identity);
const heading = /^# → Ask \/ (A-\d+)(?: \([^\)\r\n]*\))?[ \t]*\r?\n?$/u;

// Stream existing history, retaining only IDs, lengths, hashes and a bounded line prefix.
const archive_index = file => {
  const rounds = new Map();
  let current, prefix = '', long_line = false, ends_line = true;
  const feed = text => { if (current) { current.hash.update(text); current.bytes += Buffer.byteLength(text); } };
  const finish = () => {
    if (!current) return;
    if (rounds.has(current.id)) throw Error(`archive collision: duplicate ${current.id}`);
    rounds.set(current.id, { id: current.id, bytes: current.bytes, sha256: current.hash.digest('hex') });
  };
  const line = text => {
    const match = heading.exec(text);
    if (match) { finish(); current = { id: match[1], bytes: 0, hash: crypto.createHash('sha256') }; }
    feed(text);
  };
  const snapshot = writer.read_regular_file(file, 'archive', text => {
    if (text) ends_line = text.endsWith('\n');
    for (const part of text.split(/(?<=\n)/u)) {
      const ends = part.endsWith('\n');
      if (long_line) feed(part);
      else {
        prefix += part;
        if (prefix.length > 1024) {
          if (prefix.startsWith('# → Ask /')) throw Error('archive Ask boundary is too long to verify');
          feed(prefix); prefix = ''; long_line = true;
        } else if (ends) { line(prefix); prefix = ''; }
      }
      if (ends) long_line = false;
    }
  });
  if (prefix) line(prefix);
  finish();
  return { ...snapshot, rounds, ends_line };
};

const verify_archive = (file, original) => {
  if (!original) {
    if (fs.lstatSync(file, { throwIfNoEntry: false })) throw Error('archive identity changed before publication');
    return;
  }
  const current = writer.read_regular_file(file, 'archive', () => {});
  if (!same(current, original)) throw Error('archive identity changed before publication');
};

const publish_archive = ({ file, original, additions, notebook_file, notebook }) => {
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  let fd, renamed = false;
  const hash = crypto.createHash('sha256');
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    if (original) {
      const copied = writer.read_regular_file(file, 'archive', text => { fs.writeFileSync(fd, text); hash.update(text); });
      if (!same(copied, original)) throw Error('archive identity changed while copying');
    }
    for (const bytes of additions) { fs.writeFileSync(fd, bytes); hash.update(bytes); }
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.chmodSync(temporary, original?.mode ?? notebook.mode);
    const expected = hash.digest('hex');
    if (writer.read_regular_file(temporary, 'archive', () => {}).hash !== expected) throw Error('archive copy verification failed');
    verify_archive(file, original);
    writer.verify_notebook_unchanged(notebook_file, notebook);
    fs.renameSync(temporary, file); renamed = true;
    const saved = archive_index(file);
    if (saved.hash !== expected) throw Error('published archive verification failed; live notebook retained');
    return saved;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (!renamed && fs.lstatSync(temporary, { throwIfNoEntry: false })) fs.unlinkSync(temporary);
  }
};

// Caller holds the notebook lock and has checked session ownership.
const compact_locked = ({ root, notebook, original, force = false, include_answered = false }) => {
  notebook = require('./notebook-owner').location({ root, notebook }).notebook;
  const result = { notebook, archive: archive_path_for_notebook(notebook), rounds: [], snapshot: original };
  if (!force && original.content.length < 768 * 1024 && (original.text.match(/\n/gu) || []).length <= 1000) return result;
  const parsed = parse_devlog(original.text);
  const selected = [];
  let blocked;
  for (const round of parsed.rounds.slice(0, -1)) {
    if (!round.reply_text.trim()) {
      blocked = { ask: round.id, reason: 'open-round-retained' };
      break;
    }
    if (!include_answered && /^[ \t]*[-+]?[ \t]*ans:[ \t]*\S/imu.test(round.text)) {
      blocked = { ask: round.id, reason: 'answered-round-retained' };
      break;
    }
    selected.push(round);
  }
  if (blocked) {
    result.blocked = blocked;
    result.message = `Compaction retained ${blocked.ask} (${blocked.reason}); its live bytes and the unselected suffix remain authoritative.`;
  }
  if (!selected.length) return result;
  const boundaries = lint_round_boundaries(original.text);
  if (boundaries.status === 'fail') throw Error(`compaction refused: ${boundaries.detail}`);
  const file = writer.resolve_path(root, notebook, 'notebook');
  const archive = path.join(root, result.archive);
  const parent = path.dirname(archive);
  if (parent !== root) writer.resolve_path(root, path.relative(root, parent).split(path.sep).join('/'), 'archive parent');
  let prior;
  if (fs.lstatSync(archive, { throwIfNoEntry: false })) {
    writer.resolve_path(root, result.archive, 'archive');
    prior = archive_index(archive);
  }
  const additions = [];
  const archive_ids = [...(prior?.rounds.keys() || [])];
  let last_id = archive_ids.length ? Number(archive_ids.at(-1).slice(2)) : -1;
  for (const round of selected) {
    const bytes = Buffer.from(round.text);
    const proof = { id: round.id, bytes: bytes.length, sha256: digest(bytes) };
    const existing = prior?.rounds.get(round.id);
    if (existing) {
      if (existing.bytes !== proof.bytes || existing.sha256 !== proof.sha256) throw Error(`archive collision: ${round.id} has different bytes`);
      if (additions.length) throw Error('archive chronology is inconsistent; live notebook retained');
    } else {
      if (Number(round.id.slice(2)) <= last_id) throw Error('archive chronology is inconsistent; live notebook retained');
      additions.push(bytes); last_id = Number(round.id.slice(2));
    }
    result.rounds.push(proof);
  }
  if (additions.length && prior && !prior.ends_line) throw Error('archive does not end at a line boundary; live notebook retained');
  const saved = additions.length ? publish_archive({ file: archive, original: prior, additions, notebook_file: file, notebook: original }) : prior;
  for (const proof of result.rounds) {
    const copy = saved.rounds.get(proof.id);
    if (!copy || copy.bytes !== proof.bytes || copy.sha256 !== proof.sha256) throw Error(`archive verification failed for ${proof.id}; live notebook retained`);
  }
  let prefix = original.text.slice(0, selected[0].start);
  if (/^Archived eras:[^\r\n]*$/mu.test(prefix)) prefix = prefix.replace(/^Archived eras:[^\r\n]*$/mu, `Archived eras: ${result.archive}.`);
  else throw Error('compaction requires Archived eras in STATUS; archive copies retained');
  const candidate = Buffer.from(prefix + original.text.slice(selected.at(-1).end));
  writer.verify_notebook_unchanged(file, original);
  verify_archive(archive, saved);
  writer.atomic_replace(file, candidate, original.mode);
  result.snapshot = writer.read_regular_file(file, 'notebook');
  if (!result.snapshot.content.equals(candidate)) throw Error('compacted notebook verification failed');
  return result;
};

const compact = ({ root = process.cwd(), notebook, host, session, include_answered = false } = {}) => {
  root = fs.realpathSync(root);
  if (!notebook) throw Error('compact requires --notebook <path>; use the active notebook returned by startup');
  const file = writer.resolve_path(root, notebook, 'notebook');
  const lock = writer.acquire_close_round_lock(`${file}.close-round.lock`);
  try {
    const original = writer.read_regular_file(file, 'notebook');
    require('./notebook-owner').guard({ root, notebook, text: original.text, host, session });
    const { snapshot, ...result } = compact_locked({ root, notebook, original, force: true, include_answered });
    return { ...result, bytes_before: original.content.length, bytes_after: snapshot.content.length };
  } finally { writer.release_close_round_lock(lock); }
};

const main = (argv, cwd) => {
  const options = { root: cwd };
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--notebook', '--host', '--session', '--include-answered'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw Error('usage: agf compact --notebook <path> [--host <id>] [--session <id>] [--include-answered true]');
    const key = argv[i].slice(2);
    if (options[key]) throw Error(`duplicate ${argv[i]}`);
    if (key === 'include-answered') {
      if (argv[i + 1] !== 'true') throw Error('--include-answered accepts only true');
      options.include_answered = true;
    } else options[key] = argv[i + 1];
  }
  return { json: compact(options) };
};

module.exports = { archive_index, compact, compact_locked, main };
