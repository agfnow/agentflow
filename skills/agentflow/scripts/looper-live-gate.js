#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const run = (command, args, options = {}) => spawnSync(command, args, {
  encoding: 'utf8',
  ...options,
})

const fail = message => {
  const error = new Error(message)
  error.name = 'LiveGateError'
  return error
}

const require_success = (result, label) => {
  if (result.error) throw fail(`${label} could not start: ${result.error.message}`)
  if (result.status !== 0) throw fail(`${label} exited ${result.status}: ${(result.stderr || result.stdout || '').trim()}`)
  return result
}

const git = (repo, args) => require_success(run('git', args, { cwd: repo }), `git ${args.join(' ')}`)

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

const config = () => ({
  'schema-version': 7,
  switches: {
    'target-doc': '.agentflow/devlog.md',
    'workspace-dir': '.agentflow',
    'cli-provider': 'on',
    'auto-reply': 'on',
    lang: 'English',
    streams: 'always',
    'ask-names': 'off',
    'allow-ag': 'off',
    'large-work-minutes': 120,
  },
  'pipeline-roles': {
    requirements: 'off', codewalk: 'off', explore: 'off', spike: 'off', spec: 'off',
    implementation: 'basic', 'security-scan': 'off', acceptance: 'off',
    'cross-check': 'off', learn: 'off',
  },
  'external-workers': [{
    id: 'codex-live-gate',
    command: ['codex', 'exec', '--dangerously-bypass-approvals-and-sandbox', '--ephemeral'],
    priority: 1,
    family: 'codex',
    tiers: {
      best: process.env.AGENTFLOW_LOOPER_GATE_MODEL || 'gpt-5.4/medium',
      better: process.env.AGENTFLOW_LOOPER_GATE_MODEL || 'gpt-5.4/medium',
      basic: process.env.AGENTFLOW_LOOPER_GATE_MODEL || 'gpt-5.4/medium',
      cheap: process.env.AGENTFLOW_LOOPER_GATE_MODEL || 'gpt-5.4/medium',
    },
  }],
})

const initial_notebook = `# STATUS

Project: Disposable looper live gate.

Notebook: .agentflow/devlog.md — root.

Current commit: initial fixture.

Tests/scenarios: none yet.

Configuration: ag.json — schema v7.

Proven: none yet.

Open: execute both plans.

Next: run agf-looper.

Artifacts: .agentflow/planned/.

Archived eras: none.

Streams: none.

---

# → Ask / A-001

+
`

const plan = (number, file, value) => `# Live gate plan ${number}

This disposable fixture is already running under the parent looper, which owns validation and review. Edit its product and notebook directly with ordinary file and Git commands. Do not load skills, run agf.js or looper.js, invoke any model CLI, or launch a reviewer; these are prohibited nested workers in this fixture.

Create \`${file}\` in the repository root with exactly \`${value}\` and one trailing newline.

Use the active Agentflow notebook \`.agentflow/devlog.md\`. Record and finish this work as its own round. The completed round must contain the exact \`# ← Reply / A-NNN\` heading for its Ask and must end with the next sequential scaffold in exactly this form, including the bare plus line: \`# → Ask / A-NNN\n\n+\`. Before returning, read the notebook and verify the Reply heading and the full next-Ask scaffold. Commit the product and notebook changes. Do not move or edit any file under \`.agentflow/planned/\`; the parent looper owns the queue.
`

