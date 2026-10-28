'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const R = require('./looper-report')
const { main } = require('./agf')
const root = () => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-report-')))
const queue = phase => ({ run_id: 'example', repo: '/project', target_branch: 'main', expected_head: 'abc',
  updated_at: '2026-10-23T07:00:00Z', phase, groups: [
    { id: 'G01', state: 'blocked', workspace: { worktree: '/work/joke' }, tasks: [{ id: 'T01', state: 'working', allowed_paths: ['joke.md'] }, { id: 'T05', allowed_paths: ['joke.2.md'] }] },
    { id: 'G02', state: 'blocked', workspace: { worktree: '/work/poem' }, tasks: [{ id: 'T02', state: 'working', allowed_paths: ['poem.md'] }, { id: 'T06', allowed_paths: ['poem.story.md'] }] },
    { id: 'G03', state: 'blocked', workspace: { worktree: '/work/news' }, tasks: [{ id: 'T04', state: 'working', allowed_paths: ['news.md'] }] },
    { id: 'G04', state: 'pending', depends_on: ['G01', 'G02', 'G03'], tasks: [{ id: 'T03', allowed_paths: ['all.zip'] }] }
  ], questions: [
    { id: 'q1', group_id: 'G01', question: 'Created joke.md; review startup: Operation not permitted.' },
    { id: 'q2', group_id: 'G02', question: 'Created poem.md; review startup: Operation not permitted.' },
    { id: 'q3', group_id: 'G03', question: 'Reliable source pages could not be retrieved.' }
  ] })
const capture = () => { let text = ''; return { write: s => { text += s }, text: () => text } }

test('original six-task blocked example distinguishes drafts, dependencies and completion', () => {
  const q = queue('blocked'), original = JSON.stringify(q)
  const s = R.summary(q, '/run', { code: 2 })
  assert.match(s, /BLOCKED — work remains/)
  assert.match(s, /Tasks completed: 0\/6; Groups integrated: 0\/4/)
  for (const item of q.questions) assert.ok(s.includes(item.question))
  assert.match(s, /G04: WAITING \(pending\)\n    Waiting for checked dependencies: G01, G02, G03/)
  assert.match(s, /isolated work; may be incomplete or unchecked/)
  assert.match(s, /\/work\/joke\/joke.md/)
  assert.match(s, /existence is not verified/)
  assert.match(s, /Technical recovery required/)
  assert.equal(JSON.stringify(q), original)
})

test('invocation error cannot be masked by a saved complete queue', () => {
  const q = queue('complete')
  assert.match(R.summary(q, '/run', { code: 1, error: Error('claim conflict') }), /ERROR — this invocation failed/)
  assert.match(R.summary(q, '/run', { code: 1, error: Error('claim conflict') }), /retained claim\/process evidence before retrying/)
  assert.match(R.summary(undefined, '/run', { code: 1, error: Error('invalid request') }), /No saved queue snapshot/)
  assert.match(R.summary(queue('stopped'), '/run', { code: 2 }), /STOPPED — work preserved/)
})

test('progress suppresses routine saves and snapshots state', () => {
  const out = capture(); let time = 0
  const p = R.observer({ write: out.write, now: () => time })
  const q = queue('running'); p.update(q)
  const first = out.text(); p.update(q); assert.equal(out.text(), first)
  time = 30000; p.heartbeat(); assert.match(out.text(), /Still waiting/)
  q.groups[0].tasks[0].state = 'checking'
  assert.equal(p.snapshot().groups[0].tasks[0].state, 'working')
  p.update(q); assert.match(out.text(), /G01\/T01: checking/)
  q.integration = { group_id: 'G02', phase: 'checks' }; p.update(q)
  assert.match(out.text(), /Integration G02: checks/)
  const broken = R.observer({ write: () => { throw Error('closed pipe') } })
  assert.doesNotThrow(() => { broken.update(q); broken.heartbeat() })
})

test('report is exclusive, contains its path and source time, and refuses linked evidence', t => {
  const dir = root(), q = queue('blocked'), original = JSON.stringify(q)
  const one = R.save_report(dir, q, { code: 2 }), two = R.save_report(dir, q, { code: 2 })
  assert.notEqual(one.file, two.file)
  assert.equal(fs.readFileSync(one.file, 'utf8'), one.content)
  assert.ok(one.content.includes(one.file)); assert.ok(one.content.includes(q.updated_at))
  assert.equal(JSON.stringify(q), original)
  const linked = root()
  try { fs.symlinkSync(path.join(dir, 'evidence'), path.join(linked, 'evidence'), process.platform === 'win32' ? 'junction' : 'dir') }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('symlink privilege unavailable'); throw error }
  assert.throws(() => R.save_report(linked, q), /Symlink path refused/)
})

