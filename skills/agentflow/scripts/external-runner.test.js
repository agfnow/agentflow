'use strict'

const node_assert = require('node:assert/strict')
const node_child_process = require('node:child_process')
const node_fs = require('node:fs')
const node_os = require('node:os')
const node_path = require('node:path')
const node_test = require('node:test')

const runner = require('./external-runner.js')

node_test.test('external runner has no elapsed-time deadline by default', () => {
  node_assert.equal(runner.DEFAULT_TIMEOUT_MS, 0)
})

node_test.test('external runner exposes a recoverable nested-worker violation without rejecting clone changes', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-nested-')
  const nested_executable = node_path.join(disposable, 'codex')
  node_fs.symlinkSync(process.execPath, nested_executable)
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'nested', {
      env: { FAKE_NESTED_EXECUTABLE: nested_executable },
      nested_poll_ms: 20,
    }))

    node_assert.equal(result.status, 'nested_worker_violation')
    node_assert.equal(result.nested_worker.detected, true)
    node_assert.ok(result.nested_worker.processes.some(process_info => process_info.executable === nested_executable))
    node_assert.equal(result.nested_worker.containment.attempted, true)
    node_assert.equal(result.clone.changed, false)
    node_assert.equal(result.acceptance.accepted, false)
    node_assert.match(result.acceptance.reason, /nested/i)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

const fixture_path = node_path.join(__dirname, 'fixtures', 'external-worker.js')

node_test.test('default polling bounds process-table work and still contains a nested worker', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-default-poll-')
  const nested_executable = node_path.join(disposable, 'codex')
  node_fs.symlinkSync(process.execPath, nested_executable)
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'nested-hold', {
      env: { FAKE_NESTED_EXECUTABLE: nested_executable },
    }))
    node_assert.equal(result.status, 'nested_worker_violation')
    node_assert.equal(result.nested_worker.containment.attempted, true)
    node_assert.ok(result.nested_worker.poll_count <= 8, `unexpected process-table polling: ${result.nested_worker.poll_count}`)
    for (const nested of result.nested_worker.processes) {
      node_assert.throws(() => process.kill(nested.pid, 0), { code: 'ESRCH' })
    }
    node_assert.equal(result.process.exit_code, 0)
    node_assert.equal(result.acceptance.accepted, false)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

const make_temp_dir = prefix => node_fs.realpathSync(node_fs.mkdtempSync(node_path.join(node_os.tmpdir(), prefix)))
const remove_temp_dir = directory => node_fs.rmSync(directory, { recursive: true, force: true })
const git = (directory, args) => node_child_process.execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8' }).trim()

const make_source_repo = () => {
  const root = make_temp_dir('agentflow-external-runner-source-')
  git(root, ['init', '-q'])
  git(root, ['config', 'user.email', 'runner@example.test'])
  git(root, ['config', 'user.name', 'External Runner Test'])
  node_fs.writeFileSync(node_path.join(root, 'tracked.txt'), 'source content\n')
  git(root, ['add', 'tracked.txt'])
  git(root, ['commit', '-qm', 'initial'])
  return root
}

const make_run_options = (source_directory, disposable_directory, mode, overrides = {}) => ({
  source_directory,
  clone_directory: node_path.join(disposable_directory, 'clone'),
  command: [process.execPath, fixture_path, mode],
  timeout_ms: 2_000,
  termination_grace_ms: 100,
  max_output_bytes: 4_096,
  ...overrides,
})

