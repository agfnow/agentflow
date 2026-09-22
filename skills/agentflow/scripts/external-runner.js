'use strict'

const node_child_process = require('node:child_process')
const node_crypto = require('node:crypto')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const { contain_nested_processes, find_nested_processes, read_process_table, send_tree_signal } = require('./process-tree.js')

const MAX_OUTPUT_BYTES = 4096
const DEFAULT_TIMEOUT_MS = 0
const DEFAULT_TERMINATION_GRACE_MS = 200
const DEFAULT_ACTIVITY_SAMPLE_MS = 50
const DEFAULT_NESTED_POLL_MS = 250

const is_object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const nonempty_text = value => typeof value === 'string' && value.trim().length > 0
const is_positive_integer = value => Number.isInteger(value) && value > 0
const is_nonnegative_safe_integer = value => Number.isSafeInteger(value) && value >= 0
const sha256 = value => node_crypto.createHash('sha256').update(value).digest('hex')

const path_is_inside = (target, root) => {
  const resolved_target = node_path.resolve(target)
  const resolved_root = node_path.resolve(root)
  return resolved_target === resolved_root || resolved_target.startsWith(resolved_root + node_path.sep)
}

const git = (root, args) => node_child_process.execFileSync('git', ['-C', root, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()

const git_or_empty = (root, args) => {
  try {
    return git(root, args)
  } catch {
    return ''
  }
}

const list_remotes = root => git_or_empty(root, ['remote']).split(/\r?\n/).filter(Boolean)

const remove_remotes = root => {
  for (const remote of list_remotes(root)) git(root, ['remote', 'remove', remote])
  return list_remotes(root)
}

const resolve_existing_path = value => {
  const resolved = node_path.resolve(value)
  try {
    return node_fs.realpathSync(resolved)
  } catch {
    return resolved
  }
}

const resolve_git_path = (root, value) => resolve_existing_path(node_path.isAbsolute(value) ? value : node_path.join(root, value))

const inspect_git_clone = (root, source_directory) => {
  const absolute_root = resolve_existing_path(root)
  const git_directory = resolve_existing_path(git(absolute_root, ['rev-parse', '--absolute-git-dir']))
  const common_directory = resolve_git_path(absolute_root, git(absolute_root, ['rev-parse', '--git-common-dir']))
  const alternates_path = node_path.join(git_directory, 'objects', 'info', 'alternates')
  const source_git_directory = source_directory
    ? resolve_git_path(resolve_existing_path(source_directory), git(resolve_existing_path(source_directory), ['rev-parse', '--absolute-git-dir']))
    : ''
  const remotes = list_remotes(absolute_root)
  const independent = path_is_inside(git_directory, absolute_root) &&
    path_is_inside(common_directory, absolute_root) &&
    !node_fs.existsSync(alternates_path) &&
    (!source_git_directory || git_directory !== source_git_directory)

  return {
    root: absolute_root,
    git_directory,
    common_directory,
    remotes,
    independent,
  }
}

const clone_source = options => options.source_directory || options.source || options.repository
const clone_target = options => options.clone_directory || options.disposable_root || options.working_directory

const prepare_clone = options => {
  const source_directory = clone_source(options)
  const requested_target = clone_target(options)
  const source_root = source_directory ? resolve_existing_path(source_directory) : ''
  let clone_root = requested_target ? node_path.resolve(requested_target) : ''
  let cleanup_root = null
  let created = false

  if (!source_root && !clone_root) throw new Error('source_directory or clone_directory is required')
  if (source_root && !node_fs.statSync(source_root).isDirectory()) throw new Error('source_directory must be a directory')

  if (source_root && !clone_root) {
    cleanup_root = node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), 'agentflow-external-runner-'))
    clone_root = node_path.join(cleanup_root, 'clone')
  }

  if (source_root && path_is_inside(clone_root, source_root)) throw new Error('clone_directory must be separate from source_directory')
  if (source_root && path_is_inside(source_root, clone_root)) throw new Error('source_directory must be separate from clone_directory')

  const exists = node_fs.existsSync(clone_root)
  if (!exists) {
    node_fs.mkdirSync(node_path.dirname(clone_root), { recursive: true })
    if (!source_root) throw new Error('clone_directory does not exist and no source_directory was supplied')
    node_child_process.execFileSync('git', ['clone', '--no-local', source_root, clone_root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    created = true
  } else if (source_root) {
    const entries = node_fs.readdirSync(clone_root)
    if (entries.length === 0) {
      node_child_process.execFileSync('git', ['clone', '--no-local', source_root, clone_root], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      created = true
    }
  }

  const inspection_before_remote_removal = inspect_git_clone(clone_root, source_root)
  if (!inspection_before_remote_removal.independent) throw new Error('clone is not independent from the source repository')
  const remotes = remove_remotes(clone_root)
  if (remotes.length > 0) throw new Error('clone must have no remotes')
  const inspection = inspect_git_clone(clone_root, source_root)
  if (!inspection.independent) throw new Error('clone is not independent from the source repository')

  return {
    root: inspection.root,
    cleanup_root,
    created,
    independent: inspection.independent,
    remotes: inspection.remotes,
    git_directory: inspection.git_directory,
  }
}

const normalize_command = (command, extra_args) => {
  let executable
  let args
  if (Array.isArray(command)) {
    executable = command[0]
    args = command.slice(1)
  } else if (typeof command === 'string') {
    executable = command
    args = []
  } else if (is_object(command)) {
    executable = command.command || command.executable
    args = command.args === undefined ? [] : command.args
  } else {
    return null
  }

  const combined_args = extra_args === undefined ? args : [...args, ...extra_args]
  if (!nonempty_text(executable) || !Array.isArray(combined_args) || !combined_args.every(value => typeof value === 'string')) return null
  return { executable, args: [...combined_args] }
}

const read_hash = file_path => {
  const hash = node_crypto.createHash('sha256')
  const descriptor = node_fs.openSync(file_path, node_fs.constants.O_RDONLY)
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let bytes_read
    do {
      bytes_read = node_fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytes_read > 0) hash.update(buffer.subarray(0, bytes_read))
    } while (bytes_read > 0)
    return hash.digest('hex')
  } finally {
    node_fs.closeSync(descriptor)
  }
}

