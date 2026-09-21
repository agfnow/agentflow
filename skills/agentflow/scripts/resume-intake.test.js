'use strict'

// A remote default must be compared to its local branch, not its raw output.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const intake = require('./resume-intake.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-resume-intake-'))
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })

test('remote default trunk is normalized even when main also exists', () => {
  const directory = make_repo()
  try {
    git(directory, ['branch', 'trunk'])
    git(directory, ['update-ref', 'refs/remotes/origin/trunk', 'HEAD'])
    git(directory, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk'])
    git(directory, ['switch', 'trunk'])
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.notEqual(result.stream_decision.reason, 'foreign_or_parallel_work')
    git(directory, ['switch', 'main'])
    assert.equal(intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' }).stream_decision.reason, 'foreign_or_parallel_work')
  } finally { drop(directory) }
})
const git = (directory, args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim()

const identity = file => {
  const stat = fs.statSync(file, { bigint: true })
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mode: String(stat.mode),
    mtime: String(stat.mtimeNs),
    ctime: String(stat.ctimeNs),
  }
}

const config = () => JSON.stringify({
  'schema-version': 8,
  switches: {
    'target-doc': 'devlog.md',
    'workspace-dir': '.agentflow',
    'cli-provider': 'on',
    'auto-reply': 'off',
    lang: 'English',
    streams: 'always',
    'ask-names': 'off',
    'allow-ag': 'ask',
    'large-work-minutes': 120,
    'allowed-worker': ['external', 'internal', 'host'],
    'review-policy': 'prefer-independent',
  },
  'pipeline-roles': {
    requirements: 'basic', codewalk: 'basic', explore: 'basic', spike: 'basic', spec: 'basic', implementation: 'basic', 'security-scan': 'off', acceptance: 'basic', 'cross-check': 'basic', learn: 'basic',
  },
  'external-workers': [{
    id: 'node-worker', command: ['node'], priority: 1, family: 'codex', tiers: { best: 'gpt-5.6-sol/low', better: 'gpt-5.6-luna/xhigh', basic: 'gpt-5.6-luna/xhigh', cheap: 'gpt-5.4/medium' },
  }],
}, null, 2) + '\n'

const notebook = ask => `# STATUS\n\nProject: test.\n\nNotebook: devlog.md — root.\n\nCurrent commit: initial.\n\nTests/scenarios: none.\n\nConfiguration: ag.json — schema v8; validated for codex this round.\n\nProven: none.\n\nOpen: none.\n\nNext: wait.\n\nArtifacts: none.\n\nArchived eras: none.\n\nStreams: none.\n\n---\n\n# → Ask / A-001\n\n+${ask ? ` ${ask}` : ''}\n`

const make_repo = () => {
  const directory = tmp()
  git(directory, ['init', '-q', '-b', 'main'])
  git(directory, ['config', 'user.email', 'resume-intake@example.invalid'])
  git(directory, ['config', 'user.name', 'resume intake tests'])
  fs.writeFileSync(path.join(directory, 'ag.json'), config())
  fs.writeFileSync(path.join(directory, 'devlog.md'), notebook(''))
  git(directory, ['add', '.'])
  git(directory, ['commit', '-q', '-m', 'fixture'])
  return directory
}

test('one intake result validates configuration and treats a newly written final Ask as expected owner input', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('explain the current setup result'))
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.configuration.valid, true)
    assert.equal(result.branch, 'main')
    assert.deepEqual(result.changed_paths, ['devlog.md'])
    assert.equal(result.expected_owner_input, true)
    assert.equal(result.stream_decision.reason, 'owner_input_only')
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ explain the current setup result' })
    assert.match(result.status, /^# STATUS/m)
  } finally {
    drop(directory)
  }
})

test('startup accepts the same valid notebook with CRLF line endings', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('continue on Windows').replace(/\n/g, '\r\n'))
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.configuration.valid, true)
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ continue on Windows' })
  } finally {
    drop(directory)
  }
})

test('a change outside the notebook stays a foreign-work stream trigger', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('inspect this request'))
    fs.writeFileSync(path.join(directory, 'other.js'), 'module.exports = true\n')
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
    assert.equal(result.stream_decision.required_next_rulebook, 'references/streams.md')
    assert.deepEqual(result.changed_paths, ['devlog.md', 'other.js'])
  } finally {
    drop(directory)
  }
})

test('an earlier notebook edit is not disguised as expected owner input', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('inspect this request').replace('Project: test.', 'Project: foreign edit.'))
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
  } finally {
    drop(directory)
  }
})

test('a notebook edit that is not a final unresolved Ask remains a stream trigger', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n# ← Reply / A-001\n\nanswer\n`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.expected_owner_input, false)
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
  } finally {
    drop(directory)
  }
})

test('the returned Ask excludes the current round checkpoint', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n---\n\n## [WIP-001] Checkpoint — 2026-08-31 16:35 (during round A-001)\n`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ inspect this request' })
  } finally {
    drop(directory)
  }
})

