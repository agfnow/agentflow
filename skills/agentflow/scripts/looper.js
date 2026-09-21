#!/usr/bin/env node
'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn: node_spawn, spawnSync: node_spawn_sync } = require('node:child_process')
const { StringDecoder } = require('node:string_decoder')
const { contain_nested_processes, find_nested_processes, read_process_table } = require('./process-tree')
const { format_local_timestamp } = require('./local-time')
const agentflow_settings = require('./ag-settings')
const queue_contract = require('./queue-contract')
const delegation_route = require('./delegation-route')
const notebook_owner = require('./notebook-owner')
const notebook_writer = require('./notebook-write')

const PLAN_PATTERN = /^plan-([0-9]{3})\.md$/
const MAX_PLAN_BYTES = 1024 * 1024
const PLAN_READ_BUFFER_BYTES = 64 * 1024
const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_LINE_BYTES = 8192
const LOCK_NAME = '.looper.lock'
const ATTEMPT_NAME = '.looper-attempt.json'
const STOP_NAME = '.stop.txt'
const RECOVERY_NAME_ATTEMPTS = 8
const MILESTONE_INTERVAL_MS = 60 * 1000
const MAX_MILESTONE_DETAIL_CHARS = 240

const workspace_defaults = root => {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'ag.json'), 'utf8'))
    const paths = agentflow_settings.workspace_paths(config)
    return { tasks_dir: path.join(root, paths.workspace || '.', 'planned'), completion_path: paths.notebook }
  } catch {
    return { tasks_dir: path.join(root, 'planned'), completion_path: 'devlog.md' }
  }
}

const wrap_words = (text, width, first_prefix = '', next_prefix = first_prefix) => {
  const limit = Math.max(20, Number.isFinite(width) ? Math.floor(width) : 80)
  const words = String(text).trim().split(/\s+/u)
  const lines = []
  let prefix = first_prefix
  let line = prefix
  for (const word of words) {
    if (line.length > prefix.length && line.length + 1 + word.length > limit) {
      lines.push(line)
      prefix = next_prefix
      line = `${prefix}${word}`
    } else {
      line += `${line.length > prefix.length ? ' ' : ''}${word}`
    }
  }
  if (line.length > prefix.length || !lines.length) lines.push(line)
  return lines
}

const render_help = (width = 80) => {
  const option_indent = '  '
  const limit = Math.max(20, Number.isFinite(width) ? Math.floor(width) : 80)
  const description_column = limit < 60 ? 4 : 29
  const options = [
    ['--tasks-dir <path>', 'Plan directory. Default: the configured workspace planned/ directory.'],
    ['--completion-path <path>', 'Notebook whose exact "<path> updated" reply proves completion.'],
    ['--executable <path>', 'Worker executable override.'],
    ['--show-output', "Page each worker's bounded final output after it exits."],
    ['--dump', 'Save complete worker stdout and stderr under artifacts/looper-output/.'],
    ['--reset', 'Retire reviewed stale control records, then exit without running a plan.'],
    ['-h, --help', 'Show this help.'],
  ]
  const option_lines = options.flatMap(([syntax, description]) => {
    if (description_column === 4) return [
      `${option_indent}${syntax}`,
      ...wrap_words(description, limit, ' '.repeat(description_column), ' '.repeat(description_column)),
    ]
    const label = `${option_indent}${syntax}`.padEnd(description_column)
    return wrap_words(description, limit, label, ' '.repeat(description_column))
  })
  return [
    ...wrap_words('Usage: agf-looper [options] [planned-directory]', limit, '', '  '),
    '',
    ...wrap_words('Run plan-NNN.md files one at a time from the checkout where the work must happen.', limit),
    '',
    'Options:',
    ...option_lines,
    '',
    ...wrap_words('Install both agf and agf-looper after installing the skill:', limit),
    ...wrap_words('node <agentflow-skill-dir>/scripts/setup.js --fix', limit, '  ', '  '),
    '',
    'Recovery:',
    ...wrap_words('Read the failure checklist and inspect every named path. Looper never guesses that another host finished a plan. Move a reviewed completed plan into planned/done/, or leave it pending, then run --reset to retire the named stop, attempt, and stale ownership records. Run agf-looper again when you are ready to retry.', limit, '  ', '  '),
  ].join('\n')
}

const HELP = render_help(80)

const looper_error = (message, options = {}) => {
  const error = new Error(message)
  error.name = 'LooperError'
  error.exit_code = options.exit_code || 1
  error.crash = options.crash === true
  error.interruption = options.interruption === true
  error.reported = options.reported === true
  error.ownership_lost = options.ownership_lost === true
  error.nested_worker = options.nested_worker || null
  error.handoff = options.handoff === true
  return error
}

const error_message = (error) => {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return String(error)
}

const now = () => format_local_timestamp()

const format_path = (value) => path.resolve(String(value))

const path_is_within = (candidate, parent) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

const canonical_path = (file_system, value) => {
  const absolute = format_path(value)
  let probe = absolute
  const missing = []
  while (true) {
    try {
      const resolved = file_system.realpathSync(probe)
      return path.join(resolved, ...missing.reverse())
    } catch (error) {
      if (!error || error.code !== 'ENOENT' || probe === path.dirname(probe)) throw error
      missing.push(path.basename(probe))
      probe = path.dirname(probe)
    }
  }
}

const stat_identity = (stat) => ({ dev: stat.dev, ino: stat.ino, size: stat.size })

const same_stat_identity = (left, right) =>
  left && right && left.dev === right.dev && left.ino === right.ino && left.size === right.size

const same_file_object = (left, right) =>
  left && right && left.dev === right.dev && left.ino === right.ino

const ensure_regular_nonsymlink = (file_system, file, label = 'file') => {
  const stat = file_system.lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile())
    throw looper_error(`${label} is not a regular nonsymlink file: ${file}`)
  return stat
}

const descriptor_flags = () => {
  let flags = fs.constants.O_RDONLY
  if (typeof fs.constants.O_NOFOLLOW === 'number') flags |= fs.constants.O_NOFOLLOW
  return flags
}

const append_secondary = (message, secondary) =>
  secondary.length ? `${message}; additionally ${secondary.join('; ')}` : message

const safe_unlink = (file_system, file) => {
  try {
    file_system.unlinkSync(file)
  } catch {
    // A failed cleanup must not replace the primary error.
  }
}

const write_atomic = (file_system, file, content) => {
  const temporary = `${file}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    file_system.writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    file_system.renameSync(temporary, file)
  } catch (error) {
    safe_unlink(file_system, temporary)
    throw error
  }
}

const write_json_atomic = (file_system, file, value) =>
  write_atomic(file_system, file, `${JSON.stringify(value)}\n`)

const attempt_evidence_error = (file, detail) =>
  looper_error(`invalid durable attempt evidence at ${file}: ${detail}; human review required`)

const read_attempt_bytes = (file_system, file, path_stat) => {
  let descriptor = null
  let primary_error = null
  const secondary = []
  let content = null
  const valid_stat_number = (value) => Number.isSafeInteger(value) && value >= 0
  const regular_stat = (stat) => stat && typeof stat.isFile === 'function' && stat.isFile() &&
    typeof stat.isSymbolicLink === 'function' && !stat.isSymbolicLink() &&
    valid_stat_number(stat.dev) && valid_stat_number(stat.ino) && valid_stat_number(stat.size)

  try {
    descriptor = file_system.openSync(file, descriptor_flags())
    const descriptor_stat = file_system.fstatSync(descriptor)
    if (!regular_stat(descriptor_stat) || !same_stat_identity(stat_identity(path_stat), stat_identity(descriptor_stat)))
      throw new Error(`filesystem identity changed while opening ${file}`)
    if (descriptor_stat.size > MAX_PLAN_BYTES)
      throw new Error(`attempt evidence exceeds the ${MAX_PLAN_BYTES}-byte limit`)

    content = Buffer.alloc(descriptor_stat.size)
    const buffer = Buffer.alloc(Math.min(PLAN_READ_BUFFER_BYTES, MAX_PLAN_BYTES))
    let bytes_read = 0
    while (bytes_read < descriptor_stat.size) {
      const requested = Math.min(buffer.length, descriptor_stat.size - bytes_read)
      const read = file_system.readSync(descriptor, buffer, 0, requested, null)
      if (!Number.isSafeInteger(read) || read <= 0 || read > requested)
        throw new Error(`short or inconsistent read for ${file}`)
      buffer.copy(content, bytes_read, 0, read)
      bytes_read += read
      if (bytes_read > descriptor_stat.size || bytes_read > MAX_PLAN_BYTES)
        throw new Error(`attempt evidence grew beyond its declared size for ${file}`)
    }

    const final_stat = file_system.fstatSync(descriptor)
    if (!regular_stat(final_stat) || bytes_read !== descriptor_stat.size ||
      !same_stat_identity(stat_identity(descriptor_stat), stat_identity(final_stat)))
      throw new Error(`filesystem identity or size changed while reading ${file}`)
  } catch (error) {
    primary_error = error
  } finally {
    if (descriptor !== null) {
      try {
        file_system.closeSync(descriptor)
      } catch (error) {
        const close_message = `descriptor close failed: ${error_message(error)}`
        if (!primary_error) primary_error = new Error(close_message)
        else secondary.push(close_message)
      }
    }
  }

  if (primary_error)
    throw attempt_evidence_error(file, append_secondary(error_message(primary_error), secondary))
  return content
}

const read_json_if_present = (file_system, file) => {
  let stat
  try {
    stat = file_system.lstatSync(file)
  } catch (error) {
    if (error && error.code === 'ENOENT') return null
    throw attempt_evidence_error(file, `it could not be inspected: ${error_message(error)}`)
  }
  try {
    if (stat.isSymbolicLink() || !stat.isFile())
      throw looper_error(`invalid durable attempt evidence at ${file}: it is not a regular nonsymlink file; human review required`)
  } catch (error) {
    if (error && error.name === 'LooperError') throw error
    throw attempt_evidence_error(file, `its type could not be trusted: ${error_message(error)}`)
  }
  if (!Number.isSafeInteger(stat.size) || stat.size < 0)
    throw attempt_evidence_error(file, 'its size could not be trusted')
  let value
  try {
    value = JSON.parse(read_attempt_bytes(file_system, file, stat).toString('utf8'))
  } catch (error) {
    if (error && error.name === 'LooperError') throw error
    throw looper_error(`invalid durable attempt evidence at ${file}: ${error_message(error)}; human review required`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw looper_error(`invalid durable attempt evidence at ${file}; human review required`)
  return value
}

const get_tasks = (tasks_dir, file_system = fs) => {
  const entries = file_system.readdirSync(tasks_dir)
  return entries
    .map((name) => {
      const match = PLAN_PATTERN.exec(name)
      if (!match) return null
      const file = path.join(tasks_dir, name)
      try {
        if (!file_system.lstatSync(file).isFile()) return null
      } catch (error) {
        if (error && error.code === 'ENOENT') return null
        throw error
      }
      return { name, number: Number(match[1]), path: file }
    })
    .filter(Boolean)
    .sort((left, right) => left.number - right.number)
}

const read_file_identity = (file_system, file) => {
  const selected_path = format_path(file)
  let path_stat
  try {
    path_stat = ensure_regular_nonsymlink(file_system, selected_path, 'selected plan')
  } catch (error) {
    if (error && error.name === 'LooperError') throw error
    throw looper_error(`selected plan could not be inspected: ${selected_path}: ${error_message(error)}`)
  }
  if (path_stat.size > MAX_PLAN_BYTES)
    throw looper_error(`selected plan exceeds the ${MAX_PLAN_BYTES}-byte limit: ${selected_path}`)

  let descriptor = null
  let primary_error = null
  let result = null
  try {
    descriptor = file_system.openSync(selected_path, descriptor_flags())
    const descriptor_stat = file_system.fstatSync(descriptor)
    if (!descriptor_stat.isFile() || !same_stat_identity(stat_identity(path_stat), stat_identity(descriptor_stat)))
      throw looper_error(`selected plan filesystem identity changed while opening: ${selected_path}`)
    if (descriptor_stat.size > MAX_PLAN_BYTES)
      throw looper_error(`selected plan exceeds the ${MAX_PLAN_BYTES}-byte limit: ${selected_path}`)

    const hash = crypto.createHash('sha256')
    const buffer = Buffer.alloc(PLAN_READ_BUFFER_BYTES)
    let bytes_read = 0
    while (bytes_read < descriptor_stat.size) {
      const requested = Math.min(buffer.length, descriptor_stat.size - bytes_read)
      const read = file_system.readSync(descriptor, buffer, 0, requested, null)
      if (read <= 0) throw looper_error(`selected plan changed while hashing: ${selected_path}`)
      bytes_read += read
      if (bytes_read > MAX_PLAN_BYTES)
        throw looper_error(`selected plan exceeds the ${MAX_PLAN_BYTES}-byte limit: ${selected_path}`)
      hash.update(buffer.subarray(0, read))
    }

    const final_stat = file_system.fstatSync(descriptor)
    if (bytes_read !== descriptor_stat.size || !same_stat_identity(stat_identity(descriptor_stat), stat_identity(final_stat)))
      throw looper_error(`selected plan changed while hashing: ${selected_path}`)
    result = {
      selected_path,
      ...stat_identity(descriptor_stat),
      sha256: hash.digest('hex'),
    }
  } catch (error) {
    primary_error = error
  } finally {
    if (descriptor !== null) {
      try {
        file_system.closeSync(descriptor)
      } catch (error) {
        if (!primary_error) primary_error = error
      }
    }
  }
  if (primary_error) {
    if (primary_error.name === 'LooperError') throw primary_error
    throw looper_error(`selected plan could not be hashed safely: ${error_message(primary_error)}`)
  }
  return result
}

const same_file_identity = (left, right) =>
  same_stat_identity(left, right) && left.sha256 === right.sha256

const verify_file_identity = (file_system, file, expected) => {
  const actual = read_file_identity(file_system, file)
  if (!same_file_identity(actual, expected))
    throw looper_error(`selected plan filesystem identity changed: ${format_path(file)}`)
  return actual
}

const line_matches = (line, expected) => {
  const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
  return normalized === expected
}

const bounded_text = (value) => {
  let text = value.toString('utf8')
  while (Buffer.byteLength(text, 'utf8') > MAX_DIAGNOSTIC_BYTES) text = text.slice(1)
  return text
}

const notebook_round_state = (text, { allow_names = false } = {}) => {
  // Named Ask/Reply headings are part of the shared notebook grammar in every
  // launch mode; standalone looper verification must not reject them.
  const name = '(?: \\([^\\r\\n)]+\\))?'
  return {
    reply_ids: [...String(text).matchAll(new RegExp(`^# ← Reply / A-([0-9]+)${name}\\r?$`, 'gmu'))].map(match => Number(match[1])),
    next_ask_id: Number((String(text).match(new RegExp(`(?:^|\\r?\\n)# → Ask / A-([0-9]+)${name}\\r?\\n\\r?\\n\\+\\r?\\n?$`, 'u')) || [])[1] || 0),
  }
}

