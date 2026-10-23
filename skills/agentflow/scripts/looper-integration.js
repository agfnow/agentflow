const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { inspect_path } = require('./looper-state')

const git = (cwd, args) => {
  const result = spawnSync(process.platform === 'win32' ? require('./looper-agent').resolve_command(['git.exe'])[0] : 'git', ['-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`, '--literal-pathspecs', ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  if (result.error || result.status !== 0)
    throw new Error(
      `git ${args[0]} failed: ${result.error?.message || result.stderr || result.stdout}`
    )
  return result.stdout.trimEnd()
}
const head = (cwd) => git(cwd, ['rev-parse', 'HEAD'])
const oid = (cwd, value) => {
  if (!/^[a-f0-9]{40,64}$/.test(value || ''))
    throw new Error('Expected exact commit identity')
  if (git(cwd, ['rev-parse', `${value}^{commit}`]) !== value)
    throw new Error('Commit identity mismatch')
  return value
}
const safe_id = (value) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value || ''))
    throw new Error('Unsafe run/group identity')
  return value
}
const no_operation = (cwd) => {
  for (const name of [
    'MERGE_HEAD',
    'CHERRY_PICK_HEAD',
    'REVERT_HEAD',
    'rebase-merge',
    'rebase-apply',
    'index.lock',
    'HEAD.lock'
  ]) {
    if (
      fs.existsSync(
        path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', name]))
      )
    )
      throw new Error(`Foreign Git operation: ${name}`)
  }
  const common = path.resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir']))
  if (fs.existsSync(path.join(common, 'packed-refs.lock')))
    throw new Error('Foreign Git ref lock')
}
const names = (cwd, args) => git(cwd, args).split('\0').filter(Boolean)
const changed = (cwd) => [
  ...new Set([
    ...names(cwd, ['diff', '--no-renames', '--name-only', '-z', 'HEAD']),
    ...names(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])
  ])
].filter(file => !file.startsWith('.aglite-records/'))
const regular_paths = (cwd, files) => {
  for (const file of files) {
    if (path.isAbsolute(file) || file.split('/').includes('..'))
      throw new Error('Unsafe changed path')
    let current = cwd
    for (const part of file.split('/')) {
      current = path.join(current, part)
      if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Symlink change: ${file}`)
    }
    const mode = git(cwd, ['ls-files', '-s', '--', file])
    if (/^(160000|120000) /.test(mode))
      throw new Error(`Submodule change: ${file}`)
  }
}
const scoped = (file, allowed) =>
  allowed.some((prefix) => {
    if (
      !prefix ||
      path.isAbsolute(prefix) ||
      prefix.split('/').includes('..') ||
      prefix === '.'
    )
      throw new Error('Unsafe allowed path')
    const clean = prefix.replace(/\/$/, '')
    return file === clean || file.startsWith(`${clean}/`)
  })
const stage = (cwd, files) => {
  if (files.length) git(cwd, ['add', '--', ...files])
}
const commit = (cwd, message) =>
  git(cwd, [
    '-c',
    'user.name=aglite runner',
    '-c',
    'user.email=aglite@localhost',
    'commit',
    '--no-gpg-sign',
    '-m',
    message
  ])

function prepare_group(queue, group, save) {
  if (!group.workspace) {
    const branch = `aglite-${safe_id(queue.run_id)}-${safe_id(group.id)}`
    const worktree = path.join(queue.repo, '.wts', branch)
    group.workspace = { branch, worktree, base: queue.expected_head }
    save() // Intent precedes Git; recovery never invents another branch.
  }
  const w = group.workspace
  if (w.branch !== `aglite-${safe_id(queue.run_id)}-${safe_id(group.id)}` ||
      w.worktree !== path.join(queue.repo, '.wts', w.branch))
    throw Error('Recorded group workspace escaped its registered identity')
  oid(queue.repo, w.base)
  if (fs.existsSync(w.worktree)) {
    if (fs.realpathSync(w.worktree) !== w.worktree ||
        git(w.worktree, ['symbolic-ref', '--short', 'HEAD']) !== w.branch ||
        git(w.worktree, ['merge-base', w.base, 'HEAD']) !== w.base)
      throw Error('Existing group worktree identity mismatch')
  } else {
    if (git(queue.repo, ['branch', '--list', w.branch])) throw Error('Branch exists without recorded worktree')
    fs.mkdirSync(path.dirname(w.worktree), { recursive: true })
    if (fs.realpathSync(path.dirname(w.worktree)) !== path.dirname(w.worktree)) throw Error('Symlink worktree parent')
    git(queue.repo, ['worktree', 'add', '-b', w.branch, w.worktree, w.base])
  }
  no_operation(w.worktree)
  const exclude = inspect_path(path.resolve(w.worktree, git(w.worktree, ['rev-parse', '--git-path', 'info/exclude'])))
  const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
  const rules = ['/.aglite-records/', '/.aglite-records/.devlog.md.owner']
  const missing = rules.filter(rule => !existing.split(/\r?\n/).includes(rule))
  if (missing.length) fs.appendFileSync(exclude, `\n${missing.join('\n')}\n`)
  return w.worktree
}
function commit_task(cwd, expected, allowed, message, recovering = false) {
  if (head(cwd) !== expected) throw Error('Task changed HEAD; reconcile before continuing')
  no_operation(cwd)
  if (git(cwd, ['diff', '--cached', '--name-only']) && !recovering) throw Error('Task staged changes without coordinator commit intent')
  const files = changed(cwd)
  regular_paths(cwd, files)
  for (const file of files) if (!scoped(file, allowed)) throw Error(`Out-of-scope change: ${file}`)
  stage(cwd, files)
  if (files.length) commit(cwd, message)
  return head(cwd)
}
function target_safe(queue) {
  if (git(queue.repo, ['symbolic-ref', '--short', 'HEAD']) !== queue.target_branch ||
      head(queue.repo) !== queue.expected_head)
    throw Error('Target moved outside the integration lane')
  no_operation(queue.repo)
}
function prepare_integration(queue, group, save) {
  target_safe(queue)
  if (head(group.workspace.worktree) !== group.candidate) throw Error('Group candidate moved')
  const branch = `aglite-merge-${safe_id(queue.run_id)}-${safe_id(group.id)}-${crypto.randomUUID()}`
  const attempt = { id: branch, group_id: group.id, base: queue.expected_head,
    candidate: group.candidate, branch, worktree: path.join(queue.repo, '.wts', branch), phase: 'prepared' }
  queue.integration = attempt
  save()
  git(queue.repo, ['worktree', 'add', '-b', branch, attempt.worktree, attempt.base])
  try { git(attempt.worktree, ['merge', '--no-ff', '--no-commit', attempt.candidate]) }
  catch (error) {
    if (!git(attempt.worktree, ['ls-files', '--unmerged'])) throw error
    attempt.phase = 'repair'
    attempt.reason = 'merge conflicts'
    save()
    return attempt
  }
  if (fs.existsSync(path.resolve(attempt.worktree, git(attempt.worktree, ['rev-parse', '--git-path', 'MERGE_HEAD']))))
    commit(attempt.worktree, `aglite: integrate ${group.id}`)
  attempt.phase = 'checks'
  save()
  return attempt
}
function verify_integration(queue, attempt) {
  const prefix = `aglite-merge-${safe_id(queue.run_id)}-${safe_id(attempt.group_id)}-`
  if (!attempt.branch.startsWith(prefix) || !/^[a-zA-Z0-9_-]+$/.test(attempt.branch) ||
      attempt.worktree !== path.join(queue.repo, '.wts', attempt.branch) ||
      fs.realpathSync(attempt.worktree) !== attempt.worktree ||
      git(attempt.worktree, ['symbolic-ref', '--short', 'HEAD']) !== attempt.branch)
    throw Error('Recorded integration workspace identity mismatch')
  oid(queue.repo, attempt.base)
  oid(queue.repo, attempt.candidate)
}
function commit_repair(attempt, allowed) {
  const cwd = attempt.worktree
  if (git(cwd, ['symbolic-ref', '--short', 'HEAD']) !== attempt.branch) throw Error('Repair changed branch')
  const files = changed(cwd)
  regular_paths(cwd, files)
  for (const file of files) if (!scoped(file, allowed)) throw Error(`Out-of-scope repair: ${file}`)
  const unmerged = names(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
  for (const file of new Set([...unmerged, ...files])) {
    if (fs.existsSync(path.join(cwd, file)) && /^(?:<{7}|>{7})(?: |$)/m.test(fs.readFileSync(path.join(cwd, file), 'utf8')))
      throw Error(`Repair left conflict markers: ${file}`)
  }
  stage(cwd, files)
  if (git(cwd, ['ls-files', '--unmerged'])) throw Error('Repair left conflicts')
  if (git(cwd, ['diff', '--cached', '--name-only']) ||
      fs.existsSync(path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'MERGE_HEAD']))))
    commit(cwd, `aglite: repair integration ${attempt.group_id}`)
  return head(cwd)
}
function land(queue, attempt, save) {
  target_safe(queue)
  if (head(attempt.worktree) !== attempt.result || changed(attempt.worktree).length)
    throw Error('Verified integration candidate changed')
  if (git(queue.repo, ['merge-base', attempt.base, attempt.result]) !== attempt.base ||
      git(queue.repo, ['merge-base', attempt.candidate, attempt.result]) !== attempt.candidate)
    throw Error('Integration lost candidate ancestry')
  // Git refuses overwriting intersecting owner edits; disjoint dirt is preserved.
  // Reject staged owner content: ff-only may otherwise fail for that unrelated index.
  if (git(queue.repo, ['diff', '--cached', '--name-only'])) throw Error('Target has staged owner edits; preserve and reconcile')
  attempt.phase = 'landing'
  save() // A crash after ff is reconciled against this exact checked result.
  git(queue.repo, ['merge', '--ff-only', attempt.result])
}
module.exports = { git, head, oid, safe_id, no_operation, changed, regular_paths,
  scoped, stage, commit, prepare_group, commit_task, target_safe,
  prepare_integration, verify_integration, commit_repair, land }
