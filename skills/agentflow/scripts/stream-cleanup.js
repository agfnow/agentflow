'use strict'

// Preserve narrowly recognized local files before Git removes a finished worktree.
// Unknown ignored files remain a refusal, not an implicit discard request.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const owner = require('./notebook-owner')
const hooks = require('./install-hook')
const settings = require('./ag-settings')

const snapshot = (root, relative) => {
  const file = owner.safe_path(root, relative)
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0))
  try {
    const stat = fs.fstatSync(descriptor)
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw Error('local file is not a bounded regular file')
    const bytes = fs.readFileSync(descriptor)
    return { relative, bytes, dev: stat.dev, ino: stat.ino, mode: stat.mode }
  } finally { fs.closeSync(descriptor) }
}

const same = (a, b) => a.relative === b.relative && a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.bytes.equals(b.bytes)

const owned_hooks = (bytes, host) => {
  const config = JSON.parse(bytes.toString('utf8'))
  if (Object.keys(config).join(',') !== 'hooks' || Object.keys(config.hooks).sort().join(',') !== 'Stop,UserPromptSubmit') return false
  return ['Stop', 'UserPromptSubmit'].every(event => {
    const entries = config.hooks[event]
    if (!Array.isArray(entries) || entries.length !== 1 || Object.keys(entries[0]).join(',') !== 'hooks') return false
    const commands = entries[0].hooks
    if (!Array.isArray(commands) || commands.length !== 1 || Object.keys(commands[0]).sort().join(',') !== 'command,type' || commands[0].type !== 'command') return false
    const parsed = hooks.parse_owned_command(commands[0].command)
    return parsed?.host === host && fs.realpathSync(parsed.script) === fs.realpathSync(path.join(__dirname, 'stop-hook.js'))
  })
}

const inspect = ({ worktree, notebook, key, git }) => {
  try {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(key)) throw Error('stream key is not canonical')
    const status = git(worktree, ['status', '--porcelain', '-z', '--ignored', '--untracked-files=all'], { preserve_nul: true })
    if (!status.ok) throw Error('could not inspect worktree status')
    const info = owner.location({ root: worktree, notebook })
    const record = owner.read(info)
    if (record && record.state !== 'released') throw Error('stream notebook has active or unresolved ownership; close its session first')
    const notebook_file = owner.safe_path(worktree, notebook)
    if (fs.existsSync(`${notebook_file}.close-round.lock`)) throw Error('stream notebook is locked; close its session first')
    const config = JSON.parse(fs.readFileSync(settings.resolve_config_path(worktree, notebook), 'utf8'))
    const workspace = config.switches['workspace-dir']
    if (settings.workspace_dir_errors(workspace, worktree).length) throw Error('configured workspace is invalid')
    const prefix = `${workspace}/.tmp/`
    const notebook_key = crypto.createHash('sha256').update(notebook).digest('hex')
    const input = new RegExp(`^agentflow-input-[a-z0-9][a-z0-9_-]*-${notebook_key}\\.json(?:\\.A-\\d{3}\\.[a-f0-9]{64}\\.close\\.json)?$`)
    const files = []
    for (const entry of status.out ? status.out.split('\0') : []) {
      const code = entry.slice(0, 2), relative = entry.slice(3)
      if (code !== '!!' && !(code === '??' && path.posix.basename(relative) === '.DS_Store')) throw Error(`worktree still has unsaved changes: ${JSON.stringify(relative)}`)
      const item = snapshot(worktree, relative)
      let known = path.posix.basename(relative) === '.DS_Store'
      if (relative.startsWith(prefix)) {
        const local = relative.slice(prefix.length)
        known ||= (local === '.gitignore' && item.bytes.toString('utf8') === '*\n')
          || input.test(local) || relative === info.relative
          || new RegExp(`^features/${key}/A-\\d{3}/completion(?:\\.ref)?\\.json$`).test(local)
      }
      if (relative === '.codex/hooks.json' || relative === '.claude/settings.json') known = owned_hooks(item.bytes, relative.startsWith('.codex/') ? 'codex' : 'claude')
      if (!known) throw Error(`worktree still has unsaved or unknown ignored files: ${JSON.stringify(relative)}`)
      files.push(item)
    }
    return { files }
  } catch (error) { return { error: error.message } }
}

const unchanged = (before, after) => !after.error && before.files.length === after.files.length && before.files.every((item, index) => same(item, after.files[index]))

const preserve = ({ common, key, files }) => {
  if (!files.length) return null
  // The shared Git directory survives worktree removal and is never committed.
  const base = owner.safe_path(common, 'agentflow-cleanup/placeholder', true)
  const directory = fs.mkdtempSync(path.join(path.dirname(base), `${key}-`))
  fs.chmodSync(directory, 0o700)
  try {
    for (const item of files) {
      const destination = owner.safe_path(directory, item.relative, true)
      const descriptor = fs.openSync(destination, 'wx', 0o600)
      try { fs.writeFileSync(descriptor, item.bytes); fs.fsyncSync(descriptor) } finally { fs.closeSync(descriptor) }
      if (!fs.readFileSync(destination).equals(item.bytes)) throw Error('preserved bytes did not verify')
    }
    return directory
  } catch (error) {
    throw Error(`local-file preservation failed; worktree kept; partial recovery directory: ${directory}: ${error.message}`)
  }
}

module.exports = { inspect, unchanged, preserve }