const untracked_identities = (root, paths) => paths.map(relative_path => {
  const absolute_path = node_path.resolve(root, relative_path)
  if (!path_is_inside(absolute_path, root)) return { path: relative_path, identity: 'outside-root' }
  try {
    const stat = node_fs.lstatSync(absolute_path)
    if (stat.isFile()) return { path: relative_path, identity: `file:${stat.size}:${read_hash(absolute_path)}` }
    if (stat.isSymbolicLink()) return { path: relative_path, identity: `link:${node_fs.readlinkSync(absolute_path)}` }
    return { path: relative_path, identity: `mode:${stat.mode}` }
  } catch {
    return { path: relative_path, identity: 'unavailable' }
  }
})

const clone_snapshot = root => {
  const status = git_or_empty(root, ['status', '--porcelain=v1', '--untracked-files=all'])
  const raw_diff = git_or_empty(root, ['diff', '--binary', 'HEAD'])
  const staged_diff = git_or_empty(root, ['diff', '--cached', '--binary'])
  const untracked_listing = git_or_empty(root, ['ls-files', '--others', '--exclude-standard', '-z'])
  const untracked_paths = untracked_listing.split('\0').filter(Boolean)
  const untracked = untracked_identities(root, untracked_paths)
  const head = git_or_empty(root, ['rev-parse', 'HEAD'])
  const identity = sha256(JSON.stringify({ head, status, raw_diff, staged_diff, untracked }))
  return { identity, head, status, untracked }
}

const make_capture = max_bytes => {
  const chunks = []
  const hash = node_crypto.createHash('sha256')
  let byte_length = 0
  let retained_bytes = 0

  const add = chunk => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    hash.update(bytes)
    byte_length += bytes.length
    if (retained_bytes >= max_bytes) return
    const retained = bytes.subarray(0, max_bytes - retained_bytes)
    chunks.push(retained)
    retained_bytes += retained.length
  }

  const finish = () => {
    const excerpt = Buffer.concat(chunks).toString('utf8')
    return {
      excerpt,
      byte_length,
      sha256: hash.digest('hex'),
      truncated: byte_length > max_bytes,
    }
  }

  return { add, finish, byte_length: () => byte_length }
}