const read_notebook_round_state = context => {
  const notebook = path.resolve(context.root, context.completion_path)
  if (!path_is_within(notebook, context.root)) throw looper_error(`completion notebook is outside the repository: ${notebook}`)
  let text
  try { text = context.file_system.readFileSync(notebook, 'utf8') } catch (error) {
    throw looper_error(`completion notebook could not be read at ${notebook}: ${error_message(error)}`)
  }
  return notebook_round_state(text)
}

const verify_notebook_round = (context, before) => {
  if (context.options.verify_notebook_round === false) return
  const after = read_notebook_round_state(context)
  if (before.next_ask_id < 1 ||
    after.reply_ids.length !== before.reply_ids.length + 1 ||
    after.reply_ids.at(-1) !== before.next_ask_id ||
    after.next_ask_id !== before.next_ask_id + 1)
    throw looper_error(`completion notebook did not add exactly one \`# ← Reply / A-NNN\` round followed by the next empty \`# → Ask / A-NNN\` scaffold`)
}

const with_notebook_lock = (context, action) => {
  const location = notebook_owner.location({ root: context.root, notebook: context.completion_path })
  const file = notebook_owner.safe_path(location.root, location.notebook)
  const lock = notebook_writer.acquire_close_round_lock(`${file}.close-round.lock`)
  try { return action(location, file) } finally { notebook_writer.release_close_round_lock(lock) }
}

const reserve_notebook_round = (context, identity) => {
  if (context.options.verify_notebook_round === false) return undefined
  return with_notebook_lock(context, (location, file) => {
    const text = notebook_writer.read_regular_file(file, 'notebook').text
    const current = require('./round-linter').parse_devlog(text).rounds.at(-1)
    if (!current || !['', '+'].includes(current.ask_text.trim()) || current.reply_text.trim() || current.wip_text.trim())
      throw looper_error('notebook ownership: plan launch requires an empty current Ask; finish or explicitly recover the unresolved round first')
    const held = notebook_owner.guard({ root: location.root, notebook: location.notebook, text,
      ...(identity || { host: 'looper', session: context.owner_token }) })
    context.notebook_ownership = held.record
    return notebook_round_state(text)
  })
}

const verify_notebook_owner = (context, location, allow_released = false) => {
  const saved = context.notebook_ownership
  if (!saved) throw looper_error('notebook ownership reservation is missing from the attempt')
  const current = notebook_owner.read(location)
  const held = { ...location, identity: { host: saved.host, session: saved.session },
    record: { ...saved, state: allow_released && current?.state === 'released' ? 'released' : 'active' } }
  notebook_owner.verify(held, { root: context.root, notebook: context.completion_path, active: !allow_released })
  return held
}

const output_stream = (context, name) => context.options[name] || (name === 'stdout' ? process.stdout : process.stderr)

const say = (context, message, name = 'stderr') => {
  if (context.options.silent) return
  output_stream(context, name).write(`${message}\n`)
}

const queue_view = (context, active = null, failed = null) => {
  const open = get_tasks(context.tasks_dir, context.file_system).map(task => task.name)
  let done = []
  try { done = get_tasks(context.done_dir, context.file_system).map(task => task.name) } catch {}
  const names = [...new Set([...done, ...open])].sort()
  const completed = new Set(done)
  const current = active ? completed.size + 1 : completed.size
  const lines = [`Progress: ${Math.min(current, names.length)}/${names.length}`]
  for (const name of names) {
    const mark = completed.has(name) ? 'x' : name === failed ? '-' : name === active ? '*' : ' '
    lines.push(`[${mark}] ${name}`)
  }
  return { completed: completed.size, total: names.length, lines }
}

const show_queue = (context, active = null, failed = null) => {
  const view = queue_view(context, active, failed)
  for (const line of view.lines) say(context, line)
  return view
}

const show_worker_output = (context, diagnostic_tail) => {
  if (!context.options.show_output || !diagnostic_tail) return
  const task = context.current_plan ? context.current_plan.name : 'worker'
  if (typeof context.options.page_output === 'function') {
    context.options.page_output({ task, output: diagnostic_tail })
    return
  }
  const destination = output_stream(context, 'stderr')
  const pager = context.options.pager || process.env.PAGER || 'less'
  if (destination.isTTY) {
    say(context, `Showing the last ${MAX_DIAGNOSTIC_BYTES} bytes of ${task} output. Press q to return.`)
    const result = node_spawn_sync(pager, ['-R'], { input: diagnostic_tail, stdio: ['pipe', 'inherit', 'inherit'] })
    if (!result.error && result.status === 0) return
  }
  destination.write(`\nWorker output for ${task}:\n${diagnostic_tail}\n`)
}

const recovery_message = (context, message) => {
  const task = context.current_plan && context.current_plan.name
  const stop = context.stop_file || path.join(context.tasks_dir, STOP_NAME)
  const attempt = context.attempt_file || 'the protected attempt path shown after the plan directory can be opened safely'
  const done = context.done_dir || path.join(context.tasks_dir, 'done')
  const nesting = context.nested_worker?.detected
    ? `\n\nNested-worker warning: a nested model or Agentflow process was detected and contained. Parent output and authorized source changes were preserved; nested-derived evidence is quarantined. Inspect ${attempt} for the detected executable and PID, then arrange a fresh coordinator-controlled review before accepting the implementation. Process-tree visibility is limited to what the host exposed.`
    : ''
  return `${message}${nesting}\n\nWhat to do next:\n1. Inspect ${task ? `${task}, ` : ''}${context.completion_path}, and the checkout's Git changes.\n2. Inspect the stop marker at ${stop}.\n3. Inspect the protected attempt record at ${attempt}.\n4. If another host truly finished the plan, move that reviewed plan into ${done}; otherwise leave it pending.\n5. Preserve any evidence you need, clear only the reviewed stop and attempt records, then run agf-looper again.\nRun agf-looper --help for the command summary.`
}

const milestone_detail = (line) => String(line || '')
  .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
  .trim()
  .slice(0, MAX_MILESTONE_DETAIL_CHARS)

