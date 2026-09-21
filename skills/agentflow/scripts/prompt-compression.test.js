'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')
test('delegation does not override direct work or prohibit assigned implementation', () => {
	const guide = read('skills/agentflow/references/delegation.md')
	assert.doesNotMatch(guide, /All substantive .*must use this route/)
	assert.match(guide, /implementation worker.*declared source/i)
	assert.match(guide, /reviewer.*read-only/i)
	assert.doesNotMatch(read('skills/agentflow/references/ag.md'), /preserves user changes and writes only its report\/result/)
})

test('adaptive support preserves protections without ranking models or buying repeated retries', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	assert.match(skill, /Task risk determines required checks/)
	assert.match(skill, /one focused correction/)
	assert.match(skill, /No model ranking or paid qualification/)
	assert.match(skill, /comparable work.*verified success/is)
})

test('the always-loaded skill stays within the retained 32 KiB budget', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const bytes = Buffer.byteLength(skill, 'utf8')
	const retained_budget = 32 * 1024
	assert.ok(bytes < retained_budget, `always-loaded skill is ${bytes} bytes`)
	assert.match(skill, /Read `references\/closeout\.md` in full before deciding review requirements/)
	assert.doesNotMatch(skill, /"allowed_paths"/)
	assert.match(read('skills/agentflow/references/closeout.md'), /"allowed_paths"/)
})

test('the always-loaded skill routes advanced machinery on demand', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	assert.match(skill, /canonical startup command.*agf\.js start.*message-stdin/i)
	assert.match(skill, /first and only startup call.*exact owner message.*standard input/is)
	assert.match(skill, /Never make an empty or probe startup call/is)
	assert.match(skill, /references\/streams\.md.*before any feature/i)
	assert.match(skill, /references\/ag\.md.*all-in.*make-plans/i)
	assert.match(skill, /references\/delegation\.md.*before selecting, briefing, or starting a worker/i)
	assert.match(skill, /`run-looper` means: read `references\/looper\.md`/i)
	assert.doesNotMatch(skill, /eval\/evaluation-harness\.md/i)
})

test('the slim front door retains the owner, scope, evidence, and Git boundaries', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	assert.match(skill, /exact owner message.*standard input/i)
	assert.match(skill, /Scope discipline — implement exactly the ask/i)
	assert.match(skill, /Worker findings never expand scope/i)
	assert.match(skill, /Facts require direct command output or file inspection/i)
	assert.match(skill, /failing test.*smallest green change.*complete relevant suite/i)
	assert.match(skill, /Never force-push/i)
})

test('show-diff requires justified, human-scannable unified diff hunks', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const writing = read('skills/agentflow/references/writing.md')
	assert.match(skill, /each logical change.*`Reason:`.*fenced `diff` hunk/is)
	assert.match(skill, /removed lines.*`-`.*added lines.*`\+`/is)
	assert.match(skill, /hunk header shows verified old and new line numbers/i)
	assert.match(writing, /reasoned unified-diff format/i)
})

test('general writing guidance preserves requirements refresh history outside advisor-only paths', () => {
	const writing = read('skills/agentflow/references/writing.md')
	assert.match(writing, /requirements refreshes.*append-only question history.*one replaceable `# Final requirements summary`/i)
})

test('the front door makes activation and closeout one-shot operations', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')
	assert.match(skill, /bare `godev`.*`activation_only`.*`activation_placeholder_repaired`.*Development workflow ready\..*do not.*close/is)
	assert.match(skill, /bare `godev`.*`already_present`.*read the current Ask.*resume/is)
	assert.match(english, /Ask is still empty|Ask is empty|Ask is still empty/is)
	assert.match(english, /Development workflow ready\..*Ask already contains your request.*reads it/is)
	assert.match(chinese, /Ask 仍然是空的.*Development workflow ready\..*Ask 已經有你的請求.*讀取內容/is)
	assert.match(skill, /do not (?:search for|read).*AGENTS\.md.*agf\.js.*notebook-write\.js/is)
	assert.match(skill, /compose.*in memory.*--manifest-stdin/is)
	assert.match(skill, /never create.*`close-manifest\.json`/is)
	assert.match(skill, /single-quoted heredoc.*without base64.*`btoa`.*`TextEncoder`/is)
	assert.match(skill, /Close with one `agf close --manifest-stdin`; never add `--repo`/i)
	assert.match(skill, /Run it once/i)
	assert.match(skill, /use `run_events: \[\]` only when none remain/is)
	assert.match(skill, /writer owns numbering and time/is)
	assert.match(skill, /`agf close` alone adds.*next empty Ask scaffold/is)
	assert.match(skill, /Do not include that scaffold in `reply`/u)
})

test('the slim front door retains notebook compaction and concise Reply evidence', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')
	assert.match(skill, /automatically compact eligible completed rounds when the notebook exceeds 1,000 lines or reaches 768 KiB/is)
	assert.match(english, /after 1,000 lines/i)
	assert.match(chinese, /超過 1,000 行/i)
	assert.match(skill, /Do not use a fixed evidence-and-delivery checklist/i)
	assert.match(skill, /Omit the redundant literal `Host gate: PASS`/i)
	assert.match(skill, /structured `host_gate` evidence/i)
	assert.match(skill, /Host review: PASS.*inspected scope, evidence and findings/i)
})

test('advanced feature rulebooks remain complete and mechanically bounded', () => {
	const pipeline = read('skills/agentflow/references/ag.md')
	const delegation = read('skills/agentflow/references/delegation.md')
	const streams = read('skills/agentflow/references/streams.md')
	const looper = read('skills/agentflow/references/looper.md')
	assert.match(pipeline, /requirements.*specification.*implementation.*acceptance/s)
	assert.match(pipeline, /all-in.*every optional advisor/i)
	assert.match(delegation, /external-runner-v1/)
	assert.match(delegation, /independent disposable Git clone with no remotes/i)
	assert.match(streams, /finish --prep/)
	assert.match(streams, /finish --deliver/)
	assert.match(looper, /select_frozen_ready_plans/)
})

test('completion does not require or advertise an audit side file', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const completion = read('skills/agentflow/scripts/completion-context.js')
	const writer = read('skills/agentflow/scripts/notebook-write.js')
	const streams = read('skills/agentflow/references/streams.md')
	assert.doesNotMatch(skill, /\.devlog\.audit\.md|Historical audit files/)
	assert.doesNotMatch(completion, /readFileSync\(audit_path/)
	assert.match(streams, /never creates a new audit side file/i)
	assert.doesNotMatch(streams, /staging only its notebook and audit record/i)
	assert.match(writer, /active_config_path\(repository_root, repository_notebook\)/)
	assert.match(completion, /skip-review/)
})

test('worker output and evaluation evidence retain exact safety boundaries', () => {
	for (const name of ['requirements', 'codewalk', 'explore', 'spike', 'spec', 'security-scan', 'acceptance', 'learn']) {
		const source = read(`skills/agentflow/references/advisors/${name}.md`)
		assert.match(source, /Self-check:/)
	}
})
