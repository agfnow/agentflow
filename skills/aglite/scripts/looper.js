'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const S = require('./looper-state')
const G = require('./looper-integration')
const A = require('./looper-agent')
const skill = path.resolve(__dirname, '..')
const now = () => new Date().toISOString()
const insist = (ok, message) => { if (!ok) throw Error(message) }
const text = value => typeof value === 'string' && value.trim() && !value.includes('\0')
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(value)
const uniq = list => [...new Set(list)]

function worker(selection) {
  insist(selection && ['cli', 'native'].includes(selection.kind), 'Worker kind must be cli or native')
  insist(text(selection.provider) && text(selection.model) && text(selection.effort), 'Explicit worker provider/model/effort required')
  if (selection.kind === 'cli') {
    insist(['codex', 'claude', 'copilot'].includes(selection.provider), 'Unsupported CLI provider')
    const efforts = selection.provider === 'claude'
      ? ['low', 'medium', 'high', 'xhigh', 'max']
      : ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', ...(selection.provider === 'copilot' ? ['max'] : [])]
    insist(efforts.includes(selection.effort), 'Unsupported selected effort; no substitution')
  }
}
// Fresh launches own separate contexts; Copilot can serve multiple model families.
// Catalog/provider labels never prove family diversity; explicit host constraints still apply.
function counterpart(repair, review) {
  return repair.provider !== review.provider || repair.provider === 'copilot'
}
function read_settings(repo) {
  const canonical = [], legacy = [], other = [], uncertain = []
  // Probe the former fixed locations for unsafe components, even when a custom
  // canonical config exists. Never follow links during the filename inventory.
  for (const relative of ['ag.json', '.agentflow/ag.json']) S.safe_path(repo, relative)
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.aglite-records'].includes(entry.name)) continue
      const file = path.join(directory, entry.name)
      const relative = path.relative(repo, file).split(path.sep).join('/')
      if (entry.isSymbolicLink()) {
        insist(entry.name !== 'ag.json', `Symlink path refused: ${file}`)
        uncertain.push(relative)
        continue
      }
      if (entry.name !== 'ag.json') {
        if (entry.isDirectory() && !fs.existsSync(path.join(file, '.git'))) walk(file)
        continue
      }
      S.checked_file(file)
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      let source
      try { source = fs.readFileSync(fd, 'utf8') } finally { fs.closeSync(fd) }
      let config
      try { config = JSON.parse(source) } catch (error) {
        if (['ag.json', '.agentflow/ag.json'].includes(relative)) throw Error(`${file}: ${error.message}`)
        other.push(relative); continue
      }
      if (!config || typeof config !== 'object' || Array.isArray(config) ||
          (config.switches !== undefined && (!config.switches || typeof config.switches !== 'object' || Array.isArray(config.switches)))) {
        if (['ag.json', '.agentflow/ag.json'].includes(relative)) throw Error(`${file}: ag.json and switches must be objects`)
        other.push(relative); continue
      }
      const ag_dir = config.switches?.['ag-dir'] === undefined ? '.agentflow' : config.switches['ag-dir']
      // Validate even a legacy source's declared destination before choosing it.
      const declared = S.safe_path(repo, ag_dir)
      const candidate = { file: relative, config, source }
      if (path.dirname(file) === declared) canonical.push(candidate)
      else if (relative === 'ag.json' || (relative === '.agentflow/ag.json' &&
        [undefined, 9, 10, 11, 'aglite-5'].includes(config['schema-version']))) legacy.push(candidate)
      else {
        insist(relative !== '.agentflow/ag.json', `Misplaced configuration ${relative}: owner reconciliation required`)
        other.push(relative)
      }
    }
  }
  walk(repo)
  insist(canonical.length + legacy.length <= 1,
    `Configuration collision: ${[...canonical, ...legacy].map(value => value.file).join(', ')}; owner reconciliation required`)
  insist(!legacy.length, `Legacy configuration ${legacy[0]?.file}: relocate to <ag-dir>/ag.json via the owner-facing host`)
  insist(canonical.length === 1, `No canonical <ag-dir>/ag.json; resolve configuration routing${other.length || uncertain.length ? ': ' + [...other, ...uncertain].join(', ') : ''}`)
  const { config, source, file } = canonical[0]
  insist(config['schema-version'] === undefined || config['schema-version'] === 12, 'ag.json schema-version: migrate to integer 12 via the host')
  const limits = config['looper-limits'] === undefined ? {} : config['looper-limits']
  insist(limits && typeof limits === 'object' && !Array.isArray(limits), 'ag.json looper-limits must be an object')
  const max_workers = limits['max-workers'] === undefined ? 3 : limits['max-workers']
  const max_repairs = limits['max-repairs'] === undefined ? 2 : limits['max-repairs']
  insist(Number.isSafeInteger(max_workers) && max_workers > 0, 'ag.json looper-limits.max-workers must be positive integer')
  insist(Number.isSafeInteger(max_repairs) && max_repairs >= 0, 'ag.json looper-limits.max-repairs must be nonnegative integer')
  return { config, file, digest: crypto.createHash('sha256').update(source).digest('hex'), max_workers, max_repairs }
}
function select(settings, role) {
  insist(['task', 'repair', 'review', 'acceptance'].includes(role), 'Unknown looper role')
  const route = role === 'review' ? 'acceptance' : role
  const label = `ag.json looper-routes.${route}`
  const value = settings.config['looper-routes']?.[route]
  insist(value && typeof value === 'object' && !Array.isArray(value), `${label} required`)
  insist(text(value['model-family']), `${label}.model-family required`)
  for (const key of ['model', 'effort']) insist(!Object.hasOwn(value, key), `${label}.${key} belongs in model-family`)
  const role_key = ['task', 'repair'].includes(role) ? 'implementation' : 'acceptance'
  const tier = settings.config['pipeline-roles']?.[role_key]
  insist(text(tier), `ag.json pipeline-roles.${role_key} required; coordinator has no host defaults`)
  const model_key = `model-family.${value['model-family']}.${tier}`
  const pair = settings.config['model-family']?.[value['model-family']]?.[tier]
  insist(text(pair) && pair.lastIndexOf('/') > 0 && pair.lastIndexOf('/') < pair.length - 1,
    `ag.json ${model_key} must be model/effort`)
  const split = pair.lastIndexOf('/')
  const selection = { kind: value.kind, provider: value.provider, model: pair.slice(0, split), effort: pair.slice(split + 1) }
  if (value.executable !== undefined) {
    insist(value.kind === 'cli' && text(value.executable), `${label}.executable requires a nonempty CLI executable`)
    selection.executable = value.executable
  }
  try { worker(selection) } catch (error) { throw Error(`${label} (${model_key}): ${error.message}`) }
  selection.source = { file: settings.file, digest: settings.digest, route, tier }
  return selection
}
function request_text(queue, root) {
  const file = S.safe_path(root, queue.request, { must_exist: true })
  S.checked_file(file)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  let bytes
  try {
    insist(fs.fstatSync(fd).isFile(), `Expected regular request file: ${file}`)
    bytes = fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
  const value = bytes.toString('utf8')
  insist(text(value) && Buffer.from(value, 'utf8').equals(bytes), `Request must be nonempty UTF-8 text: ${file}`)
  insist(typeof queue.request_sha256 === 'string' && /^[a-f0-9]{64}$/.test(queue.request_sha256), 'request_sha256 required')
  insist(crypto.createHash('sha256').update(bytes).digest('hex') === queue.request_sha256, `Original request changed: ${file}`)
  return value
}
function validate(queue, root, { verify_request = true } = {}) {
  for (const key of ['group_gates', 'waves', 'roles', 'final_checks', 'review_order', 'native_only', 'threeways',
    'task_worker', 'repair_worker', 'review_worker', 'acceptance_worker', 'max_workers', 'max_repairs'])
    insist(!Object.hasOwn(queue, key), `Unsupported legacy queue field: ${key}`)
  insist(queue.schema_version === 2, 'Queue schema 2 with request file/digest required; preserve started queues and finish with their matching prior runtime; host may convert verified unstarted queues')
  insist(id(queue.run_id), 'Invalid queue run_id')
  insist(path.isAbsolute(queue.repo) && fs.realpathSync(queue.repo) === queue.repo &&
    fs.realpathSync.native(G.git(queue.repo, ['rev-parse', '--show-toplevel'])) === queue.repo, 'Physical Git-root repo required')
  G.git(queue.repo, ['check-ref-format', '--branch', queue.target_branch])
  G.oid(queue.repo, queue.base_commit)
  if (queue.expected_head) G.oid(queue.repo, queue.expected_head)
  insist(text(queue.request), 'Original owner request file required')
  if (verify_request) request_text(queue, root)
  insist(queue.authorization?.execute === true && queue.authorization?.worktrees === true &&
    queue.authorization?.local_commits === true, 'Explicit execution/worktree/local-commit authority required')
  insist(queue.checks && !Array.isArray(queue.checks), 'Checks object required')
  for (const [key, check] of Object.entries(queue.checks)) {
    insist(id(key) && Array.isArray(check.command) && check.command.length && check.command.every(text), 'Invalid check command')
    insist(check.timeout_ms === undefined || (Number.isSafeInteger(check.timeout_ms) && check.timeout_ms > 0), 'Invalid check timeout')
  }
  const checks = list => insist(Array.isArray(list) && list.length && new Set(list).size === list.length &&
    list.every(key => Object.hasOwn(queue.checks, key)), 'Nonempty registered check IDs required')
  checks(queue.integration_checks)
  insist(Array.isArray(queue.groups) && queue.groups.length, 'Registered groups required')
  const groups = new Set(), tasks = new Set(), files = new Set()
  for (const group of queue.groups) {
    for (const key of ['wave', 'dependencies', 'group_gates'])
      insist(!Object.hasOwn(group, key), `Unsupported group scheduling field: ${key}`)
    insist(id(group.id) && !groups.has(group.id), 'Duplicate/invalid group ID')
    if (Object.hasOwn(group, 'depends_on')) {
      insist(Array.isArray(group.depends_on) && new Set(group.depends_on).size === group.depends_on.length &&
        group.depends_on.every(key => typeof key === 'string' && groups.has(key)),
      'depends_on must contain unique IDs of earlier groups')
    }
    groups.add(group.id)
    insist(/^group-\d{3}\.md$/.test(group.file) && !files.has(group.file), 'Unique group-NNN.md required')
    files.add(group.file)
    S.checked_file(S.safe_path(root, group.file))
    const source = fs.readFileSync(path.join(root, group.file), 'utf8')
    insist(Array.isArray(group.tasks) && group.tasks.length, 'Group tasks required')
    for (const task of group.tasks) {
      insist(id(task.id) && !tasks.has(task.id), 'Duplicate/invalid task ID')
      tasks.add(task.id)
      insist(source.split(/\r?\n/).filter(line => line === `## ${task.id}`).length === 1, `Missing/duplicate task section ${task.id}`)
      insist(Array.isArray(task.allowed_paths) && task.allowed_paths.length, 'Task allowed_paths required')
      for (const file of task.allowed_paths) {
        S.safe_path(queue.repo, file)
        insist(!/^(\.git|\.wts|\.aglite-records)(\/|$)/i.test(file), 'Reserved task path')
        if (process.platform === 'win32') {
          const first = path.join(queue.repo, file.split('/')[0])
          if (fs.existsSync(first)) {
            const actual = fs.realpathSync.native(first).toLowerCase()
            for (const name of ['.git', '.wts', '.aglite-records']) {
              const reserved = path.join(queue.repo, name)
              insist(!fs.existsSync(reserved) || actual !== fs.realpathSync.native(reserved).toLowerCase(), 'Reserved task path alias')
            }
          }
        }
      }
      checks(task.checks)
    }
  }
  for (const file of fs.readdirSync(root))
    insist(!/^group-\d+\.md$/.test(file) || files.has(file), `Unregistered group file: ${file}`)
  return queue
}
const load = root => validate(S.read_json(path.join(root, 'queue.json')), root)
const active_processes = queue => (queue.processes || []).filter(item => !item.ended_at)
function stopped(queue) {
  for (const proc of active_processes(queue))
    insist(S.writer_stopped(proc), `Writer still alive or uncertain: ${proc.pid}`)
}
function acquire(file, queue) {
  if (!fs.existsSync(file)) return S.acquire_claim(file, { run_id: queue.run_id })
  const old = S.read_json(file)
  stopped(queue)
  insist(S.process_alive(old) === false, 'Coordinator claim alive or uncertain')
  return S.takeover_claim(file, old.token, active_processes(queue))
}
const unmet_dependencies = (queue, group) => (group.depends_on || []).filter(key =>
  queue.groups.find(item => item.id === key).state !== 'done')
function status(root = process.cwd()) {
  root = fs.realpathSync(root)
  const q = validate(S.read_json(path.join(root, 'queue.json')), root, { verify_request: false })
  let request_error
  try { request_text(q, root) } catch (error) { request_error = error.message }
  const tasks = q.groups.flatMap(group => group.tasks)
  const done = tasks.filter(task => task.state === 'done').length
  let observation = ''
  if (q.phase === 'running') {
    const claim_file = path.join(root, '.queue.owner')
    observation = fs.existsSync(claim_file)
      ? ` (coordinator ${S.process_alive(S.read_json(claim_file)) === true ? 'live' : 'dead or uncertain; reconcile with run'})`
      : ' (coordinator absent; reconcile with run)'
  }
  const lines = [`Run ${q.run_id}: ${q.phase || 'planned'}${observation}`,
    `Tasks ${done}/${tasks.length}; groups ${q.groups.filter(group => group.state === 'done').length}/${q.groups.length}`,
    `Target: ${q.expected_head || q.base_commit}`, `Ready: ${(q.ready || []).join(', ') || 'none'}`]
  if (request_error) lines.push(`Request input blocked: ${request_error}`)
  for (const group of q.groups) lines.push(`${group.id}: ${group.state || 'pending'}; task ${group.tasks.find(task => task.state !== 'done')?.id || 'none'}; unmet dependencies ${unmet_dependencies(q, group).join(', ') || 'none'}; records ${group.workspace ? path.join(group.workspace.worktree, '.aglite-records') : 'not started'}`)
  for (const question of q.questions || []) if (!question.answer) lines.push(`${question.id}: ${question.question}`)
  for (const handoff of q.handoffs || []) if (!handoff.completed) lines.push(`Native ${handoff.id}: ${handoff.assignment}${handoff.error ? `; ${handoff.error}` : ''}`)
  if (q.lane_error) lines.push(`Integration blocked: ${q.lane_error}`)
  return lines.join('\n') + '\n'
}
function task_text(root, group, task) {
  const source = fs.readFileSync(path.join(root, group.file), 'utf8')
  const heading = new RegExp(`^## ${task.id}\\r?$`, 'gm')
  const matches = [...source.matchAll(heading)]
  insist(matches.length === 1, 'Task section missing/duplicate')
  const start = matches[0].index
  const rest = source.slice(start + matches[0][0].length)
  const next = /\r?\n## /.exec(rest)
  return source.slice(start, next ? start + matches[0][0].length + next.index : undefined)
}
function notebook(cwd, group) {
  const dir = path.join(cwd, '.aglite-records')
  S.inspect_path(dir)
  const file = path.join(dir, 'devlog.md')
  S.inspect_path(file)
  if (fs.existsSync(file)) {
    S.checked_file(file)
    group.notebook_initialized = true
  } else insist(!group.notebook_initialized && !(group.attempt?.previous_round > 0) &&
    !group.tasks.some(task => task.round > 0), 'Active isolated notebook is missing; explicit recovery required')
  return file
}
// Phase comes from the sequence, never from a translated label. Ignore code fences;
// only actual top-level headings can prove ordinary workflow completion.
function notebook_rounds(value) {
  let fence, round, ask_label, reply_label, phase = 0, completed = 0
  for (const line of value.split(/\r?\n/)) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (boundary) {
      if (!fence) fence = { char: boundary[1][0], length: boundary[1].length }
      else if (boundary[1][0] === fence.char && boundary[1].length >= fence.length && !boundary[2].trim()) fence = undefined
      continue
    }
    if (fence) continue
    const heading = /^# (?:(→) ([^\r\n]+?)|((?:Ask|Reply))) \/ A-(\d{3,})(.*)$/.exec(line)
    if (!heading) {
      insist(!/^# (?:→ .+|Ask|Reply) \/ A-/.test(line), 'Malformed ordinary round heading')
      continue
    }
    const label = heading[2] || heading[3]
    const number = Number(heading[4])
    const suffix = heading[5]
    insist(!suffix || /^ \([^\r\n]+\)$/.test(suffix), 'Malformed ordinary round heading')
    if (round === undefined) { round = number; phase = 1 }
    else if (number === round && phase === 1) {
      insist(label !== ask_label, 'Duplicate ordinary Ask heading')
      insist(!suffix, 'Reply cannot have an asker suffix')
      if (heading[3]) insist(heading[3] === 'Reply', 'Out-of-order ordinary round heading')
      reply_label = label
      phase = 2; completed = round
      continue
    } else {
      insist(number === round + 1 && phase === 2 && label !== reply_label, 'Missing/duplicate/out-of-order ordinary round heading')
      round = number; phase = 1
    }
    ask_label = label
    if (heading[3]) insist(heading[3] === 'Ask', 'Ordinary round must start with Ask')
  }
  return { completed, next: phase === 1 && round === completed + 1 }
}
function ordinary_closeout(cwd, attempt) {
  const file = path.join(cwd, '.aglite-records/devlog.md')
  S.checked_file(file)
  const rounds = notebook_rounds(fs.readFileSync(file, 'utf8'))
  insist(rounds.completed > (attempt.previous_round || 0) && rounds.next,
    'Ordinary task closeout is missing a new Reply/next Ask')
  return rounds.completed
}
function project_context(queue) {
  const paths = uniq(['AGENTS.md', ...(queue.contracts || [])])
  const files = paths.map(file => {
    S.safe_path(queue.repo, file)
    try { return `File ${file} at ${queue.base_commit}:\n${G.git(queue.repo, ['show', `${queue.base_commit}:${file}`])}` }
    catch (error) { if (file === 'AGENTS.md' && !queue.contracts?.includes(file)) return ''; throw error }
  })
  const baseline = ['project-rules', 'invariants', 'writing'].map(name => fs.readFileSync(path.join(skill, `references/${name}.md`), 'utf8')).join('\n')
  return `${baseline}\n${files.join('\n')}`
}

async function run(root = process.cwd(), options = {}) {
  root = fs.realpathSync(root)
  S.inspect_path(root)
  const file = path.join(root, 'queue.json')
  let source = fs.readFileSync(file, 'utf8')
  const q = load(root)
  const original_request = request_text(q, root)
  const settings = read_settings(q.repo)
  if (q.groups.some(group => group.tasks.some(task => task.state !== 'done') && !group.attempt))
    select(settings, 'task') // Validate new task dispatch before creating claims or worktrees.
  const common = path.resolve(q.repo, G.git(q.repo, ['rev-parse', '--git-common-dir']))
  const target_claim = path.join(common, `aglite-target-${crypto.createHash('sha256').update(q.target_branch).digest('hex').slice(0, 20)}.owner`)
  const own_claim = path.join(root, '.queue.owner')
  const claim = acquire(own_claim, q)
  let target
  const abort = new AbortController()
  const cancel = () => abort.abort()
  let uncertain = false
  let persistence_failed = false
  const jobs = new Map()
  const invalid_native = new Set()
  let merge_job = null
  const save = () => {
    try {
    S.verify_claim(own_claim, claim)
    if (target) S.verify_claim(target_claim, target)
    insist(fs.readFileSync(file, 'utf8') === source, 'queue.json changed outside coordinator')
    q.updated_at = now()
    S.write_json(file, q)
    source = fs.readFileSync(file, 'utf8')
    } catch (error) { persistence_failed = true; throw error }
    options.on_save?.(q)
  }
  const track = async identity => {
    const entries = Array.isArray(identity) ? identity : [identity]
    q.processes.push(...entries)
    // Target ownership includes children, even when another run root tries recovery.
    for (const [name, owner] of [[own_claim, claim], [target_claim, target]]) {
      if (!owner) continue
      S.verify_claim(name, owner)
      owner.children = [...(owner.children || []), ...entries]
      S.write_json(name, owner)
    }
    save()
  }
  const settled = list => {
    for (const proc of list) proc.ended_at = now()
    q.processes = q.processes.filter(proc => !proc.ended_at)
    for (const [name, owner] of [[own_claim, claim], [target_claim, target]]) {
      if (!owner) continue
      S.verify_claim(name, owner)
      owner.children = (owner.children || []).filter(proc => !proc.ended_at)
      S.write_json(name, owner)
    }
    save()
  }
  const checks = async (cwd, ids, label) => {
    const dir = path.join(root, 'evidence', `${label}-${crypto.randomUUID()}`)
    const list = []
    const observe = async proc => { list.push(...(Array.isArray(proc) ? proc : [proc])); await track(proc) }
    try {
      const before = G.head(cwd)
      const result = await (options.checks || A.run_checks)({ cwd, ids, checks: q.checks,
        evidence_dir: dir, signal: abort.signal, on_launch: observe, on_descendant: observe })
      insist(G.head(cwd) === before && !G.changed(cwd).length, 'Checks mutated product workspace')
      settled(list)
      return result
    } catch (error) { if (error.unsettled) uncertain = true; else settled(list); throw error }
  }
  const invoke = async (role, cwd, prompt, holder) => {
    const fresh_attempt = !holder.attempt
    if (!holder.attempt) {
      const selected = select(settings, role)
      if (role === 'repair') {
        const group = q.groups.find(item => item.id === holder.group_id)
        insist(group && (group.repairs || 0) < settings.max_repairs, 'Repair budget exhausted')
        const review = select(settings, 'review')
        if (selected.kind === 'cli' && review.kind === 'cli')
          insist(counterpart(selected, review), 'Repair requires counterpart review')
      }
      holder.attempt = { id: crypto.randomUUID(), role, selection: selected, expected_head: G.head(cwd), started_at: now() }
      if (role === 'task') {
        const file = notebook(cwd, holder)
        holder.attempt.previous_round = fs.existsSync(file) ? notebook_rounds(fs.readFileSync(file, 'utf8')).completed : 0
      }
      save()
    }
    const attempt = holder.attempt
    insist(attempt.role === role && attempt.selection, 'Saved attempt role/selection required')
    const selection = attempt.selection
    if (role === 'task') { notebook(cwd, holder); save() } // Persist observed creation, including pending native work.
    worker(selection)
    const original_prompt = prompt
    prompt = `Isolated looper ${role} session: read inherited configuration only at ${path.join(cwd, settings.file)}; missing/unsafe config blocks dependent work, never substitute defaults. No configuration discovery, creation, migration writes, release checks or project adoption; these belong to the owner-facing host. Interpret documented mappings in memory only; unknown/conflicting mappings require owner decisions. Root notebooks, registry and backlog are read-only constraints.\n${prompt}`
    if (role === 'task') prompt += `\nUse generated workflow session UUID ${attempt.id} for this isolated task's notebook ownership. This UUID is assigned before dispatch, not read from a marker. You alone render/create this isolated notebook from the ordinary notebook asset in configured switches.use-lang before task work; the coordinator creates no human scaffold. STATUS identity facts: project ${q.run_id}/${holder.id}; notebook .aglite-records/devlog.md (explicit isolated group); checkout ${cwd}; branch ${holder.workspace.branch}. Preserve existing history/ownership and exact original input bytes; render mutable STATUS and new human text in the configured locale. Perform no other setup, adoption, backlog/registry writes or config migration. Before starting/resuming a native assignment, inspect its current queue group; a blocked group or handoff recovery error forbids dispatch or notebook recreation. Never take a foreign claim. If a question blocks closeout, preserve the open Ask and this session's marker; the coordinator may archive only this exact mapped marker after proved worker stop for the authorized task handoff.`
    insist(id(attempt.id), 'Invalid saved attempt identity')
    const dir = path.join(root, 'attempts', attempt.id)
    if (selection.kind === 'native') {
      fs.mkdirSync(dir, { recursive: true })
      const assignment = path.join(dir, 'assignment.md')
      if (!fs.existsSync(assignment)) {
        fs.writeFileSync(assignment, `${prompt}\nNative selection: ${JSON.stringify(selection)}\nWorktree: ${cwd}\nAttempt: ${attempt.id}\nReturn ${JSON.stringify({ ...A.result_schema(attempt), properties: { ...A.result_schema(attempt).properties, writer_stopped: { type: 'boolean', const: true } }, required: [...A.result_schema(attempt).required, 'writer_stopped'] })}. Write response to ${path.join(root, 'inbox', `${attempt.id}.json`)} only after the worker and descendants stop; host verifies ordinary workflow and the selected model/effort. Do not edit queue.json.\n`, { flag: 'wx' })
        q.handoffs.push({ id: attempt.id, role, selection, cwd, assignment, completed: false })
        save()
      }
      const response = path.join(root, 'inbox', `${attempt.id}.json`)
      if (!fs.existsSync(response)) return null
      const handoff = q.handoffs.find(item => item.id === attempt.id)
      let result
      try {
        result = A.validate_result(S.read_json(response), attempt)
        insist(result.writer_stopped === true, 'Native host must prove worker and descendants stopped')
      } catch (error) {
        invalid_native.add(attempt.id)
        handoff.error = error.message
        save()
        return null // The assignment still reserves its slot; never infer a stopped writer.
      }
      handoff.error = null
      handoff.completed = true
      save()
      return result
    }
    // Import stopped results after a crash; only an exact answered attempt may renew nonpass work.
    if (role === 'task') {
      const file = notebook(cwd, holder)
      insist(fs.existsSync(file) || fresh_attempt && attempt.previous_round === 0, 'Active isolated notebook is missing; explicit recovery required')
    }
    if (fs.existsSync(dir)) {
      const exit_file = path.join(dir, 'exit.json')
      const result_file = path.join(dir, 'result.json')
      if (fs.existsSync(exit_file) && fs.existsSync(result_file)) {
        const exit = S.read_json(exit_file)
        if (exit.exit_code === 0 && !exit.error && !exit.aborted && !exit.timed_out) {
          const result = A.validate_result(S.read_json(result_file), attempt)
          if (result.outcome === 'pass' || holder.retry_attempt !== attempt.id) return result
        }
      }
      if (role === 'task') release_task_claim(cwd, attempt)
      delete holder.retry_attempt
      holder.attempt = null
      save()
      return invoke(role, cwd, original_prompt, holder)
    }
    const list = []
    const observe = async proc => { list.push(...(Array.isArray(proc) ? proc : [proc])); await track(proc) }
    try {
      const result = await (options.agent || A.launch_agent)({ selection, role, cwd, prompt,
        attempt, attempt_dir: dir, signal: abort.signal, on_launch: observe, on_descendant: observe })
      settled(list)
      if (role === 'task') { notebook(cwd, holder); save() }
      return A.validate_result(result, attempt)
    } catch (error) { if (error.unsettled) uncertain = true; else settled(list); throw error }
  }
  const release_task_claim = (cwd, attempt) => {
    const marker = path.join(cwd, '.aglite-records/.devlog.md.owner')
    if (!fs.existsSync(marker)) return
    const owner = S.read_json(marker)
    insist(owner.session === attempt.id, 'Foreign isolated notebook claim requires explicit owner handoff')
    const destination = S.safe_path(root, `attempts/${attempt.id}/notebook-owner.released.json`)
    insist(!fs.existsSync(destination), 'Notebook handoff archive collision')
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.renameSync(marker, destination)
  }
  const question = (group, message, kind, requires_owner = false) => {
    group.state = 'blocked'
    const old = q.questions.find(item => !item.answer && item.group_id === group.id)
    if (!old) q.questions.push({ id: crypto.randomUUID(), group_id: group.id, kind, requires_owner, question: message })
    save()
  }
  const finished_merge = attempt => {
    const group = q.groups.find(item => item.id === attempt.group_id)
    group.state = 'done'
    group.integration = attempt
    q.expected_head = attempt.result
    q.ready = q.ready.filter(key => key !== group.id)
    q.integration = null
    save()
  }
  try {
    target = acquire(target_claim, q)
    stopped(q)
    for (const proc of active_processes(q)) proc.ended_at = now()
    q.expected_head ??= q.base_commit
    q.ready ??= []
    q.questions ??= []
    q.handoffs ??= []
    q.processes ??= []
    if (q.integration?.phase === 'landing' && G.head(q.repo) === q.integration.result) {
      const attempt = q.integration
      insist(attempt.checks?.every(item => item.passed) && attempt.checks.length, 'Landed result lacks checked evidence')
      finished_merge(attempt)
    }
    try { G.target_safe(q); q.lane_error = null } catch (error) { q.lane_error = error.message }
    // A restored expected target and proved stopped writers permit rechecking the
    // preserved attempt; no new target history is silently adopted.
    q.lane_wait = false
    for (const group of q.groups) {
      group.state ??= 'pending'
      for (const task of group.tasks) {
        task.state ??= 'pending'
        if (task.state === 'done') {
          G.oid(q.repo, task.candidate)
          insist(task.checks.every(key => task.checks_result?.some(item => item.id === key && item.passed === true)),
            'Completed task lacks its declared check proof')
        }
      }
      if (group.state === 'done') {
        const proof = group.integration
        insist(proof && proof.result && proof.checks?.length && proof.checks.every(item => item.passed === true),
          'Completed group lacks checked integration proof')
        insist(G.git(q.repo, ['merge-base', proof.result, q.expected_head]) === proof.result,
          'Completed integration is absent from the expected target')
      }
      if (group.state === 'uncertain') group.state = group.attempt ? 'working' : 'pending'
      if (group.state === 'working' && !group.attempt) group.state = 'pending'
      if (group.workspace && group.tasks.some(task => task.state !== 'done')) {
        try {
          notebook(group.workspace.worktree, group)
          const handoff = q.handoffs.find(item => item.id === group.attempt?.id && !item.completed)
          if (handoff?.error === 'Active isolated notebook is missing; explicit recovery required') handoff.error = null
          save()
        } catch (error) {
          const handoff = q.handoffs.find(item => item.id === group.attempt?.id && !item.completed)
          if (handoff) handoff.error = error.message
          question(group, error.message, 'task')
        }
      }
    }
    // Only host-supplied answers are inputs; the coordinator alone saves their state.
    const answers = path.join(root, 'inbox', 'answers.json')
    if (fs.existsSync(answers)) for (const answer of S.read_json(answers)) {
      const item = q.questions.find(entry => entry.id === answer.id)
      insist(item && text(answer.answer), 'Unknown question or empty answer')
      if (item.answer) { insist(item.answer === answer.answer, 'Conflicting saved owner answer'); continue }
      const answer_source = answer.source || 'owner'
      insist(['owner', 'host'].includes(answer_source) && (!item.requires_owner || answer_source === 'owner'),
        'Owner-only question requires an actual owner answer')
      const group = q.groups.find(entry => entry.id === item.group_id)
      if (item.kind === 'task' && group.workspace) {
        const file = notebook(group.workspace.worktree, group)
        insist(fs.existsSync(file) || group.attempt?.selection.kind !== 'cli', 'Active isolated notebook is missing; explicit recovery required')
      }
      item.answer = answer.answer
      item.answer_source = answer_source
      group.state = item.kind === 'integration' ? 'ready' : 'pending'
      if (answer_source === 'host' && item.kind === 'task' && group.attempt?.selection.kind === 'cli')
        group.retry_attempt = group.attempt.id
      if (answer_source === 'owner' && group.attempt) {
        const old = q.handoffs.find(entry => entry.id === group.attempt.id)
        if (old) {
          insist(old.completed || answer.writer_stopped === true, 'Superseded native writer must be proved stopped')
          old.completed = true; old.superseded = true
        }
        group.attempt = null
      }
      const retry = group.tasks.find(task => task.state !== 'done')
      if (retry && item.kind !== 'integration') {
        if (answer_source === 'host' && retry.candidate && G.head(group.workspace.worktree) === retry.candidate)
          retry.state = 'checking'
        else if (!(answer_source === 'host' && retry.commit_intent)) {
          retry.state = 'pending'
          delete retry.commit_intent
          delete retry.candidate
        }
      }
      if (item.kind === 'integration') {
        const previous = group.suspended_integration
        if (previous?.attempt) {
          const old = q.handoffs.find(entry => entry.id === previous.attempt.id)
          if (old) {
            insist(old.completed || answer.writer_stopped === true, 'Superseded native writer must be proved stopped')
            old.completed = true; old.superseded = true
          }
          previous.attempt = null
        }
        if (previous?.base === q.expected_head && previous.phase !== 'prepared') group.resume_integration = true
        if (!q.ready.includes(group.id)) q.ready.push(group.id)
      }
    }
    q.phase = 'running'
    save()
    process.on('SIGINT', cancel)
    process.on('SIGTERM', cancel)
    const context = project_context(q)
    const completed = []
    const task_job = async group => {
      const cwd = G.prepare_group(q, group, save)
      notebook(cwd, group) // Check known history before creating the verified checkout's record directory.
      const records = S.safe_path(cwd, '.aglite-records')
      if (!fs.existsSync(records)) fs.mkdirSync(records) // Never recreate a vanished checkout root.
      insist(fs.statSync(records).isDirectory(), 'Isolated records path must be a directory')
      const task = group.tasks.find(item => item.state !== 'done')
      if (!task) return { group, ready: true }
      group.state = 'working'
      if (task.state !== 'checking') task.state = 'working'
      save()
      if (task.commit_intent && !task.candidate) {
        const actual = G.head(cwd)
        if (actual !== task.commit_intent.base) {
          insist(G.git(cwd, ['show', '-s', '--format=%P', actual]) === task.commit_intent.base &&
            G.git(cwd, ['show', '-s', '--format=%B', actual]).trim() === task.commit_intent.message,
            'Interrupted task commit identity is uncertain')
          task.candidate = actual
        } else {
          insist(task.result?.outcome === 'pass' && group.attempt, 'Interrupted task staging lacks successful task proof')
          A.validate_result(task.result, group.attempt)
          ordinary_closeout(cwd, group.attempt)
          task.candidate = G.commit_task(cwd, task.commit_intent.base, task.allowed_paths, task.commit_intent.message, true)
        }
        task.state = 'checking'
        save()
      }
      if (task.state === 'checking' && task.candidate) {
        insist(G.head(cwd) === task.candidate, 'Task checkpoint moved')
        task.checks_result = await checks(cwd, task.checks, task.id)
        insist(task.checks_result.length === task.checks.length && task.checks_result.every(item => item.passed), 'Task checks failed')
        task.state = 'done'; group.attempt = null; save()
        return { group, ready: group.tasks.every(item => item.state === 'done') }
      }
      const input_file = S.safe_path(root, `inputs/${group.id}-${task.id}.md`)
      insist(!task.input_file || task.input_file === input_file, 'Saved task input escaped its registered identity')
      if (!task.input_file) {
        fs.mkdirSync(path.dirname(input_file), { recursive: true })
        fs.writeFileSync(input_file, task_text(root, group, task), { flag: 'wx' })
        task.input_file = input_file
        save()
      }
      const instructions = fs.readFileSync(input_file, 'utf8')
      const prior = q.questions.filter(item => item.group_id === group.id && item.answer)
      const prompt = `Load ${path.join(skill, 'SKILL.md')}. Original authorized request (context only; execute the selected task): ${original_request}\nExplicit session overrides: notebook ${path.join(cwd, '.aglite-records/devlog.md')}; ag-dir .aglite-records; auto-commit off; auto-push off; ag-dir .aglite-records is a record-only session override and never relocates config. No project adoption writes. Follow ordinary task workflow and configured review; no mandatory extra verifier or group gates. Do not ask to create a Git repository. Finish the task's ordinary closeout before returning pass; render headings as # → <localized label> / A-NNN (Ask then Reply for each ID, then next consecutive Ask; three-digit increasing IDs, optional parenthesized asker suffix only on Ask); localize all human text using switches.use-lang while preserving machine tokens.\n${context}\nGroup ${group.id}, task ${task.id}; edit only ${JSON.stringify(task.allowed_paths)}.\n${instructions}\nDeclared checks: ${JSON.stringify(task.checks.map(key => q.checks[key]))}.\nHost-provided answers/corrections: ${JSON.stringify(prior)}\nPreserve any existing unfinished task edits; inspect before continuing.`
      const result = await invoke('task', cwd, prompt, group)
      if (!result) return { group, native: true }
      if (result.outcome !== 'pass') {
        release_task_claim(cwd, group.attempt)
        return { group, blocked: result.summary, requires_owner: result.outcome === 'needs_owner' }
      }
      const round = ordinary_closeout(cwd, group.attempt)
      release_task_claim(cwd, group.attempt)
      // Snapshot product changes before running independent coordinator checks.
      const expected = group.attempt.expected_head
      const recovering_commit = Boolean(task.commit_intent)
      if (!recovering_commit) insist(!G.git(cwd, ['diff', '--cached', '--name-only']), 'Task staged changes without coordinator intent')
      task.result = result
      task.round = round
      task.commit_intent = { base: expected, message: `aglite: ${group.id}/${task.id} ${group.attempt.id}` }
      save()
      const candidate = G.commit_task(cwd, expected, task.allowed_paths, task.commit_intent.message, recovering_commit)
      task.candidate = candidate
      task.state = 'checking'
      save()
      const observations = await checks(cwd, task.checks, task.id)
      task.checks_result = observations
      insist(observations.length === task.checks.length && observations.every(item => item.passed), 'Task checks failed')
      task.state = 'done'
      group.attempt = null
      save()
      return { group, ready: group.tasks.every(item => item.state === 'done') }
    }
    const integrate = async group => {
      let attempt = q.integration
      if (!attempt && group.resume_integration && group.suspended_integration?.base === q.expected_head) {
        q.integration = attempt = group.suspended_integration
        group.resume_integration = false
        save()
      }
      if (!attempt) attempt = G.prepare_integration(q, group, save)
      insist(attempt.group_id === group.id, 'Integration identity mismatch')
      // Prepared/merge-in-progress crash effects stay inspectable; never repeat blindly.
      if (attempt.phase === 'prepared') throw Error('Interrupted merge preparation requires host reconciliation')
      G.verify_integration(q, attempt)
      const cwd = attempt.worktree
      const included = q.groups.filter(item => item.state === 'done' || item.id === group.id)
      const tasks = included.flatMap(item => item.tasks)
      const ids = uniq([...q.integration_checks, ...tasks.flatMap(item => item.checks)])
      const requirements = included.map(item => fs.readFileSync(path.join(root, item.file), 'utf8')).join('\n')
      while (true) {
        insist(!abort.signal.aborted, 'Integration interrupted')
        if (attempt.phase === 'repair') {
          attempt.repair_index ??= G.git(cwd, ['ls-files', '--stage'])
          save()
          const result = await invoke('repair', cwd,
            `${context}\nPreserve all included outcomes:\n${requirements}\nRepair ${attempt.reason}. Allowed paths: ${JSON.stringify(uniq(tasks.flatMap(item => item.allowed_paths)))}. Do not stage or commit. Owner answers: ${JSON.stringify(q.questions.filter(item => item.answer))}`, attempt)
          if (!result) return { native: true }
          if (result.outcome !== 'pass') {
            const error = Error(result.summary)
            error.requires_owner = result.outcome === 'needs_owner'
            throw error
          }
          insist(G.head(cwd) === attempt.attempt.expected_head, 'Repair changed HEAD')
          insist(G.git(cwd, ['ls-files', '--stage']) === attempt.repair_index, 'Repair worker changed the Git index')
          G.commit_repair(attempt, uniq(tasks.flatMap(item => item.allowed_paths)))
          attempt.repair_selection = attempt.attempt.selection
          group.repairs = (group.repairs || 0) + 1
          attempt.repaired = true
          delete attempt.repair_index
          attempt.attempt = null
          attempt.phase = 'checks'
          save()
        }
        if (attempt.phase === 'checks') {
          attempt.checks = await checks(cwd, ids, 'combined')
          if (attempt.checks.length !== ids.length || !attempt.checks.every(item => item.passed)) {
            attempt.phase = 'repair'; attempt.reason = 'failed combined checks'; save(); continue
          }
          attempt.result = G.head(cwd)
          attempt.phase = attempt.repaired ? 'review' : 'verified'
          save()
        }
        for (const role of ['review', 'acceptance']) {
          if (attempt.phase !== role) continue
          const logs = attempt.checks.map(item => ({ id: item.id, passed: item.passed,
            output: item.log ? fs.readFileSync(item.log, 'utf8') : '(test-injected observation)' }))
          const comparison = `Coordinator-observed exact Git evidence: HEAD ${G.head(cwd)}; branch ${G.git(cwd, ['symbolic-ref', '--short', 'HEAD'])}; status ${JSON.stringify(G.git(cwd, ['status', '--porcelain']))}. Diff from base to exact result:\n${G.git(cwd, ['diff', '--binary', attempt.base, attempt.result])}\nObserved check output:\n${JSON.stringify(logs)}\nThese are supplied live coordinator observations; inspect the diff and actual candidate files. Shell/Git re-execution is not required when this evidence suffices. Return repair for concrete code defects; blocked for missing access/proof; needs_owner for owner-only decisions.`
          const review = attempt.attempt?.selection || select(settings, role)
          if (role === 'review' && attempt.repair_selection?.kind === 'cli' && review.kind === 'cli')
            insist(counterpart(attempt.repair_selection, review), 'Repair requires counterpart review')
          const result = await invoke(role, cwd,
            `${context}\n${role === 'review' ? 'Review' : 'Accept or reject'} repaired combined result ${attempt.result} against original request ${original_request}. Base ${attempt.base}. Requirements:\n${requirements}\nChecks: ${JSON.stringify(attempt.checks)}. Read actual diff/files. Missing proof is blocked.\n${comparison}`, attempt)
          if (!result) return { native: true }
          insist(G.head(cwd) === attempt.result && !G.changed(cwd).length, 'Review/acceptance mutated candidate')
          if (result.outcome === 'repair') {
            attempt.phase = 'repair'; attempt.reason = result.summary; attempt.attempt = null; save(); break
          }
          if (result.outcome !== 'pass') {
            const error = Error(result.summary)
            error.requires_owner = result.outcome === 'needs_owner'
            throw error
          }
          attempt[`${role}_result`] = result
          attempt.attempt = null
          attempt.phase = role === 'review' ? 'acceptance' : 'verified'
          save()
        }
        if (attempt.phase === 'repair') continue
        if (attempt.phase === 'verified' || attempt.phase === 'landing') {
          G.land(q, attempt, save)
          finished_merge(attempt)
          return { done: true }
        }
        throw Error(`Unreconciled integration phase: ${attempt.phase}`)
      }
    }
    const collect = () => {
      for (const result of completed.splice(0).sort((a, b) => a.group.id.localeCompare(b.group.id))) {
        jobs.delete(result.group.id)
        const group = result.group
        if (result.error?.unsettled) {
          group.state = 'uncertain'
          q.lane_error = 'Worker settlement uncertain; preserve claims and prove writers stopped before continuation'
        } else if (result.error || result.blocked) question(group, result.error?.message || result.blocked, 'task', result.requires_owner)
        else if (result.native) group.state = 'native'
        else if (result.ready) {
          insist(G.head(group.workspace.worktree) === group.tasks.at(-1).candidate, 'Completed group HEAD moved outside task checkpoints')
          group.candidate = G.head(group.workspace.worktree)
          group.state = 'ready'
          if (!q.ready.includes(group.id)) q.ready.push(group.id)
        } else group.state = 'pending'
        save()
      }
    }
    while (!abort.signal.aborted) {
      collect()
      for (const group of q.groups) {
        if (uncertain) break
        if (!['pending', 'working', 'native'].includes(group.state) || jobs.has(group.id)) continue
        if (unmet_dependencies(q, group).length) continue
        if (group.depends_on?.length && !group.workspace) {
          if (q.lane_error) continue
          try { G.target_safe(q) } catch (error) { q.lane_error = error.message; save(); continue }
        }
        const reserved = q.groups.filter(item => !jobs.has(item.id) && (item.state === 'native' ||
          q.handoffs.some(handoff => handoff.id === item.attempt?.id && !handoff.completed))).length
        if (!(group.attempt && (group.state === 'native' || q.handoffs.some(item => item.id === group.attempt.id && !item.completed))) &&
            jobs.size + reserved >= settings.max_workers) continue
        if (group.state === 'native' && group.attempt &&
            (invalid_native.has(group.attempt.id) || !fs.existsSync(path.join(root, 'inbox', `${group.attempt.id}.json`)))) continue
        const job = task_job(group).then(result => completed.push(result), error => completed.push({ group, error }))
        jobs.set(group.id, job)
      }
      if (!uncertain && !merge_job && !q.lane_error && !q.lane_wait && q.ready.length) {
        const group = q.groups.find(item => item.id === q.ready[0])
        merge_job = integrate(group).then(result => {
          if (result.native) {
            // The host may still launch the assigned native writer. Keep the one
            // repair lane reserved until its stopped result is imported on run.
            q.lane_wait = true
            save()
          }
        }).catch(error => {
          if (error.unsettled) uncertain = true
          try { G.target_safe(q) } catch (unsafe) { q.lane_error = unsafe.message }
          if (!uncertain && !q.lane_error && q.integration?.phase !== 'landing') {
            group.suspended_integration = q.integration
            q.integration = null
            q.ready = q.ready.filter(key => key !== group.id)
            question(group, error.message, 'integration', error.requires_owner)
          } else { q.lane_error = error.message; save() }
        }).finally(() => { merge_job = null })
      }
      if (!jobs.size && !merge_job && !completed.length) break
      await Promise.race([...jobs.values(), ...(merge_job ? [merge_job] : [])])
    }
    await Promise.allSettled([...jobs.values(), ...(merge_job ? [merge_job] : [])])
    collect()
    q.phase = q.groups.every(group => group.state === 'done') ? 'complete' : abort.signal.aborted ? 'stopped' : 'blocked'
    save()
    return q.phase === 'complete' ? 0 : 2
  } finally {
    abort.abort()
    await Promise.allSettled([...jobs.values(), ...(merge_job ? [merge_job] : [])])
    process.off('SIGINT', cancel)
    process.off('SIGTERM', cancel)
    if (!uncertain && !persistence_failed) {
      stopped(q)
      if (target) S.release_claim(target_claim, target)
      S.release_claim(own_claim, claim)
    }
  }
}

module.exports = { run, status, load, validate, task_text, ordinary_closeout, read_settings, select, counterpart }