const make_capture = (expected_line) => {
  const streams = new Map()
  const matches_by_stream = new Map()
  let diagnostic_tail = Buffer.alloc(0)
  let latest_line = ''

  const append_tail = (chunk) => {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    if (value.length >= MAX_DIAGNOSTIC_BYTES) {
      diagnostic_tail = value.subarray(value.length - MAX_DIAGNOSTIC_BYTES)
      return
    }
    const combined = Buffer.concat([diagnostic_tail, value])
    diagnostic_tail = combined.length > MAX_DIAGNOSTIC_BYTES
      ? combined.subarray(combined.length - MAX_DIAGNOSTIC_BYTES)
      : combined
  }

  const make_stream = () => ({
    decoder: new StringDecoder('utf8'),
    line: '',
    overflow: false,
  })

  const consume_text = (stream_name, state, text) => {
    let start = 0
    while (start < text.length) {
      const newline = text.indexOf('\n', start)
      const fragment = newline === -1 ? text.slice(start) : text.slice(start, newline)
      if (!state.overflow) {
        const next = state.line + fragment
        if (Buffer.byteLength(next, 'utf8') > MAX_LINE_BYTES) {
          state.line = ''
          state.overflow = true
        } else {
          state.line = next
        }
      }
      if (newline === -1) return
      if (!state.overflow && line_matches(state.line, expected_line))
        matches_by_stream.set(stream_name, (matches_by_stream.get(stream_name) || 0) + 1)
      if (!state.overflow && state.line.trim()) latest_line = milestone_detail(state.line)
      state.line = ''
      state.overflow = false
      start = newline + 1
    }
  }

  const consume = (stream_name, chunk) => {
    append_tail(chunk)
    if (!streams.has(stream_name)) streams.set(stream_name, make_stream())
    const state = streams.get(stream_name)
    consume_text(stream_name, state, state.decoder.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
  }

  const finish_stream = (stream_name) => {
    if (!streams.has(stream_name)) return
    const state = streams.get(stream_name)
    consume_text(stream_name, state, state.decoder.end())
    if (!state.overflow && state.line.length && line_matches(state.line, expected_line))
      matches_by_stream.set(stream_name, (matches_by_stream.get(stream_name) || 0) + 1)
    state.line = ''
    state.overflow = false
  }

  return {
    consume,
    finish_stream,
    get matches() {
      const counts = [...matches_by_stream.values()]
      const total = counts.reduce((sum, count) => sum + count, 0)
      return total === 2 && counts.length === 2 && counts.every(count => count === 1) ? 1 : total
    },
    get diagnostic_tail() { return diagnostic_tail },
    get latest_line() { return latest_line },
  }
}

const state_root_is_safe = (candidate, root, tasks_dir, system_temp) =>
  !path_is_within(candidate, root) && !path_is_within(candidate, tasks_dir) && !path_is_within(candidate, system_temp)

const node_identity = (stat) => ({ dev: stat.dev, ino: stat.ino })

const same_node_identity = (left, right) =>
  left && right && left.dev === right.dev && left.ino === right.ino

const read_directory_identity = (file_system, directory, label) => {
  let stat
  try {
    stat = file_system.lstatSync(directory)
  } catch (error) {
    throw looper_error(`${label} could not be inspected at ${directory}: ${error_message(error)}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw looper_error(`${label} is not a real directory at ${directory}`)
  return node_identity(stat)
}

const verify_directory_identity = (file_system, directory, expected, label) => {
  const actual = read_directory_identity(file_system, directory, label)
  if (!same_node_identity(actual, expected))
    throw looper_error(`${label} was replaced at ${directory}; human review required`)
  return true
}

const verify_protected_state = (context) => {
  let stat
  try {
    stat = context.file_system.lstatSync(context.state_dir)
  } catch (error) {
    throw looper_error(`protected state directory could not be inspected at ${context.state_dir}: ${error_message(error)}`)
  }
  if (stat.isSymbolicLink() || !stat.isDirectory())
    throw looper_error(`protected state directory is not a real directory at ${context.state_dir}`)
  if (!same_node_identity(node_identity(stat), context.state_identity))
    throw looper_error(`protected state directory was replaced at ${context.state_dir}; human review required`)
  if ((stat.mode & 0o077) !== 0)
    throw looper_error(`protected state directory has group or other permission bits at ${context.state_dir}`)
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid())
    throw looper_error(`protected state directory has the wrong owner at ${context.state_dir}`)
  return true
}

const verify_queue_identity = (context) => {
  verify_directory_identity(context.file_system, context.root, context.root_identity, 'repository root directory')
  verify_directory_identity(context.file_system, context.tasks_dir, context.tasks_identity, 'task directory')
  return true
}

const choose_default_state_root = (context, root, tasks_dir, system_temp) => {
  const xdg_state_home = process.env.XDG_STATE_HOME
  if (xdg_state_home && path.isAbsolute(xdg_state_home)) {
    try {
      const candidate = canonical_path(context.file_system, xdg_state_home)
      if (state_root_is_safe(candidate, root, tasks_dir, system_temp)) return candidate
    } catch {
      // The home-directory fallback is validated below.
    }
  }
  return path.join(os.homedir(), '.local', 'state')
}

const prepare_state = (context) => {
  const root = canonical_path(context.file_system, context.root)
  const tasks_dir = canonical_path(context.file_system, context.tasks_dir)
  const root_identity = read_directory_identity(context.file_system, root, 'repository root directory')
  const tasks_identity = read_directory_identity(context.file_system, tasks_dir, 'task directory')
  const system_temp = canonical_path(context.file_system, os.tmpdir())
  const requested_state_root = context.options.state_root !== undefined
    ? context.options.state_root
    : choose_default_state_root(context, root, tasks_dir, system_temp)
  let state_root
  try {
    state_root = canonical_path(context.file_system, requested_state_root)
  } catch (error) {
    throw looper_error(`protected state root could not be resolved: ${error_message(error)}`)
  }
  if (!state_root_is_safe(state_root, root, tasks_dir, system_temp))
    throw looper_error(`protected state root is unsafe; it must be outside the repository, task directory, and system temporary directory: ${state_root}`)

  const queue_hash = crypto.createHash('sha256').update(tasks_dir).digest('hex')
  const state_dir = path.join(state_root, 'agentflow', 'looper', queue_hash)
  try {
    context.file_system.mkdirSync(state_dir, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw looper_error(`protected state directory could not be created: ${error_message(error)}`)
  }
  let canonical_state_dir
  let state_identity
  try {
    const state_stat = context.file_system.lstatSync(state_dir)
    if (state_stat.isSymbolicLink() || !state_stat.isDirectory())
      throw new Error('protected state directory is not a real directory')
    if ((state_stat.mode & 0o077) !== 0)
      throw new Error('protected state directory has group or other permission bits')
    if (typeof process.getuid === 'function' && state_stat.uid !== process.getuid())
      throw new Error('protected state directory has the wrong owner')
    state_identity = node_identity(state_stat)
    canonical_state_dir = canonical_path(context.file_system, state_dir)
  } catch (error) {
    throw looper_error(`protected state directory is unsafe: ${error_message(error)}`)
  }
  if (!state_root_is_safe(canonical_state_dir, root, tasks_dir, system_temp))
    throw looper_error(`protected state directory is unsafe: ${canonical_state_dir}`)

  context.root = root
  context.tasks_dir = tasks_dir
  context.done_dir = path.join(tasks_dir, 'done')
  context.stop_file = path.join(tasks_dir, STOP_NAME)
  context.canonical_tasks_dir = tasks_dir
  context.root_identity = root_identity
  context.tasks_identity = tasks_identity
  context.state_dir = canonical_state_dir
  context.state_identity = state_identity
  context.lock_dir = path.join(canonical_state_dir, LOCK_NAME)
  context.attempt_file = path.join(canonical_state_dir, ATTEMPT_NAME)
}

const make_context = (options) => {
  const file_system = options.fs || fs
  const root = format_path(options.root || process.cwd())

  const defaults = workspace_defaults(root)
  const tasks_dir = format_path(options.tasks_dir || defaults.tasks_dir)
  const completion_path = options.completion_path || defaults.completion_path
  const completion_line = options.completion_line || `${completion_path} updated`
  const context = {
    options,
    file_system,
    root,
    tasks_dir,
    done_dir: path.join(tasks_dir, 'done'),
    state_dir: null,
    canonical_tasks_dir: null,
    root_identity: null,
    tasks_identity: null,
    state_identity: null,
    lock_dir: null,
    attempt_file: null,
    stop_file: path.join(tasks_dir, STOP_NAME),
    completion_line,
    executable: options.executable || null,
    command_args: [],
    spawn: options.spawn || node_spawn,
    launched: [],
    current_attempt: null,
    current_plan: null,
    active_child: null,
    nested_worker: { visible: false, detected: false, processes: [], containment: { attempted: false, actions: [] }, poll_count: 0 },
    interruption: null,
    no_later_launch: false,
    listeners: [],
    owner_acquired: false,
    owner_token: null,
    lock_identity: null,
    owner_identity: null,
    generated_queue_authority: null,
    worker_family: options.executable && path.basename(String(options.executable)) === 'codex' ? 'codex' : null,
    worker_model: null,
    worker_effort: null,
    completion_message_file: null,
    completion_message_descriptor: null,
    completion_message_identity: null,
    completion_message_argument: null,
    completion_path,
  }
  return context
}

const verify_generated_queue = (context) => {
  if (!context.generated_queue_authority) return null
  try {
    return queue_contract.read_frozen_queue(context.tasks_dir, {
      authority: context.generated_queue_authority,
    })
  } catch (error) {
    throw looper_error(`generated frozen queue authority failed: ${error_message(error)}`)
  }
}

const initialize_generated_queue = (context) => {
  const envelope_path = path.join(context.tasks_dir, queue_contract.ENVELOPE_NAME)
  if (!path_is_present(context.file_system, envelope_path)) {
    const generated = get_tasks(context.tasks_dir, context.file_system).some(task => {
      try {
        const path_stat = ensure_regular_nonsymlink(context.file_system, task.path, 'selected plan')
        // The normal selection path records the durable failure for oversized
        // plans. Do not pre-empt it merely while looking for authority markers.
        if (path_stat.size > MAX_PLAN_BYTES) return false
        const identity = read_file_identity(context.file_system, task.path)
        let descriptor = null
        try {
          descriptor = context.file_system.openSync(task.path, descriptor_flags())
          const opened = context.file_system.fstatSync(descriptor)
          if (!opened.isFile() || !same_stat_identity(identity, stat_identity(opened)))
            throw new Error(`filesystem identity changed while opening ${task.path}`)
          const content = Buffer.alloc(opened.size)
          let offset = 0
          while (offset < content.length) {
            const count = context.file_system.readSync(descriptor, content, offset, content.length - offset, null)
            if (!Number.isSafeInteger(count) || count <= 0) throw new Error(`short read for ${task.path}`)
            offset += count
          }
          const closed = context.file_system.fstatSync(descriptor)
          if (!same_stat_identity(stat_identity(opened), stat_identity(closed)))
            throw new Error(`filesystem identity changed while reading ${task.path}`)
          if (crypto.createHash('sha256').update(content).digest('hex') !== identity.sha256)
            throw new Error(`content changed while reading ${task.path}`)
          const final_path = ensure_regular_nonsymlink(context.file_system, task.path, 'selected plan')
          if (!same_stat_identity(stat_identity(closed), stat_identity(final_path)))
            throw new Error(`filesystem identity changed after reading ${task.path}`)
          const text = content.toString('utf8')
          return /^## Authority[ \t]*$/mu.test(text) && /^-[ \t]*generation_id:[ \t]*\S+/mu.test(text)
        } finally {
          if (descriptor !== null) context.file_system.closeSync(descriptor)
        }
      } catch (error) {
        throw looper_error(`generated plan authority could not be inspected: ${error_message(error)}`)
      }
    })
    if (generated) throw looper_error('generated plan authority is incomplete: queue envelope is missing; refusing to launch')
    return false
  }
  let authority
  try {
    authority = queue_contract.read_frozen_queue(context.tasks_dir)
  } catch (error) {
    throw looper_error(`generated frozen queue authority failed: ${error_message(error)}`)
  }
  const supplied_completion = context.options.completion_line ||
    ((context.options.completion_path !== undefined && context.options.completion_path_explicit !== false)
      ? `${context.options.completion_path} updated`
      : null)
  if (supplied_completion && supplied_completion !== authority.envelope.completion_signal)
    throw looper_error(`generated queue completion override does not match frozen envelope: expected ${authority.envelope.completion_signal}`)
  context.generated_queue_authority = authority
  context.completion_line = authority.envelope.completion_signal
  context.completion_path = authority.envelope.completion_path
  return true
}

const generated_tasks = (context) => {
	if (!context.generated_queue_authority) return get_tasks(context.tasks_dir, context.file_system)
	let readiness
	try {
		readiness = queue_contract.select_frozen_ready_plans(context.tasks_dir, {
			authority: context.generated_queue_authority,
		})
	} catch (error) {
		throw looper_error(`generated frozen queue authority failed: ${error_message(error)}`)
	}
	context.generated_queue_authority = readiness.authority
	const open = new Map(get_tasks(context.tasks_dir, context.file_system).map(task => [task.name, task]))
	return readiness.ready_plan_names.map(name => open.get(name)).filter(Boolean)
}

const worker_config = context => {
  let config = context.options.worker_config
  if (!config) {
    const config_path = agentflow_settings.active_config_path(context.root, context.completion_path)
    config = agentflow_settings.read_json_config(config_path, { repo_root: context.root, active_host: context.options.active_host || 'standalone', check_executables: false, persist_migration: false })
  }
  return config
}

const policy_for_queue = config => ({
  allowed_worker: config.switches?.['allowed-worker'] || ['external', 'host'],
  review_policy: config.switches?.['review-policy'] || 'require-independent',
  cli_provider: config.switches?.['cli-provider'] || 'off',
})

const configure_child = (context) => {
  // Programmatic test/embedding callers supply a checked argument builder.
  if (typeof context.options.build_args === 'function' || context.child_configured) return
  const config = worker_config(context)
  if (config['pipeline-roles']?.implementation === 'off') throw looper_error('implementation role is off; no queue worker can start')
  const available = context.options.executable_available || (command => {
    if (!path.isAbsolute(command)) return agentflow_settings.executable_available(command)
    try { return fs.statSync(command).isFile() && (fs.statSync(command).mode & 0o111) !== 0 } catch { return false }
  })
  const profiles = (config['external-workers'] || []).map(profile => {
    const command = context.options.executable ? [context.options.executable, ...profile.command.slice(1)] : profile.command
    const executable = path.basename(command[0])
    return { ...profile, command, candidate_id: profile.id, available: available(command[0]) === true,
      recipe_checked: (executable === 'codex' && command.includes('exec')) || (executable === 'claude' && command.includes('-p')) }
  })
  let host = context.options.active_host
  if (!host) { try { host = agentflow_settings.detect_host() } catch { host = 'standalone' } }
  const selection = delegation_route.select_executor_action({
    config, policy: policy_for_queue(config), host: { id: host, family: context.options.host_family || agentflow_settings.family_for_host(host) },
    task: { task_id: 'standalone-queue', role: 'implementation', requested_tier: config['pipeline-roles']?.implementation, interactive_host: false, delegation_worthy: true },
    capabilities: { external: profiles },
  })
  if (selection.status !== 'selected' || selection.kind !== 'external') {
    throw looper_error(`No permitted external executor is available. Resume this pending queue in an interactive host: ${context.tasks_dir}. ${selection.requirement || ''}`, { handoff: true })
  }
  const profile = profiles.find(candidate => candidate.candidate_id === selection.candidate_id)
  context.executable = profile.command[0]
  context.command_args = profile.command.slice(1)
  context.worker_family = agentflow_settings.profile_family(profile) || null
  context.worker_model = selection.usable_model === 'inherited' ? null : selection.usable_model
  context.worker_effort = selection.usable_effort === 'inherited' ? null : selection.usable_effort
  context.child_configured = true
}

const notify = (context, event, data = {}) => {
  if (typeof context.options.on_event !== 'function') return
  try {
    context.options.on_event({ event, ...data })
  } catch {
    // Test observation must never change queue safety.
  }
}

const maybe_crash = (context, phase) => {
  if (context.options.crash_at !== phase) return
  throw looper_error(`injected crash after ${phase}`, { crash: true, exit_code: 90 })
}

const ownership_error = (message) => looper_error(`${message}; human review required`, { ownership_lost: true })

const read_owner_record_at = (context, owner_dir, expected_identity) => {
  const owner_file = path.join(owner_dir, 'owner.json')
  let stat
  try {
    stat = context.file_system.lstatSync(owner_file)
  } catch (error) {
    if (error && error.code === 'ENOENT') throw ownership_error(`queue owner evidence disappeared at ${owner_file}`)
    throw ownership_error(`queue owner evidence could not be inspected at ${owner_file}: ${error_message(error)}`)
  }
  if (stat.isSymbolicLink() || !stat.isFile())
    throw ownership_error(`queue owner evidence is not a regular nonsymlink file at ${owner_file}`)
  if (!same_node_identity(node_identity(stat), expected_identity))
    throw ownership_error(`queue owner evidence was replaced at ${owner_file}`)
  let record
  try {
    record = JSON.parse(context.file_system.readFileSync(owner_file, 'utf8'))
  } catch (error) {
    throw ownership_error(`queue owner evidence is unreadable at ${owner_file}: ${error_message(error)}`)
  }
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.owner_token !== context.owner_token)
    throw ownership_error(`queue owner token no longer matches at ${owner_file}`)
  return record
}

const read_owner_record = (context) =>
  read_owner_record_at(context, context.lock_dir, context.owner_identity)

const verify_ownership = (context) => {
  if (!context.owner_acquired) throw ownership_error('queue ownership is not held')
  try {
    verify_protected_state(context)
  } catch (error) {
    throw ownership_error(error_message(error))
  }
  let lock_stat
  try {
    lock_stat = context.file_system.lstatSync(context.lock_dir)
  } catch (error) {
    throw ownership_error(`queue ownership evidence disappeared at ${context.lock_dir}: ${error_message(error)}`)
  }
  if (lock_stat.isSymbolicLink() || !lock_stat.isDirectory())
    throw ownership_error(`queue ownership path is not a real directory at ${context.lock_dir}`)
  if (!same_node_identity(node_identity(lock_stat), context.lock_identity))
    throw ownership_error(`queue ownership directory was replaced at ${context.lock_dir}`)
  const owner = read_owner_record(context)
  if (owner.canonical_queue !== context.canonical_tasks_dir || owner.protected_state_path !== context.state_dir)
    throw ownership_error(`queue owner record no longer names this queue at ${path.join(context.lock_dir, 'owner.json')}`)
  return true
}

const write_attempt_record = (context, value) => {
  verify_ownership(context)
  const record = { ...value, version: 1, updated_at: now() }
  if (typeof context.options.write_attempt_record === 'function') {
    context.options.write_attempt_record(record)
  } else {
    write_json_atomic(context.file_system, context.attempt_file, record)
  }
  context.current_attempt = record
  notify(context, 'attempt-recorded', { phase: record.phase })
  return record
}

const write_stop_marker = (context, message) => {
  verify_queue_identity(context)
  verify_protected_state(context)
  if (path_is_present(context.file_system, context.stop_file)) return false
  if (typeof context.options.write_stop_marker === 'function') {
    context.options.write_stop_marker(message, context.stop_file)
    return true
  }
  context.file_system.writeFileSync(context.stop_file, `${message}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  return true
}

const combine_error = (primary, secondary = [], options = {}) =>
  looper_error(append_secondary(error_message(primary), secondary), {
    exit_code: options.exit_code || (primary && primary.exit_code) || 1,
    interruption: options.interruption === true,
    reported: options.reported === true,
  })

const fail_plan = (context, primary, extra = {}) => {
  const secondary = []
  const message = error_message(primary)
  const failed_record = {
    ...(context.current_attempt || {}),
    ...extra,
    phase: 'failed',
    error: message,
    diagnostic_tail: extra.diagnostic_tail || (context.current_attempt && context.current_attempt.diagnostic_tail) || '',
  }
  try {
    write_attempt_record(context, failed_record)
  } catch (error) {
    secondary.push(`attempt evidence failed: ${error_message(error)}`)
  }
  try {
    write_stop_marker(context, message)
  } catch (error) {
    secondary.push(`stop marker failed: ${error_message(error)}`)
  }
  return combine_error(message, secondary, { reported: true })
}

const ensure_task_directory = (context) => {
  verify_queue_identity(context)
  context.file_system.readdirSync(context.tasks_dir)
}

const has_stop_marker = (context) => {
  verify_queue_identity(context)
  return path_is_present(context.file_system, context.stop_file)
}

const acquire_lock = (context) => {
  verify_protected_state(context)
  try {
    context.file_system.mkdirSync(context.lock_dir)
  } catch (error) {
    if (error && error.code === 'EEXIST')
      throw looper_error(`queue ownership already exists at ${context.lock_dir}; human review required`)
    throw looper_error(`unable to acquire queue ownership at ${context.lock_dir}: ${error_message(error)}`)
  }
  context.owner_acquired = true
  context.owner_token = crypto.randomBytes(32).toString('hex')
  try {
    write_json_atomic(context.file_system, path.join(context.lock_dir, 'owner.json'), {
      version: 1,
      owner_token: context.owner_token,
      pid: process.pid,
      canonical_queue: context.canonical_tasks_dir,
      protected_state_path: context.state_dir,
      started_at: now(),
    })
    const lock_stat = context.file_system.lstatSync(context.lock_dir)
    if (lock_stat.isSymbolicLink() || !lock_stat.isDirectory())
      throw new Error('queue ownership path is not a real directory')
    const owner_stat = context.file_system.lstatSync(path.join(context.lock_dir, 'owner.json'))
    if (owner_stat.isSymbolicLink() || !owner_stat.isFile())
      throw new Error('queue owner evidence is not a regular nonsymlink file')
    context.lock_identity = node_identity(lock_stat)
    context.owner_identity = node_identity(owner_stat)
    read_owner_record(context)
  } catch (error) {
    throw looper_error(`queue ownership evidence failed: ${error_message(error)}`)
  }
  notify(context, 'ownership-acquired', { lock_dir: context.lock_dir })
  maybe_crash(context, 'ownership-acquired')
}

const path_is_present = (file_system, file) => {
  try {
    file_system.lstatSync(file)
    return true
  } catch (error) {
    if (error && error.code === 'ENOENT') return false
    throw error
  }
}

const move_to_recovery = (context, source, parent, prefix, before_move, before_rename) => {
  for (let attempt = 0; attempt < RECOVERY_NAME_ATTEMPTS; attempt += 1) {
    const destination = path.join(parent, `.${prefix}-${crypto.randomBytes(32).toString('hex')}`)
    if (path_is_present(context.file_system, destination)) continue
    if (typeof before_move === 'function') before_move({ source, destination })
    if (path_is_present(context.file_system, destination)) continue
    if (typeof before_rename === 'function') before_rename({ source, destination })
    if (path_is_present(context.file_system, destination)) continue
    try {
      context.file_system.renameSync(source, destination)
      return destination
    } catch (error) {
      if (error && ['EEXIST', 'ENOTEMPTY'].includes(error.code)) continue
      throw error
    }
  }
  throw looper_error(`could not allocate a unique recovery path below ${parent}`)
}

const release_lock = (context) => {
  verify_ownership(context)
  const lock_identity = context.lock_identity
  const owner_identity = context.owner_identity
  let retired_path
  try {
    retired_path = move_to_recovery(
      context,
      context.lock_dir,
      context.state_dir,
      'looper-retired',
      context.options.before_release_move,
      () => verify_protected_state(context)
    )
  } catch (error) {
    throw ownership_error(`queue ownership release move failed at ${context.lock_dir}: ${error_message(error)}`)
  }

  let retired_stat
  try {
    retired_stat = context.file_system.lstatSync(retired_path)
  } catch (error) {
    throw ownership_error(`retired ownership evidence disappeared at ${retired_path}: ${error_message(error)}`)
  }
  if (retired_stat.isSymbolicLink() || !retired_stat.isDirectory() || !same_node_identity(node_identity(retired_stat), lock_identity))
    throw ownership_error(`retired ownership directory identity does not match at ${retired_path}`)

  try {
    const retired_owner = read_owner_record_at(context, retired_path, owner_identity)
    if (retired_owner.canonical_queue !== context.canonical_tasks_dir || retired_owner.protected_state_path !== context.state_dir)
      throw new Error('retired owner evidence no longer names this queue')
  } catch (error) {
    throw ownership_error(`retired owner evidence could not be verified at ${retired_path}: ${error_message(error)}`)
  }

  context.owner_acquired = false
  notify(context, 'ownership-released', { lock_dir: context.lock_dir, retired_path })
}

const valid_identity_number = (value) => Number.isSafeInteger(value) && value >= 0

const valid_sha256 = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)

const record_identity = (record, prefix = '') => {
  const field = (name) => prefix ? `${prefix}_${name}` : name
  return {
    sha256: record[field('sha256')],
    dev: record[field('dev')],
    ino: record[field('ino')],
    size: record[field('size')],
  }
}

const valid_record_identity = (identity) =>
  valid_sha256(identity.sha256) &&
  valid_identity_number(identity.dev) &&
  valid_identity_number(identity.ino) &&
  valid_identity_number(identity.size) &&
  identity.size <= MAX_PLAN_BYTES

const same_record_identity = (record, prefix, expected) => {
  const actual = record_identity(record, prefix)
  return valid_record_identity(actual) && same_file_identity(actual, expected)
}

const completed_record_is_trustworthy = (context, record) => {
  if (record.version !== 1 || typeof record.task !== 'string' || !PLAN_PATTERN.test(record.task)) return false
  if (record.selected_path !== path.join(context.tasks_dir, record.task)) return false
  const selected_identity = record_identity(record)
  if (!valid_record_identity(selected_identity)) return false
  if (!same_record_identity(record, 'rechecked', selected_identity)) return false
  if (record.execution) {
    const execution = record.execution
    if (delegation_route.validate_execution_record(execution, { controls: record.selection?.requested }) || execution.state !== 'completed') return false
    if (execution.task_id !== record.task || execution.attempt_id !== record.owner_token
        || execution.kind !== record.selection?.kind || execution.candidate_id !== record.selection?.candidate_id
        || JSON.stringify(execution.source_identity) !== JSON.stringify(record.source_identity)
        || execution.outputs.completion_line !== context.completion_line) return false
  } else if (record.exit_code !== 0 || record.signal !== null || record.completion_matches !== 1) return false
  if (record.completion_line !== context.completion_line || record.archived !== true) return false

  let done_dir
  try {
    done_dir = canonical_path(context.file_system, context.done_dir)
  } catch {
    return false
  }
  if (done_dir !== context.done_dir || path.basename(done_dir) !== 'done' || !path_is_within(done_dir, context.tasks_dir)) return false
  const archived_path = path.join(done_dir, record.task)
  if (record.archived_path !== archived_path) return false
  if (path_is_present(context.file_system, record.selected_path)) return false
  if (!same_record_identity(record, 'archived', selected_identity)) return false

  let archived_identity
  try {
    archived_identity = read_file_identity(context.file_system, archived_path)
  } catch {
    return false
  }
  return same_record_identity(record, 'archived', archived_identity)
}

const existing_attempt_blocks = (context) => {
  verify_protected_state(context)
  const record = read_json_if_present(context.file_system, context.attempt_file)
  if (!record) return false
  if (record.phase === 'completed' && completed_record_is_trustworthy(context, record)) return false
  if (record.phase === 'completed')
    throw looper_error(`completed attempt evidence is incomplete or inconsistent at ${context.attempt_file}; human review required`)
  throw looper_error(`incomplete attempt evidence survives at ${context.attempt_file}; human review required`)
}

const process_is_alive = (context, pid) => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (typeof context.options.process_is_alive === 'function') return context.options.process_is_alive(pid) === true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && error.code === 'ESRCH') return false
    return true
  }
}

