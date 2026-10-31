'use strict'

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const C = require('./feature-common')
const S = require('./looper-state')
const { insist, exists, safePath, readOptional, git } = C
const activation = 'At session start, the owner-facing host must load and follow agentflow via supported skill discovery, honoring explicit owner opt-outs. If unavailable, report it; never assume paths or install it. Delegates follow assignments without activating agentflow.'
const baseline = dir => `Read agentflow's \`references/project-rules.md\` from the resolved skill or exact host-supplied text, then \`${dir}/rules.md\` if present; unavailable baseline defers shared-record writes and invariant/review acceptance. Report the gap and continue independent authorized work. Reading rules does not activate agentflow.`
function observedLocale() {
  const candidates = []
  if (process.platform === 'darwin') {
    const result = spawnSync('/usr/bin/defaults', ['read', '-g', 'AppleLocale'], { encoding: 'utf8', timeout: 5000 })
    if (!result.error && result.status === 0) candidates.push(result.stdout.trim())
  }
  if (process.platform === 'win32') {
    const result = spawnSync(S.powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(Get-Culture).Name'], { cwd: os.homedir(), encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (!result.error && result.status === 0) candidates.push(result.stdout.trim())
  }
  candidates.push(process.env.LC_ALL, process.env.LC_MESSAGES, process.env.LANG)
  for (const value of candidates) {
    const clean = value?.split(/[.@]/)[0].replaceAll('_', '-').toLowerCase()
    if (clean && !['c', 'posix'].includes(clean) && /^[a-z]+(?:-[a-z0-9]+)*$/.test(clean)) return clean
  }
  return 'en-us'
}
function locale(value) {
  const input = (value || observedLocale()).toLowerCase().replaceAll('_', '-')
  insist(/^[a-z]+(?:-[a-z0-9]+)*$/.test(input), `Invalid initialization locale: ${input}; use a locale tag such as en-US.`)
  if (/^en(?:-|$)/.test(input) || /^zh(?:$|-tw(?:-|$)|-hant(?:-|$))/.test(input)) return input
  return /^zh(?:-|$)/.test(input) ? 'zh-tw' : 'en-us'
}
function adopt(file, old, next, stat) {
  const verify = () => {
    insist(readOptional(file) === old, `AGENTS source changed: ${file}; reconcile before retry`)
    const current = S.checked_file(file)
    insist(current.ino === stat.ino && current.dev === stat.dev && current.mode === stat.mode && current.uid === stat.uid && current.nlink === 1, 'AGENTS identity or permissions changed; preserve state for host review')
  }
  verify()
  const temporary = `${file}.tmp-${crypto.randomUUID()}`
  const fd = fs.openSync(temporary, 'wx', stat.mode & 0o7777)
  try { fs.writeFileSync(fd, next); fs.fchmodSync(fd, stat.mode & 0o7777); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
  verify()
  fs.renameSync(temporary, file)
}

function instructions(old, dir, zh) {
  if (old && /(?:agentflow|aglite)/i.test(old)) {
    insist(!/(?:\.\.?\/|\/Users\/|[A-Z]:\\).*?(?:SKILL\.md|agentflow)/i.test(old), 'Existing AGENTS skill path requires host adoption review')
    insist(/owner-facing host|host-only|session host/i.test(old) && /project-rules\.md/.test(old) && old.includes(`${dir}/rules.md`), 'Existing Agentflow instructions require host adoption review; preserved unchanged')
    return old
  }
  insist(!old || !/(?:backlog|sys[- ]invariants?|shared[- ](?:rules|records)|project[- ]rules|(?:`|\/)rules\.md)/i.test(old), 'Existing shared-authority directives require host adoption review')
  const lines = zh
    ? ['擁有者的主代理須在工作階段開始時，透過支援的技能探索載入並遵循 agentflow，尊重明確的停用指示。若無法取得技能，請回報；不得假設路徑或自行安裝。受委派代理只執行指派工作，不啟動 agentflow。', `所有專案代理與審查者在工作或審查前，須讀取已解析 agentflow 技能的 \`references/project-rules.md\` 或主代理提供的完整原文，再讀取 \`${dir}/rules.md\`（若存在）。無法取得共用基準時，回報缺漏並延後共用紀錄寫入與不變條件／審查驗收；可繼續獨立且已授權的工作。讀取規則不會啟動 agentflow。`]
    : [activation, baseline(dir)]
  const newline = old?.includes('\r\n') ? '\r\n' : '\n'
  const addition = lines.join(newline + newline) + newline + newline
  if (!old) return addition
  let offset = 0
  const frontmatter = old.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (/^---\r?\n/.test(old)) { insist(frontmatter, 'Unclosed AGENTS frontmatter'); offset = frontmatter[0].length }
  const title = old.slice(offset).match(/^(?:\r?\n)*# [^\n]*(?:\n|$)/)
  if (title) offset += title[0].length
  while (old.slice(offset).startsWith(newline)) offset += newline.length
  return old.slice(0, offset) + (offset && !old.slice(0, offset).endsWith(newline + newline) ? newline : '') + addition + old.slice(offset)
}
function complete(root, config) {
  const dir = config.agDir, name = config.settings['notebook-name'] || (() => { const stem = path.basename(root).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32).replace(/-$/, ''); return stem ? `${stem}.devlog.md` : 'devlog.md' })()
  for (const file of [`${dir}/${name}`, `${dir}/backlog.md`, `${dir}/sys-invariants.md`, 'AGENTS.md']) S.checked_file(safePath(root, file))
  for (const sub of ['artifacts', 'features', '.tmp']) insist(fs.statSync(safePath(root, `${dir}/${sub}`)).isDirectory(), `Missing setup directory: ${dir}/${sub}`)
  const text = readOptional(safePath(root, `${dir}/${name}`))
  const headings = C.roundHeadings(text), tail = headings.slice(-3)
  insist(/^# STATUS\r?$/m.test(text) && tail.length === 3 && tail[0].ask === tail[1].ask && tail[0].label !== tail[1].label && tail[0].label === tail[2].label && Number(tail[2].ask.slice(2)) === Number(tail[1].ask.slice(2)) + 1, 'Incomplete notebook; host reconciliation required')
  const agents = readOptional(safePath(root, 'AGENTS.md'))
  insist(/agentflow/i.test(agents) && agents.includes('references/project-rules.md') && agents.includes(`${dir}/rules.md`), 'Incomplete AGENTS adoption; continue with host')
}
function scan(root) {
  function visit(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(ent.name)) continue
      const file = path.join(dir, ent.name)
      insist(!(/^(?:.*\.devlog\.md|devlog\.md|.*\.archive\.md|backlog\.md|sys-invariants\.md|.*\.owner|\.aglite-records|\.agentflow)$/i.test(ent.name)), `Existing records or ownership require host reconciliation: ${file}`)
      if (ent.isDirectory() && !exists(path.join(file, '.git'))) visit(file)
    }
  }
  visit(root)
}
function repository(root, fresh = false) {
  const probe = git(root, ['rev-parse', '--show-toplevel'], { allowFailure: true })
  if (probe.status !== 0) {
    insist(!exists(path.join(root, '.git')), 'Invalid Git metadata; inspect retained repository state')
    const bare = git(root, ['rev-parse', '--is-bare-repository'], { allowFailure: true })
    insist(!bare.error && bare.stdout?.trim() !== 'true', 'Git is unavailable or this is a bare repository; initialization stopped')
    insist(probe.status === 128 && /not a git repository/i.test(probe.stderr || ''), 'Unexplained Git discovery failure; initialization stopped')
    if (!fresh) return false
    git(root, ['init'])
  } else insist(fs.realpathSync(probe.stdout.trim()) === root, 'Run initialization at the physical Git root; nested folders are unsupported')
  insist(fs.lstatSync(path.join(root, '.git')).isDirectory(), 'Linked worktrees and redirected Git directories require host setup')
  insist(git(root, ['rev-parse', '--is-bare-repository']) === 'false', 'Bare repository unsupported')
  const branch = git(root, ['symbolic-ref', '--short', 'HEAD'])
  insist(!branch.startsWith('feature/'), 'Managed feature setup belongs to the feature lifecycle')
  C.noOperation(root)
  const head = git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
  if (head.status !== 0) insist(!git(root, ['for-each-ref', '--format=%(refname)']), 'Unborn repository with refs requires reconciliation')
  return true
}
function detect() {
  // npm .cmd shims cannot be probed without shell interpretation; do not guess Windows routes.
  if (process.platform === 'win32') return null
  for (const [provider, family] of [['codex', 'openai'], ['claude', 'claude']]) {
    const result = spawnSync(provider, ['--version'], { cwd: os.homedir(), encoding: 'utf8', timeout: 5000, windowsHide: true })
    if (!result.error && result.status === 0) return { kind: 'cli', provider, 'model-family': family }
  }
  return null
}
function recordedHistory(root, agentsPresent) {
  const head = git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).status === 0
  const staged = git(root, ['ls-files', '-z']).split('\0').filter(Boolean)
  const committed = head ? git(root, ['ls-tree', '-r', '--name-only', '-z', 'HEAD']).split('\0').filter(Boolean) : []
  for (const file of new Set([...staged, ...committed])) {
    const folded = file.toLowerCase()
    if (folded === 'agents.md') { insist(agentsPresent, 'Recorded AGENTS.md is missing; host history reconciliation required'); continue }
    insist(folded !== '.agentflow' && !folded.startsWith('.agentflow/') && !folded.startsWith('agents.md/') && !/^(?:.*\/)?(?:.*\.devlog\.md|devlog\.md|.*\.archive\.md|backlog\.md|sys-invariants\.md)$/i.test(file), `Recorded setup history requires host reconciliation: ${file}`)
    if (path.posix.basename(folded) !== 'ag.json' || folded.split('/').includes('node_modules')) continue
    for (const reference of [...(staged.includes(file) ? [`:${file}`] : []), ...(committed.includes(file) ? [`HEAD:${file}`] : [])]) {
      const text = git(root, ['show', reference], { allowFailure: true })
      insist(text.status === 0, `Recorded configuration is unresolved: ${file}`)
      let value
      try { value = JSON.parse(text.stdout) } catch { throw Error(`Recorded configuration requires host reconciliation: ${file}`) }
      const parent = path.posix.dirname(folded), effective = value?.switches?.['ag-dir'] || '.agentflow'
      insist(typeof effective === 'string', `Recorded configuration requires host reconciliation: ${file}`)
      insist(![effective.toLowerCase(), '.', '.agentflow'].includes(parent), `Recorded configuration/history requires host reconciliation: ${file}`)
    }
  }
}
function preflight(root, hasGit, generated, agentsPresent) {
  if (hasGit) recordedHistory(root, agentsPresent)
  for (const key of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) git(root, ['var', key])
  if (!hasGit) {
    try { repository(root, true) } catch (error) { throw Error(`${error.message}\nGit initialization may have retained state at ${root}; host reconciliation is required before retry.`) }
  }
  const result = git(root, ['check-ignore', '--no-index', '-z', '--stdin'], { allowFailure: true, input: generated.join('\0') + '\0' })
  insist(result.status === 1, `Generated setup paths are ignored or ignore inspection failed: ${result.stdout?.split('\0').filter(Boolean).join(', ') || result.stderr?.trim()}${!hasGit ? '; authorized Git initialization retained; no Agentflow reservation or scaffold was created' : ''}`)

}
function initialize({ cwd = process.cwd(), lang, invocation = ['agf', 'init', ...(lang ? ['--lang', lang] : [])] } = {}) {
  insist(Number(process.versions.node.split('.')[0]) >= 20, 'Initialization requires Node.js 20 or later')
  const root = fs.realpathSync(cwd)
  insist(!/[\x00-\x1f\x7f]/.test(root), 'Control characters in project paths are unsupported')
  const config = C.discover(root, { allowAbsent: true })
  const hasGit = repository(root)
  if (!config.absent) {
    // No claims, symlinks or ambiguous history may be hidden by a nominal config.
    function claims(dir) { for (const ent of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, ent.name); insist(!ent.isSymbolicLink() && !ent.name.endsWith('.owner'), `Unsafe path or retained ownership: ${file}`); if (ent.isDirectory()) claims(file) } }
    claims(safePath(root, config.agDir)); complete(root, config)
    const displayLocale = locale(lang || config.settings['use-lang'])
    return { skipped: true, message: displayLocale.startsWith('zh') ? '已完成初始化；未變更任何檔案。' : 'Already initialized; no files changed.' }
  }
  const selected = locale(lang), zh = selected.startsWith('zh')
  scan(root)
  const agents = safePath(root, 'AGENTS.md'), oldAgents = readOptional(agents), nextAgents = instructions(oldAgents, '.agentflow', zh)
  const agentsStat = oldAgents === null ? null : S.checked_file(agents)
  if (agentsStat) {
    insist(agentsStat.nlink === 1 && (!process.getuid || agentsStat.uid === process.getuid()), 'AGENTS must be singly linked and owned by the current user; host adoption required')
    insist(fs.readFileSync(agents).equals(Buffer.from(oldAgents, 'utf8')), 'AGENTS contains non-UTF-8 bytes; host adoption required to preserve them')
  }
  const value = config.value
  value.switches['use-lang'] = selected
  const route = detect()
  value['looper-routes'] = route ? Object.fromEntries(['task', 'repair', 'acceptance'].map(key => [key, { ...route }])) : {}
  if (oldAgents !== null && oldAgents !== nextAgents) {
    insist(hasGit && git(root, ['ls-files', '--error-unmatch', '--', 'AGENTS.md'], { allowFailure: true }).status === 0, 'Untracked existing AGENTS.md requires host adoption; owner contents excluded from setup delivery')
    insist(!git(root, ['diff', '--cached', '--name-only', '--', 'AGENTS.md']), 'Staged AGENTS.md requires host adoption; index preserved')
    insist(!git(root, ['diff', '--name-only', '--', 'AGENTS.md']), 'Modified AGENTS.md requires host adoption; owner contents excluded from setup delivery')
  }
  const planned = ['.agentflow/ag.json', `.agentflow/${value.switches['notebook-name']}`, '.agentflow/backlog.md', '.agentflow/sys-invariants.md', ...['artifacts', 'features', '.tmp'].map(sub => `.agentflow/${sub}/.gitkeep`), ...(oldAgents !== nextAgents ? ['AGENTS.md'] : [])]
  preflight(root, hasGit, planned, oldAgents !== null)
  const dir = safePath(root, '.agentflow')
  // Exclusive reservation is also the interruption marker. Never remove it on failure.
  fs.mkdirSync(dir)
  const token = crypto.randomUUID(), pending = safePath(root, '.agentflow/.init-pending.owner')
  const ownership = JSON.stringify({ session: token, ask: 'A-001', invocation, claimed_at: new Date().toISOString() }) + '\n'
  fs.writeFileSync(pending, ownership, { flag: 'wx', mode: 0o600 })
  const verify = () => insist(readOptional(pending) === ownership, 'Initialization ownership changed; stop and reconcile retained state')
  try {
  repository(root, true)
  const index = git(root, ['ls-files', '--stage', '-z'])
  if (git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).status !== 0) {
    git(root, ['commit', '--allow-empty', '--only', '-m', 'chore: initialize repository'])
    insist(git(root, ['ls-files', '--stage', '-z']) === index && !git(root, ['ls-tree', '-r', '--name-only', 'HEAD']) && git(root, ['rev-list', '--parents', '-1', 'HEAD']).split(' ').length === 1, 'Unexpected bootstrap effects; retain state and inspect')
  }
  const name = value.switches['notebook-name'], notebook = `.agentflow/${name}`, branch = git(root, ['symbolic-ref', '--short', 'HEAD']), now = new Date().toISOString()
  verify()
  const baseHead = git(root, ['rev-parse', 'HEAD'])
  let expectedHead = baseHead
  const verifyIdentity = () => {
    verify(); repository(root)
    insist(git(root, ['symbolic-ref', '--short', 'HEAD']) === branch && git(root, ['rev-parse', 'HEAD']) === expectedHead, 'Git branch or HEAD changed; retain initialization state for host reconciliation')
  }
  const status = zh ? `# STATUS\n\n專案: ${path.basename(root)}\n\n筆記本: ${notebook} — 根目錄\n\n工作目錄: ${root}\n\n分支: ${branch}\n\n目前工作: A-002 等待下一個請求。\n\n已驗證: 已建立初始檔案；僅在 .agentflow/.init-pending.owner 仍存在時須核對復原。\n\n下一步: 等待請求。\n\n封存紀錄: 無。` : `# STATUS\n\nProject: ${path.basename(root)}\n\nNotebook: ${notebook} — root\n\nCheckout: ${root}\n\nBranch: ${branch}\n\nCurrent: A-002 awaiting the next request.\n\nProven: setup files created; reconcile only if .agentflow/.init-pending.owner remains.\n\nNext: awaiting request.\n\nArchived eras: none.`
  const command = invocation.join(' ')
  const invocationText = '+ ' + command
  const excerpt = Array.from(command).slice(0, 100).join('') + (Array.from(command).length > 100 ? '...' : '')
  const timestamp = now.replace('T', ' ').replace(/\.\d+Z$/, ' +0000')
  const invariantHeading = zh ? '系統不變條件變更' : 'System invariant changes'
  const invariantNotice = zh ? '尚無已接受的 ID；已建立空白初始紀錄，未建立任何持續保證。' : 'No accepted IDs; empty scaffold created. No durable guarantee established.'
  const note = `${status}\n\n---\n\n# → ${zh ? '提問' : 'Ask'} / A-001\n\n${invocationText}\n\n# → ${zh ? '回覆' : 'Reply'} / A-001\n\n* _${timestamp}_\n\n1. ${excerpt}\n\n   ${(zh ? ['初始化程式已建立初始檔案。待處理標記仍存在時，須由主代理核對，不能視為初始化完成。', '未執行模型呼叫或代理審查。', '主代理仍須處理擁有者請求、版本檢查、命令綁定及設定的交付。未建立遠端或推送。'] : ['Initialization program created setup files. While the pending ownership marker remains, initialization is not complete and requires host reconciliation.', 'No model call or agent review was performed.', 'The host still handles owner input, release checks, command binding and configured delivery. No remote or push was performed.']).join('\n\n   ')}\n\n## ${invariantHeading}\n\n${invariantNotice}\n\n## ${zh ? '問題（批次列出；每題附建議預設值）' : 'Questions (batched — each with a suggested default)'}\n\n- ${zh ? '無。' : 'None.'}\n\n---\n\n# → ${zh ? '提問' : 'Ask'} / A-002\n`

  const files = { '.agentflow/ag.json': JSON.stringify(value, null, 2) + '\n', [notebook]: note }
  for (const file of ['backlog.md', 'sys-invariants.md']) files[`.agentflow/${file}`] = zh ? (file === 'backlog.md' ? '# 待辦事項\n\n可執行的未來工作，不是執行佇列。推定事項為提案；擁有者同意延後的事項為待辦。排程須有擁有者授權。每個 B-NNN 項目須記錄來源／提問、預期成果、未結原因及預估工作量或下一個決策。移除前先在筆記本記錄已證明的完成結果。\n\n目前沒有未結事項。\n' : '# 系統不變條件\n\n只記錄已接受的持續保證；不得由程式碼或提案推定授權。重用既有權威契約。每個穩定 SYS-INV-n 項目須說明適用範圍／起始條件、保證與違反情形、權威來源及具體證明。各輪結果留在工作紀錄。內容變更遵循已解析 agentflow 技能 references/delivery.md 的通知規則及專案規則。\n\n不變條件通知：尚無已接受的 ID；已建立空白初始紀錄。\n') : fs.readFileSync(path.join(__dirname, '../assets/.agentflow', file), 'utf8')
  if (!zh) files['.agentflow/sys-invariants.md'] = files['.agentflow/sys-invariants.md'].replace('No accepted guarantees recorded yet.', 'Invariant notice: no accepted IDs; empty scaffold created.')
  for (const sub of ['artifacts', 'features', '.tmp']) { verify(); fs.mkdirSync(safePath(root, `.agentflow/${sub}`)); files[`.agentflow/${sub}/.gitkeep`] = '' }
  for (const [relative, text] of Object.entries(files)) { verify(); const file = safePath(root, relative); fs.writeFileSync(file, text, { flag: 'wx' }); insist(readOptional(file) === text, `Scaffold verification failed: ${file}`) }
  verify()
  if (oldAgents === null) fs.writeFileSync(agents, nextAgents, { flag: 'wx' })
  else if (oldAgents !== nextAgents) adopt(agents, oldAgents, nextAgents, agentsStat)
  insist(readOptional(agents) === nextAgents, 'AGENTS adoption verification failed')
  verify(); complete(root, config)
  const generated = [...Object.keys(files), ...(oldAgents !== nextAgents ? ['AGENTS.md'] : [])]
  const verifyGenerated = () => {
    verifyIdentity()
    for (const [relative, text] of Object.entries(files)) insist(readOptional(safePath(root, relative)) === text, `Generated source changed: ${relative}; retain state for reconciliation`)
    insist(readOptional(agents) === nextAgents, 'AGENTS changed; retain state for reconciliation')
  }
  if (value.switches['auto-commit'] === 'on') {
    // --only preserves unrelated index entries and never includes owner files.
    verifyGenerated()
    git(root, ['add', '--', ...generated])
    verifyGenerated()
    git(root, ['commit', '--only', '-m', 'chore: initialize agentflow', '--', ...generated])
    expectedHead = git(root, ['rev-parse', 'HEAD'])
    insist(git(root, ['rev-list', '--parents', '-1', 'HEAD']) === `${expectedHead} ${baseHead}`, 'Unexpected setup commit ancestry; retain state and inspect')
    const changed = git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').filter(Boolean).sort()
    insist(JSON.stringify(changed) === JSON.stringify([...generated].sort()), 'Unexpected setup commit paths; retain state and inspect')
    const unrelated = raw => raw.split('\0').filter(entry => entry && !generated.includes(entry.slice(entry.indexOf('\t') + 1))).join('\0')
    insist(unrelated(git(root, ['ls-files', '--stage', '-z'])) === unrelated(index), 'Unexpected index effects; retain state and inspect')
    insist(git(root, ['diff', '--cached', '--quiet', 'HEAD', '--', ...generated], { allowFailure: true }).status === 0 && git(root, ['diff', '--quiet', 'HEAD', '--', ...generated], { allowFailure: true }).status === 0, 'Generated delivery differs from committed bytes; retain state and inspect')
  }
  verifyGenerated()
  const receipt = safePath(root, `.git/agf-init-completed-${token}.json`)
  insist(!exists(receipt), 'Initialization receipt collision; retain ownership for host reconciliation')
  fs.renameSync(pending, receipt)
  insist(readOptional(receipt) === ownership && !exists(pending), 'Ownership retirement unproved; inspect retained state')
  return { notebook: safePath(root, notebook), message: zh ? `## ${invariantHeading}\n\n${invariantNotice}\n\n已初始化 ${notebook}。請在 A-002 填寫下一個請求。${route ? '' : (process.platform === 'win32' ? 'Windows CLI 控制尚未驗證；執行路由維持空白，分組執行前須由主代理設定。尚未實測原生 Windows 執行。' : '未偵測到 Codex／Claude CLI；執行路由為空，分組執行前須由主代理設定。')}主代理仍須處理版本檢查、命令綁定及設定的交付；未建立遠端或推送。` : `## ${invariantHeading}\n\n${invariantNotice}\n\nInitialized ${notebook}. Write the next request in A-002. ${route ? '' : (process.platform === 'win32' ? 'Windows CLI controls are unverified; execution routes remain empty and require host configuration before looper work. Native Windows execution is unobserved. ' : 'No Codex/Claude CLI detected; execution routes are empty and require host configuration before looper work. ')}The host still handles release checks, command binding and configured delivery; no remote or push performed.` }
  } catch (error) { throw Error(`${error.message}\nInitialization state retained: ${pending}. Have the host reconcile the actual Git/index/files and this ownership marker before retry; do not delete it or infer completion.`) }
}
module.exports = { initialize, locale }
