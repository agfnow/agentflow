'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const records = require('./completion-record')
const { completion_metadata } = require('./round-linter')
const ownership_fixture = require('./fixtures/notebook-owner')
ownership_fixture.configure()
const fixture = () => {
  const project_root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'completion-record-')))
  fs.mkdirSync(path.join(project_root, '.agentflow'))
  fs.writeFileSync(path.join(project_root, '.agentflow/devlog.md'), '# → Ask / A-001\n\n+ implement\n')
  ownership_fixture.adopt(project_root, '.agentflow/devlog.md')
  return { project_root, notebook_path: '.agentflow/devlog.md', workspace_dir: '.agentflow', ask: 'A-001' }
}
const draft = '## [FINAL REPORT]\n\n1. Done.\n\n```completion-metadata\nHost review: PASS — inspected the requested change.\n```\n'
const incident_xml = '<completion-metadata>\nHost review: PASS — inspected poem-zh-tw.md against the request; it contains one complete Traditional Chinese poem and no unrelated content.\nInformational document: poem-zh-tw.md — requested non-executable poem artifact.\n</completion-metadata>'
const legacy_reply = ctx => {
  const info = records.location(ctx)
  const record = { version: 1, notebook: ctx.notebook_path, ask: ctx.ask, created_at: '2026-09-11 12:00:00 +0800', metadata_text: 'Host review: PASS — inspected the requested change.' }
  const bytes = JSON.stringify(record, null, 2) + '\n'
  fs.mkdirSync(path.dirname(info.file), { recursive: true })
  fs.writeFileSync(info.file, bytes)
  const hash = require('node:crypto').createHash('sha256').update(bytes).digest('hex')
  return draft.replace(/```completion-metadata\n[\s\S]*?```\n/u, `Completion record: [${ctx.ask}](${info.href}) sha256:${hash}\n`)
}

test('new Replies keep all completion metadata in sidecar storage', () => {
  const ctx = fixture()
  const reply = records.publish_reply(draft, ctx)
  assert.doesNotMatch(reply, /Completion record:|sha256:|completion-metadata|Host review:|<!--/)
  assert.match(reply, /1\. Done\./)
  assert.match(completion_metadata(reply, ctx).text, /Host review: PASS/)
})

test('publisher rejects unexternalized completion fields without changing the notebook', () => {
  const ctx = fixture()
  const notebook = path.join(ctx.project_root, ctx.notebook_path)
  const before = fs.readFileSync(notebook)
  for (const reply of [incident_xml, 'Host review: PASS — inspected the requested change.']) {
    assert.throws(() => records.publish_reply(reply, ctx), /completion fields require a completion-metadata fence.*literal examples/i)
    assert.equal(completion_metadata(reply, ctx).error, '')
    assert.equal(records.publish_reply(reply, { ...ctx, read_only: true }), reply)
  }
  assert.deepEqual(fs.readFileSync(notebook), before)
  assert.equal(fs.existsSync(records.location(ctx).file), false)
})

test('publisher preserves literal XML examples without granting completion authority', () => {
  const ctx = fixture()
  const examples = [
    '```xml\n' + incident_xml + '\n```',
    '```text\n' + incident_xml + '\n```',
    incident_xml.split('\n').map(line => '> ' + line).join('\n'),
    incident_xml.split('\n').map(line => '    ' + line).join('\n'),
    '<completion-metadata><note>literal XML</note></completion-metadata>',
  ]
  for (const reply of examples) {
    assert.equal(records.publish_reply(reply, ctx), reply)
    const parsed = completion_metadata(reply, ctx)
    assert.equal(parsed.error, '')
    assert.deepEqual(parsed.document_effects, [])
    assert.doesNotMatch(parsed.text, /^Host review:/imu)
  }
  assert.equal(fs.existsSync(records.location(ctx).file), false)
})

