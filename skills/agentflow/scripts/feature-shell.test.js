'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, execFileSync } = require('node:child_process')
const S = require('./feature-shell')
const { main } = require('./agf')

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-shell-')))
  t.after(() => { if (process.platform === 'darwin') execFileSync('/usr/bin/trash', [root]) })
  return root
}

test('destination channel rejects links, public files, contents and relative paths', t => {
  const root = fixture(t), file = path.join(root, 'channel')
  fs.writeFileSync(file, '', { mode: 0o600 })
  S.destination(file, root)
  assert.equal(fs.readFileSync(file, 'utf8'), root + '\n')
  fs.writeFileSync(file, '')
  S.destination(file, root, 'Localized hint')
  assert.equal(fs.readFileSync(file, 'utf8'), root + '\nLocalized hint\n')
  fs.writeFileSync(file, '')
  assert.throws(() => S.destination(file, root, 'injected\nline'), /Invalid.*hint/)
  S.destination(file, root)
  assert.throws(() => S.destination(file, root), /empty private/)
  fs.writeFileSync(file, '')
  const link = path.join(root, 'link'); fs.symlinkSync(file, link)
  assert.throws(() => S.destination(link, root), /regular/)
  fs.linkSync(file, path.join(root, 'hardlink'))
  assert.throws(() => S.channel(file), /one link/)
  assert.throws(() => S.channel('relative'), /absolute/)
  const publicFile = path.join(root, 'public'); fs.writeFileSync(publicFile, '', { mode: 0o644 })
  if (process.platform !== 'win32') assert.throws(() => S.channel(publicFile), /private/)
})

