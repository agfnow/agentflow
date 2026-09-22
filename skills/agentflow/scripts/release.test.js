'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const repo_root = path.resolve(__dirname, '../../..')

test('candidate changelog keeps Unreleased empty and accounts for the 8.3.0 changes', () => {
  const changelog = fs.readFileSync(path.join(repo_root, 'docs', 'CHANGELOG.md'), 'utf8')
  const unreleased = changelog.match(/## \[Unreleased\]([\s\S]*?)(?=\n## \[|$)/u)?.[1] || ''
  assert.doesNotMatch(unreleased, /\S/)
  assert.match(changelog, /## \[8\.3\.0\]/)
  assert.match(changelog, /git-timeout-ms/)
  assert.match(changelog, /default-branch resolver/)
})

test('the retained regression command names terminal and release boundary tests', () => {
  const readme = fs.readFileSync(path.join(repo_root, 'skills', 'agentflow', 'scripts', 'README.md'), 'utf8')
  assert.match(readme, /Run from `skills\/agentflow\/scripts`/)
  assert.match(readme, /node --test \*\.test\.js/)
})
