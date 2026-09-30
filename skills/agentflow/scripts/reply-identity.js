'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Only the active session's current turn is evidence. Configuration is never read.
const detect_reply_identity = ({ root = process.cwd(), env = process.env, host, active_host, session } = {}) => {
  const explicit_host = host ?? active_host;
  const ids = [env.CODEX_THREAD_ID, env.CODEX_SESSION_ID].filter(Boolean);
  const detected_host = explicit_host !== undefined
    ? String(explicit_host)
    : ids.length ? 'codex' : env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CLAUDE_CODE ? 'claude' : 'host';
  const unknown = `${/^[a-z0-9][a-z0-9_-]{0,127}$/u.test(detected_host) ? detected_host : 'host'}/unknown`;
  if (detected_host === 'claude') {
    const claude_ids = [env.CLAUDE_CODE_SESSION_ID, env.CLAUDE_SESSION_ID, session || env.AGENTFLOW_SESSION_ID].filter(Boolean);
    if (new Set(claude_ids).size !== 1 || !/^[a-f0-9-]{36}$/iu.test(claude_ids[0])) return unknown;
    try {
      const projects = path.join(env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), '.claude'), 'projects');
      const matches = fs.readdirSync(projects, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(projects, entry.name, `${claude_ids[0]}.jsonl`))
        .filter(file => fs.existsSync(file));
      if (matches.length !== 1) return unknown;
      const stat = fs.lstatSync(matches[0]);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return unknown;
      const cwd = fs.realpathSync(root);
      let turn;
      for (const line of fs.readFileSync(matches[0], 'utf8').split('\n')) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        if (record.isSidechain) continue;
        if (record.type === 'user' || record.type === 'assistant') {
          if (record.sessionId !== claude_ids[0] || (record.session_id && record.session_id !== claude_ids[0]) || fs.realpathSync(record.cwd) !== cwd) return unknown;
          const content = record.message?.content;
          if (record.type === 'user' && (typeof content === 'string' || (Array.isArray(content) && !content.some(block => block.type === 'tool_result')))) turn = undefined;
          if (record.type === 'assistant') turn = record;
        }
      }
      const model = turn?.message?.model;
      const effort = turn?.effort;
      if (typeof model !== 'string' || model.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(model)) return unknown;
      if (typeof effort !== 'string' || effort.length > 32 || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(effort)) return unknown;
      if (turn.perTurnEffort && turn.perTurnEffort !== effort) return unknown;
      return `${model}/${effort}`;
    } catch { return unknown; }
  }
  if (detected_host !== 'codex' || new Set(ids).size !== 1 || !/^[a-f0-9-]{36}$/iu.test(ids[0])) return unknown;
  try {
    const sessions = path.join(env.CODEX_HOME || path.join(env.HOME || os.homedir(), '.codex'), 'sessions');
    const matches = [];
    const visit = (directory, depth) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith(`-${ids[0]}.jsonl`)) matches.push(file);
        else if (depth < 3 && entry.isDirectory() && /^\d{2,4}$/u.test(entry.name)) visit(file, depth + 1);
      }
    };
    visit(sessions, 0);
    if (matches.length !== 1) return unknown;
    const stat = fs.lstatSync(matches[0]);
    if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return unknown;
    const text = fs.readFileSync(matches[0], 'utf8');
    let meta;
    let turn;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const record = JSON.parse(line);
      if (record.type === 'session_meta') {
        if (meta) return unknown;
        meta = record.payload;
      }
      if (record.type === 'turn_context') turn = record.payload;
    }
    if (!meta || !turn || meta.id !== ids[0] || (meta.session_id && meta.session_id !== ids[0])) return unknown;
    const cwd = fs.realpathSync(root);
    if (fs.realpathSync(meta.cwd) !== cwd || fs.realpathSync(turn.cwd) !== cwd) return unknown;
    const { model, effort } = turn;
    if (typeof model !== 'string' || model.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(model)) return unknown;
    if (typeof effort !== 'string' || effort.length > 32 || !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(effort)) return unknown;
    const settings = turn.collaboration_mode?.settings;
    if (settings && ((settings.model && settings.model !== model) || (settings.reasoning_effort && settings.reasoning_effort !== effort))) return unknown;
    return `${model}/${effort}`;
  } catch {
    return unknown;
  }
};

module.exports = { detect_reply_identity };
