#!/usr/bin/env node
'use strict';

const node_crypto = require('node:crypto');
const node_fs = require('node:fs');
const node_path = require('node:path');

const template = `# Tracker

## Identity

- **Work key:** <work-key>.

- **Active Ask:** <A-NNN>.

- **Goal:** <goal>.

- **Last update:** <YYYY-MM-DD HH:MM:SS ±HHMM>.

- **Evidence commit:** uncommitted.

## Overall state

- **State:** active.

- **Reason:** Work remains.

- **Total:** <count>.

- **Completed:** 0.

- **Remaining:** <count>.

## Accepted task checklist

- [ ] **T-1:** <self-contained task: required outcome, scope boundary, and proof needed>. Source: <A-NNN>.

## Accepted scope changes

- None.

## Current recovery

- **Current item:** T-1.

- **Last proven result:** None.

- **Active blocker or running process:** None.

- **Next safe action:** <next action>.

- **Expected changed files:** <paths>.

## Completion proof

- **All accepted tasks checked:** no.

- **Blocking accepted decision:** none.

- **Operation running:** no.

- **Next action remaining:** T-1.

- **Evidence status:** current.

- **Judgment:** active.

## Update meaning

- Saving this tracker is a recovery checkpoint, not a stop signal.

- For completed work, Evidence commit names the Git evidence commit, or is not applicable in a plain folder. Local file and test proof is still required.

- Work continues with the next unfinished item unless an independent stop condition applies.
`;

const file_identity = file => node_crypto.createHash('sha256').update(node_fs.readFileSync(file)).digest('hex');

const validation_facts = ({ repo, tracker, repository = require('./repository-state').detect(repo) }) => {
  const absolute_repo = node_path.resolve(repo);
  const absolute_tracker = node_path.resolve(tracker);
  const relative = node_path.relative(absolute_repo, absolute_tracker).split(node_path.sep).join('/');
  const text = node_fs.readFileSync(absolute_tracker, 'utf8');
  const identity = file_identity(absolute_tracker);
  const entry = node_fs.lstatSync(absolute_tracker);
  return {
    required: true,
    path: relative,
    work_root: node_path.posix.dirname(relative),
    repository_root: '.',
    repository,
    text,
    file: { regular: entry.isFile(), symlink: entry.isSymbolicLink(), checked_identity: identity, opened_identity: identity, read_identity: identity },
    format_only: true
  };
};

const refresh_counts = text => {
  const section = /^#{1,6} Accepted task checklist\r?\n([\s\S]*?)(?=^#{1,6} |$(?![\s\S]))/imu.exec(text)?.[1] || '';
  const tasks = [...section.matchAll(/^[-*+] \[([ xX])\] (?:\*\*)?T-\d+:(?:\*\*)? \S.*$/gmu)];
  const counts = { Total: tasks.length, Completed: tasks.filter(task => task[1].toLowerCase() === 'x').length, Remaining: tasks.filter(task => task[1] === ' ').length };
  const rendered = text.replace(/(^#{1,6} Overall state\r?\n)([\s\S]*?)(?=^#{1,6} |$(?![\s\S]))/imu, (_all, heading, body) => heading + body.replace(/(^[-*+] (?:\*\*)?(Total|Completed|Remaining):(?:\*\*)? )[^\r\n]*$/gmu, (_line, prefix, name) => `${prefix}${counts[name]}.`));
  return { text: rendered, counts };
};

const validate = options => {
  if (!options.refresh) return require('./round-linter.js').lint_tracker(validation_facts(options));
  const writer = require('./notebook-write.js');
  const repo = node_fs.realpathSync(options.repo);
  const relative = node_path.relative(node_path.resolve(options.repo), node_path.resolve(options.tracker)).split(node_path.sep).join('/');
  const file = writer.resolve_path(repo, relative, 'tracker');
  const lock = writer.acquire_close_round_lock(`${file}.close-round.lock`);
  try {
    const original = writer.read_regular_file(file, 'tracker');
    const refreshed = refresh_counts(original.text);
    const facts = validation_facts({ repo, tracker: file });
    const result = require('./round-linter.js').lint_tracker({ ...facts, text: refreshed.text });
    if (result.status === 'fail') return result;
    writer.verify_notebook_unchanged(file, original);
    if (refreshed.text !== original.text) writer.atomic_replace(file, Buffer.from(refreshed.text), original.mode);
    return { ...result, counts: refreshed.counts };
  } finally { writer.release_close_round_lock(lock); }
};

const run = () => {
  const args = process.argv.slice(2);
  if (args[0] === 'template' && args.length === 1) {
    process.stdout.write(template);
    return;
  }
  if (args[0] === 'validate') {
    const repo_index = args.indexOf('--repo');
    const tracker_index = args.indexOf('--tracker');
    if (repo_index < 0 || tracker_index < 0 || !args[repo_index + 1] || !args[tracker_index + 1]) {
      throw new Error('Usage: tracker-contract.js validate --repo <repo> --tracker <tracker>');
    }
    const result = validate({ repo: args[repo_index + 1], tracker: args[tracker_index + 1], refresh: args.includes('--refresh') });
    process.stdout.write(`${result.status.toUpperCase()}: ${result.detail}${result.counts ? `; ${result.counts.Completed}/${result.counts.Total} tasks complete, ${result.counts.Remaining} remaining` : ''}\n`);
    process.exitCode = result.status === 'fail' ? 1 : 0;
    return;
  }
  throw new Error('Usage: tracker-contract.js template | validate --repo <repo> --tracker <tracker>');
};

module.exports = { template, validate, validation_facts, refresh_counts };

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
