'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const repo_root = path.resolve(__dirname, '../../..')
const read = relative => fs.readFileSync(path.join(repo_root, relative), 'utf8')

const { schema_version } = require('./ag-settings.js')
const public_package = fs.existsSync(path.join(repo_root, '.claude-plugin', 'plugin.json'))

if (public_package) test('public release templates use the validator schema and explain installation readiness', () => {
	const english = read('README.md')
	const chinese = read('README.zh-tw.md')

	assert.match(english, new RegExp(`version-${schema_version}\\b`))
	assert.match(chinese, new RegExp(`版本 ${schema_version}\\b`))
	for (const document of [english, chinese]) {
		assert.match(document, /agf setup/)
		assert.match(document, /Node(?:\.js)? 18|Node 18/i)
		assert.match(document, /Git/i)
		assert.match(document, /godev/)
		assert.match(document, /optional worker|optional worker.*installation failed|選用 worker|安裝失敗/i)
	}
	assert.equal((english.match(/node "\$HOME\/\.(?:codex|claude)\/skills\/agentflow\/scripts\/setup\.js"/g) || []).length, 2)
	assert.doesNotMatch(chinese, /setup\.js/)
	assert.doesNotMatch(english, /AGENTFLOW_SKILL_DIR/)
	assert.doesNotMatch(chinese, /AGENTFLOW_SKILL_DIR/)
})

