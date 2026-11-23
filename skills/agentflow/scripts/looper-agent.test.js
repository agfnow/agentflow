'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const A = require('./looper-agent')

const fixture = source => {
  const cwd = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-diagnostic-')))
  const executable = path.join(cwd, 'provider.js')
  fs.writeFileSync(executable, '#!/usr/bin/env node\n' + source, { mode: 0o700 })
  const attempt = { id: crypto.randomUUID() }
  return { cwd, attempt, attempt_dir: path.join(cwd, attempt.id), role: 'task',
    prompt: 'Complete the bounded assignment.',
    selection: { kind: 'cli', provider: 'codex', model: 'gpt-6.1-sol', effort: 'low', executable } }
}

test('provider failures retain structured diagnostics and evidence identity without tool output', async () => {
  const args = fixture(`
    console.log(JSON.stringify({type:'item.completed',item:{aggregated_output:'private owner text'}}));
    console.log(JSON.stringify({type:'turn.failed',error:{message:'Quota exhausted; access_token=secret-value'}}));
    process.exitCode=1;
  `)
  await assert.rejects(A.launch_agent(args), error => {
    assert.match(error.message, /codex\/task execution/)
    assert.match(error.message, /Quota exhausted/)
    assert.doesNotMatch(error.message, /secret-value|private owner text/)
    assert.ok(error.message.includes(path.join(args.attempt_dir, 'failure.json')))
    return true
  })
  const failure = JSON.parse(fs.readFileSync(path.join(args.attempt_dir, 'failure.json')))
  assert.equal(failure.attempt_id, args.attempt.id)
  assert.equal(failure.observation.exit_code, 1)
  assert.equal(failure.transcript, path.join(args.attempt_dir, 'transcript.log'))
  assert.ok(fs.existsSync(path.join(args.attempt_dir, 'exit.json')))
})

test('exit zero without a valid result remains a result failure with saved identity', async () => {
  for (const source of [
    'process.exitCode=0;',
    `require('node:fs').writeFileSync(process.argv[process.argv.indexOf('-o')+1], '{"outcome":"pass"}')`
  ]) {
    const args = fixture(source)
    await assert.rejects(A.launch_agent(args), /codex\/task result/)
    const failure = JSON.parse(fs.readFileSync(path.join(args.attempt_dir, 'failure.json')))
    assert.equal(failure.stage, 'result')
    assert.equal(failure.observation.exit_code, 0)
    assert.equal(failure.attempt_id, args.attempt.id)
  }
})

test('worker timeout stops the process and records the applied duration', async () => {
  const args = fixture('setInterval(() => {}, 1000)')
  const signal = AbortSignal.timeout(5000)
  await assert.rejects(A.launch_agent({ ...args, timeout_ms: 300, signal }), /Worker timed out/)
  const launch = JSON.parse(fs.readFileSync(path.join(args.attempt_dir, 'launch.json')))
  assert.equal(launch.timeout_ms, 300)
  const exit = JSON.parse(fs.readFileSync(path.join(args.attempt_dir, 'exit.json')))
  assert.equal(exit.timed_out, true)
})

test('sandbox startup diagnostic is distinct from a harmless PATH alias warning', () => {
  const source = 'WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)\n' +
    'Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)\n'
  assert.equal(A.provider_error(source), 'Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)')
  assert.equal(A.provider_error(source.split('\n')[0]), '')
  const capacity = JSON.stringify({ type: 'error', message: 'Selected model is at capacity.' })
  assert.equal(A.provider_error(capacity + '\n' + capacity), 'Selected model is at capacity.')
  assert.ok(A.diagnostic_text('x'.repeat(5000)).length <= 800)
  assert.doesNotMatch(A.diagnostic_text('Bearer abcdef\napi_key=abcdef; sk-abcdefgh1234'), /abcdef/)
  assert.equal(A.diagnostic_text('Proxy http://owner:fake-password@proxy.example:8080'),
    'Proxy http://[redacted]@proxy.example:8080')
  assert.equal(A.diagnostic_text('Proxy socks5h://owner:fake-password@proxy.example'),
    'Proxy socks5h://[redacted]@proxy.example')
  assert.doesNotMatch(A.diagnostic_text('Proxy-Authorization: Basic fake-credential'), /fake-credential/)
})

