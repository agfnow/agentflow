'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')
const { merge } = require('./feature-merge')
const schema = require('../assets/.agentflow/ag.json')['schema-version']
const git = (cwd, ...argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
function fixture(physicalName) {
  let root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-merge-'))
  if (physicalName) { root = path.join(root, physicalName); fs.mkdirSync(root) }
  git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@localhost')
  fs.mkdirSync(path.join(root, '.agentflow'))
  fs.writeFileSync(path.join(root, '.agentflow/ag.json'), JSON.stringify({ 'schema-version': schema, switches: { 'saving-mode': 'off', 'notebook-name': 'root.devlog.md', 'auto-commit': 'off', 'auto-push': 'off' } }))
  fs.writeFileSync(path.join(root, '.agentflow/root.devlog.md'), 'private root\n')
  fs.writeFileSync(path.join(root, 'product'), 'base\n'); fs.writeFileSync(path.join(root, 'owner'), 'owner base\n')
  git(root, 'add', '.'); git(root, 'commit', '-m', 'base')
  const target = path.join(root, '.wts/ft-demo'); git(root, 'worktree', 'add', '-b', 'feature/demo', target)
  const dir = path.join(target, '.agentflow/features/demo'); fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'demo.devlog.md'), '# STATUS\n\nProven: previous work\n\nStream: open\n\nSession: active\n\nCleanup: N/A\n\n# → Ask / A-001\n\ndone\n\n# → Reply / A-001\n\nDone.\n\n# → Ask / A-002\n\n')
  fs.writeFileSync(path.join(target, 'product'), 'feature\n')
  fs.writeFileSync(path.join(target, '.agentflow/root.devlog.md'), 'excluded feature root\n')
  git(target, 'add', '.'); git(target, 'commit', '-m', 'feature')
  return { root, target, tip: git(target, 'rev-parse', 'HEAD') }
}
const checks = [[process.execPath, '-e', 'process.exit(0)']]
test('AC-3 scoped original-parent merge preserves owner staging and root bytes', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(f.root, 'owner'), 'owner staged\n'); git(f.root, 'add', 'owner')
  fs.appendFileSync(path.join(f.root, 'owner'), 'owner unstaged\n')
  fs.writeFileSync(path.join(f.root, '.agentflow/.root.devlog.md.owner'), 'foreign root claim')
  const index = git(f.root, 'ls-files', '--stage', 'owner')
  const result = await merge('demo', { cwd: f.root, checks })
  assert.match(result.message, /Retained/)
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'feature')
  assert.equal(git(f.root, 'show', 'HEAD:.agentflow/root.devlog.md'), 'private root')
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/root.devlog.md'), 'utf8'), 'private root\n')
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/.root.devlog.md.owner'), 'utf8'), 'foreign root claim')
  assert.equal(git(f.root, 'ls-files', '--stage', 'owner'), index)
  assert.equal(fs.readFileSync(path.join(f.root, 'owner'), 'utf8'), 'owner staged\nowner unstaged\n')
  assert.equal(git(f.root, 'show', '-s', '--format=%P', 'HEAD'), `${old} ${git(f.target, 'rev-parse', 'HEAD')}`)
})
test('failed check preserves refs and an explicit renewed command builds a fresh verified attempt', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  await assert.rejects(merge('demo', { cwd: f.root, checks: [[process.execPath, '-e', 'process.exit(9)']] }), /Recoverable merge state/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  await merge('demo', { cwd: f.root, checks })
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'feature')
})
test('real owner overlap stops before main mutation without configured checks', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(f.root, 'product'), 'owner work\n')
  await assert.rejects(merge('demo', { cwd: f.root }), /overlap/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  assert.equal(fs.readFileSync(path.join(f.root, 'product'), 'utf8'), 'owner work\n')
})
test('terminal no-check merge saves empty selection and reports unchecked completion on repeat', () => {
  for (const locale of ['en-us', 'zh-TW']) {
    const f = fixture(), cli = path.join(__dirname, 'agf.js')
    for (const root of [f.root, f.target]) {
      const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
      value.switches['use-lang'] = locale
      fs.writeFileSync(file, JSON.stringify(value))
      git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'locale')
    }
    if (locale === 'zh-TW') {
      fs.writeFileSync(path.join(f.target, 'package.json'), '{}')
      git(f.target, 'add', 'package.json'); git(f.target, 'commit', '-m', 'no test script')
    }
    const invoke = () => execFileSync(process.execPath, [cli, 'mergeft', 'demo'], { cwd: f.root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
    const output = invoke(), head = git(f.root, 'rev-parse', 'HEAD')
    const state = JSON.parse(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/merge-state.json')))
    assert.deepEqual(state.checks, [])
    assert.equal(state.phase, 'complete')
    assert.match(git(f.root, 'show', '-s', '--format=%B', state.commit), /no repository checks configured/)
    const notebook = fs.readFileSync(path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), 'utf8')
    const expected = locale === 'en-us' ? /No repository checks configured/ : /未設定儲存庫檢查/
    assert.match(output, expected); assert.match(notebook, expected)
    assert.match(notebook, /^Proven: (?:No repository checks configured|未設定儲存庫檢查)/m)
    assert.doesNotMatch(output + notebook, /checks passed|檢查已通過/i)
    assert.match(invoke(), expected)
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), head)
  }
})
test('npm fallback runs on candidate and integrated main; explicit checks override it', async () => {
  for (const mode of ['pass', 'fail', 'override']) {
    const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
    const testScript = mode === 'pass'
      ? `node -e "if(require('node:fs').readFileSync('product','utf8').trim()!=='feature')process.exit(8)"`
      : 'node -e "process.exit(9)"'
    fs.writeFileSync(path.join(f.target, 'package.json'), JSON.stringify({ scripts: { test: testScript } }))
    git(f.target, 'add', 'package.json'); git(f.target, 'commit', '-m', 'test script')
    if (mode === 'fail') {
      await assert.rejects(merge('demo', { cwd: f.root }), /failed\/cancelled/)
      assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
    } else {
      const result = await merge('demo', { cwd: f.root, ...(mode === 'override' ? { checks } : {}) })
      assert.match(result.message, /Repository checks passed/)
      const state = JSON.parse(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/merge-state.json')))
      assert.deepEqual(state.checks, mode === 'override' ? checks : [['npm', 'test']])
      assert.equal(state.mainChecksStarted, true)
      if (mode === 'pass') {
        const logs = fs.readdirSync(state.workspace).filter(file => /^process-.*\.log$/.test(file)).map(file => fs.readFileSync(path.join(state.workspace, file), 'utf8'))
        assert.equal(logs.filter(log => log.includes('> node -e')).length, 2)
      }
    }
  }
})
test('fallback uses merged candidate including main-only scripts and authorized test removal', async () => {
  for (const mode of ['main-fail', 'main-pass', 'removed']) {
    const f = fixture()
    fs.writeFileSync(path.join(f.root, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "process.exit(' + (mode === 'main-fail' ? 9 : 0) + ')"' } }))
    git(f.root, 'add', 'package.json'); git(f.root, 'commit', '-m', 'main test')
    if (mode === 'removed') {
      // Make the package part of the common base, then authorize its removal on the feature.
      git(f.target, 'merge', '--no-edit', 'main')
      git(f.target, 'rm', 'package.json'); git(f.target, 'commit', '-m', 'remove test package')
    }
    const old = git(f.root, 'rev-parse', 'HEAD')
    if (mode === 'main-fail') {
      await assert.rejects(merge('demo', { cwd: f.root }), /failed\/cancelled/)
      assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
    } else {
      const result = await merge('demo', { cwd: f.root })
      assert.match(result.message, mode === 'main-pass' ? /Repository checks passed/ : /No repository checks configured/)
    }
  }
})
test('explicit include snapshots exact authorized product files with original parent and no shell evaluation', async () => {
  const f = fixture()
  fs.writeFileSync(path.join(f.target, 'product'), 'authorized dirty\n')
  const before = git(f.target, 'rev-parse', 'HEAD')
  await merge('demo', { cwd: f.root, include: ['product'], checks: [[process.execPath, '-e', 'if(process.argv[1]!=="$(touch EVIL)")process.exit(1)', '$(touch EVIL)']] })
  const tip = git(f.target, 'rev-parse', 'HEAD')
  assert.notEqual(tip, before)
  assert.equal(git(f.target, 'show', '-s', '--format=%P', tip), before)
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'authorized dirty')
  assert.equal(fs.existsSync(path.join(f.target, 'EVIL')), false)
})
function diverge(f) {
  fs.writeFileSync(path.join(f.root, 'product'), 'main competing\n')
  git(f.root, 'add', 'product'); git(f.root, 'commit', '-m', 'main diverged')
}
function stub(f, body) {
  const file = path.join(f.root, 'codex-stub')
  fs.writeFileSync(file, '#!' + process.execPath + '\n' + body, { mode: 0o755 })
  return file
}
test('isolated conflict resolver accepts only conflict changes and preserves original merge parents', async () => {
  const f = fixture(); diverge(f)
  const old = git(f.root, 'rev-parse', 'HEAD')
  const codex = stub(f, 'const fs=require("node:fs");if(fs.existsSync(".agentflow/root.devlog.md"))process.exit(2);fs.writeFileSync("product","resolved both intentions\\n")')
  await merge('demo', { cwd: f.root, checks, codex })
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'resolved both intentions')
  assert.equal(git(f.root, 'show', '-s', '--format=%P', 'HEAD'), `${old} ${git(f.target, 'rev-parse', 'HEAD')}`)
})
test('resolver foreign path and Git metadata changes are rejected before integration', async () => {
  for (const body of ['require("node:fs").writeFileSync("owner","attack")', 'require("node:fs").appendFileSync(".git/config","\\n[evil]\\n")']) {
    const f = fixture(); diverge(f)
    const old = git(f.root, 'rev-parse', 'HEAD')
    await assert.rejects(merge('demo', { cwd: f.root, checks, codex: stub(f, body) }), /unauthorized path or Git identity/)
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  }
})
test('gate remains unresolved and default auto-commit delivers only feature record', async () => {
  const f = fixture()
  for (const root of [f.root, f.target]) {
    const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
    value.switches['gate-tracker'] = 'on'; fs.writeFileSync(file, JSON.stringify(value))
    git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'gate setting')
  }
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /Configured gate requires host/)
  assert.match(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), 'utf8'), /Stream: open/)
})
test('combined-main check failure does not retire and never retries automatically', async () => {
  const f = fixture()
  const argv = [process.execPath, '-e', `if(process.cwd()===${JSON.stringify(fs.realpathSync(f.root))})process.exit(7)`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [argv] }), /failed\/cancelled/)
  assert.match(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), 'utf8'), /Stream: open/)
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /no automatic retry/)
})
test('cancelled check is settled and main refs stay unchanged', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  await assert.rejects(merge('demo', { cwd: f.root, timeout: 100, checks: [[process.execPath, '-e', 'setTimeout(()=>{},10000)']] }), /failed\/cancelled/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
})
test('changed main reference during candidate checks is detected before path application', async () => {
  const f = fixture()
  const argv = [process.execPath, '-e', `require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','concurrent owner'],{cwd:${JSON.stringify(f.root)}})`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [argv] }), /Main ref changed/)
  assert.equal(fs.readFileSync(path.join(f.root, 'product'), 'utf8'), 'base\n')
})
test('ordinary symlink, executable mode, rename and deletion apply without owner index replacement', async () => {
  const f = fixture()
  git(f.target, 'mv', 'product', 'renamed')
  fs.symlinkSync('renamed', path.join(f.target, 'link'))
  fs.chmodSync(path.join(f.target, 'renamed'), 0o755)
  git(f.target, 'rm', 'owner'); git(f.target, 'add', '.'); git(f.target, 'commit', '-m', 'path types')
  await merge('demo', { cwd: f.root, checks })
  assert.equal(fs.readlinkSync(path.join(f.root, 'link')), 'renamed')
  assert.ok(fs.statSync(path.join(f.root, 'renamed')).mode & 0o111)
  assert.equal(fs.existsSync(path.join(f.root, 'product')), false)
  assert.equal(fs.existsSync(path.join(f.root, 'owner')), false)
})
test('ready recovery finishes missing path/ref updates once without duplicate Reply', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  const argv = [process.execPath, '-e', `require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','concurrent'],{cwd:${JSON.stringify(f.root)}})`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [argv] }), /Main ref changed/)
  const stateFile = path.join(f.target, '.agentflow/features/demo/merge-state.json')
  const state = JSON.parse(fs.readFileSync(stateFile))
  git(f.root, 'update-ref', 'refs/heads/main', old, git(f.root, 'rev-parse', 'HEAD'))
  const product = git(f.root, 'ls-tree', state.commit, 'product').split(/\s+/)
  fs.writeFileSync(path.join(f.root, 'product'), execFileSync('git', ['show', `${state.commit}:product`], { cwd: f.root }))
  git(f.root, 'update-index', '--cacheinfo', `${product[0]},${product[2]},product`)
  // Replace the recorded check with a harmless equivalent only in this task-owned fault fixture.
  state.checks = checks; state.phase = 'ready'; state.applyStarted = true; fs.writeFileSync(stateFile, JSON.stringify(state))
  await merge('demo', { cwd: f.root, checks })
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), state.commit)
  const notebook = fs.readFileSync(path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), 'utf8')
  assert.equal((notebook.match(/# → Reply \/ A-002/g) || []).length, 1)
  await merge('demo', { cwd: f.root, checks })
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), 'utf8'), notebook)
})
test('retained feature-rooted merge returns main; later explicit cleanup and removed-source repeat settle', { skip: process.platform !== 'darwin' }, async () => {
  const f = fixture()
  const first = await merge(undefined, { cwd: f.target })
  assert.equal(first.destination, fs.realpathSync(f.root))
  assert.ok(fs.existsSync(f.target))
  const commit = git(f.root, 'rev-parse', 'HEAD')
  const recordBefore = fs.readFileSync(path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), 'utf8')
  const priorReply = recordBefore.slice(recordBefore.indexOf('# → Reply / A-002'), recordBefore.indexOf('# → Ask / A-003'))
  const cleanup = await merge(undefined, { cwd: f.target, cleanup: true })
  assert.match(cleanup.message, /No repository checks configured/)
  assert.doesNotMatch(cleanup.message, /checks passed/i)
  assert.equal(cleanup.destination, fs.realpathSync(f.root))
  assert.equal(fs.existsSync(f.target), false)
  const record = path.join(f.root, '.agentflow/features/demo/demo.devlog.md')
  assert.match(fs.readFileSync(record, 'utf8'), /Cleanup: complete/)
  const finalRecord = fs.readFileSync(record, 'utf8')
  assert.ok(finalRecord.includes(priorReply))
  assert.equal((finalRecord.match(/# → Reply \/ A-003/g) || []).length, 1)
  assert.match(finalRecord, /\+ agf merge-feature demo --cleanup/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), commit)
  const repeat = await merge('demo', { cwd: f.root, cleanup: true })
  assert.equal(repeat.destination, fs.realpathSync(f.root))
  assert.match(repeat.message, /No repository checks configured/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), commit)
})
test('localized closeout preserves labels, timestamp, questions and empty next Ask', async () => {
  const f = fixture()
  for (const root of [f.root, f.target]) {
    const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
    value.switches['use-lang'] = 'zh-tw'; value.switches['omit-asker'] = 'off'
    fs.writeFileSync(file, JSON.stringify(value)); git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'locale')
  }
  const notebook = path.join(f.target, '.agentflow/features/demo/demo.devlog.md')
  fs.writeFileSync(notebook, fs.readFileSync(notebook, 'utf8').replaceAll('Ask', '提問').replaceAll('Reply', '回覆'))
  git(f.target, 'add', '.'); git(f.target, 'commit', '-m', 'localized phases')
  const result = await merge('demo', { cwd: f.root, checks: [[process.execPath, '-e', 'if(process.argv[1]!=="")process.exit(1)', '']] })
  assert.match(result.message, /已將 feature\/demo/)
  const actual = fs.readFileSync(path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), 'utf8')
  assert.match(actual, /# → 回覆 \/ A-002\n\n\* _\d{4}-/)
  assert.match(actual, /## 問題（批次列出；每題附建議預設值）\n\n- 無。/)
  assert.match(actual, /---\n\n# → 提問 \/ A-003 \(Fixture\)\n\n$/)
  assert.match(actual, /\n\n\+ agf merge-feature demo/)
})
test('creation-only untracked feature notebook merges without explicit product include', async () => {
  const f = fixture()
  const notebook = '.agentflow/features/demo/demo.devlog.md'
  git(f.target, 'rm', '--cached', notebook)
  git(f.target, 'commit', '-m', 'notebook still prepared locally')
  const result = await merge('demo', { cwd: f.root, checks })
  assert.match(result.message, /Merged/)
  assert.match(git(f.root, 'show', `HEAD:${notebook}`), /\+ agf merge-feature demo/)
})
test('harmless configuration metadata merges while derived punctuated root notebooks remain excluded', async () => {
  for (const [physicalName, notebookName] of [['!!! My Project!', 'my-project.devlog.md'], ['!!!', 'devlog.md']]) {
    const f = fixture(physicalName)
    for (const root of [f.root, f.target]) {
      const config = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(config))
      delete value.switches['notebook-name']
      if (root === f.target) value.next_update_date = '2099-01-01'
      fs.writeFileSync(config, JSON.stringify(value))
      fs.writeFileSync(path.join(root, '.agentflow', notebookName), root === f.root ? 'private default root\n' : 'excluded feature default root\n')
      git(root, 'add', '.'); git(root, 'commit', '-m', 'default routing and metadata')
    }
    const configText = fs.readFileSync(path.join(f.target, '.agentflow/ag.json'), 'utf8')
    const codex = stub(f, `require('node:fs').writeFileSync('.agentflow/ag.json', ${JSON.stringify(configText)})`)
    await merge('demo', { cwd: f.root, checks, codex })
    assert.equal(git(f.root, 'show', `HEAD:.agentflow/${notebookName}`), 'private default root')
    assert.equal(fs.readFileSync(path.join(f.root, '.agentflow', notebookName), 'utf8'), 'private default root\n')
    assert.equal(JSON.parse(git(f.root, 'show', 'HEAD:.agentflow/ag.json')).next_update_date, '2099-01-01')
  }
})

