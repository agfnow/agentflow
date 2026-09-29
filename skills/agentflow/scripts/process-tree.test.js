'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { find_nested_processes } = require('./process-tree')

const process_table = (commands) => commands.map(([pid, ppid, command]) => ({ pid, ppid, command }))

test('ignores ordinary descendants whose paths contain helper names', () => {
  const result = find_nested_processes(100, process_table([
    [101, 100, 'node /opt/codex/runtime-helper.js --telemetry'],
    [102, 100, '/opt/codex/bin/codex-code-mode-host'],
    [103, 100, 'node /work/skills/agentflow/scripts/utility.js'],
  ]))

  assert.deepEqual(result.processes, [])
})

test('detects explicit model and Agentflow entry points', () => {
  const result = find_nested_processes(200, process_table([
    [201, 200, 'codex exec --full-auto'],
    [202, 200, 'claude -p review'],
    [203, 200, 'node /work/skills/agentflow/scripts/agf.js start'],
    [204, 200, 'node /work/skills/agentflow/scripts/looper.js'],
  ]))

  assert.deepEqual(result.processes.map(process_info => process_info.command), [
    'codex exec --full-auto',
    'claude -p review',
    'node /work/skills/agentflow/scripts/agf.js start',
    'node /work/skills/agentflow/scripts/looper.js',
  ])
})

test('ignores a fake entry point only below an inspected Node test-runner ancestor', () => {
  // The injected table models Unix ps output; no native process inspection is used.
  const table = process_table([
    [100, 1, '/bin/sh -c node --test /work/scripts.test.js'],
    [200, 100, 'node --test /work/scripts.test.js'],
    [201, 200, 'node /work/external-worker.js'],
    [202, 201, '/tmp/fake/codex nested-child'],
    [300, 100, 'node /work/external-worker.js'],
    [301, 300, 'codex exec --full-auto'],
    [302, 300, 'node /work/skills/agentflow/scripts/agf.js start'],
  ])

  assert.deepEqual(find_nested_processes(200, table).processes, [])
  assert.deepEqual(find_nested_processes(300, table).processes.map(process_info => process_info.command), [
    'codex exec --full-auto',
    'node /work/skills/agentflow/scripts/agf.js start',
  ])
})