test('active owner-facing Markdown uses the accepted configuration contract', () => {
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')
	const readme = read('skills/agentflow/scripts/README.md')
	const delegation = read('skills/agentflow/references/delegation.md')
	const setup = read('skills/agentflow/scripts/setup.js')
	const install_hook = read('skills/agentflow/scripts/install-hook.js')

	for (const guide of [english, chinese]) {
		assert.match(guide, new RegExp(`schema-version": ${schema_version}\\b`))
		assert.match(guide, /allow_ag|allow-ag/)
		assert.doesNotMatch(guide, /`metrics: on\|off`/)
		assert.match(guide, /git-timeout-ms/)
		assert.match(guide, /external-workers/)
		assert.match(guide, /pipeline-roles/)
		assert.match(guide, /\[FINAL REPORT\]/)
		assert.doesNotMatch(guide, /schema_version": 1/)
		assert.doesNotMatch(guide, /seven switches|七個設定/)
		assert.doesNotMatch(guide, /## Final report/)
		assert.doesNotMatch(guide, /DO NOT USE Agentflow pipeline/)
		assert.doesNotMatch(guide, /nine switches|九個設定|four-hour|四小時|20 個同時 active|這兩個子指令|beside this guide|就在本指南旁邊|~\/\.claude\/skills\/agentflow\/scripts\/setup\.js/)
		assert.match(guide, /large-work-minutes/)
		assert.doesNotMatch(guide, /docs\/marcom\/(?:USAGE|FAQ|COURSE)\.md/)
		assert.match(guide, /Still to do.*None\.|Still to do.*None/i)
		assert.match(guide, /archive|封存/i)
	}
	assert.match(english, /shared-coverage marker|shared coverage marker/i)
	assert.match(english, /\[RUN-NNN\]|numbered RUN/i)
	assert.match(english, /references\/closeout\.md/)
	assert.match(english, /Each copied round is verified before its original bytes are removed/i)
	assert.match(chinese, /shared-coverage marker/i)
	assert.match(chinese, /RUN 事件/)
	assert.match(chinese, /references\/closeout\.md/)
	assert.match(chinese, /每個對話都先核對位元組與雜湊，再移除原本的副本/)
	assert.doesNotMatch(chinese, /最後核實日期|十六題|十四題|gemma4:e4b-mlx/)
	for (const guide of [english, chinese]) {
		assert.match(guide, /gpt-5\.6-sol\/low/)
		assert.match(guide, /youtu\.be\/0dp_HnqX0ms/)
		assert.match(guide, /npx skills update agentflow/)
		assert.match(guide, /crontab/)
	}
	assert.doesNotMatch(english, /disposable worktree|throwaway worktree/)
	assert.doesNotMatch(chinese, /拋棄式 worktree/)
	assert.doesNotMatch(`${setup}\n${install_hook}`, /~\/\.claude\/skills\/agentflow\/scripts\/setup\.js/)
	assert.match(install_hook, /node_path\.join\(__dirname, 'setup\.js'\)/)

	assert.match(english, /Direct route/)
	assert.match(english, /Selected-advisor route/)
	assert.match(english, /Full-pipeline route/)
	assert.match(english, /Blocked route/)
	for (const concept of ['no delegation', 'make-plans', 'run-plans', 'run-looper', 'feature stream', 'skip-review:']) assert.ok(english.includes(concept), concept)
	assert.match(chinese, /direct route/)
	assert.match(chinese, /selected-advisor route/)
	assert.match(chinese, /full-pipeline route/)
	assert.match(chinese, /blocked route/)
	for (const concept of ['no delegation', 'make-plans', 'run-plans', 'run-looper', 'feature stream', 'skip-review:']) assert.ok(chinese.includes(concept), concept)
	assert.match(english, /answers multiple requests in your original order/i)
	assert.match(chinese, /依照你提出要求的原始順序/)
	assert.match(english, /succeeded.*failed.*limited/i)
	assert.match(chinese, /成功.*失敗.*限制/)
	assert.match(readme, new RegExp(`Version ${schema_version}\\b`, 'i'))
	assert.match(readme, /pipeline-roles/)
	assert.match(readme, /planning-only frozen/)
	assert.match(readme, /external-runner\.js/)
	assert.doesNotMatch(readme, /schema_version|pipeline_roles|external_workers/)
	assert.doesNotMatch(delegation, /20-minute deadline|45-minute deadline/i)
	assert.match(delegation, /Do not impose a fixed elapsed-time deadline/)
	assert.match(delegation, /ten-minute checkpoint interval is reporting cadence only/)
	assert.match(delegation, /Silent reasoning or unchanged files alone never prove a hang/)
	assert.match(delegation, /launcher wrapper.*(?:does not|without) copying|launcher wrapper.*repeat neither/i)
	assert.match(delegation, /owner explicitly selects an exact model or model-and-effort combination.*pauses for owner approval.*never substitute another model automatically/i)
	assert.doesNotMatch(delegation, /owner-selected model never substitutes without owner approval/i)
	assert.doesNotMatch(delegation, /coordinator runs the suite personally, every time/i)
})

test('current guidance uses live devlog records and public command entry points only', () => {
	const public_readmes = public_package ? ['README.md', 'README.zh-tw.md'] : []
	const public_english_readme = public_package ? read(public_readmes[0]) : ''
	const current_guidance = [
		...public_readmes,
		'skills/agentflow/SKILL.md',
		'skills/agentflow/references/ag.md',
		'skills/agentflow/references/streams.md',
		'skills/agentflow/references/looper.md',
		'skills/agentflow/docs/AG_GUIDE.md',
		'skills/agentflow/docs/AG_GUIDE.zh-tw.md',
		'skills/agentflow/scripts/README.md',
	].map(read)

	for (const document of current_guidance) {
		assert.doesNotMatch(document, /runlog(?:\.md)?|run log/i)
		assert.doesNotMatch(document, /node\s+(?:"?\$[A-Z_]+\/)?(?:skills\/agentflow\/)?scripts\/(?:agf|looper|setup|install-hook|ag-settings)\.js/i)
	}
	assert.doesNotMatch(public_english_readme, /runlog(?:\.md)?|run log/i)
	if (public_package) assert.equal((public_english_readme.match(/node "\$HOME\/\.(?:codex|claude)\/skills\/agentflow\/scripts\/setup\.js"/g) || []).length, 2)
})

test('looper operation guidance is loaded only by explicit run triggers', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const looper = read('skills/agentflow/references/looper.md')
	assert.match(skill, /`run-looper` means: read `references\/looper\.md`/)
	assert.match(skill, /`run-plans` means: read the same reference/)
	assert.doesNotMatch(skill, /^### Running a planned queue for the owner$/mu)
	for (const fact of [/handwritten queue/i, /make-plans/i, /--dump/, /--reset/, /looper-live-gate\.js/]) assert.match(looper, fact)
	assert.match(skill, /`allow-ag: off` blocks AG without asking to start it/i)
	assert.match(skill, /Triggers never change settings/i)
	assert.match(read('skills/agentflow/references/ag.md'), /route trigger is not a settings change and never overrides `off`/i)
})

test('workspace layout instructions are explicit across the complete impact inventory', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const streams = read('skills/agentflow/references/streams.md')
	const pipeline = read('skills/agentflow/references/ag.md')
	const looper = read('skills/agentflow/references/looper.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	assert.match(skill, /workspace_instruction_inventory/)
	assert.match(skill, /workspace_layout_change/)
	assert.match(skill, /<workspace-dir>\/features\/<taskkey>\/<taskkey>\.devlog\.md/)
	assert.match(streams, /\$workspace_dir\/\.tmp\/features\/<taskkey>/)
	assert.match(skill, /<workspace-dir>\/artifacts\/<work-key>/)
	assert.match(pipeline, /<work-root>\/tracker\.md/)
	assert.match(looper, /\$workspace_dir\/planned/)
	for (const guide of [english, chinese]) {
		assert.match(guide, /\.agentflow\/devlog\.md/)
		assert.match(guide, /\.agentflow\/features/)
		assert.match(guide, /workspace-dir/)
	}
})

test('continuation controls retain the canonical Reply boundary', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	assert.match(skill, /continue`\/`next` only re-read and resume/)
	assert.match(skill, /writer supplies `# ← Reply \/ A-NNN`/)
})

test('the skill requires canonical tracker generation and validation', () => {
	const front = read('skills/agentflow/SKILL.md')
	assert.match(front, /Read `references\/progress\.md` before decomposing work, recording a material result, or reaching ten active minutes/)
	const skill = front + '\n' + read('skills/agentflow/references/progress.md')
	assert.match(skill, /tracker-contract\.js template/)
	assert.match(skill, /tracker-contract\.js validate --refresh --repo <repo> --tracker <path>/)
	assert.match(skill, /— I-063/)
})

test('startup and closeout guidance contains the complete fast-path contract', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	for (const field of ['version', 'notebook', 'ask', 'run_events', 'reply', 'status', 'allowed_paths', 'commit_message', 'delivery']) {
		assert.match(skill, new RegExp(`"${field}"`))
	}
	assert.match(skill, /next_run_id/)
	assert.match(skill, /and changed paths/)
	assert.match(skill, /setup-created `.gitignore` and `ag.json`/)
	assert.match(skill, /Never use a pseudo-terminal or `tty: true`/)
	assert.match(skill, /writer owns numbering and time/)
	assert.match(skill, /Successful `agf close` is the final preflight/)
	assert.match(skill, /Do not repeat it after successful `agf close`/)
})

test('the incident-derived closeout stop rule prevents recursive final review', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const incidents = read('skills/agentflow/docs/incidents-log.md')
	assert.match(skill, /Closeout stop rule:/)
	assert.match(skill, /record-only corrections need only the mechanical completion check/)
	assert.match(skill, /Repeated final validation of unchanged implementation is a protocol defect/)
	assert.match(skill, /reviewer performs its assigned review directly/)
	assert.match(skill, /never invokes Agentflow for the reviewed repository/)
	assert.match(skill, /never delegates or launches another reviewer/)
	assert.match(skill, /— I-072/)
	assert.match(incidents, /I-072 — 2026-09-03 — exact-commit certainty caused a recursive final-review loop/)
})

test('user-facing terminal changes require reusable real-person PTY journeys', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	assert.match(skill, /Before completing any new or changed user-facing terminal feature or control, run a reusable real PTY journey/)
	assert.match(skill, /terminal identity, visible input and output, process exit status, and resulting repository or configuration state/)
	assert.match(skill, /model-backed journey uses the configured cheap model tier/)
	assert.match(skill, /Unit tests and headless process tests do not replace this journey/)
})

test('consequential-work controls are visible in both owner guides', () => {
	for (const guide of [read('skills/agentflow/docs/AG_GUIDE.md'), read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')]) {
		for (const control of ['Design Go:', 'Outcome', 'Minimality', 'Conformance', 'Result Go:', '3ways']) assert.ok(guide.includes(control), control)
		assert.match(guide, /journey|旅程/i)
		assert.match(guide, /host gate/i)
	}
})

test('minimality challenges and Taipei timestamps stay aligned across active guidance', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const acceptance = read('skills/agentflow/references/advisors/acceptance.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	for (const document of [skill, english, chinese]) {
		assert.match(document, /Minimality check/)
	}
	assert.match(skill, /writer owns numbering and time/)
	for (const guide of [english, chinese]) assert.match(guide, /YYYY-MM-DD HH:MM:SS ±HHMM/)
	for (const document of [skill, acceptance, english, chinese]) {
		assert.match(document, /delet|remove|刪除/i)
		assert.match(document, /combin|合併/i)
		assert.match(document, /reuse|existing behavior|現有行為/i)
		assert.match(document, /Minimality: BLOCKING/)
	}
})

test('live devlog, merge-conflict recovery, and proportional cross-check guidance stay aligned', () => {
	const skill = read('skills/agentflow/SKILL.md') + '\n' + read('skills/agentflow/references/closeout.md')
	const delegation = read('skills/agentflow/references/delegation.md')
	const streams = read('skills/agentflow/references/streams.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	for (const document of [skill, english, chinese]) {
		assert.match(document, /narrow/i)
		assert.match(document, /targeted/i)
		assert.match(document, /full/i)
		assert.match(document, /skip-review/i)
	}
	assert.match(delegation, /cross-check-plan\.js/)
	assert.match(delegation, /complete relevant suite once/i)
	for (const document of [skill, english, chinese]) assert.match(document, /owner conversation and live recovery|what you asked, short numbered RUN|即時 RUN 事件/i)
	for (const document of [streams, english, chinese]) {
		assert.match(document, /merge --continue/)
		assert.match(document, /finish --prep/)
		assert.match(document, /finish --deliver/)
	}
})

test('named-advisor guidance states the complete parser and route contract', () => {
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	for (const guide of [english, chinese]) {
		assert.match(guide, /advisors:\s*requirements,\s*codewalk,\s*spec/)
		assert.match(guide, /requirements.*codewalk.*explore.*spike.*spec.*security-scan.*acceptance.*learn/s)
		assert.match(guide, /trailing comma|尾逗號/i)
		assert.match(guide, /non-string|非字串/i)
		assert.match(guide, /parser order|typed order|解析順序|輸入順序/i)
		assert.match(guide, /dependency-safe|dependency.*order|相依安全|相依性/i)
		assert.match(guide, /named material question|具名.*問題/i)
		assert.match(guide, /before any advisor starts|任何 advisor.*啟動前/i)
		assert.match(guide, /requirements-only|selecting only.*requirements|只選.*requirements/i)
	}

	assert.doesNotMatch(english, /advisors?:.*best effort|advisor selection is only a hint/i)
	assert.doesNotMatch(chinese, /advisor.*只是建議|選擇.*僅供參考/i)
})
