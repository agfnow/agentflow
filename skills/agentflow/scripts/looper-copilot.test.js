'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const current_schema = require('../assets/.agentflow/ag.json')['schema-version']
const os = require('node:os')
const path = require('node:path')
const { parse_copilot_result, copilot_environment, copilot_tools, launch_agent } = require('./looper-agent')
const attempt = { id: 'attempt-1' }
const selection = { provider: 'copilot', model: 'exact-model', effort: 'high' }
const outcome = { attempt_id: attempt.id, outcome: 'pass', summary: 'done', evidence: [] }
const line = values => values.map(value => JSON.stringify(value)).join('\n')
function fixture() {
  return {
    records: [{ type: 'assistant.message', data: { originatingMessageId: 'root', model: selection.model,
      content: JSON.stringify(outcome), toolRequests: [] } },
    { type: 'result', sessionId: 'session', exitCode: 0, usage: {} }],
    saved: [{ type: 'session.start', data: { sessionId: 'session', selectedModel: selection.model,
      reasoningEffort: selection.effort, copilotVersion: '1.0.101' } },
    { type: 'user.message', data: { messageId: 'root', content: 'prompt', parentAgentTaskId: 'nonempty-root-value' } }]
  }
}
function parse(f) {
  return parse_copilot_result(line(f.records), { session_source: line(f.saved),
    session_id: 'session', selection, prompt: 'prompt', attempt })
}
test('Copilot binds persisted root, outer final, terminal and requested pair; ignores reasoning and recoverable tools', () => {
  const f = fixture()
  f.records.unshift({ type: 'assistant.reasoning', data: { content: 'not JSON' } },
    { type: 'tool.execution_complete', data: { success: false, error: 'recoverable' } },
    { type: 'assistant.message', data: { originatingMessageId: 'subagent', model: 'different', content: 'untrusted' } })
  const actual = parse(f)
  assert.deepEqual(actual.result, outcome)
  assert.equal(actual.identity.effective_effort, 'unproved')
  assert.equal(actual.identity.accepted_effort, 'high')
})
test('Copilot rejects ambiguous, stale, malformed or unverified outcomes', () => {
  const mutations = [
    f => f.records.pop(),
    f => f.records.push(f.records.at(-1)),
    f => f.records.push({ type: 'assistant.idle' }),
    f => { f.records.at(-1).exitCode = 1 },
    f => { f.records.at(-1).sessionId = 'old' },
    f => { f.records[0].data.content = 'not JSON' },
    f => { f.records[0].data.content = JSON.stringify({ ...outcome, attempt_id: 'stale' }) },
    f => { f.records[0].data.originatingMessageId = 'subagent' },
    f => { f.records[0].data.model = 'fallback' },
    f => { f.records[0].data.toolRequests = [{ name: 'view' }] },
    f => { delete f.records[0].data.toolRequests },
    f => f.saved.shift(),
    f => f.saved.push(f.saved[0]),
    f => { f.saved[0].data.reasoningEffort = 'low' },
    f => { f.saved[0].data.selectedModel = 'fallback' },
    f => { f.saved[1].data.content = 'old prompt' },
    f => f.saved.push(f.saved[1]),
    f => f.records.unshift({ type: 'session.error', data: { errorType: 'fatal' } }),
    f => f.records.unshift({ type: 'assistant.message', data: { originatingMessageId: 'root', model: 'fallback' } })
  ]
  for (const mutate of mutations) {
    const f = fixture()
    mutate(f)
    assert.throws(() => parse(f), undefined, mutate.toString())
  }
  const f = fixture()
  assert.throws(() => parse_copilot_result('not JSON\n' + line(f.records), {
    session_source: line(f.saved), session_id: 'session', selection, prompt: 'prompt', attempt }))
})
test('curated environment preserves HOME and explicit credentials, excludes executable config and telemetry', () => {
  const source = { HOME: '/owner', PATH: '/bin', PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\System32\\cmd.exe', COPILOT_PROVIDER_API_KEY: 'secret',
    COPILOT_HOME: '/foreign', COPILOT_ALLOW_ALL: 'true', COPILOT_PROVIDER_API_KEY_COMMAND: 'untrusted',
    BASH_ENV: '/hook', NODE_OPTIONS: '--require hook', OTEL_EXPORTER_OTLP_HEADERS: 'secret' }
  const env = copilot_environment('/owned', source)
  assert.equal(env.HOME, '/owner')
  assert.equal(env.PATHEXT, source.PATHEXT)
  assert.equal(env.ComSpec, source.ComSpec)
  assert.equal(env.COPILOT_HOME, '/owned')
  assert.equal(env.COPILOT_PROVIDER_API_KEY, 'secret')
  for (const name of ['BASH_ENV', 'NODE_OPTIONS', 'OTEL_EXPORTER_OTLP_HEADERS', 'COPILOT_ALLOW_ALL', 'COPILOT_PROVIDER_API_KEY_COMMAND'])
    assert.equal(env[name], undefined)
  assert.equal(source.COPILOT_HOME, '/foreign')
})
test('Copilot editing exposes the platform shell and model editing tools; read-only exposes neither', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    assert.deepEqual(copilot_tools(false, platform), ['view', 'glob', 'grep'])
    assert.deepEqual(copilot_tools(true, platform), ['view', 'glob', 'grep', 'create', 'edit', 'apply_patch',
      platform === 'win32' ? 'powershell' : 'bash'])
  }
})
test('launch arguments preserve Codex and Claude branches and scope Copilot tools without provider calls', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-copilot-test-')))
  const executable = path.join(root, 'fake-cli.js')
  // Always fail before parsing: this fixture observes invocation only, with no model call.
  fs.writeFileSync(executable, '#!' + process.execPath + '\nprocess.exitCode = 1\n', { mode: 0o700 })
  for (const provider of ['codex', 'claude', 'copilot']) {
    for (const role of ['task', 'review', 'repair']) {
      const dir = path.join(root, provider + '-' + role)
      await assert.rejects(launch_agent({ selection: { ...selection, provider, executable }, role,
        cwd: root, prompt: 'bounded', attempt, attempt_dir: dir }), /Worker failed/)
      const launch = JSON.parse(fs.readFileSync(path.join(dir, 'launch.json')))
      const args = launch.command.slice(1)
      const prompt = fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8')
      assert.equal(prompt.includes('exactly one raw JSON object'), provider === 'copilot')
      assert.equal(prompt.includes('actual ordinary notebook Reply'), provider === 'copilot' && role === 'task')
      if (provider === 'codex') {
        assert.equal(args[0], 'exec')
        assert.equal(args.includes('multi_agent'), role !== 'task')
        assert.equal(args[args.indexOf('-s') + 1], role === 'review' ? 'read-only' : 'workspace-write')
        assert.equal(args.includes('sandbox_workspace_write.network_access=true'),
          role !== 'review' && process.env.CODEX_SANDBOX_NETWORK_DISABLED !== '1')
        assert.ok(args.includes('model_reasoning_effort="high"'))
      } else if (provider === 'claude') {
        assert.ok(args.includes('--safe-mode'))
        assert.equal(args[args.indexOf('--tools') + 1], role === 'review' ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash')
        assert.equal(args.includes('--add-dir'), role === 'task')
      } else {
        assert.match(launch.session_id, /^[a-f0-9-]{36}$/)
        assert.equal(args[args.indexOf('--session-id') + 1], launch.session_id)
        assert.deepEqual(args.slice(args.indexOf('--available-tools') + 1, args.indexOf('--allow-tool')),
          role === 'review' ? ['view', 'glob', 'grep'] : ['view', 'glob', 'grep', 'create', 'edit', 'apply_patch',
            process.platform === 'win32' ? 'powershell' : 'bash'])
        assert.equal(args[args.indexOf('--reasoning-effort') + 1], 'high')
        assert.equal(args.includes('--allow-all'), false)
        assert.equal(args.includes('--yolo'), false)
        assert.equal(args.includes('--resume'), false)
        assert.equal(args.includes('--add-dir'), role === 'task')
        assert.ok(args.includes('--no-custom-instructions'))
        assert.ok(args.includes('--no-remote-export'))
        assert.ok(fs.statSync(launch.home).isDirectory())
        assert.equal(fs.existsSync(path.join(launch.home, 'providers.json')), false)
      }
    }
  }
})
test('Copilot launch accepts only owned persisted session evidence and saves nonsecret identity', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-copilot-result-')))
  const executable = path.join(root, 'fake-copilot.js')
  fs.writeFileSync(executable, '#!' + process.execPath + '\n' + `
const fs = require('node:fs'), path = require('node:path')
const args = process.argv.slice(2)
const get = flag => args[args.indexOf(flag) + 1]
const prompt = fs.readFileSync(0, 'utf8')
const sessionId = get('--session-id')
const dir = path.join(process.env.COPILOT_HOME, 'session-state', sessionId)
fs.mkdirSync(dir, { recursive: true })
const start = { type: 'session.start', data: { sessionId, selectedModel: get('--model'), reasoningEffort: get('--reasoning-effort'), copilotVersion: 'fixture' } }
const root = { type: 'user.message', data: { messageId: 'root', content: prompt, parentAgentTaskId: 'root-is-not-subagent' } }
fs.writeFileSync(path.join(dir, 'events.jsonl'), [start, root].map(JSON.stringify).join('\\n'))
console.log(JSON.stringify({ type: 'assistant.message', data: { originatingMessageId: 'root', model: get('--model'), toolRequests: [], content: JSON.stringify(${JSON.stringify(outcome)}) } }))
console.log(JSON.stringify({ type: 'result', sessionId, exitCode: 0, usage: {} }))
`, { mode: 0o700 })
  const attempt_dir = path.join(root, 'attempt')
  assert.deepEqual(await launch_agent({ selection: { ...selection, executable }, role: 'review',
    cwd: root, prompt: ('Inspect \"quotes\"\n繁體中文 😀\n').repeat(3000), attempt, attempt_dir }), outcome)
  const proof = JSON.parse(fs.readFileSync(path.join(attempt_dir, 'identity.json')))
  assert.equal(proof.effective_effort, 'unproved')
  assert.equal(proof.observed_model, selection.model)
  assert.equal(proof.copilot_version, 'fixture')
  const launch = JSON.parse(fs.readFileSync(path.join(attempt_dir, 'launch.json')))
  assert.equal(launch.session_id, proof.session_id)
  assert.equal(launch.command.includes('-p'), false)
  assert.deepEqual(launch.resolved_command.slice(0, 2), [process.execPath, executable])
  const saved = fs.readFileSync(path.join(launch.home, 'session-state', launch.session_id, 'events.jsonl'), 'utf8')
  const root_message = saved.split('\n').map(JSON.parse).find(event => event.type === 'user.message').data.content
  assert.ok(root_message.length > 32767)
  assert.equal(root_message, fs.readFileSync(path.join(attempt_dir, 'prompt.txt'), 'utf8'))
})


