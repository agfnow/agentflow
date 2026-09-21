'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const make_temp_directory = require('./temp-directory')

test('temporary fixtures stay under home/tmp and refuse a symlink or file there', () => {
  const root = make_temp_directory('agentflow-scratch-check-')
  assert.equal(path.dirname(root), path.join(fs.realpathSync(os.homedir()), 'tmp'))
  const fresh = make_temp_directory('fresh-', root)
  assert.equal(path.dirname(fresh), path.join(root, 'tmp'))
  assert.equal(fs.statSync(fresh).mode & 0o077, 0)
  for (const kind of ['symlink', 'file']) {
    const home = make_temp_directory(`${kind}-`, root)
    const outside = make_temp_directory('outside-', root)
    if (kind === 'symlink') fs.symlinkSync(outside, path.join(home, 'tmp'), 'dir')
    else fs.writeFileSync(path.join(home, 'tmp'), 'preserve this file\n')
    assert.throws(() => make_temp_directory('must-not-appear-', home), /must be a real directory/)
    assert.deepEqual(fs.readdirSync(outside), [])
    if (kind === 'file') assert.equal(fs.readFileSync(path.join(home, 'tmp'), 'utf8'), 'preserve this file\n')
  }
})