const reset_control_state = (context) => {
  verify_queue_identity(context)
  verify_protected_state(context)
  const attempt = read_json_if_present(context.file_system, context.attempt_file)
  if (attempt?.selection && attempt.phase !== 'completed') {
    const execution = attempt.execution
    const settled = execution && !delegation_route.validate_execution_record(execution)
      && execution.state !== 'uncertain'
      && (execution.state === 'completed' || execution.transport.stop_verified === true || execution.transport.worker_started === false)
    if (!settled) throw looper_error('reset refused for an unresolved interactive attempt; verify native/host stop through its real interface and finish the saved claim before resetting')
  }
  if (attempt && process_is_alive(context, attempt.child_pid))
    throw looper_error(`reset refused because attempt evidence names live child process ${attempt.child_pid}; human review required`)

  if (path_is_present(context.file_system, context.lock_dir)) {
    const lock_stat = context.file_system.lstatSync(context.lock_dir)
    if (lock_stat.isSymbolicLink() || !lock_stat.isDirectory())
      throw looper_error(`reset refused because ownership evidence is not a real directory at ${context.lock_dir}; human review required`)
    const owner_file = path.join(context.lock_dir, 'owner.json')
    const owner = read_json_if_present(context.file_system, owner_file)
    if (!owner || owner.canonical_queue !== context.canonical_tasks_dir || owner.protected_state_path !== context.state_dir ||
      !Number.isSafeInteger(owner.pid) || owner.pid <= 0)
      throw looper_error(`reset refused because ownership evidence cannot be verified at ${owner_file}; human review required`)
    if (process_is_alive(context, owner.pid))
      throw looper_error(`reset refused because queue owner process ${owner.pid} is still live; human review required`)
  }

  const stop_present = has_stop_marker(context)

  const retired = []
  if (attempt) retired.push(move_to_recovery(
    context, context.attempt_file, context.state_dir, 'looper-reset-attempt', null,
    () => verify_protected_state(context)
  ))
  if (stop_present) {
    retired.push(move_to_recovery(
      context, context.stop_file, context.tasks_dir, 'looper-reset-stop', null,
      () => verify_queue_identity(context)
    ))
  }
  if (path_is_present(context.file_system, context.lock_dir)) retired.push(move_to_recovery(
    context, context.lock_dir, context.state_dir, 'looper-reset-owner', null,
    () => verify_protected_state(context)
  ))
  for (const retired_path of retired) say(context, `Reset retired: ${retired_path}`)
  if (!retired.length) say(context, 'Reset: no stale control records found.')
  return retired
}

