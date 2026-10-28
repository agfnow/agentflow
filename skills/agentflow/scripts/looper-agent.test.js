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

test('sandbox startup diagnostic is distinct from a harmless PATH alias warning', () => {
  const source = 'WARNING: proceeding, even though we could not create PATH aliases: Operation not permitted (os error 1)\n' +
    'Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)\n'
  assert.equal(A.provider_error(source), 'Error: failed to initialize in-process app-server client: Operation not permitted (os error 1)')
  assert.equal(A.provider_error(source.split('\n')[0]), '')
  const capacity = JSON.stringify({ type: 'error', message: 'Selected model is at capacity.' })
  assert.equal(A.provider_error(capacity + '\n' + capacity), 'Selected model is at capacity.')
  assert.ok(A.diagnostic_text('x'.repeat(5000)).length <= 800)
  assert.doesNotMatch(A.diagnostic_text('Bearer abcdef\napi_key=abcdef; sk-abcdefgh1234'), /abcdef/)
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