node_test.test('external runner returns text', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-text-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'text'))

    node_assert.equal(result.result.value, 'FAKE_TEXT_RESULT\n')
    node_assert.equal(result.process.exit_code, 0)
    node_assert.equal(result.acceptance.accepted, false)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner keeps command arguments literal', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-args-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'args', {
      args: ['literal value', '$(not-a-command)', 'a;b'],
      result_format: 'json',
    }))

    node_assert.equal(result.process.exit_code, 0)
    node_assert.equal(result.process.signal, null)
    node_assert.deepEqual(result.result.value, ['literal value', '$(not-a-command)', 'a;b'])
    node_assert.match(result.acceptance.reason, /coordinator acceptance/i)
    node_assert.equal(result.stdin_closed, true)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner gives the fake worker an already-closed standard input', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-stdin-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'stdin'))

    node_assert.equal(result.result.value, '')
    node_assert.equal(result.stdin_closed, true)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner removes only opposite-host markers for provider workers', async () => {
  const marker_names = ['CODEX_SESSION_ID', 'CODEX_THREAD_ID', 'CODEX_CI', 'CODEX_SANDBOX', 'CODEX_CLI', 'CLAUDE_PROJECT_DIR', 'CLAUDE_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CLI', 'NEUTRAL_VALUE']
  const supplied_env = Object.fromEntries(marker_names.map(name => [name, `${name}-value`]))

  for (const provider of ['claude', 'codex']) {
    const source = make_source_repo()
    const disposable = make_temp_dir(`agentflow-external-runner-${provider}-environment-`)
    const executable = node_path.join(disposable, provider)
    node_fs.symlinkSync(process.execPath, executable)
    try {
      const result = await runner.run_external_command(make_run_options(source, disposable, 'environment', {
        command: [executable, fixture_path, 'environment', ...marker_names],
        env: supplied_env,
        result_format: 'json',
      }))
      const removed_prefix = provider === 'claude' ? 'CODEX_' : 'CLAUDE_'
      const kept_prefix = provider === 'claude' ? 'CLAUDE_' : 'CODEX_'
      for (const name of marker_names.filter(name => name.startsWith(removed_prefix))) node_assert.equal(result.result.value[name], null, `${provider} inherited ${name}`)
      for (const name of marker_names.filter(name => name.startsWith(kept_prefix))) node_assert.equal(result.result.value[name], supplied_env[name], `${provider} lost ${name}`)
      node_assert.equal(result.result.value.NEUTRAL_VALUE, supplied_env.NEUTRAL_VALUE)
    } finally {
      remove_temp_dir(source)
      remove_temp_dir(disposable)
    }
  }
})

node_test.test('external runner parses declared JSON output without accepting process success', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-json-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'json', {
      result_format: 'json',
    }))

    node_assert.deepEqual(result.result.value, { kind: 'json', ok: true })
    node_assert.equal(result.result.parse_error, null)
    node_assert.equal(result.acceptance.accepted, false)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner reads a bounded declared result file inside the clone', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-file-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'result-file', {
      result_file: 'declared-result.json',
      result_format: 'json',
    }))

    node_assert.equal(result.declared_result_file.exists, true)
    node_assert.equal(result.declared_result_file.path, node_path.join(result.clone.root, 'declared-result.json'))
    node_assert.deepEqual(result.declared_result_file.value, { from: 'file', ok: true })
    node_assert.equal(result.declared_result_file.truncated, false)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner rejects a same-path separated Codex output option before child start', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-codex-collision-')
  const codex_path = node_path.join(disposable, 'codex')
  node_fs.symlinkSync(process.execPath, codex_path)
  try {
    for (const option of ['-o', '--output-last-message']) {
      await node_assert.rejects(
        runner.run_external_command(make_run_options(source, disposable, 'result-file', {
          command: [codex_path, fixture_path, 'result-file', option, 'declared-result.json'],
          result_file: 'declared-result.json',
          result_format: 'json',
        })),
        /declared result path|output option/i,
      )
      const clone_directory = node_path.join(disposable, 'clone')
      node_assert.equal(node_fs.existsSync(node_path.join(clone_directory, 'declared-result.json')), false)
      node_fs.rmSync(clone_directory, { recursive: true, force: true })
    }
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner leaves non-Codex, different-path, equals-form, and shell-looking arguments literal', async () => {
  const cases = [
    { name: 'non-codex', executable: process.execPath, args: ['-o', 'declared-result.json'] },
    { name: 'different-path', executable: 'codex', args: ['-o', 'other-result.json'] },
    { name: 'equals-form', executable: 'codex', args: ['-o=declared-result.json'] },
    { name: 'shell-looking', executable: 'codex', args: ['-o', '$(touch should-not-exist)'] },
  ]

  for (const test_case of cases) {
    const source = make_source_repo()
    const disposable = make_temp_dir(`agentflow-external-runner-codex-allow-${test_case.name}-`)
    const executable = test_case.executable === 'codex'
      ? node_path.join(disposable, 'codex')
      : test_case.executable
    if (test_case.executable === 'codex') node_fs.symlinkSync(process.execPath, executable)
    const original_args = [fixture_path, 'result-file', ...test_case.args]
    try {
      const result = await runner.run_external_command(make_run_options(source, disposable, 'result-file', {
        command: [executable, ...original_args],
        result_file: 'declared-result.json',
        result_format: 'json',
      }))
      node_assert.equal(result.process.exit_code, 0, test_case.name)
      node_assert.deepEqual(result.command.args, original_args, test_case.name)
      node_assert.deepEqual(result.declared_result_file.value, { from: 'file', ok: true }, test_case.name)
    } finally {
      remove_temp_dir(source)
      remove_temp_dir(disposable)
    }
  }
})