const build_prompt = (context, task) => {
  const relative_task = path.relative(context.root, task.path) || task.name
  if (typeof context.options.prompt_builder === 'function')
    return String(context.options.prompt_builder({
      task: task.name,
      plan_path: format_path(task.path),
      relative_task,
      tasks_dir: context.tasks_dir,
      root: context.root,
    }))
  const reservation = context.notebook_ownership
  const ownership_note = reservation ? `\n\nThe controller reserved ${context.completion_path} ${reservation.ask} for host ${reservation.host}, session ${reservation.session}, token ${reservation.token}. Before editing that notebook, read its ownership record at ${notebook_owner.location({ root: context.root, notebook: context.completion_path }).relative} and confirm this exact active owner. Use this retained host/session for any notebook writer call. Leave ownership release to the controller; stop if the owner has changed.` : ''
  const request = `Execute the frozen plan directly: ${relative_task}\n\nYou are the plan worker already launched by agf-looper. Execute the named plan directly and complete the product work yourself. Do not invoke agf-looper or start another plan worker. Do not invoke Agentflow, codex, claude, another model CLI, a subagent, a delegate, or an independent review process. Complete the Agentflow notebook record for this plan. A completed round must contain its exact \`# ← Reply / A-NNN\` heading and must end with the next sequential scaffold in exactly this form, including the bare plus line: \`# → Ask / A-NNN\n\n+\`. Do not treat a summary, final report, commit, or bare completion signal as a completed notebook round without the Reply heading and that full next-Ask scaffold. When the plan and its record are safely complete, your entire final response must be exactly: ${context.completion_line}${ownership_note}`
  if (!context.generated_queue_authority) return request
  return `${request}\n\nThis frozen plan is owned by looper. Execute the plan's product and record work only. Do not move, rename, delete, or archive the plan or any other file under ${context.tasks_dir}; do not create queue control markers. Leave queue transitions to looper after your exact final completion response.`
}

const configured_worker_args = (context, base_args) => {
  if (!context.worker_model || !context.worker_effort) return base_args
  if (context.worker_family === 'codex')
    return [...base_args, '-m', context.worker_model, '-c', `model_reasoning_effort=${context.worker_effort}`]
  if (context.worker_family === 'claude')
    return [...base_args, '--model', context.worker_model, '--effort', context.worker_effort]
  throw looper_error(`configured model and effort cannot be applied to unsupported worker family ${context.worker_family || '<missing>'}`)
}

