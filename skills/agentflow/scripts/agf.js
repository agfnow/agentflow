#!/usr/bin/env node
'use strict'
const { run, status } = require('./looper')
const args = process.argv.slice(2)
if (args[0] !== 'loop' || !['run', 'status'].includes(args[1]) || args.length > 3) {
  console.error('Usage: agf loop run [run-root]\n       agf loop status [run-root]')
  process.exitCode = 1
} else {
  Promise.resolve().then(() => args[1] === 'run' ? run(args[2]) : process.stdout.write(status(args[2])))
    .then(code => { if (args[1] === 'run') process.exitCode = code })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