const process_group_is_alive = pid => {
  if (!pid) return false
  try {
    process.kill(process.platform === 'win32' ? pid : -pid, 0)
    return true
  } catch (error) {
    return error && error.code === 'EPERM'
  }
}

// Signalling only child.pid on Windows leaves the worker's descendants alive,
// so a cancelled or timed-out run keeps burning a paid CLI session. Delegate to
// the tree kill, which is a process-group signal everywhere else.
const send_process_signal = (child, signal) => {
  try {
    send_tree_signal(child, signal)
    return { signal, sent: true, error: null }
  } catch (error) {
    return { signal, sent: false, error: error.code || error.message }
  }
}

const wait_ms = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

const terminate_process_group = async (child, grace_ms, trigger) => {
  const signals = []
  if (!child || !child.pid) return { trigger, attempted: false, signals, terminated: false, group_after: 'unknown', proof: 'not_proven' }
  signals.push(send_process_signal(child, 'SIGTERM'))
  await wait_ms(grace_ms)
  if (process_group_is_alive(child.pid)) signals.push(send_process_signal(child, 'SIGKILL'))
  await wait_ms(Math.min(grace_ms, 50))
  const alive = process_group_is_alive(child.pid)
  return {
    trigger,
    attempted: true,
    signals,
    terminated: !alive,
    group_after: alive ? 'alive' : 'not_alive',
    proof: 'not_proven',
  }
}

const activity_file_identity = file_path => {
  if (!file_path) return 'not_declared'
  try {
    const stat = node_fs.statSync(file_path)
    return stat.isFile() ? `file:${stat.size}:${stat.mtimeMs}` : 'not_regular'
  } catch (error) {
    return error && error.code === 'ENOENT' ? 'missing' : 'unreadable'
  }
}

const host_markers = Object.freeze({
  codex: ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_CLI'],
  claude: ['CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CLI'],
})

const worker_environment = (command, requested_env) => {
  const environment = { ...(requested_env || process.env) }
  const executable = node_path.basename(command.executable)
  const opposite = executable === 'claude' ? 'codex' : executable === 'codex' ? 'claude' : null
  if (opposite !== null) for (const marker of host_markers[opposite]) delete environment[marker]
  return environment
}

