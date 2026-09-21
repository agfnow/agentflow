'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')

const { inspect_notebook_rounds, verify_gate } = require('./looper-live-gate')

const notebook = rounds => `${Array.from({ length: rounds }, (_, index) => `# → Ask / A-${String(index + 1).padStart(3, '0')}\n\n+ plan\n\n# ← Reply / A-${String(index + 1).padStart(3, '0')}\n\ncomplete\n\n`).join('')}# → Ask / A-${String(rounds + 1).padStart(3, '0')}\n\n+\n`

test('kept live-gate state stays below home tmp even when setup fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live-gate-location-'))
  t.after(() => execFileSync('trash', [root]))
  const fakeHome = path.join(root, 'home'), fakeTemp = path.join(root, 'system-temp')
  fs.mkdirSync(fakeHome)
  fs.mkdirSync(fakeTemp)
  const module = { exports: {} }
  let launches = 0
  const load = name => name === 'node:os' ? { homedir: () => fakeHome, tmpdir: () => fakeTemp }
    : name === 'node:child_process' ? { spawnSync: command => {
      launches += 1
      assert.equal(command, 'git', 'the deterministic fixture must stop before model execution')
      return { status: 1, stderr: 'synthetic setup failure' }
    } } : require(name)
  load.main = module
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'looper-live-gate.js'), 'utf8'), {
    require: load, module, __dirname, process: {
      argv: ['node', 'looper-live-gate.js', '--keep'], env: {}, execPath: process.execPath,
      stdout: { write() {} }, stderr: { write() {} },
    },
  })
  assert.equal(launches, 1)
  assert.deepEqual(fs.readdirSync(fakeHome), ['tmp'])
  assert.equal(fs.readdirSync(path.join(fakeHome, 'tmp')).filter(n => /^\.agentflow-looper-live-gate-state-/.test(n)).length, 1)
})

test('notebook proof requires two completed rounds and a following Ask', () => {
  assert.deepEqual(inspect_notebook_rounds(notebook(1)), { reply_ids: [1], next_ask_id: 2, complete: false })
  assert.deepEqual(inspect_notebook_rounds(notebook(2)), { reply_ids: [1, 2], next_ask_id: 3, complete: true })
  assert.equal(inspect_notebook_rounds('# → Ask / A-001\n\n+\n\n# ← Reply / A-001\n').complete, false)
})

test('live gate verdict requires every owner-named outcome', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'looper-gate-verdict-'))
  try {
    fs.mkdirSync(path.join(repo, '.agentflow', 'planned', 'done'), { recursive: true })
    fs.writeFileSync(path.join(repo, '.agentflow', 'devlog.md'), notebook(2))
    fs.writeFileSync(path.join(repo, 'product-one.txt'), '1111\n')
    fs.writeFileSync(path.join(repo, 'product-two.txt'), '2222\n')
    fs.writeFileSync(path.join(repo, '.agentflow', 'planned', 'done', 'plan-001.md'), 'one\n')
    fs.writeFileSync(path.join(repo, '.agentflow', 'planned', 'done', 'plan-002.md'), 'two\n')
    assert.equal(verify_gate({ repo, process_status: 0 }).passed, true)
    fs.unlinkSync(path.join(repo, 'product-two.txt'))
    const failed = verify_gate({ repo, process_status: 0 })
    assert.equal(failed.passed, false)
    assert.deepEqual(failed.failures, ['product_two'])
  } finally {
    fs.rmSync(repo, { recursive: true, force: true })
  }
})