test('missing provider executable retains the failed launch rather than implying a task verdict', async () => {
  const args = fixture('')
  args.selection.executable = path.join(args.cwd, 'provider-does-not-exist')
  await assert.rejects(A.launch_agent(args), /Worker failed/)
  const failure = JSON.parse(fs.readFileSync(path.join(args.attempt_dir, 'failure.json')))
  assert.match(failure.message, /ENOENT|not found/i)
  assert.equal(failure.observation.spawned, false)
  assert.equal(fs.existsSync(path.join(args.attempt_dir, 'result.json')), false)
})

test('latest Codex model uses the selected executable and ranks eligible versions', async () => {
  const { cwd, selection } = fixture(`
    const readline = require('node:readline');
    const row = (model, effort='high', hidden=false) => ({
      model, hidden, supportedReasoningEfforts:[{reasoningEffort:effort}]
    });
    require('node:assert/strict').ok(process.argv.includes('app-server'));
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const {id, method, params} = JSON.parse(line);
      if (method === 'initialize') console.log(JSON.stringify({id, result:{}}));
      if (method === 'config/read') console.log(JSON.stringify({id, result:{config:{
        model_provider:require('node:fs').existsSync('custom-provider') ? 'custom' : 'openai',
        model_catalog_json:require('node:fs').existsSync('overridden') ? 'private-catalog.json' : null
      }}}));
      if (method !== 'model/list') return;
      const data = params.cursor ? [row('gpt-6.10-sol'), row('gpt-7-sol', 'low')] :
        [row('gpt-6.2-sol'), row('gpt-9-sol', 'high', true), row('gpt-9-astra'),
         row('gpt-9-sol-preview'), row('gpt-6-sol')];
      console.log(JSON.stringify({id, result:{data, nextCursor:params.cursor ? null : 'next'}}));
    });
  `)
  const latest = { ...selection, model: 'gpt-latest-sol', effort: 'high' }
  assert.equal((await A.resolve_latest(latest, cwd)).model, 'gpt-6.10-sol')
  await assert.rejects(A.resolve_latest({ ...latest, effort: 'medium' }, cwd), /no eligible/)
  const abort = new AbortController()
  const reason = new Error('Selection stopped')
  let launched
  const resolving = A.resolve_latest(latest, cwd, abort.signal, {
    on_launch: identity => {
      launched = identity
      abort.abort(reason)
    }
  })
  await assert.rejects(resolving, error => error === reason)
  assert.equal(launched.kind, 'catalog')
  assert.throws(() => process.kill(launched.pid, 0), { code: 'ESRCH' })
  fs.writeFileSync(path.join(cwd, 'custom-provider'), '')
  await assert.rejects(A.resolve_latest(latest, cwd), /catalog unavailable/)
  fs.renameSync(path.join(cwd, 'custom-provider'), path.join(cwd, 'was-custom-provider'))
  fs.writeFileSync(path.join(cwd, 'overridden'), '')
  await assert.rejects(A.resolve_latest(latest, cwd), /catalog unavailable/)
  const pin = { ...selection, executable: 'should-not-launch' }
  assert.equal(await A.resolve_latest(pin, cwd), pin)
})

test('latest Claude model requires a concrete ID and effort from initialization', async () => {
  const { cwd, selection } = fixture(`
    const request = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));
    console.log(JSON.stringify({type:'control_response', response:{
      request_id:request.request_id, subtype:'success', response:{models:[
        {value:'opus',resolvedModel:'claude-opus-5-5',supportedEffortLevels:['high']},
        {value:'claude-opus-4-20250514',supportedEffortLevels:['medium']},
        {value:'claude-opus-4-8',supportedEffortLevels:['high','medium']},
        {value:'sonnet',supportedEffortLevels:['high']}
      ]}
    }}));
  `)
  const latest = { ...selection, provider: 'claude', model: 'claude-latest-opus', effort: 'high' }
  assert.equal((await A.resolve_latest(latest, cwd)).model, 'claude-opus-5-5')
  assert.equal((await A.resolve_latest({ ...latest, effort: 'medium' }, cwd)).model, 'claude-opus-4-8')
  await assert.rejects(A.resolve_latest({ ...latest, model: 'claude-latest-sonnet' }, cwd), /no eligible/)
  await assert.rejects(A.resolve_latest({ ...latest, executable: 'missing-catalog-executable' }, cwd), /catalog unavailable/)
})