test('the returned Ask excludes current RUN events before a checkpoint', () => {
  const directory = make_repo()
  try {
    const run = '## [RUN-001] Event — 2026-09-04 10:00 (during round A-001)\n\n- **Material result:** focused tests passed.\n'
    const wip = '## [WIP-001] Checkpoint — 2026-09-04 10:10 (during round A-001)\n\n- **Finished:** one task.\n'
    fs.writeFileSync(path.join(directory, 'devlog.md'), `${notebook('inspect this request')}\n${run}\n${wip}`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ inspect this request' })
  } finally {
    drop(directory)
  }
})

test('a malformed RUN-like heading cannot hide later owner input', () => {
  const text = `${notebook('retain this owner instruction')}\n## [RUN-bad] Event — malformed\n\n+ keep this later owner instruction\n`
  assert.deepEqual(intake.final_ask(text), {
    id: 'A-001',
    text: '+ retain this owner instruction\n\n## [RUN-bad] Event — malformed\n\n+ keep this later owner instruction'
  })
})

test('intake returns the current Ask when completed history exceeds the old whole-file limit', () => {
  const directory = make_repo()
  try {
    const history = `${'# ← Reply / A-000\n\nold result text\n\n'.repeat(2500)}---\n\n`
    const large_notebook = notebook('').replace('---\n\n# → Ask', `---\n\n${history}# → Ask`)
    fs.writeFileSync(path.join(directory, 'devlog.md'), large_notebook)
    git(directory, ['add', 'devlog.md'])
    git(directory, ['commit', '-q', '-m', 'large history'])
    fs.writeFileSync(path.join(directory, 'devlog.md'), large_notebook.replace(/\+\n$/u, '+ large notebook request\n'))

    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })

    assert.deepEqual(result.current_ask, { id: 'A-001', text: '+ large notebook request' })
    assert.match(result.status, /^# STATUS/m)
    assert.equal(result.expected_owner_input, true)
    assert.equal(result.stream_decision.reason, 'owner_input_only')
  } finally {
    drop(directory)
  }
})

test('current startup provenance is required before setup files suppress the stream rulebook', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'bootstrap.js'), 'module.exports = true\n')
    const result = intake.collect_intake({
      repo_root: directory,
      notebook_path: 'devlog.md',
      active_host: 'codex',
      bootstrap_provenance: [{
        path: 'bootstrap.js',
        before: null,
        after: identity(path.join(directory, 'bootstrap.js')),
      }],
    })
    assert.equal(result.stream_decision.reason, 'bootstrap_files_only')
  } finally {
    drop(directory)
  }
})

test('a mixed bootstrap and foreign change takes the conservative decision', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'bootstrap.js'), 'module.exports = true\n')
    fs.writeFileSync(path.join(directory, 'foreign.js'), 'module.exports = false\n')
    const result = intake.collect_intake({
      repo_root: directory,
      notebook_path: 'devlog.md',
      active_host: 'codex',
      bootstrap_provenance: [{
        path: 'bootstrap.js',
        before: null,
        after: identity(path.join(directory, 'bootstrap.js')),
      }],
    })
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
  } finally {
    drop(directory)
  }
})

test('filename-only similarity never proves bootstrap provenance', () => {
  const directory = make_repo()
  try {
    fs.writeFileSync(path.join(directory, 'ag.json'), `${config().replace('streams": "always"', 'streams": "off"')}`)
    const result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
  } finally {
    drop(directory)
  }
})

test('a non-default branch and an active stream remain foreign-work reasons', () => {
  const directory = make_repo()
  try {
    git(directory, ['switch', '-c', 'feature'])
    fs.writeFileSync(path.join(directory, 'devlog.md'), notebook('owner request'))
    let result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')

    git(directory, ['switch', 'main'])
    const active = notebook('').replace('Project: test.', 'Project: test.\n\nStreams:\n\nstream: work — active — features/work/work.devlog.md')
    fs.writeFileSync(path.join(directory, 'devlog.md'), active)
    result = intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' })
    assert.equal(result.stream_decision.reason, 'foreign_or_parallel_work')
  } finally {
    drop(directory)
  }
})

test('configured default trunk overrides cached main during local-only intake', () => {
  const directory = make_repo()
  try {
    git(directory, ['branch', 'trunk'])
    git(directory, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
    git(directory, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'])
    git(directory, ['config', 'agentflow.default-branch', 'trunk'])
    git(directory, ['switch', 'trunk'])
    assert.notEqual(intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' }).stream_decision.reason, 'foreign_or_parallel_work')
    git(directory, ['switch', 'main'])
    assert.equal(intake.collect_intake({ repo_root: directory, notebook_path: 'devlog.md', active_host: 'codex' }).stream_decision.reason, 'foreign_or_parallel_work')
  } finally { drop(directory) }
})
