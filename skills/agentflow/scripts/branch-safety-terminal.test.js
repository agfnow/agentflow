'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const make_temp = require('./fixtures/temp-directory')
const settings = require('./ag-settings')

const agf = path.join(__dirname, 'agf.js')
const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const word = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('$', '\\$').replaceAll('[', '\\[').replaceAll(']', '\\]').replaceAll('"', '\\"')}"`

test('discard confirmation in a real terminal preserves a remote branch changed while the owner answers', { skip: process.platform !== 'darwin' || !fs.existsSync('/usr/bin/expect') }, () => {
  const root = fs.realpathSync(make_temp('agf-branch-terminal-'))
  const repo = path.join(root, 'repo')
  const remote = path.join(root, 'remote.git')
  fs.mkdirSync(repo)
  git(repo, ['init', '-q', '-b', 'main'])
  git(repo, ['config', 'user.name', 'Safety test'])
  git(repo, ['config', 'user.email', 'safety@example.invalid'])
  fs.writeFileSync(path.join(repo, '.gitignore'), '.worktrees/\n')
  fs.writeFileSync(path.join(repo, 'ag.json'), JSON.stringify(settings.make_template('codex')))
  fs.mkdirSync(path.join(repo, '.agentflow'))
  fs.writeFileSync(path.join(repo, '.agentflow/devlog.md'), settings.format_status({ project: 'safety test', notebook: '.agentflow/devlog.md', current_commit: 'fixture', tests_scenarios: 'fixture', config_path: 'ag.json', host: 'codex', validation: 'validated', proven: 'fixture', open: 'none', next: 'none', artifacts: 'none', archived_eras: 'none' }))
  git(repo, ['add', '.'])
  git(repo, ['commit', '-qm', 'initial'])
  git(root, ['init', '--bare', '-q', '-b', 'main', remote])
  git(repo, ['remote', 'add', 'origin', remote])
  git(repo, ['push', '-qu', 'origin', 'main'])
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', TERM: 'xterm-256color' }
  const opened = spawnSync(process.execPath, [agf, 'new', 'safety feature'], { cwd: repo, env, encoding: 'utf8' })
  assert.equal(opened.status, 0, opened.stderr)
  const key = 'safety-feature'
  const before = git(remote, ['rev-parse', `refs/heads/${key}`])
  git(remote, ['config', 'user.name', 'Other user'])
  git(remote, ['config', 'user.email', 'other@example.invalid'])
  const newer = git(remote, ['commit-tree', `${before}^{tree}`, '-p', before, '-m', 'concurrent remote work'])
  const program = [
    'set timeout 30',
    'log_user 1',
    `spawn -noecho /bin/sh -c ${word('test -t 0 && test -t 1 && echo terminal-is-tty; exec "$@"')} safety-terminal ${word(process.execPath)} ${word(agf)} ditch ${key}`,
    'expect "are you sure?"',
    `exec git -C ${word(remote)} update-ref refs/heads/${key} ${newer} ${before}`,
    'send -- "y\\r"',
    'expect eof',
    'set result [wait]',
    'exit [lindex $result 3]',
  ].join('\n')
  const result = spawnSync('/usr/bin/expect', ['-c', program], { cwd: repo, env, encoding: 'utf8', timeout: 40000 })
  const output = `${result.stdout || ''}${result.stderr || ''}`
  assert.match(output, /terminal-is-tty/)
  assert.match(output, /are you sure\?/)
  assert.equal(result.status, 1, output)
  assert.equal(git(remote, ['rev-parse', `refs/heads/${key}`]), newer)
  assert.equal(git(repo, ['rev-parse', `refs/heads/${key}`]), before)
  assert.ok(fs.existsSync(path.join(repo, '.worktrees', key)))
})
