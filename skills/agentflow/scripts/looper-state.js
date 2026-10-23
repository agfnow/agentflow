'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const require_value = (ok, message) => {
  if (!ok) throw new Error(message)
}
const text = (value) =>
  typeof value === 'string' && value.trim().length > 0 && !value.includes('\0')
const id_ok = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value)

// Check every existing component, including the root's ancestors. A lexical
// containment check alone would permit an ancestor symlink to redirect writes.
const windows_component = part => !/[<>:"|?*\x00-\x1f]/.test(part) && !/[. ]$/.test(part) &&
  !/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³]|CONIN\$|CONOUT\$)(?:\.|$)/i.test(part)
const inspect_path = (absolute) => {
  const parsed = path.parse(absolute)
  let current = parsed.root
  for (const part of absolute
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean)) {
    require_value(process.platform !== 'win32' || windows_component(part), 'Unsafe Windows path component')
    current = path.join(current, part)
    try {
      require_value(
        !fs.lstatSync(current).isSymbolicLink(),
        `Symlink path refused: ${current}`
      )
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return absolute
}

const safe_path = (root, relative, { must_exist = false } = {}) => {
  require_value(
    typeof root === 'string' && path.isAbsolute(root),
    'Root must be absolute'
  )
  require_value(
    text(relative) && !path.isAbsolute(relative) && !relative.includes('\\'),
    'Expected relative path'
  )
  require_value(
    !relative
      .split('/')
      .some((part) => part === '..' || part === '.' || part === ''),
    'Unsafe path component'
  )
  const resolved = inspect_path(path.resolve(root, relative))
  require_value(
    resolved.startsWith(path.resolve(root) + path.sep),
    'Path escaped root'
  )
  if (must_exist) fs.lstatSync(resolved)
  return resolved
}

const checked_file = (file) => {
  inspect_path(path.resolve(file))
  const stat = fs.lstatSync(file)
  require_value(stat.isFile(), `Expected regular file: ${file}`)
  return stat
}

const read_json = (file) => {
  checked_file(file)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    require_value(fs.fstatSync(fd).isFile(), `Expected regular file: ${file}`)
    return JSON.parse(fs.readFileSync(fd, 'utf8'))
  } finally {
    fs.closeSync(fd)
  }
}

const flush_directory = (directory) => {
  if (process.platform === 'win32') return
  const fd = fs.openSync(directory, 'r')
  try {
    try {
      fs.fsyncSync(fd)
    } catch (error) {
      // Some platforms cannot fsync directories; all other I/O failures stop writes.
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code)) throw error
    }
  } finally {
    fs.closeSync(fd)
  }
}

const write_json = (file, value) => {
  file = path.resolve(file)
  inspect_path(file)
  if (fs.existsSync(file)) checked_file(file)
  const temporary = `${file}.tmp-${crypto.randomUUID()}`
  const fd = fs.openSync(temporary, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  inspect_path(file)
  if (fs.existsSync(file)) checked_file(file)
  fs.renameSync(temporary, file)
  flush_directory(path.dirname(file))
}

let linux_boot_id
const powershell = () => {
  // Never resolve a privileged process query through a task-controlled cwd/PATH.
  const root = process.env.SystemRoot || process.env.WINDIR
  require_value(root && path.win32.isAbsolute(root), 'Windows system root unavailable')
  return path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}
const powershell_options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
const process_identity = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8')
      linux_boot_id ??= fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()
      return `linux:${linux_boot_id}:${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}`
    }
    if (process.platform === 'win32') {
      const start = execFileSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CreationDate.ToUniversalTime().Ticks`], { ...powershell_options, maxBuffer: 4096 }).trim()
      return /^\d+$/.test(start) ? `win32:${start}` : null
    }
    const start = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim()
    return start ? `${process.platform}:${start.replace(/\s+/g, ' ')}` : null
  } catch {
    return null
  }
}
const process_alive = (identity) => {
  if (
    !object(identity) ||
    !Number.isInteger(identity.pid) ||
    identity.pid <= 0 ||
    !text(identity.started_at)
  )
    return 'unknown'
  try {
    process.kill(identity.pid, 0)
  } catch (error) {
    return error.code === 'ESRCH' ? false : 'unknown'
  }
  const actual = process_identity(identity.pid)
  return actual ? actual === identity.started_at : 'unknown'
}

const writer_stopped = (identity) => {
  if (process_alive(identity) !== false) return false
  // A reused leader PID proves its old process group also retired; never signal it.
  if (identity.process_group && process.platform !== 'win32' && !process_identity(identity.pid)) {
    try { process.kill(-identity.process_group, 0); return false }
    catch (error) { if (error.code !== 'ESRCH') return false }
  }
  return true
}

const acquire_claim = (file, identity = {}) => {
  inspect_path(path.resolve(file))
  const started_at = process_identity(process.pid)
  require_value(started_at, 'Cannot prove coordinator process identity')
  const claim = {
    ...identity,
    token: crypto.randomUUID(),
    pid: process.pid,
    started_at
  }
  const fd = fs.openSync(file, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, JSON.stringify(claim, null, 2) + '\n')
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  flush_directory(path.dirname(path.resolve(file)))
  return claim
}
const verify_claim = (file, claim) => {
  require_value(
    object(claim) && text(claim.token) && read_json(file).token === claim.token,
    'Foreign or changed claim'
  )
  return true
}
const archive_claim = (file, claim, label) => {
  verify_claim(file, claim)
  const archived = `${file}.${label}-${crypto.randomUUID()}`
  fs.renameSync(file, archived)
  flush_directory(path.dirname(path.resolve(file)))
  return archived
}
const release_claim = (file, claim) => archive_claim(file, claim, 'released')
const takeover_claim = (file, expected_token, children = []) => {
  const old = read_json(file)
  require_value(
    old.token === expected_token,
    'Foreign or changed takeover token'
  )
  require_value(
    Array.isArray(children) &&
      (old.children === undefined || Array.isArray(old.children)),
    'Child identities required as array'
  )
  const processes = [old, ...(old.children || []), ...children]
  require_value(
    processes.every(writer_stopped),
    'Takeover refused: process alive or uncertain'
  )
  archive_claim(file, old, 'taken-over')
  const {
    token,
    pid,
    started_at,
    children: previous_children,
    ...identity
  } = old
  return acquire_claim(file, identity)
}

module.exports = { windows_component, powershell, powershell_options, write_json, read_json, safe_path, checked_file, inspect_path,
  acquire_claim, verify_claim, release_claim, process_identity, process_alive, writer_stopped, takeover_claim }
