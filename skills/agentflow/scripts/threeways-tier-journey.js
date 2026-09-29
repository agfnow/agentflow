#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const settings = require('./ag-settings')

assert.ok(process.stdin.isTTY && process.stdout.isTTY, 'Run this journey in a real terminal/PTY')
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-threeways-tier-')))
const config_path = path.join(root, 'ag.json')
const legacy = settings.make_template('codex')
delete legacy['pipeline-roles'].threeways
fs.writeFileSync(config_path, JSON.stringify(legacy, null, 2) + '\n')
const run = (args, expected = 0) => {
	console.log(`$ node ag-settings.js ${args.join(' ')}`)
	const child = spawnSync(process.execPath, [path.join(__dirname, 'ag-settings.js'), ...args, '--repo', root, '--host', 'codex'], { encoding: 'utf8', timeout: 30000 })
	process.stdout.write(child.stdout || '')
	process.stderr.write(child.stderr || '')
	assert.equal(child.status, expected, child.error?.message || child.stderr)
	return child.stdout
}
const original = fs.readFileSync(config_path, 'utf8')
assert.match(run(['show']), /pipeline-roles.threeways: better/)
assert.equal(fs.readFileSync(config_path, 'utf8'), original)
assert.match(run(['change', '--set', 'pipeline-roles.threeways: best']), /threeways.*best/)
assert.match(run(['show']), /pipeline-roles.threeways: best/)
const changed = JSON.parse(fs.readFileSync(config_path, 'utf8'))
assert.equal(changed['pipeline-roles'].threeways, 'best')
delete changed['pipeline-roles'].threeways
assert.deepEqual(changed, legacy)
const before_invalid = fs.readFileSync(config_path, 'utf8')
run(['change', '--set', 'pipeline-roles.threeways: off'], 1)
assert.equal(fs.readFileSync(config_path, 'utf8'), before_invalid)
console.log(`PASS: real PTY settings input/output, legacy file preserved on read, best saved, other settings unchanged, off refused. No model calls. Fixture: ${root}`)