test('changed main notebook routing blocks initial application and saved ready-state recovery', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  const config = path.join(f.root, '.agentflow/ag.json')
  const argv = [process.execPath, '-e', `const fs=require('node:fs');const file=${JSON.stringify(config)};const value=JSON.parse(fs.readFileSync(file));value.switches['notebook-name']='other.md';fs.writeFileSync(file,JSON.stringify(value))`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [argv] }), /routing changed/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  assert.equal(fs.readFileSync(path.join(f.root, 'product'), 'utf8'), 'base\n')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /routing changed/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
})

test('successful-exit combined checks cannot silently change main source or index', async () => {
  const f = fixture()
  const argv = [process.execPath, '-e', `if(process.cwd()===${JSON.stringify(fs.realpathSync(f.root))})require('node:fs').writeFileSync('owner','check altered owner bytes\\n')`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [argv] }), /changed main files, index or ref/)
  assert.match(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), 'utf8'), /Stream: open/)
  assert.equal(fs.readFileSync(path.join(f.root, 'owner'), 'utf8'), 'check altered owner bytes\n')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /no automatic retry/)
})

test('default delivery skips absent remotes and pushes only a verified sole remote', async () => {
  for (const remoteEnabled of [false, true]) {
    const f = fixture()
    if (remoteEnabled) {
      const remote = path.join(f.root, 'delivery.git'); git(f.root, 'init', '--bare', remote)
      git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', 'origin', 'main')
    }
    for (const root of [f.root, f.target]) {
      const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
      value.switches['auto-push'] = 'on'; value.switches['auto-commit'] = 'on'; fs.writeFileSync(file, JSON.stringify(value))
    }
    // The configuration changes are explicitly included; other task bytes were already committed.
    git(f.root, 'add', '.agentflow/ag.json'); git(f.root, 'commit', '-m', 'delivery policy')
    if (remoteEnabled) { git(f.root, 'push', 'origin', 'main'); git(f.root, 'push', 'origin', 'feature/demo:refs/heads/feature/demo') }
    await merge('demo', { cwd: f.root, checks, include: ['.agentflow/ag.json'] })
    if (remoteEnabled) assert.equal(git(f.root, 'ls-remote', '--heads', 'origin', 'main').split(/\s+/)[0], git(f.root, 'rev-parse', 'HEAD'))
  }
})
test('terminal dirty-path continuation is literal, non-poisoning, and succeeds through alias retry', () => {
  const f = fixture(), file = 'literal $(touch EVIL) name'
  fs.writeFileSync(path.join(f.target, file), 'authorized task\n')
  const notebook = path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), original = fs.readFileSync(notebook, 'utf8')
  const tip = git(f.target, 'rev-parse', 'HEAD'), main = git(f.root, 'rev-parse', 'HEAD')
  const cli = path.join(__dirname, 'agf.js'), argv = ['mergeft', 'demo', '--check', JSON.stringify(checks[0])]
  let failure
  try { execFileSync(process.execPath, [cli, ...argv], { cwd: f.root, encoding: 'utf8', stdio: 'pipe' }) } catch (e) { failure = e }
  assert.equal(failure.status, 1); assert.match(failure.stderr, /--include 'literal \$\(touch EVIL\) name'/)
  assert.equal(fs.readFileSync(notebook, 'utf8'), original)
  assert.equal(git(f.target, 'rev-parse', 'HEAD'), tip); assert.equal(git(f.root, 'rev-parse', 'HEAD'), main)
  assert.equal(fs.existsSync(path.join(path.dirname(notebook), 'intake-state.json')), false)
  execFileSync(process.execPath, [cli, 'merge-feature', '--include', file, 'demo', '--check', JSON.stringify(checks[0])], { cwd: f.root, encoding: 'utf8', stdio: 'pipe' })
  assert.equal(git(f.root, 'show', `HEAD:${file}`), 'authorized task')
  assert.equal(fs.existsSync(path.join(f.root, 'EVIL')), false)
})
test('terminal settled check failure accepts explicit renewed dependency checks with ignored outputs', () => {
  const f = fixture(), cli = path.join(__dirname, 'agf.js')
  for (const root of [f.root, f.target]) { fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n'); git(root, 'add', '.gitignore'); git(root, 'commit', '-m', 'dependency outputs ignored') }
  const verify = [process.execPath, '-e', 'if(!require("node:fs").existsSync("node_modules/proof"))process.exit(4)']
  const prepare = [process.execPath, '-e', 'const fs=require("node:fs");fs.mkdirSync("node_modules",{recursive:true});fs.writeFileSync("node_modules/proof","installed")']
  assert.throws(() => execFileSync(process.execPath, [cli, 'mergeft', 'demo', '--check', JSON.stringify(verify)], { cwd: f.root, stdio: 'pipe' }))
  execFileSync(process.execPath, [cli, 'merge-feature', 'demo', '--check', JSON.stringify(prepare), '--check', JSON.stringify(verify)], { cwd: f.root, stdio: 'pipe' })
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'feature')
  const dir = path.join(f.target, '.agentflow/features/demo')
  const intake = JSON.parse(fs.readFileSync(path.join(dir, 'intake-state.json')))
  assert.equal(intake.history.length, 1)
  assert.ok(fs.existsSync(path.join(f.root, 'node_modules/proof')))
})
test('ignored owner addition and cleanup data refuse before integration with recoverable bytes', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(f.target, 'arrival'), 'feature payload\n'); git(f.target, 'add', 'arrival'); git(f.target, 'commit', '-m', 'new arrival')
  fs.appendFileSync(path.join(f.root, '.git/info/exclude'), '\n/arrival\n')
  fs.writeFileSync(path.join(f.root, 'arrival'), 'ignored owner bytes\n')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /overlap|ignored\/untracked/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  assert.equal(fs.readFileSync(path.join(f.root, 'arrival'), 'utf8'), 'ignored owner bytes\n')
  const g = fixture(), tip = git(g.target, 'rev-parse', 'HEAD'), notebook = path.join(g.target, '.agentflow/features/demo/demo.devlog.md'), original = fs.readFileSync(notebook, 'utf8')
  fs.appendFileSync(path.join(g.root, '.git/info/exclude'), '\n/private-local\n')
  fs.writeFileSync(path.join(g.target, 'private-local'), 'keep local\n')
  await assert.rejects(merge('demo', { cwd: g.root, checks, cleanup: true }), e => /private-local/.test(e.message) && !/--abandon/.test(e.message))
  assert.equal(git(g.target, 'rev-parse', 'HEAD'), tip); assert.equal(fs.readFileSync(notebook, 'utf8'), original)
  await merge('demo', { cwd: g.root, checks })
  assert.equal(fs.readFileSync(path.join(g.target, 'private-local'), 'utf8'), 'keep local\n')
})
test('gitlink addition and deletion stop before intake or touching owner submodule contents', async () => {
  for (const deletion of [false, true]) {
    const f = fixture(), oid = git(f.root, 'rev-parse', 'HEAD')
    if (deletion) { git(f.root, 'update-index', '--add', '--cacheinfo', `160000,${oid},module`); git(f.root, 'commit', '-m', 'gitlink'); git(f.target, 'merge', '--no-edit', 'main') }
    if (deletion) git(f.target, 'update-index', '--force-remove', 'module')
    else git(f.target, 'update-index', '--add', '--cacheinfo', `160000,${oid},module`)
    git(f.target, 'commit', '-m', 'change gitlink')
    fs.mkdirSync(path.join(f.root, 'module'), { recursive: true }); fs.writeFileSync(path.join(f.root, 'module/owner'), 'owner bytes')
    const old = git(f.root, 'rev-parse', 'HEAD'), tip = git(f.target, 'rev-parse', 'HEAD')
    await assert.rejects(merge('demo', { cwd: f.root, checks }), /Changed submodule/)
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), old); assert.equal(git(f.target, 'rev-parse', 'HEAD'), tip)
    assert.equal(fs.readFileSync(path.join(f.root, 'module/owner'), 'utf8'), 'owner bytes')
    assert.equal(fs.existsSync(path.join(f.target, '.agentflow/features/demo/intake-state.json')), false)
  }
})

