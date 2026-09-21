'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const temp = require('./fixtures/temp-directory')
const { resolve_default_branch } = require('./default-branch')

test('default resolver uses explicit branch then cached remote then compatibility without network', t => {
  const root = temp('agf-default-branch-')
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const read = args => {
    assert.ok(!['fetch', 'push', 'ls-remote', 'remote'].includes(args[0]), 'selection must stay offline')
    try { return git(args) } catch { return null }
  }
  git(['init', '-b', 'trunk'])
  git(['config', 'user.name', 'Default test'])
  git(['config', 'user.email', 'default@example.test'])
  git(['commit', '--allow-empty', '-m', 'fixture'])
  assert.equal(resolve_default_branch(read).branch, '')
  git(['branch', 'master'])
  assert.equal(resolve_default_branch(read).branch, 'master')
  git(['branch', 'main'])
  assert.equal(resolve_default_branch(read).branch, 'main')
  git(['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
  git(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
  assert.deepEqual(resolve_default_branch(read), { branch: 'trunk', source: 'origin/HEAD', error: '' })
  for (const branch of ['master', 'release/stable', "release;echo-safe"]) {
    if (branch !== 'master') git(['branch', branch])
    git(['config', 'agentflow.default-branch', branch])
    assert.deepEqual(resolve_default_branch(read), { branch, source: 'config', error: '' })
  }
  for (const branch of ['', 'missing', '-bad', 'refs/heads/main', 'bad name', '@{-1}']) {
    git(['config', 'agentflow.default-branch', branch])
    const result = resolve_default_branch(read)
    assert.equal(result.branch, '')
    assert.match(result.error, /existing local branch/)
  }
  git(['config', '--unset', 'agentflow.default-branch'])
  assert.equal(resolve_default_branch(read).branch, 'trunk')
})

test('a configured branch avoids all remote and fallback reads', () => {
  const seen = []
  const result = resolve_default_branch(args => {
    seen.push(args[0])
    if (args[0] === 'config') return 'trunk\n'
    if (['check-ref-format', 'show-ref'].includes(args[0])) return ''
    throw Error('unexpected later probe')
  })
  assert.equal(result.branch, 'trunk')
  assert.deepEqual(seen, ['config', 'check-ref-format', 'show-ref'])
})