test('CLI streams progress, retains final report and clears heartbeat for blocked/complete/error', async () => {
  for (const outcome of ['blocked', 'complete', 'error']) {
    const dir = root(), stdout = capture(), stderr = capture(); let cleared = false, tick
    const code = await main(['looper', 'run', dir], { stdout, stderr,
      load: () => ({ repo: dir }), read_settings: () => ({ config: { switches: {} } }),
      setTimeout: fn => { tick = fn; return { unref() {} } }, clearTimeout: () => { cleared = true },
      run: async (_, { on_save }) => {
        const q = queue(outcome === 'error' ? 'running' : outcome)
        on_save(q)
        if (outcome === 'error') throw Error('target moved')
        if (outcome === 'complete') { for (const g of q.groups) { g.state = 'done'; for (const t of g.tasks) t.state = 'done' }; on_save(q); return 0 }
        return 2
      }
    })
    assert.equal(code, outcome === 'blocked' ? 2 : outcome === 'error' ? 1 : 0)
    assert.ok(cleared); assert.equal(typeof tick, 'function')
    assert.match(stderr.text(), /Starting\/resuming/)
    assert.match(stdout.text(), /Saved report:/)
    assert.ok(fs.existsSync(path.join(dir, 'results.md')))
    assert.equal(fs.readdirSync(path.join(dir, 'evidence')).length, 1)
    if (outcome === 'complete') assert.match(stdout.text(), /Tasks completed: 6\/6; Groups integrated: 4\/4/)
    if (outcome === 'error') assert.match(stdout.text(), /ERROR.*\n[\s\S]*target moved/)
  }
})

test('CLI error before a saved snapshot creates no report; report/output failure preserves outcome', async () => {
  const dir = root(), stdout = capture(), stderr = capture()
  const base = { stdout, stderr, load: () => { throw Error('bad queue') } }
  assert.equal(await main(['looper', 'run', dir], { ...base, run: async () => { throw Error('bad request') } }), 1)
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.match(stdout.text(), /bad request/)
  assert.equal(await main(['looper', 'run', dir], { ...base,
    run: async (_, { on_save }) => { on_save(queue('blocked')); return 2 },
    save_report: () => { throw Error('disk full') }
  }), 2)
  assert.match(stderr.text(), /Report could not be saved: disk full/)
  assert.equal(await main(['looper', 'run', dir], { ...base,
    stdout: { write() { throw Error('EPIPE') } }, stderr: { write() { throw Error('EPIPE') } },
    run: async (_, { on_save }) => { on_save(queue('blocked')); return 2 }
  }), 2)
})

test('status uses stdout only, stays read-only and handles invalid roots without a report', async () => {
  const dir = root(), stdout = capture(), stderr = capture()
  assert.equal(await main(['looper', 'status', dir], { stdout, stderr, status: () => 'Run: blocked\nTasks 0/6\n' }), 0)
  assert.equal(stdout.text(), 'Run: blocked\nTasks 0/6\n'); assert.equal(stderr.text(), '')
  assert.deepEqual(fs.readdirSync(dir), [])
  assert.equal(await main(['looper', 'status', dir], { stdout, stderr, status: () => { throw Error('queue missing') } }), 1)
  assert.match(stderr.text(), /containing queue.json/)
  assert.equal(await main(['oops'], { stdout, stderr }), 1)
})

test('configured Traditional Chinese presentation and safe control characters', () => {
  const s = R.summary(queue('blocked'), '/run', { code: 2, locale: 'zh-TW', error: Error('\x1b[31mdenied') })
  assert.match(s, /本次執行失敗/); assert.match(s, /已完成任務: 0\/6/)
  assert.equal(s.includes('\x1b'), false)
  assert.match(R.summary(queue('blocked'), '/run', { code: 2, locale: 'zh' }), /已完成任務/)
  assert.match(R.summary(queue('blocked'), '/run', { locale: 'zh-CN' }), /Unsupported CLI locale/)
  assert.match(R.details(queue('running'), '/run'), /inspect coordinator and writer status/)
  assert.equal(R.details(queue('running'), '/run').includes('agf looper run'), false)
})

test('CLI heartbeat resets after progress, survives an early wall-clock tick and clears on settlement', async () => {
  const dir = root(), stdout = capture(), stderr = capture(), timers = []; let clock = 0
  const code = await main(['looper', 'run', dir], { stdout, stderr, now: () => clock,
    load: () => ({ repo: dir }), read_settings: () => ({ config: { switches: {} } }),
    setTimeout: (fn, delay) => { const t = { fn, due: clock + delay, cancelled: false, unref() {} }; timers.push(t); return t },
    clearTimeout: t => { if (t) t.cancelled = true },
    run: async (_, { on_save }) => {
      const q = queue('running'); on_save(q)
      clock = 29000; q.groups[0].tasks[0].state = 'checking'; on_save(q)
      const active = timers.filter(t => !t.cancelled)
      assert.equal(active.length, 1); assert.equal(active[0].due, 59000)
      // Node's relative timer may fire before the wall clock reaches its nominal deadline.
      clock = 58999; active[0].cancelled = true; active[0].fn()
      assert.match(stderr.text(), /Still waiting/)
      assert.equal(timers.filter(t => !t.cancelled).length, 1)
      q.phase = 'blocked'; on_save(q); return 2
    }
  })
  assert.equal(code, 2); assert.equal(timers.filter(t => !t.cancelled).length, 0)
})

test('blocked worker evidence reaches live, status and saved reports with bounded redacted text', () => {
  const q = queue('blocked')
  q.questions = [{ id: 'blocked-1', group_id: 'G01', question: 'Independent review could not start.',
    attempt_dir: '/run/attempts/exact-attempt',
    evidence: ['Error: app-server initialization failed.', 'access_token=private-value', 'x'.repeat(2000), 'check log: /run/evidence/check.log', 'not displayed'] }]
  let live = ''
  R.observer({ locale: 'en-us', write: value => { live += value } }).update(q)
  const dir = root(), before = JSON.stringify(q)
  const saved = R.save_report(dir, q, { code: 2, locale: 'en-us' })
  for (const output of [live, R.details(q, dir, 'en-us'), saved.content]) {
    assert.match(output, /\/run\/attempts\/exact-attempt/)
    assert.match(output, /app-server initialization failed/)
    assert.match(output, /check\.log/)
    assert.doesNotMatch(output, /private-value|not displayed/)
    assert.equal(output.includes('x'.repeat(501)), false)
  }
  assert.equal(JSON.stringify(q), before)
  assert.match(R.details(q, dir, 'zh-TW'), /代理回報證據/)
})