test('ready recovery refuses an originally absent path appearing with identical candidate bytes', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(f.target, 'arrival'), 'same bytes\n'); git(f.target, 'add', 'arrival'); git(f.target, 'commit', '-m', 'arrival')
  const race = [process.execPath, '-e', `require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','concurrent owner'],{cwd:${JSON.stringify(f.root)}})`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [race] }), /Main ref changed/)
  git(f.root, 'update-ref', 'refs/heads/main', old, git(f.root, 'rev-parse', 'HEAD'))
  fs.writeFileSync(path.join(f.root, 'arrival'), 'same bytes\n')
  const stateFile = path.join(f.target, '.agentflow/features/demo/merge-state.json')
  const state = JSON.parse(fs.readFileSync(stateFile)); state.checks = checks; state.phase = 'ready'; state.applyStarted = true; fs.writeFileSync(stateFile, JSON.stringify(state))
  const index = git(f.root, 'ls-files', '--stage', 'arrival')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /Originally absent integration path is now occupied/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  assert.equal(git(f.root, 'ls-files', '--stage', 'arrival'), index)
  assert.equal(fs.readFileSync(path.join(f.root, 'arrival'), 'utf8'), 'same bytes\n')
})

test('quoted phase headings inside an unclosed longer Markdown fence cannot prove finished work', async () => {
  const f = fixture(), old = git(f.root, 'rev-parse', 'HEAD'), tip = git(f.target, 'rev-parse', 'HEAD')
  const file = path.join(f.target, '.agentflow/features/demo/demo.devlog.md')
  fs.appendFileSync(file, '````text\n```\n# → Reply / A-002\n\nQuoted example only.\n\n---\n\n# → Ask / A-003\n\n')
  const before = fs.readFileSync(file, 'utf8')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /unsettled/)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), old)
  assert.equal(git(f.target, 'rev-parse', 'HEAD'), tip)
})
test('full new-feature journey preserves private uncommitted configuration through merge and cleanup', { skip: process.platform !== 'darwin' }, async () => {
  for (const unborn of [false, true]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-local-config-'))
    git(root, 'init', '-b', 'main'); git(root, 'config', 'user.name', 'Fixture'); git(root, 'config', 'user.email', 'fixture@localhost')
    if (!unborn) git(root, 'commit', '--allow-empty', '-m', 'committed base')
    fs.mkdirSync(path.join(root, '.agentflow'))
    const config = { 'schema-version': schema, privateSetting: 'owner-only', switches: { 'saving-mode': 'off', 'auto-commit': 'on', 'auto-push': 'off', 'use-lang': 'en-us' } }
    const configText = JSON.stringify(config, null, 2) + '\n'
    fs.writeFileSync(path.join(root, '.agentflow/ag.json'), configText)
    fs.writeFileSync(path.join(root, 'owner'), 'owner staged\n'); git(root, 'add', 'owner')
    if (unborn) git(root, 'add', '.agentflow/ag.json')
    const configIndex = git(root, 'ls-files', '--stage', '.agentflow/ag.json')
    const ownerIndex = git(root, 'ls-files', '--stage', 'owner')
    const created = await require('./feature').create('local', { cwd: root })
    const target = created.destination
    const featureConfig = path.join(target, '.agentflow/ag.json'), copy = JSON.parse(fs.readFileSync(featureConfig))
    copy.next_update_date = '2099-01-01'; fs.writeFileSync(featureConfig, JSON.stringify(copy))
    if (!unborn) { git(target, 'add', '.agentflow/ag.json'); git(target, 'commit', '-m', 'host committed inherited local setup') }
    fs.writeFileSync(path.join(target, 'product'), 'delivered task\n')
    await merge('local', { cwd: root, include: ['product'], checks, cleanup: true })
    assert.equal(fs.existsSync(target), false)
    assert.equal(fs.readFileSync(path.join(root, '.agentflow/ag.json'), 'utf8'), configText)
    assert.equal(git(root, 'ls-files', '--stage', '.agentflow/ag.json'), configIndex)
    assert.equal(git(root, 'ls-tree', '-r', '--name-only', 'HEAD', '--', '.agentflow/ag.json'), '')
    assert.equal(git(root, 'ls-files', '--stage', 'owner'), ownerIndex)
    assert.equal(git(root, 'show', 'HEAD:product'), 'delivered task')
  }
})
test('explicit settled renewal rebuilds against advanced main and preserves owner restaging', async () => {
  const f = fixture()
  await assert.rejects(merge('demo', { cwd: f.root, checks: [[process.execPath, '-e', 'process.exit(8)']] }), /failed\/cancelled/)
  fs.writeFileSync(path.join(f.root, 'owner'), 'new committed owner\n'); git(f.root, 'add', 'owner'); git(f.root, 'commit', '-m', 'owner advances main')
  const advanced = git(f.root, 'rev-parse', 'HEAD')
  fs.appendFileSync(path.join(f.root, 'owner'), 'restaged owner\n'); git(f.root, 'add', 'owner')
  const staged = git(f.root, 'ls-files', '--stage', 'owner')
  fs.writeFileSync(path.join(f.target, 'product'), 'fixed feature\n')
  const repairedNotebook = path.join(f.target, '.agentflow/features/demo/demo.devlog.md')
  fs.appendFileSync(repairedNotebook, '\n# → Reply / A-002\n\nOwner settled the failed check and product repair.\n\n---\n\n# → Ask / A-003\n\n')
  await merge('demo', { cwd: f.root, include: ['product'], checks })
  assert.equal(git(f.root, 'show', '-s', '--format=%P', 'HEAD').split(' ')[0], advanced)
  assert.equal(git(f.root, 'ls-files', '--stage', 'owner'), staged)
  assert.equal(fs.readFileSync(path.join(f.root, 'owner'), 'utf8'), 'new committed owner\nrestaged owner\n')
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'fixed feature')
})
test('advanced main permits later cleanup and removed-source repeat without remerging or publishing owner history', { skip: process.platform !== 'darwin' }, async () => {
  for (const commitRecords of [false, true]) {
    const f = fixture()
    for (const root of [f.root, f.target]) {
      const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
      value.switches['auto-commit'] = commitRecords ? 'on' : 'off'; value.switches['auto-push'] = commitRecords ? 'off' : 'on'
      fs.writeFileSync(file, JSON.stringify(value)); git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'delivery policy')
    }
    let remote
    if (!commitRecords) { remote = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-advanced-remote-')); git(remote, 'init', '--bare'); git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', '-u', 'origin', 'main'); git(f.root, 'push', 'origin', 'feature/demo:refs/heads/feature/demo') }
    await merge('demo', { cwd: f.root, checks })
    const mergeCommit = JSON.parse(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/merge-state.json'))).commit
    fs.writeFileSync(path.join(f.root, 'owner'), 'later main owner\n'); git(f.root, 'add', 'owner'); git(f.root, 'commit', '-m', 'main advances after merge')
    const advanced = git(f.root, 'rev-parse', 'HEAD')
    if (remote) git(f.root, 'push', 'origin', 'main')
    const stateText = fs.readFileSync(path.join(f.target, '.agentflow/features/demo/merge-state.json'), 'utf8')
    await assert.rejects(require('./feature').drop('demo', { cwd: f.root }), /agf merge-feature demo --cleanup/)
    assert.equal(fs.readFileSync(path.join(f.target, '.agentflow/features/demo/merge-state.json'), 'utf8'), stateText)
    fs.appendFileSync(path.join(f.root, 'owner'), 'restaged later owner\n'); git(f.root, 'add', 'owner')
    const staged = git(f.root, 'ls-files', '--stage', 'owner')
    await merge('demo', { cwd: f.root, cleanup: true })
    assert.equal(git(f.root, 'ls-files', '--stage', 'owner'), staged)
    const cleanedHead = git(f.root, 'rev-parse', 'HEAD')
    if (commitRecords) assert.equal(git(f.root, 'show', '-s', '--format=%P', 'HEAD'), advanced)
    else assert.equal(cleanedHead, advanced)
    const delivered = JSON.parse(fs.readFileSync(path.join(f.root, '.agentflow/features/demo/merge-state.json')))
    assert.equal(delivered.commit, mergeCommit)
    git(f.root, 'commit', '--only', 'owner', '-m', 'main advances after cleanup')
    const repeatedHead = git(f.root, 'rev-parse', 'HEAD')
    await merge('demo', { cwd: f.root, cleanup: true })
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), repeatedHead)
    if (remote) assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), advanced)
  }
})
test('root notebook archive claim and root-only commits remain independent during combined checks', async () => {
  const f = fixture()
  for (const root of [f.root, f.target]) {
    const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
    value.switches['auto-commit'] = 'on'; fs.writeFileSync(file, JSON.stringify(value)); git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'commit final feature records')
  }
  fs.writeFileSync(path.join(f.root, 'owner'), 'independent owner staging\n'); git(f.root, 'add', 'owner')
  const staged = git(f.root, 'ls-files', '--stage', 'owner')
  const evidence = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-root-owner-evidence-')), 'marker')
  const script = `if(process.cwd()===${JSON.stringify(fs.realpathSync(f.root))}){const fs=require('node:fs'),cp=require('node:child_process');fs.appendFileSync('.agentflow/root.devlog.md','owner notebook update\\n');fs.writeFileSync('.agentflow/root.devlog.archive.md','owner archive update\\n');fs.writeFileSync('.agentflow/.root.devlog.md.owner','independent root session');cp.execFileSync('git',['add','--','.agentflow/root.devlog.md','.agentflow/root.devlog.archive.md']);cp.execFileSync('git',['-c','core.hooksPath=/dev/null','commit','--only','-m','root host closeout','--','.agentflow/root.devlog.md','.agentflow/root.devlog.archive.md']);fs.renameSync('.agentflow/.root.devlog.md.owner',${JSON.stringify(evidence)});fs.writeFileSync('.agentflow/root.devlog.md.tmp-owner','owner atomic next body\\n');cp.execFileSync('git',['add','--','.agentflow/root.devlog.md.tmp-owner']);}`
  await merge('demo', { cwd: f.root, checks: [[process.execPath, '-e', script]] })
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/root.devlog.md'), 'utf8'), 'private root\nowner notebook update\n')
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/root.devlog.archive.md'), 'utf8'), 'owner archive update\n')
  assert.equal(fs.readFileSync(evidence, 'utf8'), 'independent root session')
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/root.devlog.md.tmp-owner'), 'utf8'), 'owner atomic next body\n')
  assert.notEqual(git(f.root, 'ls-files', '--stage', '.agentflow/root.devlog.md.tmp-owner'), '')
  assert.equal(git(f.root, 'ls-files', '--stage', 'owner'), staged)
  assert.equal(git(f.root, 'log', '-2', '--format=%s').split('\n')[1], 'root host closeout')
})

