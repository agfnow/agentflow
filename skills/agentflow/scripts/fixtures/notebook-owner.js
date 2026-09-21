'use strict';

// Test setup explicitly adopts pre-populated historical fixtures. Production
// writers never infer ownership from fixture contents or bypass the guard.
const fs = require('node:fs');
const path = require('node:path');
const writer = require('../notebook-write');
const owner = require('../notebook-owner');
const session = 'test-session';
const configure = () => {
  process.env.CODEX_THREAD_ID = session;
  process.env.CODEX_SESSION_ID = session;
  process.env.CLAUDE_SESSION_ID = '';
  process.env.AGENTFLOW_SESSION_ID = '';
};
const adopt = (root, notebook, host = 'codex', selected_session = session) => {
  root = fs.realpathSync(root);
  let inspection;
  try { inspection = owner.inspect({ root, notebook }); } catch { return; } // Deliberately malformed fixtures must reach the writer's own validation.
  const parsed = require('../round-linter').parse_devlog(fs.readFileSync(path.join(root, notebook), 'utf8'));
  if (!parsed.rounds.at(-1) || parsed.rounds.at(-1).reply_text.trim() || ['', '+'].includes(parsed.rounds.at(-1).ask_text.trim())) return;
  const lock = writer.acquire_close_round_lock(`${path.join(root, notebook)}.close-round.lock`);
  const names = host === 'codex' ? ['CODEX_THREAD_ID', 'CODEX_SESSION_ID'] : host === 'claude' ? ['CLAUDE_SESSION_ID'] : [];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  for (const name of names) process.env[name] = selected_session;
  try { owner.transfer({ root, notebook, host, session: selected_session, ask: inspection.ask, expected: inspection.owner?.token || 'unowned', sha256: inspection.sha256 }); }
  finally {
    for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    writer.release_close_round_lock(lock);
  }
};
module.exports = { session, configure, adopt };