const inspect_notebook_rounds = text => {
  const reply_ids = [...text.matchAll(/^# ← Reply \/ A-([0-9]+)$/gmu)].map(match => Number(match[1]))
  const next_ask_id = Number((text.match(/(?:^|\n)# → Ask \/ A-([0-9]+)\n\n\+\n?$/u) || [])[1] || 0)
  return { reply_ids, next_ask_id, complete: reply_ids.includes(1) && reply_ids.includes(2) && next_ask_id === 3 }
}

const verify_gate = ({ repo, process_status }) => {
  const read_or_null = file => {
    try { return fs.readFileSync(file, 'utf8') } catch { return null }
  }
  const notebook = read_or_null(path.join(repo, '.agentflow', 'devlog.md')) || ''
  const rounds = inspect_notebook_rounds(notebook)
  const checks = {
    process_exit: process_status === 0,
    product_one: read_or_null(path.join(repo, 'product-one.txt')) === '1111\n',
    product_two: read_or_null(path.join(repo, 'product-two.txt')) === '2222\n',
    notebook_round_one: rounds.reply_ids.includes(1),
    notebook_round_two: rounds.complete,
    archived_plan_one: fs.existsSync(path.join(repo, '.agentflow', 'planned', 'done', 'plan-001.md')),
    archived_plan_two: fs.existsSync(path.join(repo, '.agentflow', 'planned', 'done', 'plan-002.md')),
  }
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  return { passed: failures.length === 0, checks, failures }
}

const install_shortcut = ({ home, skill_dir }) => {
  const installed = path.join(home, '.codex', 'skills', 'agentflow')
  fs.mkdirSync(path.dirname(installed), { recursive: true })
  fs.symlinkSync(skill_dir, installed, 'dir')
  const setup = path.join(skill_dir, 'scripts', 'setup.js')
  require_success(run(process.execPath, [setup, '--fix'], {
    env: { ...process.env, HOME: home, SHELL: '/bin/zsh', AGF_OPEN: 'true' },
    input: 'y\n',
  }), 'real shell shortcut installation')
  const shell_file = path.join(home, '.zshrc')
  const installed_text = fs.readFileSync(shell_file, 'utf8')
  if (!/agf-looper\s*\(\s*\)/u.test(installed_text)) throw fail('setup succeeded without installing agf-looper()')
  return shell_file
}

const execute_gate = (options = {}) => {
  const skill_dir = path.resolve(options.skill_dir || path.join(__dirname, '..'))
  const codex_home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
  const scratch = path.join(os.homedir(), 'tmp')
  fs.mkdirSync(scratch, { recursive: true })
  if (fs.lstatSync(scratch).isSymbolicLink()) throw fail('home scratch directory must not be a symlink')
  const temporary_root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-looper-live-gate-'))
  const state_root = fs.mkdtempSync(path.join(scratch, '.agentflow-looper-live-gate-state-'))
  const home = path.join(temporary_root, 'home')
  const repo = path.join(temporary_root, 'repo')
  fs.mkdirSync(home, { recursive: true })
  fs.mkdirSync(repo, { recursive: true })
  try {
    git(repo, ['init', '-q'])
    git(repo, ['config', 'user.name', 'Agentflow live gate'])
    git(repo, ['config', 'user.email', 'agentflow-live-gate@example.invalid'])
    write(path.join(repo, 'ag.json'), `${JSON.stringify(config(), null, 2)}\n`)
    write(path.join(repo, '.agentflow', 'devlog.md'), initial_notebook)
    write(path.join(repo, '.agentflow', 'planned', 'plan-001.md'), plan(1, 'product-one.txt', '1111'))
    write(path.join(repo, '.agentflow', 'planned', 'plan-002.md'), plan(2, 'product-two.txt', '2222'))
    write(path.join(repo, '.gitignore'), '.agentflow-looper-state/\n.codex/\n.claude/\n')
    git(repo, ['add', 'ag.json', '.agentflow', '.gitignore'])
    git(repo, ['commit', '-qm', 'Initialize looper live gate'])
    const shell_file = install_shortcut({ home, skill_dir })
    const result = run('/bin/zsh', ['-c', `source "$1" && agf-looper`, 'looper-live-gate', shell_file], {
      cwd: repo,
      env: { ...process.env, HOME: home, CODEX_HOME: codex_home, SHELL: '/bin/zsh', XDG_STATE_HOME: state_root },
      timeout: options.timeout_ms || 20 * 60 * 1000,
      maxBuffer: 1024 * 1024,
    })
    const verdict = verify_gate({ repo, process_status: result.status })
    const report = {
      schema_version: 1,
      gate: 'agentflow-looper-real-two-plan-v1',
      passed: verdict.passed,
      checks: verdict.checks,
      process_status: result.status,
      repository: options.keep ? repo : 'removed after verification',
    }
    if (options.report) write(path.resolve(options.report), `${JSON.stringify(report, null, 2)}\n`)
    if (!verdict.passed) throw fail(`live gate failed: ${verdict.failures.join(', ')}\n${(result.stderr || result.stdout || '').trim()}`)
    return report
  } finally {
    if (!options.keep) fs.rmSync(temporary_root, { recursive: true, force: true })
    if (!options.keep) fs.rmSync(state_root, { recursive: true, force: true })
  }
}

const parse_cli = argv => {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--keep') options.keep = true
    else if (argv[index] === '--report' && argv[index + 1]) options.report = argv[++index]
    else throw fail(`unknown or incomplete option: ${argv[index]}`)
  }
  return options
}

if (require.main === module) {
  try {
    const report = execute_gate(parse_cli(process.argv.slice(2)))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`HALT: ${error.message}\n`)
    process.exitCode = 1
  }
}

module.exports = { inspect_notebook_rounds, verify_gate }
