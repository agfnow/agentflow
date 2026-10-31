'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync, spawn } = require('node:child_process')
const { initialize, locale } = require('./init')
const C = require('./feature-common')
const launcher = path.join(__dirname, 'agf.js')
function fixture(git = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-'))
  if (git) { C.git(root, ['init']); C.git(root, ['config', 'user.name', 'Initializer test']); C.git(root, ['config', 'user.email', 'initializer@example.invalid']); C.git(root, ['config', 'commit.gpgsign', 'false']) }
  return root // Retain fixtures for recovery; never permanently remove owner/test state.
}
const run = (root, ...args) => spawnSync(process.execPath, [launcher, 'init', ...args], { cwd: root, encoding: 'utf8' })
function snapshot(root) {
  return { tree: C.treeDigest(path.join(root, '.agentflow')), agents: fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), head: C.git(root, ['rev-parse', 'HEAD']), index: C.git(root, ['ls-files', '--stage', '-z']) }
}
test('unborn Git bootstrap, generated-only commit, existing index and bytes, exact repeat', () => {
  const root = fixture()
  fs.writeFileSync(path.join(root, 'owner.txt'), 'staged owner\n'); C.git(root, ['add', 'owner.txt'])
  fs.writeFileSync(path.join(root, 'owner.txt'), 'unstaged owner\n')
  fs.writeFileSync(path.join(root, 'other.txt'), 'untracked\n')
  const before = C.git(root, ['ls-files', '--stage', '-z'])
  const result = initialize({ cwd: root, lang: 'en-us' })
  const commits = C.git(root, ['rev-list', '--reverse', 'HEAD']).split('\n')
  assert.equal(commits.length, 2)
  assert.equal(C.git(root, ['ls-tree', '-r', '--name-only', commits[0]]), '')
  assert.equal(C.git(root, ['rev-list', '--parents', '-1', commits[0]]), commits[0])
  assert.equal(C.git(root, ['ls-files', '--stage', '-z', '--', 'owner.txt']), before)
  assert.equal(fs.readFileSync(path.join(root, 'owner.txt'), 'utf8'), 'unstaged owner\n')
  assert.equal(C.git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).includes('owner.txt'), false)
  assert.match(fs.readFileSync(result.notebook, 'utf8'), /# → Ask \/ A-001[\s\S]*# → Reply \/ A-001[\s\S]*# → Ask \/ A-002\n$/)
  const first = snapshot(root)
  assert.equal(initialize({ cwd: root, lang: 'zh-TW' }).skipped, true)
  assert.deepEqual(snapshot(root), first)
})
test('existing committed root retains history; Traditional Chinese records and repeat', () => {
  const root = fixture(); C.git(root, ['commit', '--allow-empty', '-m', 'owner baseline'])
  const base = C.git(root, ['rev-parse', 'HEAD'])
  const result = initialize({ cwd: root, lang: 'zh-TW' })
  assert.equal(C.git(root, ['rev-parse', 'HEAD^']), base)
  assert.match(fs.readFileSync(result.notebook, 'utf8'), /# → 提問 \/ A-002/)
  assert.match(fs.readFileSync(path.join(root, '.agentflow/backlog.md'), 'utf8'), /目前沒有未結事項/)
  const old = snapshot(root); assert.equal(initialize({ cwd: root }).skipped, true); assert.deepEqual(snapshot(root), old)
})
test('complete custom canonical setup remains byte/index/HEAD no-op', () => {
  const root = fixture(); initialize({ cwd: root, lang: 'en' })
  fs.renameSync(path.join(root, '.agentflow'), path.join(root, 'records'))
  const file = path.join(root, 'records/ag.json'), config = JSON.parse(fs.readFileSync(file)); config.switches['ag-dir'] = 'records'; config.switches['auto-commit'] = 'off'; config.switches['use-lang'] = 'fr'; config.custom = 'owner value'
  fs.writeFileSync(file, JSON.stringify(config))
  const agents = path.join(root, 'AGENTS.md'); fs.writeFileSync(agents, fs.readFileSync(agents, 'utf8').replace('.agentflow/rules.md', 'records/rules.md'))
  const before = C.treeDigest(root); assert.equal(initialize({ cwd: root }).message, 'Already initialized; no files changed.'); assert.equal(C.treeDigest(root), before); assert.equal(initialize({ cwd: root, lang: 'en' }).skipped, true); assert.equal(C.treeDigest(root), before)
})
test('malformed locale and nested Git folder refuse before scaffold writes', () => {
  const root = fixture(false); assert.throws(() => initialize({ cwd: root, lang: 'bad/tag' }), /Invalid initialization locale/); assert.deepEqual(fs.readdirSync(root), [])
  const parent = fixture(), child = path.join(parent, 'child'); fs.mkdirSync(child)
  assert.throws(() => initialize({ cwd: child, lang: 'en' }), /physical Git root/); assert.deepEqual(fs.readdirSync(child), [])
})
test('fresh non-Git root initializes through real command with configured external identity', () => {
  const root = fixture(false)
  const result = spawnSync(process.execPath, [launcher, 'init', '--lang', 'en'], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' } })
  assert.equal(result.status, 0, result.stderr); assert.equal(C.git(root, ['rev-list', '--count', 'HEAD']), '2')
})
test('partial records, legacy config, symlinks, ownership and history are preserved', () => {
  for (const name of ['orphan.devlog.md', 'backlog.md', 'sys-invariants.md', '.old.owner', '.agentflow']) {
    const root = fixture(); fs.writeFileSync(path.join(root, name), 'retain')
    const old = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' })); assert.equal(C.treeDigest(root), old)
  }
  const root = fixture(); fs.writeFileSync(path.join(root, 'ag.json'), '{"schema-version":8,"switches":{}}')
  const old = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /migration/); assert.equal(C.treeDigest(root), old)
  const linkRoot = fixture(); fs.symlinkSync('missing', path.join(linkRoot, 'AGENTS.md')); assert.throws(() => initialize({ cwd: linkRoot, lang: 'en' })); assert.equal(fs.readlinkSync(path.join(linkRoot, 'AGENTS.md')), 'missing')
  const initialized = fixture(); initialize({ cwd: initialized, lang: 'en' }); fs.writeFileSync(path.join(initialized, '.agentflow/.active.owner'), 'retain')
  const prior = C.treeDigest(initialized); assert.throws(() => initialize({ cwd: initialized }), /ownership/); assert.equal(C.treeDigest(initialized), prior)
})
test('Git locks, detached and feature roots, refs without HEAD, and staged adoption refuse', () => {
  const root = fixture(); fs.writeFileSync(path.join(root, '.git/index.lock'), 'retain'); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /lock/); assert.equal(fs.existsSync(path.join(root, '.agentflow')), false)
  const staged = fixture(); fs.writeFileSync(path.join(staged, 'AGENTS.md'), '# Owner\n'); C.git(staged, ['add', 'AGENTS.md']); const index = C.git(staged, ['ls-files', '--stage', '-z']); assert.throws(() => initialize({ cwd: staged, lang: 'en' }), /Staged AGENTS/); assert.equal(C.git(staged, ['ls-files', '--stage', '-z']), index)
  for (const feature of [false, true]) { const r = fixture(); C.git(r, ['commit', '--allow-empty', '-m', 'base']); C.git(r, feature ? ['checkout', '-b', 'feature/example'] : ['checkout', '--detach']); assert.throws(() => initialize({ cwd: r, lang: 'en' })); assert.equal(fs.existsSync(path.join(r, '.agentflow')), false) }
  const refs = fixture(); C.git(refs, ['commit', '--allow-empty', '-m', 'base']); C.git(refs, ['symbolic-ref', 'HEAD', 'refs/heads/unborn']); assert.throws(() => initialize({ cwd: refs, lang: 'en' }), /refs/)
})
test('bootstrap failure retains explicit partial reservation and prevents guessed retry', () => {
  const root = fixture(); C.git(root, ['config', 'commit.gpgsign', 'true']); C.git(root, ['config', 'gpg.program', '/missing/agf-test-gpg'])
  assert.throws(() => initialize({ cwd: root, lang: 'en' }), /failed/)
  assert.equal(fs.statSync(path.join(root, '.agentflow')).isDirectory(), true)
  const old = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /records/); assert.equal(C.treeDigest(root), old)
})
test('concurrent real processes cannot compete for scaffolds', async () => {
  const root = fixture()
  const execute = () => new Promise(resolve => { const child = spawn(process.execPath, [launcher, 'init', '--lang', 'en'], { cwd: root }); let stderr = ''; child.stderr.on('data', data => { stderr += data }); child.on('close', code => resolve({ code, stderr })) })
  const results = await Promise.all([execute(), execute()])
  assert.ok(results.some(r => r.code === 0), JSON.stringify(results)); assert.ok(results.every(r => [0, 1].includes(r.code)))
  assert.equal(C.git(root, ['rev-list', '--count', 'HEAD']), '2'); assert.equal(initialize({ cwd: root }).skipped, true)
})
test('CLI validates init arguments before writes', () => { const root = fixture(false); for (const args of [['--bad'], ['--lang'], ['--lang', 'en', 'extra']]) assert.equal(run(root, ...args).status, 1); assert.deepEqual(fs.readdirSync(root), []) })
test('delivery failure retains ownership despite complete scaffolds and repeats refuse', () => {
  const root = fixture(); C.git(root, ['commit', '--allow-empty', '-m', 'base'])
  C.git(root, ['config', 'commit.gpgsign', 'true']); C.git(root, ['config', 'gpg.program', '/missing/agf-test-gpg'])
  assert.throws(() => initialize({ cwd: root, lang: 'en' }), /failed/)
  assert.equal(fs.existsSync(path.join(root, '.agentflow/ag.json')), true)
  const noteName = JSON.parse(fs.readFileSync(path.join(root, '.agentflow/ag.json'))).switches['notebook-name']
  const note = fs.readFileSync(path.join(root, '.agentflow', noteName), 'utf8')
  assert.doesNotMatch(note, /Proven: initialization complete|Initialization program completed setup/)
  assert.match(note, /pending ownership marker[\s\S]*not complete/)
  assert.equal(fs.existsSync(path.join(root, '.agentflow/.init-pending.owner')), true)
  const before = C.treeDigest(root); assert.throws(() => initialize({ cwd: root }), /ownership/); assert.equal(C.treeDigest(root), before)
})
test('completed ownership is recoverably retained outside records and never committed', () => {
  const root = fixture(); const result = initialize({ cwd: root, lang: 'en' })
  assert.equal(fs.existsSync(path.join(root, '.agentflow/.init-pending.owner')), false)
  const receipts = fs.readdirSync(path.join(root, '.git')).filter(name => name.startsWith('agf-init-completed-'))
  assert.equal(receipts.length, 1); assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.git', receipts[0]))).ask, 'A-001')
  assert.equal(C.git(root, ['ls-tree', '-r', '--name-only', 'HEAD']).includes('.owner'), false)
  const note = fs.readFileSync(result.notebook, 'utf8')
  assert.match(note, /\+ agf init --lang en\n/); assert.match(note, /\* _\d{4}-\d\d-\d\d \d\d:\d\d:\d\d \+0000_/)
  assert.match(note, /1\. agf init --lang en\n/); assert.match(note, /## System invariant changes\n\nNo accepted IDs; empty scaffold created/)
  assert.match(result.message, /## System invariant changes/); assert.match(note, /## Questions \(batched — each with a suggested default\)\n\n- None\.\n\n---\n\n# → Ask \/ A-002\n$/)
})
test('unrelated archive names are allowed; custom shared authority requires host review', () => {
  const root = fixture(); fs.mkdirSync(path.join(root, 'archive photos')); fs.writeFileSync(path.join(root, 'archive photos', 'README.md'), 'Owner photos')
  initialize({ cwd: root, lang: 'en' }); assert.equal(fs.readFileSync(path.join(root, 'archive photos/README.md'), 'utf8'), 'Owner photos')
  const custom = fixture(); fs.writeFileSync(path.join(custom, 'AGENTS.md'), '# Rules\n\nRead `custom/rules.md` and `custom/backlog.md` as shared records.\n')
  const old = C.treeDigest(custom); assert.throws(() => initialize({ cwd: custom, lang: 'en' }), /shared-authority/); assert.equal(C.treeDigest(custom), old)
})
test('used complete setups do not require retained gitkeep placeholders', () => {
  const root = fixture(); initialize({ cwd: root, lang: 'en' })
  for (const dir of ['artifacts', 'features', '.tmp']) fs.renameSync(path.join(root, '.agentflow', dir, '.gitkeep'), path.join(root, '.agentflow', dir, 'retained-placeholder'))
  const old = C.treeDigest(root); assert.equal(initialize({ cwd: root }).skipped, true); assert.equal(C.treeDigest(root), old)
})
test('CLI defaults prefer Codex, then Claude, then empty routes without model calls', { skip: process.platform === 'win32' }, () => {
  const originalPath = process.env.PATH
  try {
    for (const available of [['codex', 'claude'], ['claude'], []]) {
      const root = fixture(), bin = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-bin-')), observations = path.join(bin, 'observed')
      for (const name of available) fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = --version ] || exit 9\nprintf '%s\\n' '${name} --version' >> '${observations}'\nprintf '%s\\n' 'test version'\n`, { mode: 0o700 })
      process.env.PATH = `${bin}:/usr/bin:/bin`
      initialize({ cwd: root, lang: 'en' })
      const config = JSON.parse(fs.readFileSync(path.join(root, '.agentflow/ag.json')))
      assert.equal(Object.keys(config['looper-routes']).length, available.length ? 3 : 0)
      if (available.length) { assert.equal(config['looper-routes'].task.provider, available[0]); assert.equal(fs.readFileSync(observations, 'utf8'), `${available[0]} --version\n`) }
      assert.equal(config['looper-limits']['max-workers'], 3); assert.equal(config['looper-limits']['max-repairs'], 2)
      process.env.PATH = originalPath
    }
  } finally { process.env.PATH = originalPath }
})
test('AGENTS adoption preserves mode and rejects hardlinks and invalid bytes before writes', () => {
  const root = fixture(), agents = path.join(root, 'AGENTS.md'); fs.writeFileSync(agents, '# Title\n\nOwner bytes.\n', { mode: 0o644 })
  C.git(root, ['add', 'AGENTS.md']); C.git(root, ['commit', '-m', 'owner instructions'])
  initialize({ cwd: root, lang: 'en' }); assert.equal(fs.statSync(agents).mode & 0o777, 0o644)
  assert.match(fs.readFileSync(agents, 'utf8'), /Owner bytes\.\n$/)
  for (const linked of [true, false]) {
    const r = fixture(), file = path.join(r, 'AGENTS.md'); fs.writeFileSync(file, linked ? '# Owner\n' : Buffer.from([0xff, 0xfe]))
    if (linked) fs.linkSync(file, path.join(r, 'owner-instructions'))
    const before = C.treeDigest(r); assert.throws(() => initialize({ cwd: r, lang: 'en' }), linked ? /linked/ : /non-UTF-8/); assert.equal(C.treeDigest(r), before)
  }
})
test('derived names normalize punctuation, cap stem and fall back for non-ASCII', () => {
  for (const [name, expected] of [['My Project!', 'my-project.devlog.md'], ['A'.repeat(40), 'a'.repeat(32) + '.devlog.md'], ['專案', 'devlog.md']]) {
    const parent = fixture(false), root = path.join(parent, name); fs.mkdirSync(root)
    C.git(root, ['init']); C.git(root, ['config', 'user.name', 'Test']); C.git(root, ['config', 'user.email', 'test@example.invalid']); C.git(root, ['config', 'commit.gpgsign', 'false'])
    const result = initialize({ cwd: root, lang: 'en' }); assert.equal(path.basename(result.notebook), expected)
  }
})
test('nominal configuration with an unfinished initial Ask is partial, not complete', () => {
  const root = fixture(); const result = initialize({ cwd: root, lang: 'en' })
  fs.writeFileSync(result.notebook, '# STATUS\n\n# → Ask / A-001\n')
  const before = C.treeDigest(root); assert.throws(() => initialize({ cwd: root }), /Incomplete notebook/); assert.equal(C.treeDigest(root), before)
})
test('untracked and modified owner instructions never enter setup delivery', () => {
  for (const state of ['untracked', 'modified', 'non-Git']) {
    const root = fixture(state !== 'non-Git'), file = path.join(root, 'AGENTS.md'); fs.writeFileSync(file, '# Owner\n')
    if (state === 'modified') { C.git(root, ['add', 'AGENTS.md']); C.git(root, ['commit', '-m', 'owner instructions']); fs.appendFileSync(file, '\nNew owner decision.\n') }
    const before = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /requires host adoption/); assert.equal(C.treeDigest(root), before)
  }
})
test('recorded AGENTS deletions and missing default/custom setup history refuse before reservation', () => {
  for (const state of ['deleted-agents', 'removed-agents', 'default-records', 'staged-config', 'custom-records', 'record-dir-blob', 'instructions-directory']) {
    const root = fixture(), retained = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-retained-'))
    if (state === 'record-dir-blob' || state === 'instructions-directory') {
      const name = state === 'record-dir-blob' ? '.agentflow' : 'AGENTS.md'
      if (state === 'record-dir-blob') fs.writeFileSync(path.join(root, name), 'Owner blob\n')
      else { fs.mkdirSync(path.join(root, name)); fs.writeFileSync(path.join(root, name, 'owner'), 'Owner directory\n') }
      C.git(root, ['add', '--', name]); C.git(root, ['commit', '-m', 'owner structural path'])
      fs.renameSync(path.join(root, name), path.join(retained, 'owner-path'))
    } else if (state.includes('agents')) {
      fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Owner instructions\n'); C.git(root, ['add', 'AGENTS.md']); C.git(root, ['commit', '-m', 'owner instructions'])
      fs.renameSync(path.join(root, 'AGENTS.md'), path.join(retained, 'AGENTS.md'))
      if (state === 'removed-agents') C.git(root, ['add', '-u', '--', 'AGENTS.md'])
    } else {
      const dir = state === 'custom-records' ? 'records' : '.agentflow'
      fs.mkdirSync(path.join(root, dir)); fs.writeFileSync(path.join(root, dir, 'ag.json'), JSON.stringify({ 'schema-version': 13, switches: { 'ag-dir': dir, 'notebook-name': 'journal.md', 'saving-mode': 'off' } }))
      fs.writeFileSync(path.join(root, dir, 'journal.md'), 'Owner history\n'); C.git(root, ['add', '--', dir])
      if (state !== 'staged-config') C.git(root, ['commit', '-m', 'owner records'])
      fs.renameSync(path.join(root, dir), path.join(retained, 'records'))
    }
    const before = C.treeDigest(root), index = C.git(root, ['ls-files', '--stage', '-z']), head = C.git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).stdout
    assert.throws(() => initialize({ cwd: root, lang: 'en' }), /Recorded|reconciliation/)
    assert.equal(C.treeDigest(root), before); assert.equal(C.git(root, ['ls-files', '--stage', '-z']), index); assert.equal(C.git(root, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true }).stdout, head)
  }
})
test('directory and global-excludes rules refuse without scaffolds or partial staging', () => {
  for (const global of [false, true]) {
    const root = fixture()
    if (global) { const excludes = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-excludes-')), 'ignore'); fs.writeFileSync(excludes, '.tmp\n'); C.git(root, ['config', 'core.excludesFile', excludes]) }
    else fs.writeFileSync(path.join(root, '.gitignore'), '.agentflow/\n')
    fs.writeFileSync(path.join(root, 'owner'), 'staged'); C.git(root, ['add', 'owner'])
    const before = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /ignored/); assert.equal(C.treeDigest(root), before)
  }
})
test('non-Git ignore refusal retains only authorized Git metadata and owner files', () => {
  const root = fixture(false); fs.writeFileSync(path.join(root, '.gitignore'), '.agentflow/\n')
  const result = spawnSync(process.execPath, [launcher, 'init', '--lang', 'en'], { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.invalid', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.invalid' } })
  assert.equal(result.status, 1); assert.match(result.stderr, /authorized Git initialization retained/)
  assert.deepEqual(fs.readdirSync(root).sort(), ['.git', '.gitignore']); assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '.agentflow/\n'); assert.equal(C.git(root, ['ls-files', '--stage', '-z']), '')
})
test('invalid existing commit identity refuses before reservation', () => {
  const root = fixture(); C.git(root, ['config', 'user.name', '']); C.git(root, ['config', 'user.email', ''])
  const before = C.treeDigest(root); assert.throws(() => initialize({ cwd: root, lang: 'en' }), /IDENT|identity|ident/); assert.equal(C.treeDigest(root), before)
})
test('CRLF frontmatter/title remain first and adoption preserves original bytes and newline style', () => {
  const root = fixture(), file = path.join(root, 'AGENTS.md'), original = '---\r\nowner: true\r\n---\r\n\r\n# Owner title\r\n\r\nOriginal bytes.\r\n'
  fs.writeFileSync(file, original); C.git(root, ['add', 'AGENTS.md']); C.git(root, ['commit', '-m', 'owner instructions'])
  initialize({ cwd: root, lang: 'en' }); const result = fs.readFileSync(file, 'utf8')
  assert.ok(result.startsWith('---\r\nowner: true\r\n---\r\n\r\n# Owner title\r\n')); assert.ok(result.endsWith('\r\nOriginal bytes.\r\n')); assert.equal(/(?<!\r)\n/.test(result), false)
  assert.equal(result.replace(/At session start,[\s\S]*?Reading rules does not activate agentflow\.\r\n\r\n/, ''), original)
})

test('case aliases in recorded owner instructions, default records and custom configuration refuse unchanged', () => {
  for (const name of ['agents.md', '.Agentflow/x', 'Records/AG.JSON']) {
    const root = fixture(), retained = fs.mkdtempSync(path.join(os.tmpdir(), 'agf-init-case-retained-'))
    C.git(root, ['config', 'core.ignorecase', 'true'])
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), name.endsWith('AG.JSON') ? JSON.stringify({ switches: { 'ag-dir': 'records' } }) : 'Owner bytes\n')
    C.git(root, ['add', '--', name]); C.git(root, ['commit', '-m', 'owner case alias'])
    const first = name.split('/')[0]; fs.renameSync(path.join(root, first), path.join(retained, first))
    const before = C.treeDigest(root), index = C.git(root, ['ls-files', '--stage', '-z']), head = C.git(root, ['rev-parse', 'HEAD'])
    assert.throws(() => initialize({ cwd: root, lang: 'en' }), /Recorded|reconciliation/)
    assert.equal(C.treeDigest(root), before); assert.equal(C.git(root, ['ls-files', '--stage', '-z']), index); assert.equal(C.git(root, ['rev-parse', 'HEAD']), head)
  }
})

test('unsupported language tags fall back while supported locales retain their identity', () => {
  for (const tag of ['ja-JP', 'fr', 'de-DE']) assert.equal(locale(tag), 'en-us')
  for (const [tag, expected] of [['en-GB', 'en-gb'], ['zh-TW', 'zh-tw'], ['zh_Hant', 'zh-hant'], ['zh', 'zh'], ['zh-CN', 'zh-tw'], ['zh-Hans', 'zh-tw'], ['zh-HK', 'zh-tw'], ['zh-MO', 'zh-tw']]) assert.equal(locale(tag), expected)
})
test('Japanese CLI initialization completes in English and repeats without changes', () => {
  const root = fixture(), result = run(root, '--lang', 'ja-JP')
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(fs.readFileSync(path.join(root, '.agentflow/ag.json')))
  assert.equal(config.switches['use-lang'], 'en-us')
  assert.match(result.stdout, /Initialized/)
  assert.match(fs.readFileSync(path.join(root, '.agentflow', config.switches['notebook-name']), 'utf8'), /# → Ask \/ A-002/)
  assert.equal(C.git(root, ['rev-list', '--count', 'HEAD']), '2')
  const before = snapshot(root), repeat = run(root, '--lang', 'ja-JP')
  assert.equal(repeat.status, 0, repeat.stderr); assert.match(repeat.stdout, /Already initialized/)
  assert.deepEqual(snapshot(root), before)
})
test('omitted language uses English after an observed Japanese locale and completes CLI setup', () => {
  const root = fixture()
  // Inject only the OS-locale probe; initialization, launcher and Git run normally.
  const script = `const cp = require('node:child_process'), original = cp.spawnSync;
    cp.spawnSync = (command, args, options) => args?.includes('AppleLocale') || args?.includes('(Get-Culture).Name') ? {status: 0, stdout: 'ja_JP.UTF-8'} : original(command, args, options);
    require(${JSON.stringify(launcher)}).main(['init']).then(code => { process.exitCode = code });`
  const result = spawnSync(process.execPath, ['-e', script], { cwd: root, encoding: 'utf8', env: { ...process.env, LC_ALL: 'ja_JP.UTF-8', LC_MESSAGES: 'ja_JP.UTF-8', LANG: 'ja_JP.UTF-8' } })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.agentflow/ag.json'))).switches['use-lang'], 'en-us')
  assert.match(result.stdout, /Initialized/)
  assert.equal(C.git(root, ['rev-list', '--count', 'HEAD']), '2')
})

test('Chinese region variants complete in Traditional Chinese with a supported saved locale', () => {
  const root = fixture(), result = run(root, '--lang', 'zh-HK')
  assert.equal(result.status, 0, result.stderr)
  const config = JSON.parse(fs.readFileSync(path.join(root, '.agentflow/ag.json')))
  assert.equal(config.switches['use-lang'], 'zh-tw')
  assert.match(result.stdout, /已初始化/)
  assert.match(fs.readFileSync(path.join(root, '.agentflow', config.switches['notebook-name']), 'utf8'), /# → 提問 \/ A-002/)
})
