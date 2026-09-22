'use strict'

const child_process = require('node:child_process')
const path = require('node:path')

const nested_entrypoint_names = new Set(['codex', 'claude', 'agentflow', 'agf', 'agf-looper', 'godev'])
const nested_script_names = new Set(['agf.js', 'looper.js'])

const command_tokens = command => String(command).trim().split(/\s+/u).filter(Boolean)

const is_node_test_runner = command => {
  const tokens = command_tokens(command)
  return ['node', 'nodejs'].includes(path.basename(tokens[0] || '')) && tokens.slice(1).includes('--test')
}

const is_nested_entrypoint = command => {
  const tokens = command_tokens(command)
  if (tokens.length === 0) return false
  if (nested_entrypoint_names.has(path.basename(tokens[0]))) return true
  if (['node', 'nodejs'].includes(path.basename(tokens[0]))) return nested_script_names.has(path.basename(tokens[1] || ''))
  return nested_script_names.has(path.basename(tokens[0]))
}

const read_process_table = () => {
  if (process.platform === 'win32') return null
  try {
    const text = child_process.execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return text.split(/\r?\n/u).flatMap(line => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line)
      return match === null ? [] : [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }]
    })
  } catch {
    return null
  }
}

const descendants = (root_pid, table) => {
  if (!Array.isArray(table)) return null
  const children = new Map()
  for (const record of table) {
    const list = children.get(record.ppid) || []
    list.push(record)
    children.set(record.ppid, list)
  }
  const found = []
  const queue = [...(children.get(root_pid) || [])]
  while (queue.length > 0) {
    const record = queue.shift()
    found.push(record)
    queue.push(...(children.get(record.pid) || []))
  }
  return found
}

const has_node_test_runner_ancestor = (record, root_pid, records_by_pid) => {
  const inspected = new Set()
  let current_pid = record.ppid
  while (Number.isInteger(current_pid) && !inspected.has(current_pid)) {
    inspected.add(current_pid)
    const current = records_by_pid.get(current_pid)
    if (current === undefined) return false
    if (is_node_test_runner(current.command)) return true
    if (current.pid === root_pid) return false
    current_pid = current.ppid
  }
  return false
}

const find_nested_processes = (root_pid, table = read_process_table()) => {
  const records = descendants(root_pid, table)
  if (records === null) return { visible: false, processes: [] }
  const records_by_pid = new Map(table.map(record => [record.pid, record]))
  return {
    visible: true,
    processes: records
      .filter(record => is_nested_entrypoint(record.command) && !has_node_test_runner_ancestor(record, root_pid, records_by_pid))
      .map(record => ({ pid: record.pid, ppid: record.ppid, executable: record.command.split(/\s+/u)[0], command: record.command })),
  }
}

// Windows has no process groups, so a signal sent to the root leaves every
// descendant running. taskkill /T is the only way to reach the tree, and /F is
// needed with it because a graceful taskkill delivers WM_CLOSE, which a hidden
// console worker never processes. Cancellation on Windows is therefore always
// forceful, and SKILL.md records that.
const send_tree_signal = (child, signal) => {
  if (!child || !child.pid) return
  if (process.platform !== 'win32') {
    process.kill(-child.pid, signal)
    return
  }
  child_process.execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
    windowsHide: true,
    stdio: 'ignore',
    timeout: 10000,
  })
}

const contain_nested_processes = (processes, signal = 'SIGTERM') => {
  const actions = []
  for (const record of processes) {
    try {
      process.kill(record.pid, signal)
      actions.push({ pid: record.pid, signal, sent: true, error: null })
    } catch (error) {
      actions.push({ pid: record.pid, signal, sent: false, error: error.code || error.message })
    }
  }
  return { attempted: processes.length > 0, actions }
}

module.exports = { contain_nested_processes, descendants, find_nested_processes, read_process_table, send_tree_signal }
