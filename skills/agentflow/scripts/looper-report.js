'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { pathToFileURL } = require('node:url')
const S = require('./looper-state')

// Presentation observes saved state; it never owns scheduling or retries.
const copy = value => JSON.parse(JSON.stringify(value))
const clean = value => String(value ?? '').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '?')
  .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})\b/g, '[redacted]')
  .replace(/(Bearer\s+|(?:api[_-]?key|access[_-]?token|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]')
const resolve_locale = locale => locale || Intl.DateTimeFormat().resolvedOptions().locale
const supported_locale = locale => /^(?:en(?:[-_]|$)|zh(?:$|[-_](?:tw|hant)(?:[-_]|$)))/i.test(resolve_locale(locale))
const language = locale => /^zh(?:$|[-_](?:tw|hant)(?:[-_]|$))/i.test(resolve_locale(locale)) ? 'zh' : 'en'
const words = {
  en: {
    complete: 'COMPLETE — all groups checked and integrated', blocked: 'BLOCKED — work remains',
    stopped: 'STOPPED — work preserved', error: 'ERROR — this invocation failed', running: 'RUNNING', planned: 'PLANNED',
    tasks: 'Tasks completed', groups: 'Groups integrated', saved: 'Saved queue time', generated: 'Report time',
    outputs: 'Declared output paths (existence is not verified here)', integrated: 'integrated target',
    group_results: 'Group and task results', success: 'SUCCESS', failed: 'BLOCKED / FAILED',
    task_success: 'SUCCESS — task checked', pending_result: 'NOT COMPLETED',
    uncertain_result: 'UNCERTAIN — reconcile writers',
    waiting_result: 'WAITING', integration_pending: 'group integration pending',
    draft: 'isolated work; may be incomplete or unchecked', not_started: 'not started', waiting: 'Waiting for checked dependencies',
    reason: 'Saved blocker', owner: 'Owner answer required', host: 'Technical recovery required',
    assignment: 'Native host assignment', lane: 'Integration blocked', queue: 'Execution state',
    evidence: 'Check evidence', attempts: 'Worker results and transcripts', records: 'Task records',
    worker_evidence: 'Worker evidence', ordinary_review: 'Ordinary review',
    snapshot: 'Derived snapshot only; queue.json is authoritative. No tasks are retried by this report.',
    next: 'Next', inspect: 'Inspect the saved blockers and attempt evidence; resolve them before resuming.',
    answers: 'Supply actual answers/corrections through inbox/answers.json; owner-only questions require the owner.',
    native: 'A live host must dispatch outstanding native assignments and prove writers stopped.',
    uncertain: 'Writer/claim settlement may need reconciliation; do not delete claims or assume writers stopped.',
    latest_failed: 'Latest results not updated; invocation snapshot saved',
    input_overlap: 'results.md overlaps a registered input', output_overlap: 'results.md overlaps a declared output',
    unsafe_latest: 'Unsafe results.md file', foreign_latest: 'Foreign results.md preserved',
    edited_latest: 'Foreign or edited results.md preserved', newer_latest: 'Newer results.md preserved',
    changed_latest: 'results.md changed', prepared_latest: 'Prepared report retained at',
    latest: 'Latest results', navigation: 'Navigation (links do not verify existence)',
    result: 'Result', exit: 'Exit code', report: 'Saved report', report_failed: 'Report could not be saved',
    starting: 'Starting/resuming', preparing: 'Validating queue and reconciling saved work',
    heartbeat: 'Still waiting; no new saved transition', elapsed: 'elapsed', phase: 'Run phase',
    integration: 'Integration', target: 'Target', question: 'Blocked', handoff: 'Native assignment', warning: 'Presentation warning',
    pending: 'pending', working: 'working', checking: 'checking', done: 'done', ready: 'ready',
    fallback: 'Unsupported CLI locale; using English', status_hint: 'Pass the run directory containing queue.json.',
    reports: 'Saved report snapshots', interrupt: 'Stopping requested; waiting for workers and saved recovery',
    locale_missing: 'Locale setting unavailable; using the OS locale default.',
    recover_error: 'Inspect this invocation error and retained claim/process evidence before retrying; saved completion describes the queue only.',
    live: 'The queue may still have a coordinator; inspect coordinator and writer status before another run.',
    start: 'Review the request and configured routes, then start the queue.',
    no_snapshot: 'No saved queue snapshot observed in this invocation; inspect status before retrying.',
    cleanup: 'Cleanup', cleanup_complete: 'complete; scratch moved to recoverable Trash',
    cleanup_failed: 'failed; inspect retained state before retrying', cleanup_skipped: 'skipped; the run did not complete successfully',
    cleanup_incomplete: 'incomplete; use the manual cleanup command to retry',
    cleanup_retry: 'Resolve the saved cleanup blocker, then retry the cleanup command.',
    compacted: 'Run history recycled; queue/request/group plans retained. Full evidence is no longer in this run directory.',
    recycled: 'Recorded Trash bundle', retained_records: 'Retained task records',
    cleanup_staging: 'Cleanup staging location', cleanup_blocker: 'Cleanup blocker', retained: 'Kept outside cleanup scope',
    unproved_integration: 'No exact saved integration result', unproved_scratch: 'Retained evidence or unproved scratch ownership'
  },
  zh: {
    complete: '完成 — 所有群組皆已檢查並整合', blocked: '受阻 — 仍有未完成工作', stopped: '已停止 — 已保留工作',
    error: '錯誤 — 本次執行失敗', running: '執行中', planned: '已規劃', tasks: '已完成任務', groups: '已整合群組',
    saved: '佇列儲存時間', generated: '報告時間', outputs: '預定輸出路徑（此處未驗證檔案是否存在）',
    group_results: '群組與任務結果', success: '成功', failed: '受阻／失敗',
    task_success: '成功 — 任務已檢查', pending_result: '尚未完成',
    uncertain_result: '狀態未明 — 須確認寫入程序',
    waiting_result: '等待中', integration_pending: '群組尚未整合',
    integrated: '已整合至目標', draft: '隔離工作；可能尚未完成或檢查', not_started: '尚未開始',
    waiting: '等待相依群組完成檢查與整合', reason: '已記錄的阻礙', owner: '需要擁有者回答', host: '需要技術修復',
    assignment: '原生代理主持端指派', lane: '整合受阻', queue: '執行狀態', evidence: '檢查證據',
    attempts: '代理結果與執行紀錄', records: '任務紀錄', worker_evidence: '代理回報證據', ordinary_review: '一般審查', snapshot: '此為衍生快照；執行狀態以 queue.json 為準。本報告不會重試任務。',
    next: '下一步', inspect: '查看已記錄的阻礙與執行證據；解決後再繼續。',
    answers: '透過 inbox/answers.json 提供實際回答或修正；僅限擁有者決定的問題須由擁有者回答。',
    native: '原生指派須由在線主持端執行，並證明寫入程序已停止。',
    uncertain: '可能需要確認寫入程序與占用狀態；不要刪除占用標記或假設程序已停止。',
    latest_failed: '最新結果未更新；已儲存本次執行快照',
    input_overlap: 'results.md 與已登記輸入重疊', output_overlap: 'results.md 與預定輸出重疊',
    unsafe_latest: 'results.md 檔案不安全', foreign_latest: '已保留外來 results.md',
    edited_latest: '已保留外來或已編輯的 results.md', newer_latest: '已保留較新的 results.md',
    changed_latest: 'results.md 已變動', prepared_latest: '待儲存報告保留於',
    latest: '最新結果', navigation: '導覽（連結不證明檔案存在）',
    result: '結果', exit: '結束代碼', report: '已儲存報告', report_failed: '無法儲存報告',
    starting: '開始或繼續執行', preparing: '驗證佇列並確認已儲存工作', heartbeat: '仍在等待；尚無新的已儲存進度',
    elapsed: '經過時間', target: '目標', phase: '執行階段', integration: '整合', question: '受阻', handoff: '原生指派',
    warning: '顯示警告', pending: '待執行', working: '處理中', checking: '檢查中', done: '已完成', ready: '等待整合',
    fallback: 'CLI 尚未支援此語系；使用英文', status_hint: '請指定包含 queue.json 的執行目錄。',
    reports: '已儲存報告快照', interrupt: '已要求停止；等待程序結束並儲存復原狀態',
    locale_missing: '無法讀取語系設定；使用作業系統預設語系。',
    recover_error: '重試前請先查看本次錯誤及保留的占用與程序證據；已儲存的完成狀態只描述佇列。',
    live: '佇列可能仍有協調程序；再次執行前請先確認協調程序與寫入程序狀態。',
    start: '確認請求與設定的執行路徑後，再啟動佇列。',
    no_snapshot: '本次執行未觀察到已儲存的佇列快照；重試前請先查看狀態。',
    cleanup: '清理', cleanup_complete: '完成；暫存資料已移至可復原的垃圾桶',
    cleanup_failed: '失敗；重試前請查看保留狀態', cleanup_skipped: '已略過；工作尚未成功完成',
    cleanup_incomplete: '尚未完成；請用人工清理指令重試',
    cleanup_retry: '先解決已記錄的清理阻礙，再重試清理指令。', recycled: '已記錄的垃圾桶資料夾', retained_records: '保留的任務紀錄',
    compacted: '執行紀錄已回收；僅保留佇列、原始請求與群組計畫。完整證據已不在此執行目錄。',
    cleanup_staging: '清理暫存位置', cleanup_blocker: '清理阻礙', retained: '清理範圍外保留項目',
    unproved_integration: '沒有精確的已存整合結果', unproved_scratch: '保留證據或尚未證明暫存資料歸屬'
  }
}
const dictionary = locale => words[language(locale)]
const state = (w, value) => value || 'pending'
const task_count = q => q.groups.reduce((n, g) => n + g.tasks.filter(t => t.state === 'done').length, 0)
const task_total = q => q.groups.reduce((n, g) => n + g.tasks.length, 0)
const dependencies = (q, g) => (g.depends_on || []).filter(id => q.groups.find(x => x.id === id)?.state !== 'done')
const quote_root = root => "'" + root.replace(/'/g, "'\\''") + "'"
const command = (verb, root) => `agf looper ${verb} ${quote_root(root)}`
const blocker_evidence = (item, w) => [
  ...(item.attempt_dir ? [`${w.attempts}: ${clean(item.attempt_dir)}`] : []),
  ...(Array.isArray(item.evidence) ? item.evidence.slice(0, 4).filter(value => typeof value === 'string')
    .map(value => `${w.worker_evidence}: ${clean(value).replace(/\r?\n/g, ' ').slice(0, 500)}`) : [])
]
const ordinary_reviews = group => [
  ...group.tasks.flatMap(task => (task.ordinary_reviews || []).map(review => ({ task: task.id, review }))),
  ...(group.attempt?.ordinary_reviews || []).map(review => ({ task: group.tasks.find(task => task.state !== 'done')?.id || '-', review }))
]
const review_line = (w, group, { task, review }, indent = '  ') => {
  const selected = review.attempt?.selection
  return `${w.ordinary_review} ${group.id}/${task}: ${review.state}${review.result ? `/${review.result.outcome}` : ''}` +
    (selected ? `\n${indent}${selected.kind} ${selected.provider} ${selected.model}/${selected.effort}` : '')
}
const compacted_path = (q, original) => {
  for (const sweep of [...(q.cleanup?.compaction_history || []), q.cleanup?.compaction].filter(p => p?.state === 'complete')) {
    const item = sweep.items.find(item => original === item.source || original.startsWith(item.source + path.sep))
    if (item) return path.join(sweep.trash_path, path.basename(item.staged), path.relative(item.source, original))
  }
  return original
}
const record_path = (q, original) => compacted_path(q, q.cleanup?.items?.find(item => item.records?.source === original && item.records.move === 'done')?.records.destination || original)

// Reasons stay attached to their saved group/current task; integration failures
// must never turn an already checked task into a failed task.
const concise = value => {
  const characters = Array.from(clean(value).replace(/\s+/g, ' ').trim())
  return characters.slice(0, 240).join('') + (characters.length > 240 ? '…' : '')
}
function group_results(q, locale) {
  const w = dictionary(locale), lines = [`${w.group_results}:`]
  for (const g of q.groups) {
    const waiting = dependencies(q, g)
    const questions = (q.questions || []).filter(item => item.group_id === g.id && !item.answer)
    const current = g.tasks.find(t => t.state !== 'done')
    const blocked = ['blocked', 'failed'].includes(g.state)
    lines.push('', `  ${g.id}: ${g.state === 'done' ? w.success : g.state === 'uncertain' ? w.uncertain_result : blocked ? w.failed : waiting.length ? w.waiting_result : w.pending_result} (${state(w, g.state)})`)
    if (waiting.length) lines.push(`    ${w.waiting}: ${waiting.join(', ')}`)
    for (const question of questions.filter(item => item.kind !== 'task' || !current)) lines.push(`    ${w.reason}: ${concise(question.question)}`)
    for (const t of g.tasks) {
      const failed = t.state !== 'done' && (['blocked', 'uncertain', 'failed'].includes(t.state) ||
        t === current && questions.some(item => item.kind === 'task'))
      const result = t.state === 'done' ? w.task_success : t.state === 'uncertain' || t === current && g.state === 'uncertain' ? w.uncertain_result : failed ? w.failed : w.pending_result
      lines.push(`    ${t.id}: ${result} (${state(w, t.state)})${t.state === 'done' ? `; ${g.state === 'done' ? w.integrated : w.integration_pending}` : ''}`)
      if (t.state === 'done' && t.result?.summary) lines.push(`      ${concise(t.result.summary)}`)
      if (failed) for (const question of questions.filter(item => item.kind === 'task'))
        lines.push(`      ${w.reason}: ${concise(question.question)}`)
      const location = g.state === 'done' ? q.repo : g.workspace?.worktree
      if (t.state !== 'done') lines.push(`      ${t === current && location ? w.draft : w.not_started}`)
      if (t.allowed_paths?.length) {
        lines.push(`      ${w.outputs}:`)
        for (const file of t.allowed_paths) lines.push(`        ${location ? path.join(location, file) : file}`)
      }
    }
  }
  return lines.map(clean).join('\n') + '\n'
}

function details(q, root, locale, { summary_blockers = false, include_tasks = true } = {}) {
  const w = dictionary(locale)
  const lines = include_tasks ? [`${w.outputs}:`] : []
  const recovered = file => {
    if (q.cleanup?.state !== 'complete' || !q.cleanup.trash_path || !q.cleanup.bundle) return file
    const item = q.cleanup.items?.find(item => file === item.source || file.startsWith(item.source + path.sep))
    return item ? path.join(q.cleanup.trash_path, path.relative(q.cleanup.bundle, item.staged), path.relative(item.source, file)) : file
  }
  if (!supported_locale(locale)) lines.unshift(`${w.fallback}: ${clean(locale)}`)
  for (const g of q.groups) {
    const waiting = dependencies(q, g)
    const current = g.tasks.find(t => t.state !== 'done')
    lines.push('')
    if (include_tasks && waiting.length) lines.push(`  ${g.id}: ${w.waiting}: ${waiting.join(', ')}`)
    for (const t of include_tasks ? g.tasks : []) {
      const location = g.state === 'done' ? q.repo : g.workspace?.worktree
      const outcome = t.state === 'done' ? (g.state === 'done' ? w.integrated : w.integration_pending) : t === current && location ? w.draft : w.not_started
      lines.push(`  ${g.id}/${t.id}: ${state(w, t.state)}; ${outcome}`)
      for (const file of t.allowed_paths || []) lines.push(`    ${location ? path.join(location, file) : file}`)
    }
    if (g.workspace) {
      const original = path.join(g.workspace.worktree, '.aglite-records')
      const retained = record_path(q, original)
      lines.push(`  ${retained !== original ? w.retained_records : w.records} ${g.id}: ${retained}`)
    }
    if (g.attempt?.id) lines.push(`  ${w.attempts} ${g.id}: ${recovered(path.join(root, 'attempts', g.attempt.id))}`)
    for (const item of ordinary_reviews(g)) {
      lines.push(`  ${review_line(w, g, item).replace(/\n/g, '\n  ')}`)
      if (item.review.attempt?.id) lines.push(`    ${recovered(path.join(root, 'attempts', item.review.attempt.id))}`)
    }
  }
  for (const item of q.questions || []) if (!item.answer) {
    if (summary_blockers && !blocker_evidence(item, w).length) continue
    lines.push('')
    if (!summary_blockers) lines.push(`${w.reason} ${item.group_id || ''} [${item.id}] (${item.requires_owner ? w.owner : w.host}): ${item.question}`)
    else if (blocker_evidence(item, w).length) lines.push(`${w.reason} ${item.group_id || ''} [${item.id}]:`)
    lines.push(...blocker_evidence(item, w).map(line => `  ${line}`))
  }
  if (q.lane_error && !summary_blockers) lines.push(`${w.lane}: ${q.lane_error}`)
  for (const item of q.handoffs || []) if (!item.completed)
    lines.push(`${w.assignment} ${item.id}: ${item.assignment}${item.error ? `; ${item.error}` : ''}`)
  if (q.groups.some(g => g.state === 'uncertain') || (q.processes || []).some(p => !p.ended_at)) lines.push(w.uncertain)
  const footer_start = lines.length
  lines.push('', `${w.queue}: ${path.join(root, 'queue.json')}`,
    ...(q.cleanup?.compaction?.state === 'complete' ? [w.compacted] : [
      `${w.evidence}: ${path.join(root, 'evidence')}`,
      `${w.attempts}: ${path.join(root, 'attempts')}`,
      `${w.reports}: ${path.join(root, 'evidence', 'run-*.txt')}`,
      `${w.latest}: ${path.join(root, 'results.md')}`]))
  lines.push('')
  if (q.cleanup) {
    if (!summary_blockers) lines.push(`${w.cleanup}: ${q.cleanup.state}`)
    if (q.cleanup.trash_path) lines.push(`${w.recycled}: ${q.cleanup.trash_path}`)
    for (const sweep of [...(q.cleanup.compaction_history || []), q.cleanup.compaction].filter(Boolean)) {
      lines.push(`${w.recycled}: ${sweep.trash_path}`)
      if (sweep.state !== 'complete') lines.push(`${w.cleanup_staging}: ${sweep.bundle}`)
    }
    if (q.cleanup.state !== 'complete' && q.cleanup.bundle) lines.push(`${w.cleanup_staging}: ${q.cleanup.bundle}`)
    const extra_records = (q.cleanup.items || []).map(item => item.records).filter(record => record?.move === 'done' &&
      !q.groups.some(group => group.workspace && record.source === path.join(group.workspace.worktree, '.aglite-records')))
    if (extra_records.length) lines.push(`${w.retained_records}:`, ...extra_records.map(record => `  ${compacted_path(q, record.destination)}`))
    if (q.cleanup.error && !summary_blockers) lines.push(`${w.cleanup_blocker}: ${q.cleanup.error}`)
    if (q.cleanup.retained?.length) {
      lines.push(`${w.retained}: ${q.cleanup.retained.length}`)
      for (const item of q.cleanup.retained.slice(0, 8)) lines.push(`  ${item.path}: ${w[item.reason] || item.reason}`)
    }
    if (q.cleanup.state !== 'complete' && !summary_blockers) lines.push(command('cleanup', root))
    lines.push('')
  }
  if (q.phase === 'running') {
    if (!summary_blockers) lines.push(`${w.next}: ${w.live}`)
  }
  else if (q.phase !== 'complete') {
    if (!summary_blockers) lines.push(`${w.next}: ${!q.phase || q.phase === 'planned' ? w.start : w.inspect}`)
    if ((q.questions || []).some(x => !x.answer)) lines.push(w.answers)
    if ((q.handoffs || []).some(x => !x.completed)) lines.push(w.native)
    lines.push(command('run', root))
  }
  lines.push(command('status', root))
  const footer = lines.splice(footer_start).flatMap(line => line.split('\n')).filter(line => line !== '')
  lines.push('', ...footer.flatMap(line => [line, '']))
  return (lines.map(clean).join('\n') + '\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
}

function summary(q, root, { code, task_code = code, error, cleanup_error, cleanup_requested, locale, generated = new Date().toISOString(), report } = {}) {
  const w = dictionary(locale)
  const outcome = error || task_code === 1 ? 'error' : task_code === 0 && q?.phase === 'complete' ? 'complete' : q?.phase || 'error'
  const lines = [`${w.result}: ${w[outcome] || outcome}`]
  if (code !== undefined) lines.push(`${w.exit}: ${code}`)
  if (error) lines.push(clean(error.message || error))
  const cleanup_problem = cleanup_requested && (cleanup_error || q?.cleanup && q.cleanup.state !== 'complete')
  if (cleanup_problem) {
    lines.push(`${w.cleanup}: ${cleanup_error ? w.cleanup_failed : w.cleanup_incomplete}`)
    if (cleanup_error) lines.push(`${w.cleanup_blocker}: ${clean(cleanup_error.message || cleanup_error)}`)
    else if (q.cleanup.error) lines.push(`${w.cleanup_blocker}: ${clean(q.cleanup.error)}`)
    lines.push(`${w.next}: ${w.cleanup_retry}`, command('cleanup', root))
  }

  if (q) {
    for (const item of q.questions || []) if (!item.answer)
      lines.push(`${w.reason} ${item.group_id || ''} [${item.id}] (${item.requires_owner ? w.owner : w.host}): ${clean(item.question)}`)
    if (q.lane_error) lines.push(`${w.lane}: ${clean(q.lane_error)}`)
    if (outcome !== 'complete') lines.push(`${w.next}: ${error || task_code === 1 ? w.recover_error : q.phase === 'running' ? w.live : !q.phase || q.phase === 'planned' ? w.start : w.inspect}`)
    lines.push(`${w.tasks}: ${task_count(q)}/${task_total(q)}; ${w.groups}: ${q.groups.filter(g => g.state === 'done').length}/${q.groups.length}`,
      `${w.saved}: ${q.updated_at || '-'}`, `${w.target}: ${q.repo} (${q.target_branch}) @ ${q.expected_head || q.base_commit}`,
      w.snapshot, group_results(q, locale).trimEnd(), details(q, root, locale, { summary_blockers: true, include_tasks: false }).trimEnd())
  } else lines.push(w.no_snapshot, command('status', root))
  if (!q && (error || task_code === 1)) lines.push(`${w.next}: ${w.recover_error}`)
  if (cleanup_requested && !cleanup_problem)
    lines.push(`${w.cleanup}: ${q?.cleanup?.state === 'complete' ? w.cleanup_complete : w.cleanup_skipped}`)
  lines.push(`${w.generated}: ${generated}`)
  if (report) lines.push(`${w.report}: ${report}`)
  return lines.map(clean).join('\n\n') + '\n'
}

// Ambiguous characters are narrow; common East Asian and emoji graphemes are wide.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
function cell_width(value) {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(value) && !value.includes('\ufe0e')) return 2
  let width = 0
  for (const character of value) {
    if (/[\p{Mark}\p{Cf}]/u.test(character)) continue
    const code = character.codePointAt(0)
    width += code >= 0x1100 && (code <= 0x115f || code === 0x2329 || code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) || (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) || (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) || (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1
  }
  return width
}

function progress_text(line, timestamp, columns) {
  const prefix = `[${timestamp}] `, hanging = ' '.repeat(11)
  const available = Number.isFinite(columns) && columns > 11 ? Math.floor(columns) - 11 : undefined
  const rows = clean(line).split('\n').flatMap(logical => {
    if (!available) return [logical]
    // Preserve nested body indentation where space permits. Even an impossibly
    // narrow terminal must retain a whole wide grapheme rather than clip it.
    const indent = logical.match(/^ */)[0].slice(0, Math.max(0, available - 2))
    const segments = Array.from(graphemes.segment(logical.slice(indent.length)), item => item.segment)
    const result = [], budget = Math.max(1, available - indent.length)
    while (segments.length) {
      let end = 0, cells = 0, boundary = 0
      while (end < segments.length && cells + cell_width(segments[end]) <= budget) {
        cells += cell_width(segments[end])
        if (/^\s+$/u.test(segments[end])) boundary = end + 1
        end++
      }
      if (end < segments.length && boundary) end = boundary
      end = Math.max(1, end)
      result.push(indent + segments.splice(0, end).join(''))
    }
    return result.length ? result : [indent]
  })
  return rows.map((row, index) => (index ? hanging : prefix) + row).join('\n') + '\n\n'
}

function observer({ write, locale, now = Date.now, on_activity, columns } = {}) {
  const w = dictionary(locale)
  let previous, latest, warning = false
  const emit = line => {
    // Output errors must never escape an on_save callback into the coordinator.
    let width
    try { width = typeof columns === 'function' ? columns() : columns } catch {}
    try { write(progress_text(line, new Date(now()).toISOString().slice(11, 19), width)) } catch {}
    try { on_activity?.() } catch {}
  }
  const update = q => {
    try {
      const next = copy(q), lines = []
      if (next.phase !== previous?.phase) lines.push(`${w.phase}: ${state(w, next.phase)}`)
      if (next.cleanup?.state && next.cleanup.state !== previous?.cleanup?.state)
        lines.push(`${w.cleanup}: ${next.cleanup.state}`)
      for (const g of next.groups) {
        const old = previous?.groups.find(x => x.id === g.id)
        if (g.state !== old?.state) lines.push(`${g.id}: ${state(w, g.state)}`)
        for (const t of g.tasks) {
          if (t.state !== old?.tasks.find(x => x.id === t.id)?.state)
            lines.push(`${g.id}/${t.id}: ${state(w, t.state)}`)
        }
        for (const item of ordinary_reviews(g)) {
          const before = old && ordinary_reviews(old).find(value => value.review.request_id === item.review.request_id)
          const signature = value => value && JSON.stringify([value.review.state, value.review.result?.outcome, value.review.attempt?.id])
          if (signature(item) !== signature(before)) lines.push(review_line(w, g, item, ''))
        }
      }
      const integration = next.integration
      if (integration && JSON.stringify([integration.group_id, integration.phase]) !== JSON.stringify(previous?.integration && [previous.integration.group_id, previous.integration.phase]))
        lines.push(`${w.integration} ${integration.group_id}: ${integration.phase}`)
      if (next.lane_error && next.lane_error !== previous?.lane_error) lines.push(`${w.lane}: ${next.lane_error}`)
      for (const item of next.questions || []) if (!item.answer && !previous?.questions?.some(x => x.id === item.id && !x.answer)) {
        lines.push(`${w.question} ${item.group_id} [${item.id}]: ${item.question}`)
        lines.push(...blocker_evidence(item, w))
      }
      for (const item of next.handoffs || []) if (!item.completed && !previous?.handoffs?.some(x => x.id === item.id))
        lines.push(`${w.handoff} ${item.id}: ${item.assignment}`)
      latest = next; previous = next
      for (const line of lines) emit(line)
    } catch (error) { if (!warning) { warning = true; emit(`${w.warning}: ${error.message}`) } }
  }
  const heartbeat = () => {
    const active = latest?.groups.filter(g => ['working', 'native', 'ready'].includes(g.state)).map(g => {
      const pending = ordinary_reviews(g).find(item => item.review.state === 'pending')
      return pending ? review_line(w, g, pending, '').replace(/\n/g, '\n  ') : `${g.id}/${g.tasks.find(t => t.state !== 'done')?.id || '-'}: ${state(w, g.state)}`
    })
    emit(`${w.heartbeat}${active?.length ? `\n  ${active.join('\n  ')}` : ''}`)
  }
  return { update, heartbeat, snapshot: () => latest, emit }
}


function terminal_text(value, stream, locale, env = process.env) {
  const plain = clean(value)
  if (!stream?.isTTY || Object.hasOwn(env, 'NO_COLOR') || env.TERM === 'dumb') return plain
  const w = dictionary(locale)
  return plain.split('\n').map(line => {
    const body = line.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '').trimStart()
    let color
    if (body.startsWith(`${w.result}:`))
      color = body.includes(w.complete) && !plain.includes(`${w.exit}: 1`) ? '1;92' : '1;91'
    else if (body.startsWith(`${w.cleanup}:`) && body.includes(w.cleanup_complete)) color = '1;92'
    else if (body.startsWith(`${w.cleanup}:`) && (body.includes(w.cleanup_failed) || body.includes(w.cleanup_incomplete)) ||
        [w.reason, w.question, w.lane, w.cleanup_blocker, w.report_failed, w.latest_failed].some(label => body.startsWith(`${label}:`) || body.startsWith(`${label} `)) ||
        /: (?:blocked|uncertain|failed)(?:$|[;\s/])/.test(body)) color = '1;91'
    else if (body.startsWith(`${w.next}:`) || body.startsWith('agf looper ')) color = '1;96'
    else if ([w.warning, w.fallback, w.cleanup].some(label => body.startsWith(`${label}:`)) || body === w.uncertain) color = '1;93'
    return color ? `\x1b[${color}m${line}\x1b[0m` : line
  }).join('\n')
}

const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const result_header = '<!-- agentflow-results '
const link = (root, file, label) => {
  const relative = path.relative(root, file)
  const target = path.isAbsolute(relative) ? pathToFileURL(file).href : relative.split(path.sep).map(encodeURIComponent).join('/')
  const escaped = clean(label).replace(/\s+/g, ' ').replace(/&/g, '&amp;').replace(/[\\`*_[\]<>]/g, '\\$&')
  return `[${escaped}](<${target}>)`
}
function save_latest(root, q, content, snapshot, locale) {
  const file = S.safe_path(root, 'results.md'), w = dictionary(locale)
  if ([q.request, ...q.groups.map(group => group.file)].some(input => typeof input === 'string' && path.resolve(root, input) === file))
    throw Error(w.input_overlap)
  for (const group of q.groups) for (const task of group.tasks) for (const allowed of task.allowed_paths || []) {
    const output = path.resolve(q.repo, allowed)
    if (output === file || file.startsWith(output + path.sep) || output.startsWith(file + path.sep))
      throw Error(w.output_overlap)
  }
  let before, identity
  try {
    identity = fs.lstatSync(file)
    if (!identity.isFile() || identity.nlink !== 1) throw Error(w.unsafe_latest)
    before = fs.readFileSync(file, 'utf8')
    const end = before.indexOf(' -->\n')
    if (!before.startsWith(result_header) || end < 0) throw Error(w.foreign_latest)
    let owner
    try { owner = JSON.parse(Buffer.from(before.slice(result_header.length, end), 'base64').toString('utf8')) } catch { throw Error(w.foreign_latest) }
    if (owner.root !== root || owner.run_id !== q.run_id || owner.sha256 !== digest(before.slice(end + 5)))
      throw Error(w.edited_latest)
    if (owner.queue_time && (!q.updated_at || owner.queue_time > q.updated_at)) throw Error(w.newer_latest)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  const links = [link(root, path.join(root, 'queue.json'), 'queue.json'), link(root, snapshot, path.basename(snapshot)),
    link(root, path.join(root, 'evidence'), w.evidence), link(root, path.join(root, 'attempts'), w.attempts)]
  for (const group of q.groups) {
    if (group.workspace?.worktree) links.push(link(root, record_path(q, path.join(group.workspace.worktree, '.aglite-records')), `${group.id}: ${w.records}`))
    for (const task of group.tasks) for (const allowed of task.allowed_paths || []) {
      const location = group.state === 'done' ? q.repo : group.workspace?.worktree
      if (location) links.push(link(root, path.join(location, allowed), `${group.id}/${task.id}: ${allowed}`))
    }
  }
  // Arbitrary saved text cannot close the display fence or become Markdown/HTML.
  const fence = '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/g)].map(match => match[0].length + 1)))
  const body = `# ${w.latest}\n\n${w.snapshot}\n\n## ${w.navigation}\n\n` +
    links.map(value => `- ${value}\n`).join('\n') + `\n${fence}text\n${content}${fence}\n`
  const header = result_header + Buffer.from(JSON.stringify({ root, run_id: q.run_id, queue_time: q.updated_at || null, sha256: digest(body) })).toString('base64') + ' -->\n'
  const next = header + body
  if (before === undefined) fs.writeFileSync(file, next, { flag: 'wx', mode: 0o600 })
  else {
    const temporary = S.safe_path(root, `.results-${crypto.randomUUID()}.tmp`)
    fs.writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 })
    try {
      S.inspect_path(file)
      const current = fs.lstatSync(file)
      if (!current.isFile() || current.nlink !== 1 || current.dev !== identity.dev || current.ino !== identity.ino || fs.readFileSync(file, 'utf8') !== before)
        throw Error(w.changed_latest)
      fs.renameSync(temporary, file)
    } catch (error) { throw Error(`${error.message}; ${w.prepared_latest}: ${temporary}`) }
  }
  return file
}

function save_report(root, q, options = {}) {
  const relative = `evidence/run-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.txt`
  const file = S.safe_path(root, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  S.inspect_path(path.dirname(file))
  const content = summary(q, root, { ...options, report: file })
  // Unique exclusive files preserve prior invocation reports and foreign files.
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 })
  let latest, warning
  try { latest = save_latest(root, q, content, file, options.locale) }
  catch (error) { warning = error.message }
  return { file, content, latest, warning }
}

module.exports = { details, summary, observer, save_report, dictionary, resolve_locale, supported_locale, progress_text, record_path, terminal_text }