const build_args = (context, task, prompt) => {
  if (typeof context.options.build_args === 'function') {
    const args = context.options.build_args({
      task: task.name,
      plan_path: format_path(task.path),
      prompt,
      tasks_dir: context.tasks_dir,
      root: context.root,
    })
    if (!Array.isArray(args)) throw looper_error('child argument builder did not return an array')
    return args.map((arg) => String(arg))
  }
  if (context.worker_family === 'codex') {
    const completion_file = path.join(context.state_dir, `.last-message-${task.name}-${crypto.randomBytes(16).toString('hex')}.txt`)
    let completion_descriptor = null
    try {
      const constants = context.file_system.constants || fs.constants
      completion_descriptor = context.file_system.openSync(completion_file,
        constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | (constants.O_NOFOLLOW || 0), 0o600)
      const completion_identity = context.file_system.fstatSync(completion_descriptor)
      const path_identity = context.file_system.lstatSync(completion_file)
      if (!completion_identity.isFile() || completion_identity.isSymbolicLink() || completion_identity.nlink !== 1 ||
        !path_identity.isFile() || path_identity.isSymbolicLink() || path_identity.nlink !== 1 ||
        !same_file_object(stat_identity(completion_identity), stat_identity(path_identity)))
        throw new Error('reservation is not one unique regular file object')
      context.completion_message_file = completion_file
      context.completion_message_descriptor = completion_descriptor
      context.completion_message_identity = completion_identity
      context.file_system.unlinkSync(completion_file)
      const anonymous_identity = context.file_system.fstatSync(completion_descriptor)
      if (anonymous_identity.nlink !== 0 || !same_file_object(stat_identity(completion_identity), stat_identity(anonymous_identity)))
        throw new Error('reservation could not be made anonymous')
      context.completion_message_argument = '/dev/fd/3'
    } catch (error) {
      if (completion_descriptor !== null) {
        try { context.file_system.closeSync(completion_descriptor) } catch {}
      }
      throw looper_error(`Codex final-message evidence could not be reserved: ${error_message(error)}; human review required`)
    }
    const base_args = context.options.executable
      ? ['exec', '--sandbox', 'workspace-write', '--ephemeral']
      : context.command_args
    return [...configured_worker_args(context, base_args), '--output-last-message', context.completion_message_argument, prompt]
  }
  if (context.options.executable) return ['exec', '--sandbox', 'workspace-write', '--ephemeral', prompt]
  return [...configured_worker_args(context, context.command_args), prompt]
}

const read_completion_message = (context) => {
  const file = context.completion_message_file
  if (!file) return null
  const descriptor = context.completion_message_descriptor
  if (descriptor === null) throw looper_error(`Codex final-message evidence descriptor is missing: ${file}`)
  const descriptor_stat = context.file_system.fstatSync(descriptor)
  if (!descriptor_stat.isFile() || descriptor_stat.isSymbolicLink() || descriptor_stat.nlink !== 0)
    throw looper_error(`Codex final-message evidence is not an anonymous regular file: ${file}`)
  if (!context.completion_message_identity ||
    !same_file_object(stat_identity(context.completion_message_identity), stat_identity(descriptor_stat)))
    throw looper_error(`Codex final-message evidence identity changed before validation: ${file}`)
  if (descriptor_stat.size > MAX_LINE_BYTES + 1)
    throw looper_error(`Codex final-message evidence exceeds the ${MAX_LINE_BYTES + 1}-byte limit`)
  let text
  try {
    const content = Buffer.alloc(descriptor_stat.size)
    let bytes_read = 0
    while (bytes_read < content.length) {
      const read = context.file_system.readSync(descriptor, content, bytes_read, content.length - bytes_read, bytes_read)
      if (!Number.isSafeInteger(read) || read <= 0) throw new Error(`short or inconsistent read for ${file}`)
      bytes_read += read
    }
    const final_descriptor_stat = context.file_system.fstatSync(descriptor)
    if (final_descriptor_stat.nlink !== 0 ||
      !same_stat_identity(stat_identity(descriptor_stat), stat_identity(final_descriptor_stat)))
      throw new Error(`filesystem identity, link count, or size changed while reading ${file}`)
    text = new TextDecoder('utf-8', { fatal: true }).decode(content)
  } catch (error) {
    throw looper_error(`Codex final-message evidence is unreadable: ${error_message(error)}`)
  }
  context.file_system.closeSync(descriptor)
  context.completion_message_file = null
  context.completion_message_descriptor = null
  context.completion_message_identity = null
  context.completion_message_argument = null
  return text === context.completion_line || text === `${context.completion_line}\n` ? 1 : 0
}

const send_group_signal = (child, signal) => {
  if (!child || !child.pid) return
  if (process.platform === 'win32') {
    child.kill(signal)
    return
  }
  process.kill(-child.pid, signal)
}

const best_effort_kill = (child, signal = 'SIGKILL') => {
  try {
    send_group_signal(child, signal)
  } catch {
    try {
      if (child && typeof child.kill === 'function') child.kill(signal)
    } catch {
      // The primary failure is retained by the caller.
    }
  }
}

const install_signal_handlers = (context) => {
  const handler = (signal) => {
    if (context.interruption) return
    const interruption = {
      signal,
      exit_code: signal === 'SIGINT' ? 130 : 143,
      at: now(),
      secondary: [],
      force_timer: null,
    }
    context.interruption = interruption
    context.no_later_launch = true
    const interrupted_record = {
      ...(context.current_attempt || {}),
      phase: 'interrupted',
      interruption: { signal, at: interruption.at },
      error: `interrupted by ${signal}`,
      diagnostic_tail: context.current_attempt && context.current_attempt.diagnostic_tail,
    }
    try {
      write_attempt_record(context, interrupted_record)
    } catch (error) {
      interruption.secondary.push(`attempt evidence failed: ${error_message(error)}`)
    }
    try {
      write_stop_marker(context, `interrupted by ${signal}`)
    } catch (error) {
      interruption.secondary.push(`stop marker failed: ${error_message(error)}`)
    }
    interruption.recorded_at = now()
    notify(context, 'interruption-recorded', { signal })
    if (context.active_child) {
      try {
        send_group_signal(context.active_child, signal)
        interruption.forwarded_at = now()
        notify(context, 'signal-forwarded', { signal })
      } catch (error) {
        interruption.secondary.push(`signal forwarding failed: ${error_message(error)}`)
      }
      interruption.force_timer = setTimeout(() => {
        try {
          send_group_signal(context.active_child, 'SIGKILL')
          interruption.forced_at = now()
          notify(context, 'signal-force-forwarded', { signal: 'SIGKILL' })
        } catch (error) {
          interruption.secondary.push(`force termination failed: ${error_message(error)}`)
        }
      }, 500)
      if (typeof interruption.force_timer.unref === 'function') interruption.force_timer.unref()
    }
  }
  process.on('SIGINT', handler)
  process.on('SIGTERM', handler)
  context.listeners.push(['SIGINT', handler], ['SIGTERM', handler])
}

const remove_signal_handlers = (context) => {
  for (const [signal, handler] of context.listeners) process.removeListener(signal, handler)
  context.listeners = []
  if (context.interruption && context.interruption.force_timer) clearTimeout(context.interruption.force_timer)
}