const run_child = ({ command, cwd, timeout_ms, stall_timeout_ms, nested_poll_ms, list_processes, termination_grace_ms, max_output_bytes, env, result_file_path }) => new Promise(resolve => {
  const stdout_capture = make_capture(max_output_bytes)
  const stderr_capture = make_capture(max_output_bytes)
  let child
  try {
    child = node_child_process.spawn(command.executable, command.args, {
      cwd,
      env: worker_environment(command, env),
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    resolve({
      launch_error: error,
      close: { exit_code: null, signal: null },
      stdout: stdout_capture.finish(),
      stderr: stderr_capture.finish(),
      timed_out: false,
      stalled: false,
      activity: { state: stall_timeout_ms > 0 ? 'not_observed' : 'disabled', stall_timeout_ms, sample_count: 0, elapsed_ms: 0, last_change_elapsed_ms: null, last_change_signs: [] },
      process_group_timeout: { trigger: 'none', attempted: false, signals: [], terminated: false, group_after: 'unknown', proof: 'not_needed' },
      nested_worker: { visible: false, detected: false, processes: [], containment: { attempted: false, actions: [] }, poll_count: 0 },
    })
    return
  }

  child.stdout.on('data', stdout_capture.add)
  child.stderr.on('data', stderr_capture.add)

  let close_result = null
  let launch_error = null
  let timed_out = false
  let stalled = false
  let timeout_cleanup = null
  let finished = false
  let timeout_handle
  let nested_handle
  const started_at = Date.now()
  let sample_count = 0
  let last_sample = null
  let last_change_at = started_at
  let last_change_signs = []
  const nested_worker = { visible: false, detected: false, processes: [], containment: { attempted: false, actions: [] }, poll_count: 0 }

  const observe_nested = () => {
    const table = typeof list_processes === 'function' ? list_processes() : read_process_table()
    const observed = find_nested_processes(child.pid, table)
    nested_worker.poll_count += 1
    nested_worker.visible = nested_worker.visible || observed.visible
    if (!nested_worker.detected && observed.processes.length > 0) {
      nested_worker.detected = true
      nested_worker.processes = observed.processes
      nested_worker.containment = contain_nested_processes(observed.processes)
    }
  }

  const observe = () => {
    const sample = {
      main_process: child.exitCode === null && child.signalCode === null ? 'running' : 'exited',
      process_group: process_group_is_alive(child.pid) ? 'alive' : 'not_alive',
      stdout: stdout_capture.byte_length(),
      stderr: stderr_capture.byte_length(),
      result_file: activity_file_identity(result_file_path),
      clone: clone_snapshot(cwd).identity,
    }
    sample_count += 1
    const changed = last_sample === null
      ? ['main_process', 'process_group', 'stdout', 'stderr', ...(result_file_path ? ['result_file'] : []), 'clone']
      : Object.keys(sample).filter(key => sample[key] !== last_sample[key])
    if (changed.length > 0) {
      last_change_at = Date.now()
      last_change_signs = changed
    }
    last_sample = sample
    return sample
  }

  observe()
  observe_nested()

  const finish = () => {
    if (finished || !close_result || ((timed_out || stalled) && timeout_cleanup === null)) return
    finished = true
    clearTimeout(timeout_handle)
    clearInterval(nested_handle)
    observe_nested()
    observe()
    const elapsed_ms = Date.now() - started_at
    resolve({
      launch_error,
      close: close_result,
      stdout: stdout_capture.finish(),
      stderr: stderr_capture.finish(),
      timed_out,
      stalled,
      activity: {
        state: 'disabled',
        stall_timeout_ms,
        sample_count,
        elapsed_ms,
        last_change_elapsed_ms: last_change_at - started_at,
        last_change_signs,
        ...(last_sample || {}),
      },
      process_group_timeout: timeout_cleanup || { trigger: 'none', attempted: false, signals: [], terminated: false, group_after: 'not_alive', proof: 'not_needed' },
      nested_worker,
    })
  }

  child.once('error', error => {
    launch_error = error
    if (!close_result) close_result = { exit_code: null, signal: null }
    if (!timed_out) finish()
  })
  child.once('close', (exit_code, signal) => {
    close_result = { exit_code, signal }
    finish()
  })
  if (timeout_ms > 0) timeout_handle = setTimeout(async () => {
    if (finished || close_result) return
    timed_out = true
    timeout_cleanup = await terminate_process_group(child, termination_grace_ms, 'deadline')
    finish()
  }, timeout_ms)

  nested_handle = setInterval(() => {
    if (finished || close_result) return
    observe_nested()
  }, nested_poll_ms > 0 ? nested_poll_ms : DEFAULT_NESTED_POLL_MS)
})

const path_has_symlink_component = (file_path, root) => {
  const relative = node_path.relative(root, file_path)
  let current = root
  for (const component of relative.split(node_path.sep).filter(Boolean)) {
    current = node_path.join(current, component)
    if (node_fs.lstatSync(current).isSymbolicLink()) return true
  }
  return false
}

const read_bounded_file = (file_path, clone_root, max_bytes, result_format) => {
  if (!node_fs.existsSync(file_path)) return {
    path: file_path,
    exists: false,
    value: null,
    content: null,
    parse_error: null,
    byte_length: 0,
    sha256: null,
    truncated: false,
    error: 'declared result file was not created',
  }
  let descriptor
  try {
    if (path_has_symlink_component(file_path, clone_root)) throw new Error('declared result path contains a symbolic link')
    if (!path_is_inside(node_fs.realpathSync(file_path), node_fs.realpathSync(clone_root))) throw new Error('declared result path resolves outside the clone')
    const listed = node_fs.lstatSync(file_path)
    if (!listed.isFile()) return {
      path: file_path,
      exists: false,
      value: null,
      content: null,
      parse_error: null,
      byte_length: 0,
      sha256: null,
      truncated: false,
      error: 'declared result path is not a regular file',
    }
    descriptor = node_fs.openSync(file_path, node_fs.constants.O_RDONLY | (node_fs.constants.O_NOFOLLOW || 0))
    const opened = node_fs.fstatSync(descriptor)
    if (!opened.isFile() || opened.dev !== listed.dev || opened.ino !== listed.ino) return {
      path: file_path,
      exists: false,
      value: null,
      content: null,
      parse_error: null,
      byte_length: 0,
      sha256: null,
      truncated: false,
      error: 'declared result path changed while it was opened',
    }
    const capture = make_capture(max_bytes)
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let bytes_read
    do {
      bytes_read = node_fs.readSync(descriptor, buffer, 0, buffer.length, null)
      if (bytes_read > 0) capture.add(buffer.subarray(0, bytes_read))
    } while (bytes_read > 0)
    const identity = capture.finish()
    const parsed = parse_result(identity.excerpt, result_format)
    return {
      path: file_path,
      exists: true,
      value: parsed.value,
      content: identity.excerpt,
      parse_error: parsed.parse_error,
      byte_length: identity.byte_length,
      sha256: identity.sha256,
      truncated: identity.truncated,
      error: null,
    }
  } catch (error) {
    return {
      path: file_path,
      exists: false,
      value: null,
      content: null,
      parse_error: null,
      byte_length: 0,
      sha256: null,
      truncated: false,
      error: error.code === 'ENOENT' ? 'declared result file was not created' : 'declared result path could not be read safely',
    }
  } finally {
    if (descriptor !== undefined) node_fs.closeSync(descriptor)
  }
}

const parse_result = (text, result_format) => {
  if (result_format !== 'json') return { value: text, parse_error: null }
  try {
    return { value: JSON.parse(text), parse_error: null }
  } catch (error) {
    return { value: null, parse_error: error.message }
  }
}

const normalize_result_file = (result_file, clone_root) => {
  if (result_file === undefined || result_file === null) return null
  const declared_path = typeof result_file === 'string' ? result_file : result_file.path
  if (!nonempty_text(declared_path)) throw new Error('result_file must name a path')
  const absolute_path = node_path.resolve(clone_root, declared_path)
  if (!path_is_inside(absolute_path, clone_root) || absolute_path === clone_root) throw new Error('result_file must stay inside the clone')
  return absolute_path
}

const declared_result_output_collision = (command, clone_root, result_file_path) => {
  if (!result_file_path || node_path.basename(command.executable) !== 'codex') return null
  for (let index = 0; index < command.args.length - 1; index += 1) {
    const option = command.args[index]
    if (option !== '-o' && option !== '--output-last-message') continue
    const output_path = node_path.resolve(clone_root, command.args[index + 1])
    if (output_path === result_file_path) return { option, output_path }
  }
  return null
}

const make_result = async (options, clone, command, before_snapshot, child_result, result_file_path) => {
  const stdout = child_result.stdout
  const stderr = child_result.stderr
  const result_format = options.result_format || 'text'
  const declared_result_file = result_file_path
    ? await read_bounded_file(result_file_path, clone.root, options.max_output_bytes, result_format)
    : null
  const parsed_stdout = parse_result(stdout.excerpt, result_format)
  const result_value = declared_result_file ? declared_result_file.value : parsed_stdout.value
  const result_parse_error = declared_result_file ? declared_result_file.parse_error : parsed_stdout.parse_error
  const after_snapshot = clone_snapshot(clone.root)
  const status = child_result.nested_worker.detected
    ? 'nested_worker_violation'
    : child_result.timed_out
      ? 'timed_out'
    : child_result.stalled
      ? 'stalled'
    : child_result.launch_error
      ? 'spawn_error'
      : child_result.close.exit_code === 0
        ? 'completed'
        : 'failed'

  return {
    status,
    command: { executable: command.executable, args: command.args },
    working_directory: clone.root,
    stdin_closed: true,
    timed_out: child_result.timed_out,
    stalled: child_result.stalled,
    exit_code: child_result.close.exit_code,
    signal: child_result.close.signal,
    process: {
      exit_code: child_result.close.exit_code,
      signal: child_result.close.signal,
      error: child_result.launch_error ? child_result.launch_error.message : null,
    },
    stdout: stdout.excerpt,
    stderr: stderr.excerpt,
    stdout_identity: stdout,
    stderr_identity: stderr,
    stdout_bytes: stdout.byte_length,
    stderr_bytes: stderr.byte_length,
    stdout_truncated: stdout.truncated,
    stderr_truncated: stderr.truncated,
    result: {
      format: result_file_path ? 'file' : result_format,
      value: result_value,
      parse_error: result_parse_error,
    },
    declared_result_file,
    result_file: declared_result_file,
    clone: {
      root: clone.root,
      created: clone.created,
      independent: clone.independent,
      remotes: clone.remotes,
      git_directory: clone.git_directory,
      changed: before_snapshot.identity !== after_snapshot.identity,
      diff_identity: {
        before: before_snapshot.identity,
        after: after_snapshot.identity,
      },
    },
    clone_diff_identity: {
      before: before_snapshot.identity,
      after: after_snapshot.identity,
      changed: before_snapshot.identity !== after_snapshot.identity,
    },
    process_group_timeout: child_result.process_group_timeout,
    nested_worker: {
      ...child_result.nested_worker,
      recovery: {
        preserved_output: ['stdout', 'stderr', 'clone_diff_identity'],
        evidence_status: child_result.nested_worker.detected ? 'quarantined' : 'not_applicable',
        source_changes_preserved: true,
        fresh_review_required: child_result.nested_worker.detected,
      },
    },
    activity: child_result.activity,
    shutdown: child_result.process_group_timeout,
    acceptance: {
      accepted: false,
      reason: child_result.nested_worker.detected
        ? 'Nested worker launch was detected and contained; parent output and source changes are preserved, but nested-derived evidence is quarantined pending fresh coordinator-controlled review.'
        : 'Process exit and captured output do not prove coordinator acceptance.',
    },
    assurance: {
      os_level_confinement: 'not_proven',
      remote_provider_cancellation: 'not_proven',
    },
    limitations: [
      'The disposable clone does not prove OS-level confinement.',
      'Local process termination does not prove remote-provider cancellation.',
      'Process-tree visibility is limited to descendants exposed by the local process table.',
    ],
  }
}

const run_external_command = async options => {
  const values = is_object(options) ? options : {}
  const command = normalize_command(values.command || values.executable, values.args)
  if (command === null) throw new Error('command must contain a literal executable and string arguments')
  const timeout_ms = values.timeout_ms === undefined ? DEFAULT_TIMEOUT_MS : values.timeout_ms
  const termination_grace_ms = values.termination_grace_ms === undefined ? DEFAULT_TERMINATION_GRACE_MS : values.termination_grace_ms
  const stall_timeout_ms = values.stall_timeout_ms === undefined ? 0 : values.stall_timeout_ms
  const max_output_bytes = values.max_output_bytes === undefined ? MAX_OUTPUT_BYTES : values.max_output_bytes
  const nested_poll_ms = values.nested_poll_ms === undefined ? DEFAULT_NESTED_POLL_MS : values.nested_poll_ms
  if (!is_nonnegative_safe_integer(timeout_ms)) throw new Error('timeout_ms must be a non-negative safe integer')
  if (!is_positive_integer(termination_grace_ms)) throw new Error('termination_grace_ms must be a positive integer')
  if (!is_nonnegative_safe_integer(stall_timeout_ms)) throw new Error('stall_timeout_ms must be a non-negative safe integer')
  if (stall_timeout_ms !== 0) throw new Error('quiet-time termination is no longer supported; use an explicit deadline only when authorized')
  if (!is_positive_integer(max_output_bytes)) throw new Error('max_output_bytes must be a positive integer')
  if (!is_nonnegative_safe_integer(nested_poll_ms)) throw new Error('nested_poll_ms must be a non-negative safe integer')

  const clone = prepare_clone(values)
  const result_file_path = normalize_result_file(values.result_file, clone.root)
  const output_collision = declared_result_output_collision(command, clone.root, result_file_path)
  if (output_collision !== null) throw new Error(`Codex ${output_collision.option} must not be used when a declared result path is configured`)
  const before_snapshot = clone_snapshot(clone.root)
  const child_result = await run_child({ command, cwd: clone.root, timeout_ms, stall_timeout_ms, nested_poll_ms, list_processes: values.list_processes, termination_grace_ms, max_output_bytes, env: values.env, result_file_path })
  return make_result({ ...values, max_output_bytes }, clone, command, before_snapshot, child_result, result_file_path)
}

module.exports = {
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TERMINATION_GRACE_MS,
  DEFAULT_NESTED_POLL_MS,
  normalize_command,
  inspect_git_clone,
  prepare_clone,
  clone_snapshot,
  declared_result_output_collision,
  worker_environment,
  run_external_command,
}