node_test.test('external runner rejects a declared result-file symlink that points outside the clone', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-symlink-')
  try {
    const outside = node_path.join(disposable, 'outside.json')
    node_fs.writeFileSync(outside, JSON.stringify({ secret: true }) + '\n')
    const result = await runner.run_external_command(make_run_options(source, disposable, 'result-file-symlink', {
      args: [outside],
      result_file: 'declared-result.json',
      result_format: 'json',
    }))

    node_assert.equal(result.declared_result_file.exists, false)
    node_assert.equal(result.declared_result_file.value, null)
    node_assert.match(result.declared_result_file.error, /regular file|safely/i)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner rejects an intermediate result-directory symlink that points outside the clone', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-parent-symlink-')
  try {
    const outside = node_path.join(disposable, 'outside')
    node_fs.mkdirSync(outside)
    node_fs.writeFileSync(node_path.join(outside, 'result.json'), JSON.stringify({ secret: true }) + '\n')
    const result = await runner.run_external_command(make_run_options(source, disposable, 'result-file-parent-symlink', {
      args: [outside],
      result_file: 'result-dir/result.json',
      result_format: 'json',
    }))

    node_assert.equal(result.declared_result_file.exists, false)
    node_assert.equal(result.declared_result_file.value, null)
    node_assert.match(result.declared_result_file.error, /safely/i)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner reports a clone diff identity when the fake worker changes the clone', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-change-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'change'))

    node_assert.equal(result.clone.changed, true)
    node_assert.notEqual(result.clone.diff_identity.before, result.clone.diff_identity.after)
    node_assert.equal(node_fs.existsSync(node_path.join(result.clone.root, 'worker-change.txt')), true)
    node_assert.equal(node_fs.readFileSync(node_path.join(source, 'tracked.txt'), 'utf8'), 'source content\n')
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner bounds stdout and stderr while retaining their identities', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-output-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'large', {
      max_output_bytes: 128,
    }))

    node_assert.ok(Buffer.byteLength(result.stdout) <= 128)
    node_assert.ok(Buffer.byteLength(result.stderr) <= 128)
    node_assert.equal(result.stdout_truncated, true)
    node_assert.equal(result.stderr_truncated, true)
    node_assert.equal(result.stdout_identity.byte_length, 12_000)
    node_assert.equal(result.stderr_identity.byte_length, 12_000)
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner creates an independent clone with no remotes', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-clone-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'text'))

    node_assert.equal(result.clone.independent, true)
    node_assert.deepEqual(result.clone.remotes, [])
    node_assert.notEqual(node_path.resolve(result.clone.root), node_path.resolve(source))
    node_assert.equal(git(result.clone.root, ['remote']), '')
    node_assert.notEqual(git(result.clone.root, ['rev-parse', '--absolute-git-dir']), git(source, ['rev-parse', '--absolute-git-dir']))
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner can operate on an existing independent clone', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-existing-')
  const clone_directory = node_path.join(disposable, 'clone')
  try {
    await runner.run_external_command(make_run_options(source, disposable, 'text'))
    const result = await runner.run_external_command({
      clone_directory,
      command: [process.execPath, fixture_path, 'text'],
      timeout_ms: 2_000,
      max_output_bytes: 4_096,
    })

    node_assert.equal(result.clone.created, false)
    node_assert.equal(result.clone.independent, true)
    node_assert.deepEqual(result.clone.remotes, [])
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner times out and terminates the local process group', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-timeout-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'timeout', {
      timeout_ms: 100,
      termination_grace_ms: 50,
    }))

    node_assert.equal(result.timed_out, true)
    node_assert.equal(result.status, 'timed_out')
    node_assert.equal(result.acceptance.accepted, false)
    node_assert.equal(result.process_group_timeout.attempted, true)
    node_assert.equal(result.process_group_timeout.trigger, 'deadline')
    node_assert.equal(result.shutdown.trigger, 'deadline')
    node_assert.equal(result.assurance.os_level_confinement, 'not_proven')
    node_assert.equal(result.assurance.remote_provider_cancellation, 'not_proven')
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner disables stall detection by default and records bounded activity', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-activity-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'slow-output'))

    node_assert.equal(result.status, 'completed')
    node_assert.equal(result.stalled, false)
    node_assert.equal(result.activity.state, 'disabled')
    node_assert.equal(result.activity.stall_timeout_ms, 0)
    node_assert.ok(result.activity.sample_count >= 1)
    node_assert.equal(result.activity.stdout, Buffer.byteLength('FIRST\nSECOND\n'))
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('external runner keeps a quiet worker alive until its explicit deadline', async () => {
  const source = make_source_repo()
  const disposable = make_temp_dir('agentflow-external-runner-stall-')
  try {
    const result = await runner.run_external_command(make_run_options(source, disposable, 'timeout', {
      timeout_ms: 400,
      termination_grace_ms: 50,
    }))

    node_assert.equal(result.status, 'timed_out')
    node_assert.equal(result.timed_out, true)
    node_assert.equal(result.stalled, false)
    node_assert.equal(result.activity.state, 'disabled')
    node_assert.ok(result.activity.sample_count >= 2)
    node_assert.equal(result.shutdown.trigger, 'deadline')
    node_assert.equal(result.shutdown.attempted, true)
    node_assert.equal(result.assurance.remote_provider_cancellation, 'not_proven')
  } finally {
    remove_temp_dir(source)
    remove_temp_dir(disposable)
  }
})