for (const shell of ['bash', 'zsh']) test(`${shell} preserves argv/output/status and switches only after success`, t => {
  const probe = spawnSync(shell, ['--version'], { encoding: 'utf8' })
  if (probe.error) return t.skip(`${shell} unavailable`)
  const root = fixture(t), destination = path.join(root, "target space '測試"), launcher = path.join(root, "fake ' launcher.js")
  fs.mkdirSync(destination)
  fs.writeFileSync(launcher, `const fs=require('node:fs'); console.log('ordinary stdout: cd /'); console.error('ordinary stderr'); if(process.env.AGF_CD_FILE)fs.writeFileSync(process.env.AGF_CD_FILE, process.env.TEST_DEST+'\\n'+(process.env.AGF_CD_HINT==='1'?'Open agent $(touch forbidden) \`touch forbidden\`\\n':'')); console.log(JSON.stringify(process.argv.slice(2))); process.exit(process.argv[3]==='fail'?7:0)\n`)
  const literal = '`touch forbidden` $(touch forbidden) ; spaces 測試'
  const source = S.binding(shell, launcher) + '\nagf newft ' + S.quote(literal) + '\nprintf "RESULT:%s:%s\\n" "$?" "$PWD"\nagf newft fail\nprintf "FAILURE:%s:%s\\n" "$?" "$PWD"\nagf looper status\nprintf "LOOP:%s:%s\\n" "$?" "$PWD"\n'
  const r = spawnSync(shell, ['-c', source], { cwd: root, env: { ...process.env, TEST_DEST: destination }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes(JSON.stringify(['newft', literal])), r.stdout)
  assert.ok(r.stdout.includes(`RESULT:0:${destination}`), r.stdout)
  assert.ok(r.stdout.includes(`FAILURE:7:${destination}`), r.stdout)
  assert.ok(r.stdout.includes(`LOOP:0:${destination}`), r.stdout)
  assert.match(r.stdout, /ordinary stdout: cd \//)
  assert.match(r.stderr, /ordinary stderr/)
  assert.equal(r.stdout.split('Open agent $(touch forbidden) `touch forbidden`').length - 1, 1)
  const failed = spawnSync(shell, ['-c', S.binding(shell, launcher) + '\ncd() { return 9; }\nagf newft demo\nprintf \"STATUS:%s\\n\" \"$?\"'], { cwd: root, env: { ...process.env, TEST_DEST: destination }, encoding: 'utf8' })
  assert.match(failed.stdout, /STATUS:9/)
  assert.match(failed.stdout, /cd -- /)
  assert.match(failed.stdout, /Open agent/)
  const fallback = failed.stdout.split('\n').find(line => line.startsWith('cd -- '))
  const manual = spawnSync(shell, ['-c', fallback + '\npwd -P'], { cwd: root, encoding: 'utf8' })
  assert.equal(manual.status, 0, manual.stderr)
  assert.equal(manual.stdout.trim(), destination)
  assert.equal(fs.existsSync(path.join(root, 'forbidden')), false)
  assert.equal(fs.existsSync(path.join(destination, 'forbidden')), false)
})

test('dispatcher validates before effects, routes aliases, and publishes only success', async t => {
  const root = fixture(t), channel = path.join(root, 'channel')
  fs.writeFileSync(channel, '', { mode: 0o600 })
  const chunks = [], errors = [], calls = []
  const io = { cwd: root, cdFile: channel, stdout: { write: s => chunks.push(s) }, stderr: { write: s => errors.push(s) }, feature: {
    create: async (name, options) => { calls.push({ name, options }); return { message: 'created', destination: root } },
    merge: async (name, options) => { calls.push({ name, options }); throw Error('check failed') },
  } }
  assert.equal(await main(['newft', 'demo', '--abandon'], io), 1)
  assert.equal(calls.length, 0)
  assert.equal(await main(['newft', 'demo', '--open'], io), 0)
  assert.equal(calls[0].options.open, true)
  assert.equal(fs.readFileSync(channel, 'utf8'), root + '\n')
  fs.writeFileSync(channel, '')
  assert.equal(await main(['mergeft', 'demo', '--include', 'a.txt', '--check', '["node","test.js"]'], io), 1)
  assert.equal(fs.readFileSync(channel, 'utf8'), '')
  assert.deepEqual(calls[1].options.include, ['a.txt'])
  assert.deepEqual(calls[1].options.checks, [['node', 'test.js']])
  assert.match(errors.join(''), /check failed/)
  const before = calls.length
  for (const args of [['mergeft', '--include', '../escape'], ['mergeft', '--check', '{}'], ['newft', 'demo', '--open', '--open'], ['newft', 'demo', '--vscode'], ['dropft', 'a', 'b']])
    assert.equal(await main(args, io), 1)
  assert.equal(calls.length, before)
})

test('real terminal CLI aliases create, snapshot, merge and clean up without reading main records', { skip: process.platform !== 'darwin' }, async t => {
  const root = fixture(t), C = require('./feature-common'), launcher = path.resolve(__dirname, 'agf.js')
  C.git(root, ['init', '-b', 'main']); C.git(root, ['config', 'user.name', 'CLI fixture']); C.git(root, ['config', 'user.email', 'cli@example.invalid'])
  fs.mkdirSync(path.join(root, '.records'))
  fs.writeFileSync(path.join(root, '.records/ag.json'), JSON.stringify({ 'schema-version': 13, switches: { 'ag-dir': '.records', 'notebook-name': 'root.md', 'saving-mode': 'off', 'auto-commit': 'off', 'auto-push': 'off' } }))
  fs.writeFileSync(path.join(root, '.records/root.md'), 'Owner main notebook stays private.\n')
  fs.writeFileSync(path.join(root, 'product.txt'), 'base\n')
  C.git(root, ['add', '--', '.records/ag.json', '.records/root.md', 'product.txt']); C.git(root, ['commit', '-m', 'baseline'])
  fs.writeFileSync(path.join(root, '.records/.root.md.owner'), 'foreign root claim; no semantic read allowed')
  const invoke = args => spawnSync(process.execPath, [launcher, ...args], { cwd: root, encoding: 'utf8', timeout: 120000, env: { ...process.env, AGF_CD_FILE: '' } })
  const created = invoke(['newft', 'demo']); assert.equal(created.status, 0, created.stderr)
  assert.match(created.stdout, /Feature ready: [^\n]+\n\nNotebook:/)
  assert.equal((created.stdout.match(/cd -- /g) || []).length, 1)
  assert.match(created.stdout, /\n\nAfter changing directory, open your coding agent/)
  const target = path.join(root, '.wts/ft-demo'), notebook = '.records/features/demo/demo.devlog.md'
  fs.writeFileSync(path.join(target, 'product.txt'), 'CLI authorized task\n')
  const merged = invoke(['mergeft', 'demo', '--cleanup', '--include', 'product.txt', '--check', JSON.stringify([process.execPath, '-e', 'const fs=require("node:fs");if(fs.readFileSync("product.txt","utf8")!=="CLI authorized task\\n")process.exit(8)'])])
  assert.equal(merged.status, 0, merged.stderr + merged.stdout)
  assert.equal(fs.readFileSync(path.join(root, 'product.txt'), 'utf8'), 'CLI authorized task\n')
  assert.equal(fs.readFileSync(path.join(root, '.records/root.md'), 'utf8'), 'Owner main notebook stays private.\n')
  assert.match(fs.readFileSync(path.join(root, notebook), 'utf8'), /merged/)
  assert.equal(fs.existsSync(target), false)
  assert.equal(C.git(root, ['show-ref', '--verify', 'refs/heads/feature/demo'], { allowFailure: true }).status, 128)
})

test('terminal SIGINT waits for detached checks to stop before exiting and leaves main unchanged', { skip: process.platform !== 'darwin', timeout: 30000 }, async t => {
  const { spawn } = require('node:child_process'), C = require('./feature-common'), P = require('./looper-state')
  const root = fixture(t), ready = path.join(root, 'check-ready.json'), launcher = path.resolve(__dirname, 'agf.js')
  C.git(root, ['init', '-b', 'main']); C.git(root, ['config', 'user.name', 'Signal fixture']); C.git(root, ['config', 'user.email', 'signal@example.invalid'])
  fs.mkdirSync(path.join(root, '.agentflow'))
  fs.writeFileSync(path.join(root, '.agentflow/ag.json'), JSON.stringify({ 'schema-version': 13, switches: { 'saving-mode': 'off', 'auto-commit': 'off', 'auto-push': 'off' } }))
  fs.writeFileSync(path.join(root, 'product'), 'base\n')
  C.git(root, ['add', '--', '.agentflow/ag.json', 'product']); C.git(root, ['commit', '-m', 'baseline'])
  const head = C.git(root, ['rev-parse', 'HEAD'])
  await require('./feature').create('signal', { cwd: root })
  const source = `const fs=require('node:fs'),P=require(${JSON.stringify(path.resolve(__dirname, 'looper-state.js'))});fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,started_at:P.process_identity(process.pid)}));setInterval(()=>{},1000)`
  const child = spawn(process.execPath, [launcher, 'mergeft', 'signal', '--check', JSON.stringify([process.execPath, '-e', source])], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = '', observed
  child.stdout.on('data', x => { output += x }); child.stderr.on('data', x => { output += x })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  t.after(() => {
    if (observed && P.process_alive(observed) === true) { try { process.kill(-observed.pid, 'SIGKILL') } catch {} }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  })
  const deadline = Date.now() + 15000
  while (!fs.existsSync(ready) && Date.now() < deadline && child.exitCode === null && child.signalCode === null)
    await new Promise(resolve => setTimeout(resolve, 50))
  assert.ok(fs.existsSync(ready), output)
  observed = JSON.parse(fs.readFileSync(ready, 'utf8'))
  child.kill('SIGINT')
  const result = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve(null), 10000).unref())])
  assert.ok(result, 'CLI did not settle after SIGINT')
  assert.notEqual(result.code, 0, output)
  assert.equal(P.process_alive(observed), false, output)
  assert.equal(C.git(root, ['rev-parse', 'HEAD']), head)
})