test('Copilot catalog selection preserves exact pairs, schema boundaries and legacy counterparts', () => {
  const L = require('./looper')
  const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aglite-copilot-selection-')))
  fs.mkdirSync(path.join(repo, '.agentflow'))
  const file = path.join(repo, '.agentflow/ag.json')
  const config = { 'schema-version': current_schema, switches: { 'saving-mode': 'off' }, 'pipeline-roles': { implementation: 'basic' },
    'model-family': { selected: { basic: 'exact-model/high' } },
    'native-workers': { implementation: { 'model-family': 'unused-native' } },
    'looper-routes': { task: { kind: 'cli', provider: 'copilot', 'model-family': 'selected' } } }
  const save = () => fs.writeFileSync(file, JSON.stringify(config))
  for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    config['model-family'].selected.basic = `exact-model/${effort}`; save()
    const selected = L.select(L.read_settings(repo), 'task')
    assert.equal(selected.model, 'exact-model')
    assert.equal(selected.effort, effort)
    assert.equal(selected.source.route, 'task')
  }
  config['model-family'].selected.basic = 'exact-model/unsupported'; save()
  assert.throws(() => L.select(L.read_settings(repo), 'task'), /Unsupported selected effort/)
  config['schema-version'] = 11; save()
  const bytes = fs.readFileSync(file)
  assert.throws(() => L.read_settings(repo), new RegExp(`migrate to integer ${current_schema}`))
  assert.deepEqual(fs.readFileSync(file), bytes)
  config['schema-version'] = current_schema + 1; save()
  assert.throws(() => L.read_settings(repo), new RegExp(`migrate to integer ${current_schema}`))
})
