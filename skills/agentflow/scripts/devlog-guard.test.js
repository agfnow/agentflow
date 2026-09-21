'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const { verdict } = require('./devlog-guard.js')

const guard_path = path.join(__dirname, 'devlog-guard.js')

// ---------- pure: verdict ----------

test('verdict blocks root devlog.md staged on a non-default branch', () => {
	const message = verdict({ branch: 'login-page', def: 'main', staged: ['.agentflow/devlog.md'], has_stream_doc: true })
	assert.ok(message.includes('blocked'))
	assert.ok(message.includes('features/login-page/login-page.devlog.md'))
	assert.ok(message.includes('--no-verify'))
})

test('verdict also blocks root ag.json staged on a non-default branch', () => {
	const message = verdict({ branch: 'login-page', def: 'main', staged: ['ag.json'], has_stream_doc: true })
	assert.match(message, /root ag\.json is staged/)
	assert.match(message, /unstage them with: git restore --staged ag\.json/)
})

test('verdict names the generic shape when the stream notebook is missing', () => {
	const message = verdict({ branch: 'x', def: 'main', staged: ['.agentflow/devlog.md'], has_stream_doc: false })
	assert.ok(message.includes('features/<key>/<key>.devlog.md'))
})

test('verdict allows the default branch, other files, detached HEAD, and an unknown default', () => {
	assert.equal(verdict({ branch: 'main', def: 'main', staged: ['.agentflow/devlog.md'], has_stream_doc: false }), null)
	assert.equal(verdict({ branch: 'x', def: 'main', staged: ['features/x/x.devlog.md', 'app.js'], has_stream_doc: true }), null)
	assert.equal(verdict({ branch: 'HEAD', def: 'main', staged: ['.agentflow/devlog.md'], has_stream_doc: false }), null)
	assert.equal(verdict({ branch: 'x', def: '', staged: ['.agentflow/devlog.md'], has_stream_doc: false }), null)
})

test('verdict is about ROOT devlog.md only, not same-named files deeper down', () => {
	assert.equal(verdict({ branch: 'x', def: 'main', staged: ['docs/devlog.md'], has_stream_doc: false }), null)
})

test('verdict protects the configured workspace notebook and names its stream path', () => {
	const message = verdict({
		branch: 'login-page',
		def: 'main',
		staged: ['.agentflow/devlog.md'],
		has_stream_doc: true,
		root_notebook: '.agentflow/devlog.md',
		feature_root: '.agentflow/features',
	})
	assert.match(message, /root \.agentflow\/devlog\.md is staged/)
	assert.match(message, /\.agentflow\/features\/login-page\/login-page\.devlog\.md/)
})

// ---------- end to end: as an installed git pre-commit hook ----------

const make_repo = () => {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'guard-')))
	const run = (args, cwd = dir) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
	run(['init', '-b', 'main'])
	run(['config', 'user.email', 't@example.com'])
	run(['config', 'user.name', 'T'])
	fs.writeFileSync(path.join(dir, '.gitignore'), '.worktrees/\n')
	fs.mkdirSync(path.join(dir, '.agentflow'), { recursive: true })
	fs.writeFileSync(path.join(dir, '.agentflow/devlog.md'), '# STATUS\n')
	run(['add', '-A'])
	run(['commit', '-m', 'init'])
	fs.writeFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), `#!/bin/sh\nnode "${guard_path}"\n`, { mode: 0o755 })
	return { dir, run }
}

const drop = (dir) => fs.rmSync(dir, { recursive: true, force: true })

test('the hook blocks a devlog.md commit on a branch and allows it on main', () => {
	const { dir, run } = make_repo()
	run(['switch', '-c', 'side'])
	fs.appendFileSync(path.join(dir, '.agentflow/devlog.md'), 'tampered\n')
	run(['add', '.agentflow/devlog.md'])
	assert.throws(() => run(['commit', '-m', 'bad']), /blocked: root \.agentflow\/devlog\.md/)
	run(['restore', '--staged', '.agentflow/devlog.md'])
	run(['restore', '.agentflow/devlog.md'])
	run(['switch', 'main'])
	fs.appendFileSync(path.join(dir, '.agentflow/devlog.md'), 'a real round\n')
	run(['add', '.agentflow/devlog.md'])
	run(['commit', '-m', 'fine on main'])
	drop(dir)
})

test('the hook allows other files on a branch', () => {
	const { dir, run } = make_repo()
	run(['switch', '-c', 'side'])
	fs.writeFileSync(path.join(dir, 'app.js'), 'x\n')
	run(['add', 'app.js'])
	run(['commit', '-m', 'feature work'])
	drop(dir)
})

test('one install in the main checkout also guards every worktree', () => {
	const { dir, run } = make_repo()
	run(['worktree', 'add', path.join('.worktrees', 'bb'), '-b', 'bb'])
	const wt = path.join(dir, '.worktrees', 'bb')
	fs.appendFileSync(path.join(wt, '.agentflow/devlog.md'), 'tampered from the worktree\n')
	run(['add', '.agentflow/devlog.md'], wt)
	assert.throws(() => run(['commit', '-m', 'bad'], wt), /blocked: root \.agentflow\/devlog\.md/)
	drop(dir)
})

test('configured custom default allows root commits there and blocks a feature', () => {
  const { dir, run } = make_repo()
  try {
    run(['switch', '-c', 'trunk'])
    run(['config', 'agentflow.default-branch', 'trunk'])
    fs.appendFileSync(path.join(dir, '.agentflow/devlog.md'), 'on trunk\n')
    run(['add', '.agentflow/devlog.md'])
    assert.doesNotThrow(() => run(['commit', '-m', 'root on trunk']))
    run(['switch', '-c', 'feature'])
    fs.appendFileSync(path.join(dir, '.agentflow/devlog.md'), 'wrong branch\n')
    run(['add', '.agentflow/devlog.md'])
    assert.throws(() => run(['commit', '-m', 'must refuse']), /blocked/)
  } finally { drop(dir) }
})