const open_dump_files = context => {
  if (!context.options.dump) return null
  const root = path.join(context.root, 'artifacts', 'looper-output')
  const requested = context.dump_dir || context.options.dump_dir || path.join(root, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`)
  if (!path_is_within(requested, root)) throw looper_error(`worker output directory must stay inside ${root}`)
  context.file_system.mkdirSync(root, { recursive: true })
  const canonical_root = canonical_path(context.file_system, root)
  if (!path_is_within(canonical_root, context.root))
    throw looper_error(`worker output directory must stay inside ${root}`)
  context.file_system.mkdirSync(requested, { recursive: true })
  const directory = canonical_path(context.file_system, requested)
  if (!path_is_within(directory, canonical_root)) throw looper_error(`worker output directory must stay inside ${root}`)
  read_directory_identity(context.file_system, directory, 'worker output directory')
  context.dump_dir = directory
  const stem = context.current_plan.name.replace(/\.md$/u, '')
  const stdout_path = path.join(directory, `${stem}.stdout.log`)
  const stderr_path = path.join(directory, `${stem}.stderr.log`)
  const stdout = context.file_system.openSync(stdout_path, 'wx', 0o600)
  let stderr
  try {
    stderr = context.file_system.openSync(stderr_path, 'wx', 0o600)
  } catch (error) {
    context.file_system.closeSync(stdout)
    throw error
  }
  say(context, `Worker output files: ${stdout_path} and ${stderr_path}`)
  return { stdout, stderr }
}

const write_all_sync = (file_system, descriptor, chunk) => {
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
  let offset = 0
  while (offset < buffer.length) {
    const written = file_system.writeSync(descriptor, buffer, offset, buffer.length - offset)
    if (!Number.isSafeInteger(written) || written <= 0 || written > buffer.length - offset)
      throw looper_error('worker output file made no valid write progress')
    offset += written
  }
}

const capture_child = (context, child, expected_line, opened_dumps = null) => new Promise((resolve, reject) => {
  const capture = make_capture(expected_line)
  let dumps = opened_dumps
  let settled = false
  let close_seen = false
  const started_at = Date.now()
  const nested_worker = {
    visible: false,
    detected: false,
    processes: [],
    containment: { attempted: false, actions: [] },
    poll_count: 0,
    recovery: {
      preserved_output: ['stdout', 'stderr', 'plan_source'],
      evidence_status: 'not_applicable',
      source_changes_preserved: true,
      fresh_review_required: false,
    },
  }
  const interval_ms = context.options.milestone_interval_ms || MILESTONE_INTERVAL_MS
  const set_interval = context.options.set_interval || setInterval
  const clear_interval = context.options.clear_interval || clearInterval
  const milestone_timer = set_interval(() => {
    try {
      const elapsed_seconds = Math.max(0, Math.floor((Date.now() - started_at) / 1000))
      const detail = capture.latest_line || 'waiting for the worker’s first output'
      say(context, `Still running — ${context.current_plan.name} — ${elapsed_seconds}s elapsed — latest: ${detail}`)
    } catch {
      // Progress reporting must never change the worker result.
    }
  }, interval_ms)
  const nested_poll_ms = context.options.nested_poll_ms === undefined ? 50 : context.options.nested_poll_ms
  const observe_nested = () => {
    try {
      const table = typeof context.options.list_processes === 'function' ? context.options.list_processes() : read_process_table()
      const observed = find_nested_processes(child && child.pid, table)
      nested_worker.poll_count += 1
      nested_worker.visible = nested_worker.visible || observed.visible
      if (!nested_worker.detected && observed.processes.length > 0) {
        nested_worker.detected = true
        nested_worker.processes = observed.processes
        nested_worker.containment = contain_nested_processes(observed.processes)
        nested_worker.recovery.evidence_status = 'quarantined'
        nested_worker.recovery.fresh_review_required = true
        context.nested_worker = nested_worker
        notify(context, 'nested-worker-detected', { processes: observed.processes })
      }
    } catch {
      // Process-tree visibility is advisory; an unreadable table is retained as a limit.
    }
  }
  const nested_timer = set_interval(observe_nested, nested_poll_ms > 0 ? nested_poll_ms : 50)
  if (nested_timer && typeof nested_timer.unref === 'function') nested_timer.unref()
  if (milestone_timer && typeof milestone_timer.unref === 'function') milestone_timer.unref()
  const finish = (value) => {
    if (settled) return
    settled = true
    clear_interval(milestone_timer)
    clear_interval(nested_timer)
    context.nested_worker = nested_worker
    capture.finish_stream('stdout')
    capture.finish_stream('stderr')
    if (dumps) {
      context.file_system.closeSync(dumps.stdout)
      context.file_system.closeSync(dumps.stderr)
      dumps = null
    }
    resolve({ ...value, matches: capture.matches, diagnostic_tail: capture.diagnostic_tail, nested_worker })
  }
  const fail = (error) => {
    if (settled) return
    settled = true
    clear_interval(milestone_timer)
    clear_interval(nested_timer)
    if (dumps) {
      try { context.file_system.closeSync(dumps.stdout) } catch {}
      try { context.file_system.closeSync(dumps.stderr) } catch {}
      dumps = null
    }
    reject(error)
  }
  if (!child || !child.stdout || !child.stderr || typeof child.once !== 'function') {
    fail(looper_error('child did not provide capturable stdout and stderr'))
    return
  }
  observe_nested()
  const consume = (stream_name, chunk) => {
    try {
      if (dumps) write_all_sync(context.file_system, dumps[stream_name], chunk)
      capture.consume(stream_name, chunk)
    } catch (error) {
      best_effort_kill(child)
      fail(looper_error(`worker ${stream_name} output could not be saved: ${error_message(error)}`))
    }
  }
  child.stdout.on('data', (chunk) => {
    consume('stdout', chunk)
  })
  child.stderr.on('data', (chunk) => {
    consume('stderr', chunk)
  })
  child.once('error', (error) => fail(looper_error(`child launch failed: ${error_message(error)}`)))
  child.once('close', (code, signal) => {
    close_seen = true
    finish({ exit_code: code == null ? 1 : code, signal })
  })
  child.once('exit', (code, signal) => {
    if (!close_seen && code == null && signal == null) return
  })
})

const start_child = async (context, task, identity, prompt, args) => {
  const spawn_options = {
    cwd: context.root,
    env: context.options.env || process.env,
    detached: true,
    shell: false,
    stdio: context.completion_message_descriptor === null
      ? ['ignore', 'pipe', 'pipe']
      : ['ignore', 'pipe', 'pipe', context.completion_message_descriptor],
    ...(context.options.spawn_options || {}),
    cwd: context.root,
    shell: false,
  }
  spawn_options.env = { ...spawn_options.env, AGENTFLOW_EXTERNAL_DELEGATE: `looper-${context.owner_token}` }
  let child
  let dumps = null
  try {
    verify_queue_identity(context)
    verify_protected_state(context)
    if (context.options.verify_notebook_round !== false)
      with_notebook_lock(context, location => verify_notebook_owner(context, location))
    dumps = open_dump_files(context)
    child = context.spawn(context.executable, args, spawn_options)
  } catch (error) {
    if (dumps) {
      try { context.file_system.closeSync(dumps.stdout) } catch {}
      try { context.file_system.closeSync(dumps.stderr) } catch {}
    }
    throw looper_error(`child launch failed: ${error_message(error)}`)
  }
  context.active_child = child
  context.launched.push(task.name)
  try {
    write_attempt_record(context, {
      ...(context.current_attempt || {}),
      phase: 'child-started',
      selected_path: identity.selected_path,
      sha256: identity.sha256,
      prompt,
      arguments: args,
      child_pid: child && child.pid,
    })
  } catch (error) {
    best_effort_kill(child)
    context.active_child = null
    throw looper_error(`child-start evidence failed: ${error_message(error)}`)
  }
  notify(context, 'child-started', { task: task.name, pid: child && child.pid })
  maybe_crash(context, 'child-started')
  try {
    const result = await capture_child(context, child, context.completion_line, dumps)
    const final_message_matches = read_completion_message(context)
    return final_message_matches === null ? result : { ...result, matches: final_message_matches }
  } finally {
    context.active_child = null
  }
}

const archive_failure = (error, recovery_path) => {
  const recovery_note = recovery_path ? `; recovery evidence at ${recovery_path}` : ''
  const failure = looper_error(`${error_message(error)}${recovery_note}`, {
    exit_code: (error && error.exit_code) || 1,
  })
  if (recovery_path) failure.recovery_path = recovery_path
  return failure
}

const archive_plan = (context, source, destination, expected_identity) => {
  if (typeof context.options.move_plan === 'function') {
    context.options.move_plan({ source, destination, file_system: context.file_system })
    return { destination, recovery_path: null }
  }

  verify_queue_identity(context)
  verify_protected_state(context)
  read_directory_identity(context.file_system, path.dirname(destination), 'archive directory')
  if (path_is_present(context.file_system, destination))
    throw looper_error(`archive destination collision: ${destination}`)
  verify_file_identity(context.file_system, source, expected_identity)

  let recovery_path
  try {
    recovery_path = move_to_recovery(
      context,
      source,
      path.dirname(destination),
      'looper-recovery',
      ({ source: move_source, destination: move_destination }) => {
        if (typeof context.options.before_archive_source_move === 'function') {
          context.options.before_archive_source_move({
            source: move_source,
            recovery_path: move_destination,
            destination,
            expected_identity,
          })
        }
      },
      () => {
        verify_queue_identity(context)
        verify_protected_state(context)
      }
    )
  } catch (error) {
    throw archive_failure(error, recovery_path)
  }

  try {
    verify_file_identity(context.file_system, recovery_path, expected_identity)
    verify_queue_identity(context)
    verify_protected_state(context)
    if (path_is_present(context.file_system, destination))
      throw looper_error(`archive destination collision: ${destination}`)
    context.file_system.linkSync(recovery_path, destination)
    if (typeof context.options.before_destination_cleanup === 'function') {
      context.options.before_destination_cleanup({
        source,
        recovery_path,
        destination,
        expected_identity,
      })
    }
    verify_queue_identity(context)
    verify_protected_state(context)
    verify_file_identity(context.file_system, recovery_path, expected_identity)
    verify_file_identity(context.file_system, destination, expected_identity)
  } catch (error) {
    throw archive_failure(error, recovery_path)
  }

  return { destination, recovery_path }
}

const complete_plan_locked = (context, task, identity, notebook_before, diagnostic_tail, ownership) => {
  verify_notebook_round(context, notebook_before)
  if (has_stop_marker(context))
    throw looper_error(`stop marker exists after child completion: ${context.stop_file}`)
  verify_generated_queue(context)
  verify_file_identity(context.file_system, identity.selected_path, identity)

  write_attempt_record(context, {
    ...(context.current_attempt || {}),
    phase: 'completion-verified',
    diagnostic_tail,
  })
  maybe_crash(context, 'completion-verified')

  const rechecked_identity = verify_file_identity(context.file_system, identity.selected_path, identity)
  write_attempt_record(context, {
    ...(context.current_attempt || {}),
    phase: 'identity-rechecked',
    rechecked_sha256: rechecked_identity.sha256,
    rechecked_dev: rechecked_identity.dev,
    rechecked_ino: rechecked_identity.ino,
    rechecked_size: rechecked_identity.size,
    diagnostic_tail,
  })
  maybe_crash(context, 'identity-rechecked')

  const destination = path.join(context.done_dir, task.name)
  if (has_stop_marker(context))
    throw looper_error(`stop marker exists before archival: ${context.stop_file}`)
  if (path_is_present(context.file_system, destination))
    throw looper_error(`archive destination collision: ${destination}`)
  verify_queue_identity(context)
  verify_file_identity(context.file_system, identity.selected_path, identity)
  const archive_result = archive_plan(context, identity.selected_path, destination, identity)
  if (context.generated_queue_authority) {
    try {
      context.generated_queue_authority = queue_contract.read_frozen_queue(context.tasks_dir)
    } catch (error) {
      throw looper_error(`generated frozen queue authority failed: ${error_message(error)}`)
    }
  }
  verify_generated_queue(context)
  write_attempt_record(context, {
    ...(context.current_attempt || {}),
    phase: 'archive-moved',
    archived_path: destination,
    recovery_path: archive_result.recovery_path,
    diagnostic_tail,
  })
  maybe_crash(context, 'archive-moved')

  const archived_identity = read_file_identity(context.file_system, archive_result.destination)
  const completed_record = {
    ...(context.current_attempt || {}),
    phase: 'completed',
    archived_path: destination,
    recovery_path: archive_result.recovery_path,
    archived: true,
    archived_sha256: archived_identity.sha256,
    archived_dev: archived_identity.dev,
    archived_ino: archived_identity.ino,
    archived_size: archived_identity.size,
  }
  delete completed_record.diagnostic_tail
  write_attempt_record(context, completed_record)
  maybe_crash(context, 'completed-state-written')
  if (ownership) notebook_owner.release(ownership, notebook_writer.read_regular_file(path.join(context.root, context.completion_path), 'notebook').text)
  notify(context, 'plan-completed', { task: task.name, destination })
  const completed_view = queue_view(context)
  say(context, `Completed ${completed_view.lines[0].replace('Progress: ', '')} — ${task.name}.`)
  context.current_plan = null
}

const complete_plan = (context, task, identity, notebook_before, diagnostic_tail = '') => {
  if (context.options.verify_notebook_round === false)
    return complete_plan_locked(context, task, identity, notebook_before, diagnostic_tail)
  return with_notebook_lock(context, location => complete_plan_locked(context, task, identity,
    notebook_before, diagnostic_tail, verify_notebook_owner(context, location, true)))
}

// Interactive hosts keep this claim in their task record while using real host
// tools. The existing durable lock survives helper exit; a lost claim is an
// unresolved owner, never permission to launch a second writer.
const claim_host_plan = (options = {}) => {
  const context = make_context(options)
  context.interactive_notebook = true
  prepare_state(context)
  ensure_task_directory(context)
  initialize_generated_queue(context)
  existing_attempt_blocks(context)
  if (has_stop_marker(context)) throw looper_error(`stop marker exists: ${context.stop_file}`)
  const task = generated_tasks(context)[0]
  if (!task) return { status: 'complete', completed: true }
  const config = worker_config(context)
  if (config['pipeline-roles']?.implementation === 'off') throw looper_error('implementation role is off')
  const supplied = options.selection_facts || {}
  const policy = policy_for_queue(config)
  if (supplied.policy?.allowed_worker) policy.allowed_worker = supplied.policy.allowed_worker.filter(kind => policy.allowed_worker.includes(kind))
  const identity = read_file_identity(context.file_system, task.path)
  const selection = delegation_route.select_executor_action({ ...supplied, config, policy,
    task: { ...supplied.task, task_id: task.name, role: 'implementation', interactive_host: true } })
  if (selection.status === 'selection-required') return selection
  if (selection.status !== 'selected') throw looper_error(`interactive queue execution is unavailable: ${selection.requirement}`)
  const envelope_path = path.join(context.tasks_dir, queue_contract.ENVELOPE_NAME)
  const envelope_identity = context.generated_queue_authority ? read_file_identity(context.file_system, envelope_path) : null
  const repository = require('./repository-state').detect(context.root)
  if (repository.state === 'error') throw looper_error(repository.detail)
  const git_source = node_spawn_sync('git', ['rev-parse', 'HEAD'], { cwd: context.root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (repository.state === 'git' && git_source.status !== 0) throw looper_error('interactive Git queue needs a committed source identity before claiming a plan')
  const host_identity = notebook_owner.identity({ host: options.host || options.active_host, session: options.session })
  acquire_lock(context)
  let notebook_before
  try { notebook_before = reserve_notebook_round(context, host_identity) } catch (error) { release_lock(context); throw error }
  const source_identity = repository.state === 'git' ? { source_kind: 'git', value: git_source.stdout.trim() }
    : { source_kind: 'no-git', value: crypto.createHash('sha256').update(JSON.stringify({ plan: identity.sha256, envelope: envelope_identity?.sha256, notebook: notebook_before })).digest('hex') }
  context.current_plan = task
  context.file_system.mkdirSync(context.done_dir, { recursive: true })
  write_attempt_record(context, {
    phase: 'launch-intent', task: task.name, ...identity, owner_token: context.owner_token, selection, source_identity,
    completion_line: context.completion_line, notebook_before, envelope_identity, notebook_ownership: context.notebook_ownership,
  })
  const claim = {
    version: 1, options: { root: context.root, tasks_dir: context.tasks_dir,
      state_root: path.resolve(context.state_dir, '../../..'), completion_path: context.completion_path, ...host_identity },
    owner_token: context.owner_token, lock_identity: context.lock_identity, owner_identity: context.owner_identity,
    attempt_identity: read_file_identity(context.file_system, context.attempt_file),
    task, identity, source_identity, selection, notebook_ownership: context.notebook_ownership,
  }
  notify(context, 'interactive-plan-claimed', { task: task.name, kind: selection.kind })
  return claim
}

const finish_host_plan = (claim, execution) => {
  if (!claim || claim.version !== 1 || typeof claim.owner_token !== 'string') throw looper_error('valid interactive queue claim is required')
  const context = make_context(claim.options)
  context.interactive_notebook = true
  prepare_state(context)
  context.owner_acquired = true
  context.owner_token = claim.owner_token
  context.lock_identity = claim.lock_identity
  context.owner_identity = claim.owner_identity
  verify_ownership(context)
  verify_file_identity(context.file_system, context.attempt_file, claim.attempt_identity)
  const attempt = read_json_if_present(context.file_system, context.attempt_file)
  context.current_attempt = attempt
  context.notebook_ownership = attempt.notebook_ownership
  context.current_plan = { name: attempt.task, path: attempt.selected_path }
  try {
    const invalid = delegation_route.validate_execution_record(execution, { controls: attempt.selection.requested })
    if (invalid) throw looper_error(invalid)
    if (execution.task_id !== attempt.task || execution.attempt_id !== claim.owner_token || execution.kind !== attempt.selection.kind || execution.candidate_id !== attempt.selection.candidate_id
        || JSON.stringify(execution.source_identity) !== JSON.stringify(attempt.source_identity)) throw looper_error('execution evidence does not match the claimed plan, source and executor')
    write_attempt_record(context, { ...attempt, phase: 'child-exited', execution })
    if (execution.state !== 'completed') throw looper_error(`interactive task ${execution.state}; preserve its pending plan and resolve ownership before retrying`)
    if (execution.outputs.completion_line !== context.completion_line) throw looper_error('interactive completion evidence does not match the configured notebook')
    if (attempt.envelope_identity) verify_file_identity(context.file_system, attempt.envelope_identity.selected_path, attempt.envelope_identity)
    initialize_generated_queue(context)
    complete_plan(context, context.current_plan, attempt, attempt.notebook_before)
    release_lock(context)
    return { completed: true, task: attempt.task, kind: execution.kind, archived_path: path.join(context.done_dir, attempt.task) }
  } catch (error) {
    throw fail_plan(context, error)
  }
}

const run_plan = async (context, task) => {
  context.current_plan = task
  const start_view = queue_view(context, task.name)
  say(context, `Starting ${start_view.lines[0].replace('Progress: ', '')} — ${task.name}`)
  let identity
  let prompt
  let args
  let notebook_before
  context.notebook_ownership = null
  try { notebook_before = reserve_notebook_round(context) } catch (error) {
    context.current_plan = null
    release_lock(context)
    throw error
  }
  try {
    identity = read_file_identity(context.file_system, task.path)
    write_attempt_record(context, {
      phase: 'identity-recorded',
      task: task.name,
      ...identity,
      completion_line: context.completion_line,
      notebook_before,
      notebook_ownership: context.notebook_ownership,
    })
    maybe_crash(context, 'identity-recorded')

    verify_queue_identity(context)
    prompt = build_prompt(context, task)
    args = build_args(context, task, prompt)
    say(context, context.worker_model && context.worker_effort
      ? `Worker: ${context.worker_model}/${context.worker_effort}`
      : 'Worker: model/effort use CLI defaults')
    write_attempt_record(context, {
      ...(context.current_attempt || {}),
      phase: 'launch-intent',
      task: task.name,
      ...identity,
      executable: context.executable,
      prompt,
      arguments: args,
    })
    maybe_crash(context, 'launch-intent-recorded')

    const child_result = await start_child(context, task, identity, prompt, args)
    if (context.interruption) {
      const secondary = context.interruption.secondary
      throw looper_error(append_secondary(`interrupted by ${context.interruption.signal}`, secondary), {
        exit_code: context.interruption.exit_code,
        interruption: true,
      })
    }
    const diagnostic_tail = bounded_text(child_result.diagnostic_tail)
    write_attempt_record(context, {
      ...(context.current_attempt || {}),
      phase: 'child-exited',
      exit_code: child_result.exit_code,
      signal: child_result.signal,
      completion_matches: child_result.matches,
      diagnostic_tail,
      nested_worker: child_result.nested_worker,
    })
    show_worker_output(context, diagnostic_tail)
    maybe_crash(context, 'child-exited')

    if (child_result.nested_worker?.detected) {
      throw looper_error('nested worker violation: the controlled worker launched another model or Agentflow process; authorized source changes remain preserved, nested-derived evidence is quarantined, and a fresh coordinator-controlled review is required', {
        nested_worker: child_result.nested_worker,
      })
    }

    if (child_result.exit_code !== 0)
      throw looper_error(`child exited with code ${child_result.exit_code}`)
    if (child_result.matches !== 1)
      throw looper_error(`completion evidence was not exactly one line matching ${context.completion_line}; found ${child_result.matches}`)
    complete_plan(context, task, identity, notebook_before, diagnostic_tail)
  } catch (error) {
    if (error && (error.crash || error.interruption)) throw error
    if (error && error.reported) throw error
    throw fail_plan(context, error, {
      task: task.name,
      ...(identity || {}),
      ...(error && error.nested_worker ? { nested_worker: error.nested_worker } : {}),
      ...(error && error.recovery_path ? { recovery_path: error.recovery_path } : {}),
    })
  }
}

const success_result = (context, message) => ({
  code: 0,
  message,
  launched: [...context.launched],
})

const failure_result = (context, error) => ({
  code: error && error.exit_code ? error.exit_code : 1,
  message: recovery_message(context, error_message(error)),
  launched: [...context.launched],
})

const run_looper = async (options = {}) => {
  const context = make_context(options)
  let result
  let clean_completion = false
  try {
    prepare_state(context)
    ensure_task_directory(context)
    initialize_generated_queue(context)
    say(context, 'Agentflow looper')
    say(context, `Working directory: ${context.root}`)
    say(context, `Plan directory: ${context.tasks_dir}`)
    say(context, `Completion reply: ${context.completion_line}`)
    if (context.options.reset) {
      reset_control_state(context)
      clean_completion = true
      result = success_result(context, 'Reset complete. No plans were started.')
      return result
    }
    show_queue(context)
    existing_attempt_blocks(context)
    if (has_stop_marker(context))
      throw looper_error(`stop marker exists: ${context.stop_file}`)
    if (generated_tasks(context).length) configure_child(context)
    acquire_lock(context)
    verify_queue_identity(context)
    context.file_system.mkdirSync(context.done_dir, { recursive: true })
    install_signal_handlers(context)

    while (true) {
      if (context.no_later_launch) throw looper_error('interruption prevents later launch')
      if (has_stop_marker(context))
        throw looper_error(`stop marker exists: ${context.stop_file}`)
      verify_queue_identity(context)
      const tasks = generated_tasks(context)
      if (!tasks.length) {
        clean_completion = true
        result = success_result(context, 'All plans are complete.')
        break
      }
      configure_child(context)
      await run_plan(context, tasks[0])
    }
  } catch (error) {
    if (context.current_plan) show_queue(context, null, context.current_plan.name)
    result = error.handoff ? { code: 2, handoff: true, message: error.message, launched: [], pending: generated_tasks(context).map(task => task.name) } : failure_result(context, error)
  } finally {
    remove_signal_handlers(context)
    if (context.completion_message_descriptor !== null) {
      try { context.file_system.closeSync(context.completion_message_descriptor) } catch {}
      context.completion_message_descriptor = null
    }
  }

  if (clean_completion && context.owner_acquired) {
    try {
      release_lock(context)
    } catch (error) {
      result = failure_result(context, looper_error(`queue ownership release failed: ${error_message(error)}`))
    }
  }
  return result || failure_result(context, looper_error('looper stopped without a result'))
}

const parse_cli = (argv) => {
  const values = {}
  const positional = []
  const value_options = new Set(['--tasks-dir', '--completion-path', '--executable'])
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--help' || argument === '-h') {
      values.help = true
    } else if (argument === '--show-output') {
      values.show_output = true
    } else if (argument === '--dump') {
      values.dump = true
    } else if (argument === '--reset') {
      values.reset = true
    } else if (value_options.has(argument)) {
      if (argv[index + 1] === undefined || argv[index + 1].startsWith('-'))
        throw looper_error(`${argument} requires a value`)
      values[argument.slice(2).replaceAll('-', '_')] = argv[index + 1]
      index += 1
    } else if (argument.startsWith('-')) {
      throw looper_error(`unknown option: ${argument}`)
    } else {
      positional.push(argument)
    }
  }
  if (positional.length > 1) throw looper_error('provide at most one task directory')
  const parsed = {
    tasks_dir: values.tasks_dir || positional[0] || workspace_defaults(process.cwd()).tasks_dir,
    completion_path: values.completion_path || workspace_defaults(process.cwd()).completion_path,
    ...(values.show_output ? { show_output: true } : {}),
    ...(values.dump ? { dump: true } : {}),
    ...(values.reset ? { reset: true } : {}),
    ...(values.executable ? { executable: values.executable } : {}),
  }
  if (values.help) parsed.help = true
  Object.defineProperty(parsed, 'completion_path_explicit', {
    value: values.completion_path !== undefined,
    enumerable: false,
  })
  return parsed
}

const main = async (argv = process.argv.slice(2)) => {
  const parsed = parse_cli(argv)
  if (parsed.help) {
    const width = process.stdout.columns || Number(process.env.AGENTFLOW_TEST_COLUMNS) || 80
    const help = render_help(width)
    console.log(help)
    return { code: 0, message: help, launched: [] }
  }
  const result = await run_looper(parsed)
  if (result.code === 0) console.log(result.message)
  else console.error(`HALT: ${result.message}`)
  process.exitCode = result.code
  return result
}

module.exports = {
  ATTEMPT_NAME,
  LOCK_NAME,
  MAX_DIAGNOSTIC_BYTES,
  MAX_PLAN_BYTES,
  STOP_NAME,
  HELP,
  get_tasks,
  make_capture,
  main,
  notebook_round_state,
  parse_cli,
  queue_view,
  render_help,
  run_looper,
  claim_host_plan,
  finish_host_plan,
  workspace_defaults,
  write_all_sync,
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`HALT: ${error_message(error)}`)
    process.exitCode = 1
  })
}
