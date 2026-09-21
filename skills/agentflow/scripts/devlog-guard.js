#!/usr/bin/env node
'use strict'

// devlog-guard — a git pre-commit hook, installed by install-hook.js --project.
// On any branch other than the default, a commit that stages root devlog.md is
// blocked: that file is the ROOT notebook checked out on the branch, and a
// commit would put root history on the stream branch (I-039). Worktrees share
// the main checkout's hooks, so one install covers every stream.
// Fails open: any internal error, missing fact, or detached HEAD allows the commit.

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const settings = require('./ag-settings')
const { resolve_default_branch } = require('./default-branch.js')

const git = (args) => {
	try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }
	catch { return null }
}

// null = allow; a string = block with that message.
const verdict = ({ branch, def, staged, has_stream_doc, root_notebook = '.agentflow/devlog.md', feature_root = '.agentflow/features' }) => {
	if (!branch || branch === 'HEAD' || !def || branch === def) return null
	const root_authoritative_files = staged.filter(file => file === root_notebook || file === 'ag.json')
	if (root_authoritative_files.length === 0) return null
	const notebook = `${feature_root}/${branch}/${branch}.devlog.md`
	return [
		`blocked: root ${root_authoritative_files.join(' and ')} is staged on branch "${branch}" — these are the ROOT notebook/configuration files checked out here, and committing them puts root history on this branch (agentflow I-039).`,
		has_stream_doc
			? `this stream's own notebook is ${notebook} — write there instead.`
			: `a stream writes its own notebook (${feature_root}/<key>/<key>.devlog.md), never root ${root_notebook}.`,
		`unstage them with: git restore --staged ${root_authoritative_files.join(' ')}`,
		`only a merge carrying "${def}"'s own copy of the file may pass with: git commit --no-verify`,
	].join('\n')
}

const main = () => {
	try {
		const top = git(['rev-parse', '--show-toplevel'])
		if (!top) return 0
		const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
		const def = resolve_default_branch(git).branch
		const staged = (git(['diff', '--cached', '--name-only']) || '').split('\n').filter(Boolean)
		let paths = { notebook: '.agentflow/devlog.md', features: '.agentflow/features' }
		try { paths = settings.workspace_paths(JSON.parse(fs.readFileSync(path.join(top, 'ag.json'), 'utf8'))) } catch {}
		const has_stream_doc = branch ? fs.existsSync(path.join(top, paths.features, branch, `${branch}.devlog.md`)) : false
		const message = verdict({ branch, def, staged, has_stream_doc, root_notebook: paths.notebook, feature_root: paths.features })
		if (!message) return 0
		process.stderr.write(`${message}\n`)
		return 1
	} catch { return 0 }
}

module.exports = { verdict, main }

if (require.main === module) process.exit(main())