test('CLI resolves an aliased run root before locale preflight', async t => {
  const dir = root(), alias = path.join(dir, 'alias'), target = path.join(dir, 'planned')
  fs.mkdirSync(target)
  try { fs.symlinkSync(target, alias, 'dir') }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('Symlink privilege unavailable'); return }; throw error }
  const stdout = capture(), stderr = capture()
  assert.equal(await main(['looper', 'run', alias], { stdout, stderr,
    load: value => { assert.equal(value, fs.realpathSync(target)); return { repo: dir } },
    read_settings: () => ({ config: { switches: { 'use-lang': 'zh-TW' } } }),
    run: async value => { assert.equal(value, fs.realpathSync(target)); return 2 }
  }), 2)
  assert.match(stderr.text(), /開始或繼續執行/)
  assert.doesNotMatch(stderr.text(), /無法讀取語系|Locale setting unavailable/)
})

test('ordinary review transitions and heartbeat expose configured pending review without inventing progress', () => {
  const q = queue('running'), g = q.groups[0], review = { request_id: 'request-1', state: 'pending',
    attempt: { id: 'reviewer-1', selection: { kind: 'cli', provider: 'codex', model: 'selected-model', effort: 'high' } } }
  g.state = 'working'; g.tasks[0].state = 'working'; g.attempt = { id: 'task-1', ordinary_reviews: [review] }
  let live = ''
  const observer = R.observer({ locale: 'en-us', write: value => { live += value } })
  observer.update(q); observer.heartbeat()
  assert.match(live, /Ordinary review G01\/T01: pending\n           cli codex selected-model\/high/)
  assert.match(R.details(q, '/run', 'zh-TW'), /一般審查 G01\/T01: pending/)
  assert.match(R.details(q, '/run'), /\/run\/attempts\/reviewer-1/)
  live = ''; review.state = 'complete'; review.result = { outcome: 'pass' }; observer.update(q)
  assert.match(live, /Ordinary review G01\/T01: complete\/pass/)
  g.tasks[0].ordinary_reviews = [review]; delete g.attempt
  assert.match(R.summary(q, '/run'), /Ordinary review G01\/T01: complete\/pass/)
})

test('readable blocks retain reviewer tokens and separate heartbeat items in both locales', () => {
  for (const locale of ['en-us', 'zh-TW']) {
    const q = queue('running')
    for (const g of q.groups.slice(0, 3)) g.state = 'working'
    q.groups[0].tasks[0].ordinary_reviews = [{ request_id: 'readability', state: 'complete', result: { outcome: 'pass' },
      attempt: { selection: { kind: 'cli', provider: 'codex', model: 'gpt-6.1-sol', effort: 'high' } } }]
    const out = capture(), p = R.observer({ locale, write: out.write, now: () => 0 })
    p.update(q)
    assert.match(out.text(), /complete\/pass\n           cli codex gpt-6\.1-sol\/high\n\n/)
    const before = out.text().length
    p.heartbeat()
    const heartbeat = out.text().slice(before)
    assert.match(heartbeat, /\n             G01\/T01: working\n             G02\/T02: working\n             G03\/T04: working\n\n$/)
    q.groups[0].tasks[0].ordinary_reviews[0].state = 'pending'
    delete q.groups[0].tasks[0].ordinary_reviews[0].result
    p.update(q)
    const pending_start = out.text().length
    p.heartbeat()
    assert.match(out.text().slice(pending_start), /G01\/T01: pending\n             cli codex gpt-6\.1-sol\/high\n             G02\/T02: working/)
    const report = R.summary(q, '/a long run/root', { locale, code: 2, generated: 'fixed' })
    assert.ok(report.includes("agf looper status '/a long run/root'"))
    assert.ok(report.includes('\n\n'))
    assert.doesNotMatch(report, /\n\n\n|[ \t]+\n|\x1b/)
    assert.match(R.details(q, '/run', locale), /\n\n  G02\/T02/)
    assert.match(report, /\n    cli codex gpt-6\.1-sol\/high/)
  }
})