test('publisher externalizes metadata and preserves bytes on retry', () => {
  const ctx = fixture()
  const reply = records.publish_reply(draft, ctx)
  assert.doesNotMatch(reply, /```completion-metadata/)
  assert.doesNotMatch(reply, /Completion record:|sha256:/)
  const read = completion_metadata(reply, ctx)
  assert.equal(read.error, '')
  assert.match(read.text, /Host review: PASS/)
  const before = fs.readFileSync(read.record_file)
  assert.equal(records.publish_reply(draft, ctx), reply)
  assert.equal(records.publish_reply(reply, ctx), reply)
  assert.equal(records.publish_reply(reply, { ...ctx, read_only: true }), reply)
  assert.deepEqual(fs.readFileSync(read.record_file), before)
  fs.writeFileSync(read.record_file, before.toString().replace('inspected', 'fabricated'))
  assert.match(completion_metadata(reply, ctx).error, /records unavailable.*digest/i)
})

test('large archives allow unchanged and corrected completion retries without changing history', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  const archive = path.join(ctx.project_root, '.agentflow/devlog.archive.md')
  const history = '# → Ask / A-000\n\n# ← Reply / A-000\n\n' + '中'.repeat(800000)
  fs.writeFileSync(archive, history)
  const before = fs.readFileSync(records.location(ctx).file)
  assert.equal(records.publish_reply(draft, { ...ctx, read_only: true }), reply)
  assert.deepEqual(fs.readFileSync(records.location(ctx).file), before)
  const corrected = draft.replace('inspected the requested change', 'inspected the corrected change')
  const updated = records.publish_reply(corrected, ctx)
  assert.match(completion_metadata(updated, ctx).text, /corrected change/)
  assert.equal(fs.readFileSync(archive, 'utf8'), history)
})

test('large archives protect references anywhere and completed Ask evidence', () => {
  for (const position of [0, 65530, 2 * 1024 * 1024]) {
    const ctx = fixture()
    records.publish_reply(draft, ctx)
    const file = records.location(ctx).file, before = fs.readFileSync(file)
    const hash = require('node:crypto').createHash('sha256').update(before).digest('hex')
    const history = 'x'.repeat(position) + 'sha256:' + hash + 'x'.repeat(2 * 1024 * 1024 - position)
    fs.writeFileSync(path.join(ctx.project_root, '.agentflow/devlog.archive.md'), history)
    assert.throws(() => records.publish_reply(draft.replace('inspected', 'changed'), ctx), /referenced completion record is immutable/)
    assert.deepEqual(fs.readFileSync(file), before)
  }
  const ctx = fixture()
  records.publish_reply(draft, ctx)
  fs.writeFileSync(path.join(ctx.project_root, '.agentflow/devlog.archive.md'), 'x'.repeat(2 * 1024 * 1024) + '\r\n# → Ask / A-001 (owner)\r\n\r\n# ← Reply / A-001\r\n\r\nDone.')
  assert.throws(() => records.publish_reply(draft.replace('inspected', 'changed'), ctx), /completed record is immutable/)
})

test('unchanged retries use their verified reference without reopening the archive', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  const read = require('./notebook-write').read_regular_file
  try {
    require('./notebook-write').read_regular_file = (file, label, ...args) => {
      assert.notEqual(label, 'archive')
      return read(file, label, ...args)
    }
    assert.equal(records.publish_reply(draft, ctx), reply)
    assert.equal(records.publish_reply(draft, { ...ctx, read_only: true }), reply)
  } finally { require('./notebook-write').read_regular_file = read }
})

test('streamed archive decisions match physical Ask and Reply boundaries without retaining long lines', () => {
  const cases = [
    '# → Ask / A-001\n# ← Reply / A-001\n',
    '# → Ask / A-001\n# ← Reply / A-001\n\n# → Ask / A-002\nother',
    '# → Ask / A-001\n# ← Reply / A-001\ncontent\n# → Ask / A-002\nother',
    '# → Ask / A-001\n# ← Reply / A-001\n# → Ask / A-002 (unclosed\n',
    '  # → Ask / A-001\n# ← Reply / A-001\ncontent',
    '# → Ask / A-0010\n# ← Reply / A-001\ncontent',
    '# → Ask / A-001\r\n# ← Reply / A-001\r\n\t ',
    '# → Ask / A-001 (' + '名'.repeat(70000) + ')\n# ← Reply / A-001\ncontent',
    '# → Ask / A-001' + ' '.repeat(70000) + '\n# ← Reply / A-001\ncontent',
    '# → Ask / A-001  (invalid name)\n# ← Reply / A-001\ncontent',
    '# → Ask / A-001\n## Reply / A-001 old heading\ncontent',
  ]
  for (const history of cases) {
    const ctx = fixture()
    records.publish_reply(draft, ctx)
    const archive = path.join(ctx.project_root, '.agentflow/devlog.archive.md')
    fs.writeFileSync(archive, 'x'.repeat(65530) + '\n' + history)
    const completed = require('./round-linter').parse_devlog(history).rounds.some(round => round.id === ctx.ask && round.reply_text.trim())
    const publish = () => records.publish_reply(draft.replace('inspected', 'changed'), ctx)
    if (completed) assert.throws(publish, /completed record is immutable/)
    else assert.doesNotThrow(publish)
  }
})

test('archive scans keep reads bounded and reject invalid or changing files before replacing evidence', () => {
  for (const fault of ['none', 'utf8', 'symlink', 'directory', 'append', 'truncate', 'replace', 'read']) {
    const ctx = fixture()
    records.publish_reply(draft, ctx)
    const info = records.location(ctx), before = fs.readFileSync(info.file), ref = fs.readFileSync(info.reference_file)
    const archive = path.join(ctx.project_root, '.agentflow/devlog.archive.md')
    const history = 'x'.repeat(2 * 1024 * 1024)
    if (fault === 'symlink') fs.symlinkSync(info.file, archive)
    else if (fault === 'directory') fs.mkdirSync(archive)
    else fs.writeFileSync(archive, fault === 'utf8' ? Buffer.concat([Buffer.from(history), Buffer.from([0xc3])]) : history)
    const read = fs.readSync, open = fs.openSync, close = fs.closeSync
    let descriptor, mutated = false, closed = false, read_count = 0
    try {
      fs.openSync = (file, ...args) => {
        const result = open(file, ...args)
        if (file === archive) descriptor = result
        return result
      }
      fs.closeSync = fd => { if (fd === descriptor) closed = true; return close(fd) }
      fs.readSync = (fd, buffer, offset, length, position) => {
        if (fd === descriptor) {
          read_count++
          assert.ok(length <= 65536)
          if (!mutated) {
            mutated = true
            if (fault === 'append') fs.appendFileSync(archive, 'changed')
            if (fault === 'truncate') fs.truncateSync(archive, 0)
            if (fault === 'replace') { fs.renameSync(archive, archive + '.saved'); fs.writeFileSync(archive, history) }
            if (fault === 'read') throw Error('injected read failure')
          }
        }
        return read(fd, buffer, offset, length, position)
      }
      const publish = () => records.publish_reply(draft.replace('inspected', 'changed'), ctx)
      if (fault === 'none') { assert.doesNotThrow(publish); assert.ok(read_count > 32) }
      else {
        assert.throws(publish, /UTF-8|symbolic|regular|changed|injected read/)
        assert.deepEqual(fs.readFileSync(info.file), before)
        assert.deepEqual(fs.readFileSync(info.reference_file), ref)
      }
      if (descriptor !== undefined) assert.equal(closed, true)
    } finally { fs.readSync = read; fs.openSync = open; fs.closeSync = close }
  }
})
test('sidecars reject mismatched reports and cannot supply evidence when absent or substituted', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  assert.match(completion_metadata(reply + '\n' + draft, ctx).error, /mixed|ambiguous/i)
  assert.match(completion_metadata(reply + '\n' + reply, ctx).error, /match the Reply/i)
  assert.match(completion_metadata(reply.replace('Done.', 'Changed.'), ctx).error, /match the Reply/i)
  assert.doesNotMatch(completion_metadata(reply, { ...ctx, ask: 'A-002' }).text, /Host review: PASS/)
  assert.equal(completion_metadata(reply).record, undefined)
  const file = completion_metadata(reply, ctx).record_file
  fs.renameSync(file, file + '.saved')
  assert.match(completion_metadata(reply, ctx).error, /records unavailable/i)
  assert.deepEqual(completion_metadata(reply, ctx).document_effects, [])
  fs.symlinkSync(file + '.saved', file)
  assert.match(completion_metadata(reply, ctx).error, /records unavailable/i)
})
test('legacy linked records retain link integrity, path checks and immutable retries', () => {
  const ctx = fixture(), reply = legacy_reply(ctx)
  const before = fs.readFileSync(records.location(ctx).file)
  assert.equal(completion_metadata(reply, ctx).error, '')
  assert.match(completion_metadata(reply + '\n' + draft, ctx).error, /mixed|ambiguous/i)
  assert.match(completion_metadata(reply + '\n' + reply, ctx).error, /one|duplicate/i)
  assert.match(completion_metadata(reply, { ...ctx, ask: 'A-002' }).error, /records unavailable/i)
  assert.match(completion_metadata(reply.replace('.tmp/', '../outside/'), ctx).error, /records unavailable/i)
  assert.match(completion_metadata(reply).error, /records unavailable/i)
  fs.appendFileSync(path.join(ctx.project_root, ctx.notebook_path), '\n# ← Reply / A-001\n\n' + reply)
  assert.equal(records.publish_reply(draft, { ...ctx, read_only: true }), reply)
  assert.deepEqual(fs.readFileSync(records.location(ctx).file), before)
  assert.throws(() => records.publish_reply(draft.replace('inspected', 'changed'), ctx), /immutable/i)
  fs.writeFileSync(records.location(ctx).file, before.toString().replace('inspected', 'fabricated'))
  assert.match(completion_metadata(reply, ctx).error, /digest/i)
  fs.renameSync(records.location(ctx).file, records.location(ctx).file + '.saved')
  assert.match(completion_metadata(reply, ctx).error, /records unavailable/i)
})
test('legacy fences stay readable and quoted linked examples do not grant authority', () => {
  assert.equal(completion_metadata(draft).error, '')
  assert.match(completion_metadata(draft).text, /Host review: PASS/)
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  assert.equal(completion_metadata(reply.split('\n').map(x => '> ' + x).join('\n'), ctx).record, undefined)
})
test('records are bound to notebook and immutable after their Reply is published', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  fs.appendFileSync(path.join(ctx.project_root, ctx.notebook_path), '\n# ← Reply / A-001\n\n' + reply)
  assert.throws(() => records.publish_reply(draft.replace('inspected', 'changed'), ctx), /referenced|immutable/i)
  const other = { ...ctx, notebook_path: '.agentflow/other.md' }
  fs.writeFileSync(path.join(ctx.project_root, other.notebook_path), '# → Ask / A-001\n\n+ other\n')
  ownership_fixture.adopt(ctx.project_root, other.notebook_path)
  const other_reply = records.publish_reply(draft, other)
  assert.notEqual(completion_metadata(other_reply, other).record_file, completion_metadata(reply, ctx).record_file)
})

test('hostile JSON and publication failures never yield a usable link', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  const read = completion_metadata(reply, ctx)
  const original = fs.readFileSync(read.record_file, 'utf8')
  const crypto = require('node:crypto')
  for (const text of [original.replace('"version": 1,', '"version": 1,\n  "version": 1,'), original.replace('"A-001"', '"A-099"'), 'x'.repeat(65537)]) {
    fs.writeFileSync(read.record_file, text)
    const changed_link = reply.replace(/sha256:[a-f0-9]{64}/, 'sha256:' + crypto.createHash('sha256').update(text).digest('hex'))
    assert.match(completion_metadata(changed_link, ctx).error, /records unavailable/i)
  }
  const second = fixture(), writer = require('./notebook-write'), replace = writer.atomic_replace
  try {
    writer.atomic_replace = () => { throw Error('injected publication failure') }
    assert.throws(() => records.publish_reply(draft, second), /injected publication failure/)
    assert.doesNotMatch(fs.readFileSync(path.join(second.project_root, second.notebook_path), 'utf8'), /Completion record:/)
  } finally { writer.atomic_replace = replace }
})

test('configured workspace paths with spaces produce usable sidecars and legacy links', () => {
  const ctx = { ...fixture(), workspace_dir: 'private notes' }
  const reply = records.publish_reply(draft, ctx)
  assert.doesNotMatch(reply, /private%20notes/)
  assert.match(completion_metadata(reply, ctx).record_file, /private notes/)
  assert.equal(completion_metadata(reply, ctx).error, '')
  const old = { ...fixture(), workspace_dir: 'private notes' }
  const linked = legacy_reply(old)
  assert.match(linked, /private%20notes/)
  assert.equal(completion_metadata(linked, old).error, '')
})

test('writer stamps, CRLF, separators and owner question answers preserve report identity', () => {
  const ctx = fixture()
  const with_questions = draft + '\n## Questions (batched — each with a suggested default)\n\n1. Proceed?\n\n   - ans:\n'
  const published = records.publish_reply(with_questions, ctx)
  const rendered = '# ← Reply / A-001\n\n* _2026-09-13 10:00:00 +0800 (codex/unknown)_\n\n' + published.replace('- ans:', '- ans: yes') + '\n---\n'
  assert.equal(completion_metadata(rendered, ctx).error, '')
  assert.equal(completion_metadata(rendered.replaceAll('\n', '\r\n'), ctx).error, '')
  assert.equal(records.publish_reply(with_questions, { ...ctx, read_only: true }), published)
  assert.match(completion_metadata(rendered.replace('Done.', 'Other result.'), ctx).error, /match the Reply/)
})

test('Questions headings inside code examples remain bound to the report', () => {
  const ctx = fixture()
  const example = draft.replace('1. Done.', '1. Done.\n\n```text\n## Questions\nOriginal example\n```')
  const reply = records.publish_reply(example, ctx)
  assert.match(completion_metadata(reply.replace('Original example', 'Changed example'), ctx).error, /match the Reply/)
})

test('missing, corrupt or substituted references cannot provide evidence', () => {
  const ctx = fixture(), reply = records.publish_reply(draft, ctx)
  const file = records.location(ctx).reference_file
  const original = fs.readFileSync(file)
  fs.writeFileSync(file, '{}\n')
  assert.match(completion_metadata(reply, ctx).error, /reference is invalid/)
  fs.writeFileSync(file, original)
  fs.renameSync(file, file + '.saved')
  assert.match(completion_metadata(reply, ctx).error, /records unavailable/i)
  fs.symlinkSync(file + '.saved', file)
  assert.match(completion_metadata(reply, ctx).error, /records unavailable/i)
})

test('interrupted reference publication recovers only while its Ask remains open', () => {
  const ctx = fixture(), writer = require('./notebook-write'), replace = writer.atomic_replace
  const before = fs.readFileSync(path.join(ctx.project_root, ctx.notebook_path))
  try {
    writer.atomic_replace = (file, ...args) => {
      if (file.endsWith('completion.ref.json')) throw Error('injected reference failure')
      return replace(file, ...args)
    }
    assert.throws(() => records.publish_reply(draft, ctx), /injected reference failure/)
  } finally { writer.atomic_replace = replace }
  assert.deepEqual(fs.readFileSync(path.join(ctx.project_root, ctx.notebook_path)), before)
  assert.throws(() => records.publish_reply(draft, { ...ctx, read_only: true }), /retry input/)
  const reply = records.publish_reply(draft, ctx)
  assert.equal(completion_metadata(reply, ctx).error, '')
  const reference = records.location(ctx).reference_file
  fs.appendFileSync(path.join(ctx.project_root, ctx.notebook_path), '\n# ← Reply / A-001\n\n' + reply)
  fs.renameSync(reference, reference + '.saved')
  assert.throws(() => records.publish_reply(draft, ctx), /immutable/)
})

test('an open corrected draft recovers a failure between record and reference replacement', () => {
  const ctx = fixture(), writer = require('./notebook-write'), replace = writer.atomic_replace
  records.publish_reply(draft, ctx)
  const corrected = draft.replace('inspected the requested change', 'inspected the corrected change')
  try {
    writer.atomic_replace = (file, ...args) => {
      if (file.endsWith('completion.ref.json')) throw Error('reference replacement interrupted')
      return replace(file, ...args)
    }
    assert.throws(() => records.publish_reply(corrected, ctx), /reference replacement interrupted/)
  } finally { writer.atomic_replace = replace }
  const reply = records.publish_reply(corrected, ctx)
  assert.match(completion_metadata(reply, ctx).text, /inspected the corrected change/)
})

test('stream records with the same Ask ID do not collide with root records', () => {
  const root = fixture()
  const stream = { ...root, notebook_path: '.agentflow/features/red/red.devlog.md' }
  fs.mkdirSync(path.dirname(path.join(root.project_root, stream.notebook_path)), { recursive: true })
  fs.writeFileSync(path.join(root.project_root, stream.notebook_path), '# → Ask / A-001\n\n+ stream work\n')
  ownership_fixture.adopt(root.project_root, stream.notebook_path)
  const root_read = completion_metadata(records.publish_reply(draft, root), root)
  const stream_read = completion_metadata(records.publish_reply(draft, stream), stream)
  assert.equal(stream_read.error, '')
  assert.match(stream_read.record_file, /\.tmp\/features\/red\/A-001\/completion.json$/)
  assert.notEqual(root_read.record_file, stream_read.record_file)
})
