'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const C = require('./feature-common')
const R = require('./looper-report')
const shell = require('./feature-shell')
const continuation = target => process.platform === 'win32' ? `Set-Location -LiteralPath ${shell.psQuote(target)}` : `cd -- ${shell.quote(target)}`
const locale = c => c.settings['use-lang'] || R.resolve_locale()
const chinese = c => /^zh(?:$|[-_](?:tw|hant)(?:[-_]|$))/i.test(locale(c))
const fallback = c => { C.supportedRecordLocale(c.settings); return '' }

function retired(text) { return /^(?:Stream|功能):\s*(?:merged|dropped)|^(?:Session|工作階段):\s*retired/m.test(text || '') }
function scaffold(c) {
  C.supportedRecordLocale(c.settings)
  const zh = chinese(c)
  const labels = zh ? ['專案', '筆記本', '工作目錄', '分支', '目前工作', '已驗證', '下一步', '封存紀錄', '功能', '清理', '工作階段'] : ['Project', 'Notebook', 'Checkout', 'Branch', 'Current', 'Proven', 'Next', 'Archived eras', 'Stream', 'Cleanup', 'Session']
  const values = [path.basename(c.main), `${c.relativeNotebook} — ${zh ? '功能' : 'feature'} ${c.name}`, c.target, c.branch, zh ? 'A-002 等待下一個要求。' : 'A-002 awaiting the next request.', zh ? '已完成功能準備。' : 'Feature preparation complete.', zh ? '等待要求。' : 'Awaiting request.', zh ? '無。' : 'none.', 'open', 'N/A', 'active']
  const heading = zh ? ['提問', '回覆'] : ['Ask', 'Reply']
  const user = C.git(c.target, ['config', 'user.name'], { allowFailure: true }).stdout?.trim().replace(/[()\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ')
  const asker = c.settings['omit-asker'] === 'off' && user ? ` (${user})` : ''
  const text = `# STATUS\n\n${labels.map((label, i) => `${label}: ${values[i]}\n`).join('\n')}\n---\n\n# → ${heading[0]} / A-001${asker}\n\n+ new-feature ${c.name}\n\n${zh ? '準備來源' : 'Preparation provenance'}: ${c.target}; ${c.branch}; ${zh ? '已提交的主線基準' : 'committed main baseline'} \`${c.mainTip}\`.\n\n# → ${heading[1]} / A-001\n\n* _${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' +0000')}_\n\n1. ${zh ? '已建立功能分支與工作目錄' : 'Created feature branch and worktree'}: \`${c.branch}\`, \`${c.target}\`.\n\n2. ${zh ? '在終端機執行下列指令繼續' : 'Run the following command in your terminal to continue'}:\n\n\`\`\`text\n${continuation(c.target)}\n\`\`\`\n\n3. ${zh ? '在編輯器開啟功能筆記本（絕對路徑）' : 'Open the feature notebook in your editor (absolute path)'}: \`${c.notebook}\`.\n\n## ${zh ? '問題（批次列出；每題附建議預設值）' : 'Questions (batched — each with a suggested default)'}\n\n- ${zh ? '無。' : 'None.'}\n\n---\n\n# → ${heading[0]} / A-002${asker}\n`
  return text
}
function history(c) {
  const prefix = `${c.agDir}/features/${c.name}`
  return C.git(c.main, ['ls-tree', '-r', '--name-only', c.mainTip, '--', prefix]).trim()
}
function assertTrackable(c) {
  const paths = [c.relativeNotebook, `${c.agDir}/artifacts/A-001/creation.md`, `${c.agDir}/.tmp/${c.name}.devlog.md/A-001.md`]
  if (c.config.absent) paths.push(`${c.agDir}/ag.json`)
  const result = C.git(c.target, ['check-ignore', '--no-index', '-z', '--stdin'], { allowFailure: true, input: paths.join('\0') + '\0' })
  C.insist(result.status === 1, result.status === 0 ? `Inherited ignore rules hide feature records: ${result.stdout.split('\0').filter(Boolean).join(', ')}; records were not written; reconcile ignore rules with the host, then repeat new-feature ${c.name}` : `Cannot verify feature record ignore rules: ${result.stderr}`)
}
function resumePreparation(old, c) {
  const phases = C.roundHeadings(old)
  if (phases.length !== 1 || phases[0].ask !== 'A-001' || !['Ask', '提問'].includes(phases[0].label)) return null
  const normalized = old.replace(/\r\n/g, '\n')
  const heading = normalized.match(/^# → (?:Ask|提問) \/ A-001(?: \([^\n]*\))?\n/m)
  if (!heading) return null
  const baseline = normalized.match(/(?:committed main baseline|已提交的主線基準) `([0-9a-f]{40,64})`\./)?.[1]
  if (!baseline || baseline !== c.featureTip || C.git(c.main, ['merge-base', '--is-ancestor', baseline, c.mainTip], { allowFailure: true }).status !== 0) return null
  const rendered = scaffold({ ...c, mainTip: baseline, settings: { ...c.settings, 'use-lang': phases[0].label === '提問' ? 'zh-TW' : 'en-US' } })
  const replyStart = rendered.search(/^# → (?:Reply|回覆) \/ A-001$/m)
  const expectedBody = rendered.slice(rendered.search(/^# → (?:Ask|提問) \/ A-001/m), replyStart).replace(/^.*\n/, '').trim()
  const actualBody = normalized.slice(heading.index + heading[0].length).trim()
  if (actualBody !== expectedBody || !normalized.includes(c.target) || !normalized.includes(c.branch) || !/^(Stream|功能): open$/m.test(normalized) || !/^(Session|工作階段): active$/m.test(normalized)) return null
  const newline = old.includes('\r\n') ? '\r\n' : '\n'
  return old + (old.endsWith(newline + newline) ? '' : old.endsWith(newline) ? newline : newline + newline) + rendered.slice(replyStart).replace(/\n/g, newline)
}
async function create(name, options = {}) {
  let c = C.context(options.cwd || process.cwd(), name, 'new-feature')
  C.noOperation(c.main)
  if (!c.registration) {
    C.insist(!history(c), `Historical feature records exist in committed main: ${c.relativeNotebook}; host decision required`)
    C.insist(fs.statSync(C.safePath(c.main, c.agDir)).isDirectory(), 'Configured Agentflow directory required')
    C.localExclude(c.main, '/.wts/')
    C.git(c.main, ['worktree', 'add', '-b', c.branch, c.target, c.mainTip])
    c = C.context(c.main, name, 'new-feature')
  }
  C.assertIdentity(c)
  assertTrackable(c)
  const old = C.readOptional(c.notebook)
  C.insist(!retired(old), `Feature is retired: ${c.notebook}; choose a fresh name`)
  const ownerFile = path.join(path.dirname(c.notebook), `.${path.basename(c.notebook)}.owner`)
  C.insist(!C.exists(ownerFile), `Target feature claim blocks preparation: ${ownerFile}`)
  if (!old) {
    const localHistory = C.git(c.target, ['log', '-1', '--format=%H', '--', `${c.agDir}/features/${c.name}`])
    C.insist(!localHistory && !history(c), 'Missing historical feature notebook; request host reconciliation')
    const dir = path.dirname(c.notebook)
    if (C.exists(dir)) C.insist(!fs.readdirSync(dir).length, `Partial or archived feature records require host reconciliation: ${dir}`)
    fs.mkdirSync(dir, { recursive: true })
  }
  const ask = old ? C.roundHeadings(old).at(-1)?.ask : 'A-001'
  C.insist(ask, 'Feature round identity is missing; request host reconciliation')
  const owner = C.claim(c.notebook, ask)
  let settled = false
  try {
    C.localExclude(c.target, `/${c.agDir}/features/${c.name}/.${c.name}.devlog.md.owner`)
    owner.verify(); C.assertIdentity(c)
    if (old) {
      C.insist(C.readOptional(c.notebook) === old, 'Feature notebook changed during preparation')
      C.insist(old.includes(`committed main baseline`) || old.includes('已提交的主線基準') || old.includes('Preparation provenance:'), 'Existing feature preparation provenance is unproved; continue with host')
      const resumed = resumePreparation(old, c)
      const phases = C.roundHeadings(old)
      const first = phases.slice(0, 3)
      C.insist(resumed || old.includes(c.target) && old.includes(c.branch) && first.length === 3 && first[0].ask === 'A-001' && first[0].label !== first[1].label && first[1].ask === 'A-001' && first[2].ask === 'A-002' && first[0].label === first[2].label && new Set(phases.map(p => `${p.ask}:${p.label}`)).size === phases.length, 'Interrupted, duplicate or foreign preparation requires host reconciliation; records preserved')
      if (resumed) { owner.verify(); C.writeChanged(c.notebook, old, resumed) }
    } else C.writeChanged(c.notebook, null, scaffold(c))
    if (c.config.absent) {
      owner.verify()
      if (c.config.inheritedFrom) C.insist(C.readOptional(c.config.inheritedFrom) === c.config.inheritedSource, 'Main configuration changed during feature preparation; preserve partial state and reconcile with host')
      fs.mkdirSync(path.dirname(c.config.file), { recursive: true })
      C.writeChanged(c.config.file, null, JSON.stringify(c.config.value, null, 2) + '\n')
    }
    owner.verify()
    C.insist(C.readOptional(c.notebook).includes(c.target), 'Prepared notebook readback failed')
    settled = true
  } catch (error) {
    throw Error(`${error.message}\nPreparation retained: ${c.target}, ${c.branch}, notebook ${c.notebook}; owned claim ${owner.path} (${owner.token}). Inspect exact state with the host before handoff/retry; do not remove a claim blindly.`)
  } finally { if (settled) owner.release() }
  const zh = chinese(c)
  let warning = ''
  if (options.open) {
    const configured = c.config.value['default-editor'] ?? 'vscode'
    const command = configured === 'vscode' ? 'code' : configured
    const editor = spawnSync(command, [c.notebook], { cwd: c.target, stdio: 'inherit', windowsHide: true })
    if (editor.error || editor.status !== 0) warning = zh ? `\n\n編輯器未開啟（${editor.error?.message || editor.stderr?.trim() || editor.status}）；功能準備已成功。請手動開啟 ${c.notebook}。` : `\n\nEditor did not open (${editor.error?.message || editor.stderr?.trim() || editor.status}); feature preparation succeeded. Open ${c.notebook} manually.`
  }
  return {
    destination: c.target,
    message: fallback(c) + (zh ? `功能已就緒：${c.target}\n\n筆記本：${c.notebook}${warning}` : `Feature ready: ${c.target}\n\nNotebook: ${c.notebook}${warning}`),
    continuation: (zh ? '接續操作：' : 'Continue: ') + continuation(c.target),
    hint: zh ? '在新的功能工作目錄開啟 coding agent，繼續工作。' : 'Open your coding agent in the new worktree directory to continue working.',
    directHint: zh ? '切換目錄後，開啟 coding agent 繼續工作。' : 'After changing directory, open your coding agent to continue working.',
  }
}
async function drop(name, options = {}) {
  const c = C.context(options.cwd || process.cwd(), name, 'drop-feature')
  if (!c.featureTip) {
    C.insist(!c.registration && !C.exists(c.target), 'Mismatched remaining feature objects; request host reconciliation')
    return { destination: c.main, message: fallback(c) + (chinese(c) ? `功能 ${c.name} 已不存在；工作目錄、登錄與分支均未變更。` : `Feature ${c.name} is already absent; no checkout, registration or branch changed.`) }
  }
  if (!options.abandon) {
    const raw = C.readOptional(path.join(path.dirname(c.notebook), 'merge-state.json'))
    if (raw) {
      const state = JSON.parse(raw)
      if (state.phase === 'complete' && state.main === c.main && state.target === c.target && state.branch === c.branch && state.featureTip === c.featureTip &&
          /^(?:Stream|功能): merged$/m.test(C.readOptional(c.notebook) || '')) {
        C.assertIdentity(c)
        throw Error(chinese(c)
          ? `此功能保留了已完成合併的生命週期紀錄。請執行 agf merge-feature ${c.name} --cleanup 進行已驗證的清理；本次 drop 未變更任何內容。`
          : `This merged feature retains CLI lifecycle records. Run agf merge-feature ${c.name} --cleanup for verified cleanup; this drop made no changes.`)
      }
    }
  }
  const result = C.retire(c, { abandon: Boolean(options.abandon) })
  result.message = fallback(c) + result.message
  return result
}
module.exports = { create, drop, retired, scaffold, assertTrackable, resumePreparation }
