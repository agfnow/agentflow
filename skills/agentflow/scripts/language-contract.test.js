'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.resolve(__dirname, '../../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

test('the resolved language setting overrides host defaults for Agentflow writing', () => {
	const skill = read('skills/agentflow/SKILL.md')
	const english = read('skills/agentflow/docs/AG_GUIDE.md')
	const chinese = read('skills/agentflow/docs/AG_GUIDE.zh-tw.md')

	assert.match(skill, /configuration\.language.*Agentflow writing/i)
	assert.match(skill, /overrides host\/personal defaults/i)
	assert.match(skill, /answers, devlog records, user documents, code comments, and commits/i)
	assert.match(english, /Language:\*\* `lang: en` or `lang: zh-tw` controls AI-written replies, records, documents, comments, and commits/i)
	assert.match(english, /Your original messages stay as written/i)
	assert.match(chinese, /語言：\*\* `lang: en` 或 `lang: zh-tw` 控制 AI 撰寫的回覆、紀錄、文件、註解和提交訊息/u)
	assert.match(chinese, /你的原話會保留/u)
})

test('delegated workers receive the resolved language as a mandatory brief fact', () => {
	const delegation = read('skills/agentflow/references/delegation.md')

	assert.match(delegation, /output language to the successful startup result's `configuration\.language`/i)
	assert.match(delegation, /overrides a worker or host default/i)
})