node_test.test('retired quiet-time option is rejected before cloning, not silently reinterpreted', async () => {
  await node_assert.rejects(runner.run_external_command({ source_directory: process.cwd(), command: [process.execPath, '--version'], stall_timeout_ms: 100 }), /quiet-time termination is no longer supported/)
})

node_test.test('snapshot detects further content changes in an already dirty tracked file', () => {
  const source = make_source_repo()
  try {
    const file = node_path.join(source, 'tracked.txt')
    node_fs.writeFileSync(file, 'baseline\n')
    git(source, ['add', 'tracked.txt'])
    git(source, ['commit', '-qm', 'snapshot baseline'])
    node_fs.writeFileSync(file, 'change one\n')
    const before = runner.clone_snapshot(source)
    node_fs.writeFileSync(file, 'change two\n')
    node_assert.notEqual(runner.clone_snapshot(source).identity, before.identity)
  } finally { remove_temp_dir(source) }
})

node_test.test('external runner rejects invalid stall timeout values before cloning', async () => {
  const invalid = [-1, 1.5, NaN, Infinity, '10', null, {}]
  for (const stall_timeout_ms of invalid) {
    await node_assert.rejects(
      runner.run_external_command({ source_directory: process.cwd(), command: [process.execPath, '--version'], stall_timeout_ms }),
      /stall_timeout_ms must be a non-negative safe integer/,
    )
  }
})