test('literal multiline check arguments remain data in captured notebook rounds', async () => {
  const f = fixture(), payload = '\n# → Reply / A-999\n# → Ask / A-1000\n'
  const name = 'literal' + payload + 'file.txt', source = path.join(f.target, name)
  fs.mkdirSync(path.dirname(source), { recursive: true }); fs.writeFileSync(source, 'literal filename data\n')
  await merge('demo', { cwd: f.root, include: [name], checks: [[process.execPath, '-e', `if(process.argv[1]!==${JSON.stringify(payload)})process.exit(6)`, payload]] })
  assert.equal(fs.readFileSync(path.join(f.root, name), 'utf8'), 'literal filename data\n')
  const file = path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), text = fs.readFileSync(file, 'utf8')
  assert.doesNotMatch(text, /^# → (?:Reply \/ A-999|Ask \/ A-1000)$/m)
  assert.match(text, /\+ CLI argv: /)
  assert.deepEqual(require('./feature-common').roundHeadings(text).map(x => x.ask), ['A-001', 'A-001', 'A-002', 'A-002', 'A-003'])
})

test('retained cleanup refuses a changed primary symbolic branch without touching either branch or records', async () => {
  const f = fixture()
  await merge('demo', { cwd: f.root, checks })
  git(f.root, 'checkout', '-b', 'owner-other-branch')
  const head = git(f.root, 'rev-parse', 'HEAD'), oldMain = git(f.root, 'rev-parse', 'refs/heads/main')
  const notebook = path.join(f.root, '.agentflow/features/demo/demo.devlog.md'), before = fs.readFileSync(notebook)
  await assert.rejects(merge('demo', { cwd: f.root, checks, cleanup: true }), /Saved merge identity changed/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), head)
  assert.equal(git(f.root, 'rev-parse', 'refs/heads/main'), oldMain)
  assert.deepEqual(fs.readFileSync(notebook), before)
  assert.ok(fs.existsSync(f.target))
})
test('main advancing during candidate checks remains renewable without resetting refs or editing evidence', async () => {
  const f = fixture()
  const concurrent = [process.execPath, '-e', `require('node:child_process').execFileSync('git',['commit','--allow-empty','-m','owner advances while checking'],{cwd:${JSON.stringify(f.root)}})`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [concurrent] }), /Main ref changed before application/)
  const stateFile = path.join(f.target, '.agentflow/features/demo/merge-state.json'), stopped = JSON.parse(fs.readFileSync(stateFile))
  assert.equal(stopped.phase, 'checking'); assert.notEqual(stopped.applyStarted, true); assert.ok(stopped.commit)
  const advanced = git(f.root, 'rev-parse', 'HEAD')
  assert.equal(fs.readFileSync(path.join(f.root, 'product'), 'utf8'), 'base\n')
  await merge('demo', { cwd: f.root, checks })
  assert.equal(git(f.root, 'show', '-s', '--format=%P', 'HEAD').split(' ')[0], advanced)
  assert.equal(git(f.root, 'show', 'HEAD:product'), 'feature')
})
test('root-only adopted owner history is never automatically pushed before owner publication', async () => {
  const f = fixture()
  for (const root of [f.root, f.target]) {
    const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
    value.switches['auto-commit'] = 'on'; value.switches['auto-push'] = 'on'
    fs.writeFileSync(file, JSON.stringify(value)); git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'delivery settings')
  }
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-root-push-')); git(remote, 'init', '--bare'); git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', '-u', 'origin', 'main')
  git(f.root, 'push', 'origin', 'feature/demo:refs/heads/feature/demo')
  const originalRemote = git(remote, 'rev-parse', 'refs/heads/main')
  const rootHost = [process.execPath, '-e', `if(process.cwd()===${JSON.stringify(fs.realpathSync(f.root))}){require('node:fs').appendFileSync('.agentflow/root.devlog.md','independent root owner\\n');require('node:child_process').execFileSync('git',['commit','--only','-m','independent root owner','--','.agentflow/root.devlog.md']);}`]
  await assert.rejects(merge('demo', { cwd: f.root, checks: [rootHost] }), /Adopted owner\/root history is not published/)
  const stateFile = path.join(f.target, '.agentflow/features/demo/merge-state.json'), pending = JSON.parse(fs.readFileSync(stateFile))
  assert.equal(pending.rootAdvanced, true); assert.equal(pending.phase, 'delivered')
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), originalRemote)
  git(f.root, 'push', 'origin', `${pending.deliveryBase}:refs/heads/main`)
  await merge('demo', { cwd: f.root })
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), pending.delivery)
  assert.equal(fs.readFileSync(path.join(f.root, '.agentflow/root.devlog.md'), 'utf8'), 'private root\nindependent root owner\n')
})
test('unpublished excluded feature-parent history stops before intake and is allowed only with remote reachability proof', async () => {
  for (const reverted of [false, true]) {
    const f = fixture()
    if (reverted) {
      fs.writeFileSync(path.join(f.target, '.agentflow/root.devlog.md'), 'private root\n'); git(f.target, 'add', '.agentflow/root.devlog.md'); git(f.target, 'commit', '-m', 'restore root tree without erasing private ancestor')
    }
    for (const root of [f.root, f.target]) {
      const file = path.join(root, '.agentflow/ag.json'), value = JSON.parse(fs.readFileSync(file))
      value.switches['auto-push'] = 'on'; value.switches['auto-commit'] = 'on'
      fs.writeFileSync(file, JSON.stringify(value)); git(root, 'add', '.agentflow/ag.json'); git(root, 'commit', '-m', 'publication policy')
    }
    const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-private-feature-history-')); git(remote, 'init', '--bare'); git(f.root, 'remote', 'add', 'origin', remote); git(f.root, 'push', '-u', 'origin', 'main')
    const main = git(f.root, 'rev-parse', 'HEAD'), feature = git(f.target, 'rev-parse', 'HEAD')
    const notebook = path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), before = fs.readFileSync(notebook, 'utf8')
    await assert.rejects(merge('demo', { cwd: f.root, checks }), /Excluded root-record history is unpublished/)
    assert.equal(git(f.root, 'rev-parse', 'HEAD'), main); assert.equal(git(f.target, 'rev-parse', 'HEAD'), feature)
    assert.equal(fs.readFileSync(notebook, 'utf8'), before)
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), main)
    assert.equal(fs.existsSync(path.join(path.dirname(notebook), 'intake-state.json')), false)
    assert.throws(() => git(remote, 'cat-file', '-e', feature))
    // This separate owner action explicitly publishes the historical data; CLI never does it implicitly.
    git(f.root, 'push', 'origin', 'feature/demo:refs/heads/owner-approved-feature')
    await merge('demo', { cwd: f.root, checks })
    assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), git(f.root, 'rev-parse', 'HEAD'))
    assert.equal(git(f.root, 'show', 'HEAD:.agentflow/root.devlog.md'), 'private root')
  }
})
test('foreign integrated feature reservation blocks all source and main integration effects', async () => {
  const f = fixture(), dir = path.join(f.root, '.agentflow/features/demo')
  fs.mkdirSync(dir, { recursive: true })
  const marker = path.join(dir, '.demo.devlog.md.owner'), foreign = '{"session":"another-feature-owner","ask":"A-002","claimed_at":"owner-time"}\n'
  fs.writeFileSync(marker, foreign)
  const main = git(f.root, 'rev-parse', 'HEAD'), feature = git(f.target, 'rev-parse', 'HEAD'), index = git(f.root, 'ls-files', '--stage', '-z')
  const sourceNotebook = path.join(f.target, '.agentflow/features/demo/demo.devlog.md'), source = fs.readFileSync(sourceNotebook, 'utf8')
  await assert.rejects(merge('demo', { cwd: f.root, checks }), /Feature claim collision/)
  assert.equal(git(f.root, 'rev-parse', 'HEAD'), main); assert.equal(git(f.target, 'rev-parse', 'HEAD'), feature)
  assert.equal(git(f.root, 'ls-files', '--stage', '-z'), index)
  assert.equal(fs.readFileSync(sourceNotebook, 'utf8'), source)
  assert.equal(fs.readFileSync(path.join(f.root, 'product'), 'utf8'), 'base\n')
  assert.equal(fs.existsSync(path.join(dir, 'demo.devlog.md')), false)
  assert.equal(fs.readFileSync(marker, 'utf8'), foreign)
  assert.equal(fs.existsSync(path.join(path.dirname(sourceNotebook), 'intake-state.json')), false)
})