for (const shell of ['bash', 'zsh']) for (const lang of ['en-us', 'zh-tw']) test(`${shell} creation guidance follows actual switching (${lang})`, { skip: process.platform !== 'darwin' }, t => {
  const base = fixture(t), root = path.join(base, "space ' $(touch sentinel) `touch sentinel-two` 測試"), C = require('./feature-common'), launcher = path.resolve(__dirname, 'agf.js')
  fs.mkdirSync(root)
  C.git(root, ['init', '-b', 'main']); C.git(root, ['config', 'user.name', 'Hint fixture']); C.git(root, ['config', 'user.email', 'hint@example.invalid'])
  fs.mkdirSync(path.join(root, '.agentflow'))
  fs.writeFileSync(path.join(root, '.agentflow/ag.json'), JSON.stringify({ 'schema-version': 13, switches: { 'saving-mode': 'off', 'use-lang': lang } }))
  C.git(root, ['add', '.agentflow/ag.json']); C.git(root, ['commit', '-m', 'configured'])
  const direct = spawnSync(process.execPath, [launcher, 'newft', 'spaced'], { cwd: root, encoding: 'utf8', env: { ...process.env, AGF_CD_FILE: '' } })
  assert.equal(direct.status, 0, direct.stderr)
  assert.match(direct.stdout, lang === 'en-us' ? /Continue: cd -- [^\n]+\n\nAfter changing directory/ : /接續操作：cd -- [^\n]+\n\n切換目錄後/)
  const source = S.binding(shell, launcher) + '\nagf newft spaced\nprintf "RESULT:%s:%s\\n" "$?" "$PWD"'
  const r = spawnSync(shell, ['-c', source], { cwd: root, encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, r.stderr)
  const target = path.join(root, '.wts/ft-spaced')
  assert.ok(r.stdout.includes(`RESULT:0:${target}`), r.stdout)
  assert.doesNotMatch(r.stdout, /Continue:|接續操作：|cd -- /)
  assert.equal(fs.existsSync(path.join(root, 'sentinel')), false)
  assert.equal(fs.existsSync(path.join(root, 'sentinel-two')), false)
  assert.match(r.stdout, lang === 'en-us' ? /Notebook: [^\n]+\n\nOpen your coding agent/ : /筆記本：[^\n]+\n\n在新的功能工作目錄開啟 coding agent/)
  const dropped = spawnSync(process.execPath, [launcher, 'dropft', 'spaced', '--abandon'], { cwd: root, encoding: 'utf8', env: { ...process.env, AGF_CD_FILE: '' } })
  assert.equal(dropped.status, 0, dropped.stderr)
  assert.match(dropped.stdout, lang === 'en-us' ? /Removed [^\n]+\n\nUnregistered[^\n]+\n\nRecoverable checkout:/ : /已移除 [^\n]+\n\n已取消[^\n]+\n\n可復原的工作目錄：/)
})

test('dispatcher retains recovery output when channel publication fails and separates old/new wrappers', async t => {
  const root = fixture(t), channel = path.join(root, 'channel'), chunks = []
  const io = { cwd: root, cdFile: channel, cdHint: '1', stdout: { write: s => chunks.push(s) }, stderr: { write() {} }, feature: {
    create: async () => ({ message: 'Ready', destination: root, continuation: 'Continue: cd example', directHint: 'After switching', hint: 'Open agent' }),
    drop: async () => { fs.writeFileSync(channel, 'changed'); return { message: 'Recoverable checkout: /Trash/exact', destination: root } },
  } }
  fs.writeFileSync(channel, '', { mode: 0o600 })
  assert.equal(await main(['newft', 'example'], io), 0)
  assert.doesNotMatch(chunks.join(''), /Continue:/)
  assert.equal(fs.readFileSync(channel, 'utf8'), root + '\nOpen agent\n')
  chunks.length = 0; fs.writeFileSync(channel, ''); io.cdHint = '0'
  assert.equal(await main(['newft', 'example'], io), 0)
  assert.match(chunks.join(''), /Continue: cd example\n\nAfter switching/)
  assert.equal(fs.readFileSync(channel, 'utf8'), root + '\n')
  chunks.length = 0; fs.writeFileSync(channel, '')
  assert.equal(await main(['dropft', 'example', '--abandon'], io), 1)
  assert.match(chunks.join(''), /Recoverable checkout: \/Trash\/exact/)
})
