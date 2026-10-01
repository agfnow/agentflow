'use strict';

const { execFileSync } = require('node:child_process');
const { parse_devlog } = require('./round-linter');
const { read_close_scope } = require('./notebook-write');

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trimEnd();
  } catch {
    return '';
  }
};

// A successful close already linted the committed round. Later working files
// belong to another point in time, so they cannot revoke that result.
const verified_closed_round = (root, notebook, host, devlog_text) => {
  const parsed = parse_devlog(devlog_text);
  const round = parsed.rounds.find(candidate => candidate.text === parsed.last_round);
  if (!round?.reply_text.trim()) return false;
  const commit = git(root, ['log', '-1', '--format=%H', '-S', `# ← Reply / ${round.id}`, '--', notebook]);
  if (!/^[a-f0-9]{40}$/u.test(commit)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore', timeout: 10000 });
  } catch { return false; }
  const message = git(root, ['log', '-1', '--format=%B', commit]);
  const close_ids = [...message.matchAll(/^Agentflow-Close-Id: ([a-f0-9]{64})$/gmu)];
  if (close_ids.length !== 1) return false;
  const receipt = read_close_scope(root, notebook, host, round.id, close_ids[0][1]);
  if (receipt?.commit !== commit) return false;
  const committed = git(root, ['show', `${commit}:${notebook}`]);
  const closed_round = parse_devlog(committed).rounds.find(candidate => candidate.id === round.id);
  return closed_round?.text === round.text;
};

module.exports = { verified_closed_round };