test('terminal wrapping changes progress while final reports retain logical layout', async () => {
  const outputs = []
  for (const isTTY of [true, false]) {
    const stdout = { ...capture(), isTTY, columns: 20 }, stderr = { ...capture(), isTTY, columns: 20 }
    const q = queue('blocked')
    const code = await main(['looper', 'run', '/unused'], { stdout, stderr,
      load: () => q, read_settings: () => ({ config: { switches: { 'use-lang': 'zh-TW' } } }),
      now: () => 0, setTimeout: () => ({ unref() {} }), clearTimeout() {},
      run: async (_, { on_save }) => { on_save(q); return 2 },
      save_report: () => { throw Error('fixture: no report directory') }
    })
    assert.equal(code, 2)
    outputs.push([stdout.text().replace(/Report time: .*/g, 'Report time: fixed').replace(/報告時間: .*/g, '報告時間: fixed'), stderr.text()])
  }
  assert.equal(outputs[0][0].replace(/\x1b\[[0-9;]*m/g, ''), outputs[1][0])
  assert.notEqual(outputs[0][1], outputs[1][1])
  assert.ok(outputs[1][1].includes(queue('blocked').questions[0].question))
  assert.ok(outputs[0][0].includes("agf looper run '/unused'"))
})

test('timestamped progress uses a hanging body column at 40, 60 and 80 cells', () => {
  const heading = 'Ordinary review G01/T05: complete/pass with additional review information'
  for (const columns of [40, 60, 80]) {
    const output = R.progress_text(`${heading}\ncli codex gpt-6.1-sol/high`, '21:25:21', columns)
    const rows = output.trimEnd().split('\n')
    assert.ok(rows[0].startsWith('[21:25:21] '))
    for (const row of rows.slice(1)) assert.ok(row.startsWith(' '.repeat(11)))
    for (const row of rows) assert.ok(row.length <= columns)
    assert.ok(output.includes('gpt-6.1-sol/high'))
    assert.equal(rows.map(row => row.slice(11)).join(''), heading + 'cli codex gpt-6.1-sol/high')
  }
  assert.equal(R.progress_text('heading\ndetails', '21:25:21'), '[21:25:21] heading\n           details\n\n')
})

test('Unicode wrapping keeps graphemes intact, accounts for wide cells and preserves pipe tokens', () => {
  const text = '中文審查👩🏽‍💻🇹🇼e\u0301漢字😀資料 ' + 'long-model/effort'.repeat(3)
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const original = Array.from(segmenter.segment(text), item => item.segment)
  for (const columns of [13, 17, 40]) {
    const rows = R.progress_text(text, '00:00:00', columns).trimEnd().split('\n')
    const actual = rows.flatMap(row => Array.from(segmenter.segment(row.slice(11)), item => item.segment))
    assert.deepEqual(actual, original)
    for (const row of rows) {
      const width = Array.from(segmenter.segment(row.slice(11)), item => /[\p{Script=Han}\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(item.segment) ? 2 : 1).reduce((a, b) => a + b, 0)
      assert.ok(width <= columns - 11)
    }
  }
  assert.equal(R.progress_text(text, '00:00:00'), `[00:00:00] ${text}\n\n`)
  assert.equal(R.progress_text('中👩🏽‍💻', '00:00:00', 12).replace(/\n| /g, ''), '[00:00:00]中👩🏽‍💻')
})

test('observer reads current width on every emit and isolates rendering/output failures', () => {
  const out = capture(); let columns = 40, reads = 0, activity = 0
  const observer = R.observer({ write: out.write, now: () => 0,
    columns: () => { reads++; return columns }, on_activity: () => { activity++ } })
  const text = 'review progress '.repeat(8)
  observer.emit(text)
  const first = out.text(); columns = 80; observer.emit(text)
  assert.ok(first.split('\n').length > out.text().slice(first.length).split('\n').length)
  assert.equal(reads, 2); assert.equal(activity, 2)
  const broken = R.observer({ write() { throw Error('closed') }, columns() { throw Error('width unavailable') }, on_activity() { activity++ } })
  assert.doesNotThrow(() => broken.emit(text)); assert.equal(activity, 3)
  const fallback = capture()
  R.observer({ write: fallback.write, now: () => 0, columns() { throw Error('width unavailable') } }).emit(text)
  assert.ok(fallback.text().includes(text))
})

test('cleanup parser requires an explicit manual root and accepts the run flag only once', async () => {
  const stdout = capture(), stderr = capture()
  const forbidden = () => { throw Error('must not dispatch') }
  for (const args of [
    ['looper', 'cleanup'], ['looper', 'cleanup', ''], ['looper', 'cleanup', '/run', '--cleanup'],
    ['looper', 'status', '/run', '--cleanup'], ['looper', 'run', '--cleanup', '--cleanup'],
    ['looper', 'run', '--unknown'], ['looper', 'cleanup', '/one', '/two']
  ]) assert.equal(await main(args, { stdout, stderr, cleanup: forbidden, run: forbidden, load: forbidden }), 1)
  assert.match(stderr.text(), /agf looper cleanup <run-root>/)
})

test('manual cleanup dispatches no tasks, retains records in presentation and creates no run report', async () => {
  const dir = root(), stdout = capture(), stderr = capture(), q = queue('complete')
  q.cleanup = { state: 'complete', bundle: '/stage', trash_path: '/trash/bundle',
    records: [], items: [{ source: '/work/joke', staged: '/stage/0', records: { source: '/work/joke/.aglite-records', destination: '/retained/G01', move: 'done' } }] }
  let called = 0
  const io = { stdout, stderr, load: () => q,
    read_settings: () => ({ config: { switches: { 'use-lang': 'zh-TW' } } }),
    run: () => { throw Error('manual cleanup must not run tasks') },
    cleanup: async directory => { assert.equal(directory, dir); called++; return q } }
  assert.equal(await main(['looper', 'cleanup', dir], io), 0)
  assert.equal(called, 1); assert.deepEqual(fs.readdirSync(dir), [])
  assert.match(stdout.text(), /清理: 完成/); assert.match(stdout.text(), /保留的任務紀錄 G01: \/retained\/G01/)
  assert.equal(await main(['looper', 'cleanup', dir], { ...io, cleanup: async () => { throw Error('foreign worktree') } }), 1)
  assert.match(stderr.text(), /foreign worktree/)
})

test('opt-in cleanup runs only after success and a cleanup failure preserves the task outcome', async () => {
  for (const outcome of ['default', 'complete', 'cleanup-failed', 'blocked', 'error']) {
    const dir = root(), stdout = capture(), stderr = capture(), q = queue(outcome === 'blocked' ? 'blocked' : 'complete')
    if (q.phase === 'complete') for (const g of q.groups) { g.state = 'done'; for (const t of g.tasks) t.state = 'done' }
    let cleanups = 0
    const io = { stdout, stderr, load: () => q, read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
      run: async (_, { on_save }) => { on_save(q); if (outcome === 'error') throw Error('task invocation failed'); return outcome === 'blocked' ? 2 : 0 },
      cleanup: async (_, { on_save }) => {
        cleanups++
        q.cleanup = { state: outcome === 'cleanup-failed' ? 'failed' : 'complete', compaction: { state: 'complete', items: [] }, records: [], items: [] }
        on_save(q)
        if (outcome === 'cleanup-failed') throw Error('Trash unavailable')
        return q
      }
    }
    const args = ['looper', 'run', dir, ...(outcome === 'default' ? [] : ['--cleanup'])]
    assert.equal(await main(args, io), outcome === 'blocked' ? 2 : ['error', 'cleanup-failed'].includes(outcome) ? 1 : 0)
    assert.equal(cleanups, ['complete', 'cleanup-failed'].includes(outcome) ? 1 : 0)
    assert.equal(fs.existsSync(path.join(dir, 'evidence')), outcome !== 'complete')
    if (outcome !== 'complete') assert.equal(fs.readdirSync(path.join(dir, 'evidence')).length, 1)
    if (outcome === 'cleanup-failed') {
      assert.match(stdout.text(), /Result: COMPLETE/); assert.doesNotMatch(stdout.text(), /ERROR — this invocation failed/)
      assert.match(stdout.text(), /Exit code: 1/); assert.match(stdout.text(), /Cleanup: failed/)
      assert.ok(stdout.text().includes(`agf looper cleanup '${dir}'`))
    }
    if (['blocked', 'error'].includes(outcome)) assert.match(stdout.text(), /Cleanup: skipped/)
    if (outcome === 'default') assert.doesNotMatch(stdout.text(), /Cleanup:/)
    if (outcome === 'complete') assert.match(stdout.text(), /Cleanup: complete/)
  }
})
test('a saved incomplete cleanup reports its manual retry rather than failed task completion', async () => {
  const dir = root(), stdout = capture(), stderr = capture(), q = queue('complete')
  for (const g of q.groups) { g.state = 'done'; for (const t of g.tasks) t.state = 'done' }
  q.cleanup = { state: 'failed', error: 'prior provider failure', records: [], items: [] }
  const code = await main(['looper', 'run', dir, '--cleanup'], { stdout, stderr, load: () => q,
    read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
    run: async () => { throw Error('Cleanup incomplete; use manual cleanup') },
    cleanup: () => assert.fail('unsettled cleanup must not restart tasks or automatic cleanup') })
  assert.equal(code, 1)
  assert.match(stdout.text(), /Tasks completed: 6\/6/)
  assert.match(stdout.text(), /Cleanup: incomplete/)
  assert.doesNotMatch(stdout.text(), /Cleanup: skipped/)
  assert.ok(stdout.text().includes(`agf looper cleanup '${dir}'`))
})
test('cleanup status locates retained merge records and both recovery paths with localized reasons', () => {
  const q = queue('complete')
  q.cleanup = { state: 'failed', bundle: '/staging/bundle', trash_path: '/trash/bundle',
    retained: [{ path: '/run/foreign', reason: 'unproved_scratch' }],
    items: [{ source: '/work/merge', staged: '/staging/bundle/0', records: { source: '/work/merge/.aglite-records', destination: '/run/records/merge', move: 'done' } }] }
  const text = R.details(q, '/run', 'zh-TW')
  assert.match(text, /保留的任務紀錄:\n\n  \/run\/records\/merge/)
  assert.match(text, /已記錄的垃圾桶資料夾: \/trash\/bundle/)
  assert.match(text, /清理暫存位置: \/staging\/bundle/)
  assert.match(text, /保留證據或尚未證明暫存資料歸屬/)
})


test('TTY highlighting preserves plain content, locale, NO_COLOR and pipe behavior', () => {
  for (const locale of ['en-us', 'zh-TW']) {
    const plain = R.summary(queue('blocked'), '/run', { code: 2, locale })
    const tty = R.terminal_text(plain, { isTTY: true }, locale, { TERM: 'xterm' })
    assert.match(tty, /\x1b\[1;91m/)
    assert.match(tty, /\x1b\[1;96m/)
    assert.equal(tty.replace(/\x1b\[[0-9;]*m/g, ''), plain)
    for (const [stream, env] of [[{ isTTY: false }, {}], [{ isTTY: true }, { NO_COLOR: '' }], [{ isTTY: true }, { TERM: 'dumb' }]])
      assert.equal(R.terminal_text(plain, stream, locale, env), plain)
    assert.ok(plain.indexOf(queue('blocked').questions[0].question) < plain.indexOf(R.dictionary(locale).outputs))
    assert.ok(plain.indexOf(R.dictionary(locale).next) < plain.indexOf(R.dictionary(locale).outputs))
  }
  assert.doesNotMatch(R.terminal_text('bad \x1b[2Jtext', { isTTY: false }), /\x1b/)
})

test('CLI colors terminal summary and progress but saves plain reports with unchanged exit', async () => {
  const dir = root(), stdout = { ...capture(), isTTY: true }, stderr = { ...capture(), isTTY: true }
  const q = queue('blocked')
  const code = await main(['looper', 'run', dir], { stdout, stderr, env: { TERM: 'xterm' }, load: () => q,
    read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
    run: async (_, options) => { options.on_save(q); return 2 } })
  assert.equal(code, 2)
  assert.match(stdout.text(), /\x1b\[1;91mResult: BLOCKED/)
  assert.match(stderr.text(), /\x1b\[1;91m/)
  const saved = fs.readdirSync(path.join(dir, 'evidence')).find(file => file.startsWith('run-'))
  assert.doesNotMatch(fs.readFileSync(path.join(dir, 'evidence', saved), 'utf8'), /\x1b/)
})


test('complete/error/cleanup color, early recovery and plain saved bytes preserve task outcome', async () => {
  for (const scenario of ['complete', 'error', 'cleanup']) {
    const dir = root(), q = queue('complete'), stdout = { ...capture(), isTTY: true }, stderr = capture()
    q.questions = []; q.groups.forEach(g => { g.state = 'done'; g.tasks.forEach(t => { t.state = 'done' }) })
    const code = await main(['looper', 'run', dir, ...(scenario === 'cleanup' ? ['--cleanup'] : [])], {
      stdout, stderr, env: { TERM: 'xterm' }, load: () => q,
      read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
      run: async (_, options) => { options.on_save(q); if (scenario === 'error') throw Error('claim conflict'); return 0 },
      cleanup: async () => { throw Error('Trash unavailable') }
    })
    assert.equal(code, scenario === 'complete' ? 0 : 1)
    assert.match(stdout.text(), scenario === 'complete' ? /\x1b\[1;92mResult: COMPLETE/ : /\x1b\[1;91mResult:/)
    const plain = stdout.text().replace(/\x1b\[[0-9;]*m/g, '')
    if (scenario !== 'complete') assert.ok(plain.indexOf('Next:') < plain.indexOf('Declared output paths'))
    if (scenario === 'cleanup') {
      assert.match(stdout.text(), /\x1b\[1;91mCleanup blocker: Trash unavailable/)
      assert.ok(plain.indexOf('Trash unavailable') < plain.indexOf('Declared output paths'))
      assert.match(plain, /Result: COMPLETE/)
      assert.equal(plain.match(/Next: Resolve the saved cleanup blocker/g).length, 1)
    }
    const saved = fs.readdirSync(path.join(dir, 'evidence')).find(file => file.startsWith('run-'))
    const bytes = fs.readFileSync(path.join(dir, 'evidence', saved), 'utf8')
    assert.doesNotMatch(bytes, /\x1b/)
    assert.equal(bytes, plain)
  }
})

test('looper namespace replaces loop without dispatching legacy commands', async () => {
  const stdout = capture(), stderr = capture()
  for (const verb of ['run', 'status', 'cleanup'])
    assert.equal(await main(['loop', verb, '/run'], { stdout, stderr,
      run: () => assert.fail('legacy command dispatched'),
      load: () => assert.fail('legacy command read queue'),
      status: () => assert.fail('legacy command read status'),
      cleanup: () => assert.fail('legacy command cleaned') }), 1)
  assert.match(stderr.text(), /Usage: agf looper cleanup/)
})

test('grouped mixed outcomes preserve checked tasks and attach task failures only to current work', () => {
  const q = queue('blocked'), g = q.groups[0]
  g.tasks[0].state = 'done'; g.tasks[0].result = { summary: 'Created joke.md successfully.' }
  q.questions[0].kind = 'task'; q.questions[0].question = 'network error access_token=private-value'
  g.tasks.push({ id: 'T07', state: 'pending', allowed_paths: ['later.md'] })
  q.groups[1].tasks.forEach(t => { t.state = 'done'; t.result = { summary: 'Wrote poem.' } })
  q.questions[1].kind = 'integration'; q.questions[1].question = 'combined check failed'
  const before = JSON.stringify(q)
  for (const locale of ['en-us', 'zh-TW']) {
    const w = R.dictionary(locale), out = R.summary(q, '/run', { code: 2, locale })
    const group = out.slice(out.indexOf(`  G01:`), out.indexOf(`  G02:`))
    assert.ok(group.includes(`    T01: ${w.task_success}`))
    assert.ok(group.includes(w.integration_pending))
    assert.ok(group.includes('Created joke.md successfully.'))
    assert.ok(group.includes(`    T05: ${w.failed}`))
    assert.ok(group.includes(`    T07: ${w.pending_result}`))
    assert.ok(group.indexOf('T01:') < group.indexOf('T05:'))
    assert.ok(group.indexOf('T05:') < group.indexOf('T07:'))
    assert.ok(group.slice(group.indexOf('T07:')).includes(w.not_started))
    assert.equal(group.slice(group.indexOf('T01:'), group.indexOf('T05:')).includes(w.draft), false)
    assert.match(group.slice(group.indexOf('T05:'), group.indexOf('T07:')), /network error/)
    assert.doesNotMatch(group.slice(group.indexOf('T01:'), group.indexOf('T05:')), /network error/)
    const integrated_failure = out.slice(out.indexOf(`  G02:`), out.indexOf(`  G03:`))
    assert.ok(integrated_failure.includes('combined check failed'))
    assert.equal(integrated_failure.includes(w.draft), false)
    assert.equal(integrated_failure.includes(`: ${w.failed}`), true) // group only
    for (const id of ['T02', 'T06']) assert.ok(integrated_failure.includes(`    ${id}: ${w.task_success}`))
    assert.ok(out.includes(w.waiting_result)); assert.ok(out.includes(w.outputs))
    assert.doesNotMatch(out, /private-value/)
  }
  assert.equal(JSON.stringify(q), before)
})

test('complete group tree shows successful integration, concise summaries and unverified paths', () => {
  const q = queue('complete'); q.questions = []
  for (const g of q.groups) {
    g.state = 'done'
    for (const t of g.tasks) { t.state = 'done'; t.result = { summary: 'Result\n' + 'x'.repeat(300) } }
  }
  const out = R.summary(q, '/run', { code: 0, locale: 'en-us' })
  assert.match(out, /G01: SUCCESS \(done\)\n    T01: SUCCESS — task checked \(done\); integrated target/)
  assert.ok(out.includes('/project/poem.md')); assert.ok(out.includes('existence is not verified'))
  assert.equal(out.includes('x'.repeat(241)), false)
  assert.equal(out.includes('Result\nxxx'), false)
})

test('uncertain writers are distinguished from failure and missing summaries keep checked outputs', () => {
  const q = queue('blocked'), g = q.groups[0]
  g.state = 'uncertain'; g.tasks[0].state = 'done'; q.questions = []
  for (const locale of ['en-us', 'zh-TW']) {
    const w = R.dictionary(locale), out = R.summary(q, '/run', { code: 2, locale })
    const group = out.slice(out.indexOf('  G01:'), out.indexOf('  G02:'))
    assert.ok(group.includes(`G01: ${w.uncertain_result}`))
    assert.ok(group.includes(`T05: ${w.uncertain_result}`))
    assert.ok(group.includes(`T01: ${w.task_success}`))
    assert.ok(group.includes('/work/joke/joke.md'))
    assert.equal(group.includes(w.failed), false)
    assert.doesNotMatch(group, /undefined|null/)
  }
})

test('status details preserve checked and not-started states, and all-done task blockers remain in the tree', () => {
  const q = queue('blocked'), g = q.groups[0]
  g.tasks[0].state = 'done'; g.tasks.push({ id: 'T07', allowed_paths: ['later.md'] })
  for (const locale of ['en-us', 'zh-TW']) {
    const w = R.dictionary(locale), out = R.details(q, '/run', locale)
    assert.ok(out.includes(`G01/T01: done; ${w.integration_pending}`))
    assert.ok(out.includes(`G01/T07: pending; ${w.not_started}`))
  }
  g.tasks.forEach(t => { t.state = 'done' })
  q.questions[0].kind = 'task'; q.questions[0].question = 'Saved check proof changed'
  const out = R.summary(q, '/run', { code: 2, locale: 'en-us' })
  const group = out.slice(out.indexOf('  G01:'), out.indexOf('  G02:'))
  assert.match(group, /Saved blocker: Saved check proof changed/)
})

test('latest Markdown report updates the same run, links snapshots and safely fences saved text', () => {
  const dir = root(), q = queue('blocked')
  q.questions[0].question = '```\n<script>saved text</script>\n```'
  const before = JSON.stringify(q)
  const first = R.save_report(dir, q, { code: 2, locale: 'en-us' })
  assert.equal(first.warning, undefined)
  assert.equal(JSON.stringify(q), before)
  const report = fs.readFileSync(first.latest, 'utf8')
  assert.match(report, /# Latest results/)
  assert.match(report, /queue\.json>\)/)
  assert.ok(report.includes(path.basename(first.file)))
  assert.ok(report.includes(q.updated_at)); assert.match(report, /Report time:/)
  assert.match(report, /````text\n/)
  assert.match(report, /G01\/T01/); assert.match(report, /q1/)
  q.updated_at = '2026-10-24T07:00:00Z'
  const second = R.save_report(dir, q, { code: 2, locale: 'zh-tw' })
  assert.equal(second.warning, undefined)
  const latest = fs.readFileSync(second.latest, 'utf8')
  assert.match(latest, /# 最新結果/); assert.ok(latest.includes(path.basename(second.file)))
  assert.ok(fs.existsSync(first.file)); assert.ok(fs.existsSync(second.file))
})

test('latest report preserves foreign, edited, unsafe, stale and declared-output collisions', () => {
  for (const kind of ['foreign', 'edited', 'directory', 'hardlink', 'stale', 'output', 'output-parent', 'request', 'group-input']) {
    const dir = root(), q = queue('blocked'), target = path.join(dir, 'results.md')
    if (kind === 'foreign') fs.writeFileSync(target, 'owner notes\n')
    if (kind === 'directory') fs.mkdirSync(target)
    if (kind === 'hardlink') { fs.writeFileSync(path.join(dir, 'owner.md'), 'notes'); fs.linkSync(path.join(dir, 'owner.md'), target) }
    if (kind === 'edited' || kind === 'stale') {
      assert.equal(R.save_report(dir, q, { code: 2 }).warning, undefined)
      if (kind === 'edited') fs.appendFileSync(target, '\nowner annotation\n')
      else q.updated_at = '2026-10-22T07:00:00Z'
    }
    if (kind === 'request') q.request = 'results.md'
    if (kind === 'group-input') q.groups[0].file = 'results.md'
    if (kind.startsWith('output')) { q.repo = dir; q.groups[0].tasks[0].allowed_paths = [kind === 'output' ? 'results.md' : '.'] }
    const before = fs.existsSync(target) && fs.statSync(target).isFile() ? fs.readFileSync(target) : null
    const state = JSON.stringify(q), result = R.save_report(dir, q, { code: 2 })
    assert.ok(result.warning, kind)
    assert.ok(fs.existsSync(result.file), kind)
    if (before) assert.deepEqual(fs.readFileSync(target), before, kind)
    else assert.ok(kind === 'directory' ? fs.statSync(target).isDirectory() : !fs.existsSync(target), kind)
    assert.equal(JSON.stringify(q), state, kind)
  }
})

test('linked latest report refuses writes and CLI keeps exit and immutable snapshot on collision', async t => {
  const dir = root(), target = path.join(dir, 'owner.md'), latest = path.join(dir, 'results.md')
  fs.writeFileSync(target, 'owner')
  try { fs.symlinkSync(target, latest) }
  catch (error) { if (process.platform === 'win32' && error.code === 'EPERM') return t.skip('symlink privilege unavailable'); throw error }
  const stdout = capture(), stderr = capture(), q = queue('blocked')
  const code = await main(['looper', 'run', dir], { stdout, stderr, load: () => q,
    read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
    run: async (_, { on_save }) => { on_save(q); return 2 } })
  assert.equal(code, 2)
  assert.match(stderr.text(), /Latest results not updated; invocation snapshot saved: Symlink path refused/)
  assert.match(stdout.text(), /Saved report:/)
  assert.equal(fs.readFileSync(target, 'utf8'), 'owner')
  assert.equal(fs.readdirSync(path.join(dir, 'evidence')).length, 1)
})

test('latest-report collision leaves complete, blocked and invocation-error exit codes unchanged', async () => {
  for (const expected of [0, 2, 1]) {
    const dir = root(), stdout = capture(), stderr = capture(), q = queue(expected === 0 ? 'complete' : 'blocked')
    if (expected === 0) for (const group of q.groups) { group.state = 'done'; for (const task of group.tasks) task.state = 'done' }
    fs.writeFileSync(path.join(dir, 'results.md'), 'owner report')
    const code = await main(['looper', 'run', dir], { stdout, stderr, load: () => q,
      read_settings: () => ({ config: { switches: { 'use-lang': 'en-us' } } }),
      run: async (_, { on_save }) => { on_save(q); if (expected === 1) throw Error('fixture invocation error'); return expected } })
    assert.equal(code, expected)
    assert.equal(fs.readFileSync(path.join(dir, 'results.md'), 'utf8'), 'owner report')
    assert.equal(fs.readdirSync(path.join(dir, 'evidence')).length, 1)
    assert.match(stderr.text(), /Foreign results.md preserved/)
  }
})

test('localized latest warning distinguishes a saved snapshot and reaches both output streams', async () => {
  const dir = root(), stdout = capture(), stderr = capture(), q = queue('blocked')
  fs.writeFileSync(path.join(dir, 'results.md'), 'owner')
  assert.equal(await main(['looper', 'run', dir], { stdout, stderr, load: () => q,
    read_settings: () => ({ config: { switches: { 'use-lang': 'zh-tw' } } }),
    run: async (_, { on_save }) => { on_save(q); return 2 } }), 2)
  for (const output of [stdout.text(), stderr.text()]) {
    assert.match(output, /最新結果未更新；已儲存本次執行快照: 已保留外來 results.md/)
    assert.doesNotMatch(output, /Foreign|could not be saved/)
  }
})

test('changed report is preserved and prepared temporary report is named for recovery', () => {
  const dir = root(), q = queue('blocked'), latest = R.save_report(dir, q, { code: 2 }).latest
  const write = fs.writeFileSync
  try {
    fs.writeFileSync = (file, ...args) => {
      const result = write(file, ...args)
      if (path.basename(file).startsWith('.results-')) write(latest, 'concurrent owner edit')
      return result
    }
    const saved = R.save_report(dir, q, { code: 2 })
    assert.match(saved.warning, /results.md changed; Prepared report retained at/)
    assert.equal(fs.readFileSync(latest, 'utf8'), 'concurrent owner edit')
    assert.ok(fs.readdirSync(dir).some(file => /^\.results-.*\.tmp$/.test(file)))
  } finally { fs.writeFileSync = write }
})

test('compact-cleaned repeat does not recreate latest or invocation reports', async () => {
  const dir = root(), q = queue('complete')
  q.cleanup = { state: 'complete', compaction: { state: 'complete', items: [] }, records: [], items: [] }
  assert.equal(await main(['looper', 'run', dir], { stdout: capture(), stderr: capture(), load: () => q,
    read_settings: () => ({ config: { switches: {} } }), run: async () => 0 }), 0)
  assert.deepEqual(fs.readdirSync(dir), [])
})

test('ownership metadata cannot terminate its HTML comment through a run-root path', () => {
  const dir = path.join(root(), 'owner-->notes')
  fs.mkdirSync(dir)
  const saved = R.save_report(dir, queue('blocked'), { code: 2 })
  const header = fs.readFileSync(saved.latest, 'utf8').split('\n')[0]
  assert.equal(header.match(/-->/g).length, 1)
  assert.equal(header.includes('owner-->notes'), false)
  assert.equal(R.save_report(dir, queue('blocked'), { code: 2 }).warning, undefined)
})
