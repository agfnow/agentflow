'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

module.exports = (prefix, home = os.homedir()) => {
  const scratch = path.join(fs.realpathSync(home), 'tmp')
  try { fs.mkdirSync(scratch, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
  const stat = fs.lstatSync(scratch)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`test scratch path must be a real directory: ${scratch}`)
  return fs.mkdtempSync(path.join(scratch, prefix))
}
