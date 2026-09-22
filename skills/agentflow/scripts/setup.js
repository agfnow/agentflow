#!/usr/bin/env node
'use strict'

// setup.js — check and optionally fix the user's shell config for agentflow.
// Standalone: runs from any terminal, before or after the first godev.
//   node <skill-dir>/scripts/setup.js          check only
//   node <skill-dir>/scripts/setup.js --fix    check + offer to fix
//   node <skill-dir>/scripts/setup.js --quiet  machine-readable (exit 0 = ok)
//
// Checks: node ≥18, git, skill files, agf() and agf-looper() shell functions, AGF_OPEN.
// --fix installs or safely replaces Agentflow-managed lines after backup + confirmation.
// Supports zsh, bash, fish, and PowerShell. Writes a marker so the first-run nudge fires once.

const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFileSync } = require('node:child_process')

const SKILL_DIR = path.resolve(__dirname, '..')
const MARKER = path.join(SKILL_DIR, '.setup-checked')

// ---------- shell ----------

const detect_shell = (env_shell) => {
  const s = String(env_shell || '').toLowerCase()
  if (s.includes('pwsh') || s.includes('powershell')) return 'powershell'
  if (s.includes('fish')) return 'fish'
  if (s.includes('bash')) return 'bash'
  return 'zsh'
}

const config_file_for = (shell, home) => {
  const h = home || os.homedir()
  if (shell === 'powershell') return path.join(h, 'Documents', 'WindowsPowerShell', 'Microsoft.PowerShell_profile.ps1')
  if (shell === 'fish') return path.join(h, '.config', 'fish', 'config.fish')
  if (shell === 'bash') return path.join(h, '.bashrc')
  return path.join(h, '.zshrc')
}

// ---------- templates ----------

const shell_quote = value => `'${String(value).replaceAll("'", "'\\''")}'`

const installation_roots = Object.freeze(['agents', 'codex', 'claude'])

const agf_script_for = skill_dir => path.join(path.resolve(skill_dir), 'scripts', 'agf.js')

const looper_script_for = skill_dir => path.join(path.resolve(skill_dir), 'scripts', 'looper.js')

const shell_script_argument = script_path => script_path.startsWith('$HOME/') ? `"${script_path}"` : shell_quote(script_path)

const AGF_FN_ZSH = script_path => `agf() {
  local dir
  dir=$(node ${shell_script_argument(script_path)} "$@") || return 1
  [ -n "$dir" ] && cd "$dir"
  return 0
}`

const AGF_FN_FISH = script_path => `function agf
  set -l dir (node ${shell_script_argument(script_path)} $argv)
  or return 1
  test -n "$dir"; and cd "$dir"
  return 0
end`

const LOOPER_FN_ZSH = script_path => `agf-looper() {
  node ${shell_script_argument(script_path)} "$@"
}`

const LOOPER_FN_FISH = script_path => `function agf-looper
  node ${shell_script_argument(script_path)} $argv
end`

const powershell_argument = value => value.startsWith('$HOME/')
  ? `"${value}"` : `'${String(value).replaceAll("'", "''")}'`

const agf_function_for = (shell, script_path) => {
  if (shell === 'powershell') return `function agf {
  $dir = & node ${powershell_argument(script_path)} @args
  if ($LASTEXITCODE -ne 0) { return }
  if ($dir) { Set-Location -LiteralPath $dir }
}`
  return shell === 'fish' ? AGF_FN_FISH(script_path) : AGF_FN_ZSH(script_path)
}

const looper_function_for = (shell, script_path) => {
  if (shell === 'powershell') return `function agf-looper {
  & node ${powershell_argument(script_path)} @args
}`
  return shell === 'fish' ? LOOPER_FN_FISH(script_path) : LOOPER_FN_ZSH(script_path)
}

const realpath_or_null = value => {
  try { return fs.realpathSync(value) } catch { return null }
}

const formal_installations_for = (skill_dir, home) => {
  if (realpath_or_null(skill_dir) === null) return []
  const installations = []
  for (const host of installation_roots) {
    const installed = path.join(home, `.${host}`, 'skills', 'agentflow')
    if (!fs.existsSync(path.join(installed, 'SKILL.md')) || !fs.existsSync(path.join(installed, 'scripts', 'agf.js')) || !fs.existsSync(path.join(installed, 'scripts', 'looper.js'))) continue
    const root = `$HOME/.${host}/skills/agentflow/scripts`
    installations.push({ host, agf: `${root}/agf.js`, looper: `${root}/looper.js` })
  }
  return installations
}

const formal_installation_for = (skill_dir, home) => formal_installations_for(skill_dir, home)[0] || null

const shortcut_paths_for = (skill_dir, home) => {
  const formal = formal_installation_for(skill_dir, home)
  if (formal !== null) return formal
  const active = path.resolve(skill_dir)
  if (!fs.existsSync(path.join(active, 'SKILL.md'))
    || !fs.existsSync(path.join(active, 'scripts', 'agf.js'))
    || !fs.existsSync(path.join(active, 'scripts', 'looper.js'))) return null
  return { host: 'active', agf: agf_script_for(active), looper: looper_script_for(active) }
}

const AGF_OPEN_ZSH = 'export AGF_OPEN="code"'
const AGF_OPEN_FISH = 'set -gx AGF_OPEN "code"'
const open_line_for = shell => shell === 'powershell' ? '$env:AGF_OPEN = "code"' : shell === 'fish' ? AGF_OPEN_FISH : AGF_OPEN_ZSH

// ---------- checks ----------

const check_node = () => {
  const v = parseInt(process.version.replace(/^v/, ''), 10)
  return { ok: v >= 18, label: `node ${process.version}` }
}

const check_git = () => {
  try {
    const out = execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    return { ok: true, label: out.replace('git version ', 'git ') }
  } catch { return { ok: false, label: 'git not found' } }
}

const check_skill_files = (dir) => {
  const d = dir || SKILL_DIR
  const ok = fs.existsSync(path.join(d, 'SKILL.md'))
  return { ok, label: ok ? `skill files at ${d}` : `skill files not found at ${d}` }
}

const check_agf_script = (dir) => {
  const script_path = agf_script_for(dir || SKILL_DIR)
  let ok = false
  try { ok = fs.lstatSync(script_path).isFile() } catch {}
  return { ok, label: ok ? `agf.js at ${script_path}` : `agf.js not found at ${script_path}` }
}

const check_looper_script = (dir) => {
  const script_path = looper_script_for(dir || SKILL_DIR)
  let ok = false
  try { ok = fs.lstatSync(script_path).isFile() } catch {}
  return { ok, label: ok ? `looper.js at ${script_path}` : `looper.js not found at ${script_path}` }
}

const normalize_function_whitespace = value => String(value)
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map(line => line.trim())
  .join('\n')

const check_agf_function = (shell, cfg_path, script_paths = agf_script_for(SKILL_DIR)) => {
  if (!fs.existsSync(cfg_path)) return { ok: false, label: `usable Agentflow-managed agf() not found — ${cfg_path} does not exist` }
  const content = fs.readFileSync(cfg_path, 'utf8')
  const normalized = normalize_function_whitespace(content)
  const accepted_paths = Array.isArray(script_paths) ? script_paths : [script_paths]
  const has_exact_block = accepted_paths.some(script_path => {
    const expected = normalize_function_whitespace(agf_function_for(shell, script_path))
    return normalized === expected
      || normalized.startsWith(`${expected}\n`)
      || normalized.endsWith(`\n${expected}`)
      || normalized.includes(`\n${expected}\n`)
  })
  const declaration_pattern = shell === 'fish'
    ? /(?:^|\n)\s*function\s+agf(?:\s|$)/g
    : /(?:^|\n)\s*(?:function\s+)?agf\s*(?:\(\s*\))?\s*\{/g
  const declaration_count = (normalized.match(declaration_pattern) || []).length
  const ok = has_exact_block && declaration_count === 1
  return { ok, label: ok ? `agf() found in ${cfg_path}` : `usable Agentflow-managed agf() not found in ${cfg_path}` }
}

const check_looper_function = (shell, cfg_path, script_paths = looper_script_for(SKILL_DIR)) => {
  if (!fs.existsSync(cfg_path)) return { ok: false, label: `usable Agentflow-managed agf-looper() not found — ${cfg_path} does not exist` }
  const content = normalize_function_whitespace(fs.readFileSync(cfg_path, 'utf8'))
  const accepted_paths = Array.isArray(script_paths) ? script_paths : [script_paths]
  const has_exact_block = accepted_paths.some(script_path => {
    const expected = normalize_function_whitespace(looper_function_for(shell, script_path))
    return content === expected
      || content.startsWith(`${expected}\n`)
      || content.endsWith(`\n${expected}`)
      || content.includes(`\n${expected}\n`)
  })
  const declaration_pattern = shell === 'fish'
    ? /(?:^|\n)\s*function\s+agf-looper(?:\s|$)/g
    : /(?:^|\n)\s*(?:function\s+)?agf-looper\s*(?:\(\s*\))?\s*\{/g
  const declaration_count = (content.match(declaration_pattern) || []).length
  const ok = has_exact_block && declaration_count === 1
  return { ok, label: ok ? `agf-looper() found in ${cfg_path}` : `usable Agentflow-managed agf-looper() not found in ${cfg_path}` }
}

const check_agf_open = (env, shell, cfg_path) => {
  const val = (env || process.env).AGF_OPEN
  if (val) return { ok: true, label: `AGF_OPEN="${val}"` }
  const configured_line = open_line_for(shell)
  const configured = cfg_path && fs.existsSync(cfg_path) && fs.readFileSync(cfg_path, 'utf8').includes(configured_line)
  return {
    ok: Boolean(configured),
    label: configured ? `AGF_OPEN configured in ${cfg_path}` : 'AGF_OPEN not set',
  }
}

// ---------- fix ----------

const lines_to_append = (shell, needs_fn, needs_open, skill_dir = SKILL_DIR, needs_looper = needs_fn, shortcut_paths = null) => {
  const parts = []
  if (needs_open) parts.push(open_line_for(shell))
  if (needs_fn) {
    parts.push(agf_function_for(shell, shortcut_paths === null ? agf_script_for(skill_dir) : shortcut_paths.agf))
  }
  if (needs_looper) parts.push(looper_function_for(shell, shortcut_paths === null ? looper_script_for(skill_dir) : shortcut_paths.looper))
  return parts.join('\n')
}

const function_blocks = (shell, content, name) => {
  const escaped = name.replace('-', '\\-')
  const declaration = shell === 'fish'
    ? new RegExp(`(?:^|\\n)\\s*function\\s+${escaped}(?:\\s|$)`, 'g')
    : new RegExp(`(?:^|\\n)\\s*(?:function\\s+)?${escaped}\\s*(?:\\(\\s*\\))?\\s*\\{`, 'g')
  const ending = shell === 'fish' ? /^end\s*$/mu : /^\}\s*$/mu
  const blocks = []
  for (const match of content.matchAll(declaration)) {
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0)
    const tail = content.slice(start)
    const close = ending.exec(tail)
    if (close === null) continue
    const finish = start + close.index + close[0].length
    const text = content.slice(start, finish)
    blocks.push({ start, finish, text, managed: /[\\/]skills[\\/]agentflow[\\/]scripts[\\/](?:agf|looper)\.js/u.test(text) })
  }
  return blocks
}

const remove_managed_blocks = (shell, content, name) => {
  const blocks = function_blocks(shell, content, name)
  if (blocks.some(block => !block.managed)) throw new Error(`${name}() exists but is not an Agentflow-managed shortcut; setup will not replace it`)
  return blocks.reduceRight((next, block) => next.slice(0, block.start) + next.slice(block.finish), content).replace(/\n{3,}/g, '\n\n').trimEnd()
}

const fixed_content = ({ shell, content, needs_fn, needs_looper, needs_open, shortcut_paths }) => {
  let next = content
  const additions = []
  if (needs_fn) {
    next = remove_managed_blocks(shell, next, 'agf')
    additions.push(agf_function_for(shell, shortcut_paths.agf))
  }
  if (needs_looper) {
    next = remove_managed_blocks(shell, next, 'agf-looper')
    additions.push(looper_function_for(shell, shortcut_paths.looper))
  }
  if (needs_open) additions.unshift(open_line_for(shell))
  return `${next.trimEnd()}${next.trim().length > 0 && additions.length > 0 ? '\n\n' : ''}${additions.join('\n')}\n`
}

const uninstall_content = (shell, content) => {
  let next = content
  for (const name of ['agf', 'agf-looper']) next = remove_managed_blocks(shell, next, name)
  const owned_open = open_line_for(shell)
  next = next.split(/\r?\n/u).filter(line => line.trim() !== owned_open).join('\n')
  return `${next.trimEnd()}${next.trim().length > 0 ? '\n' : ''}`
}

const complete_skill_installation = candidate => ['SKILL.md', path.join('scripts', 'agf.js'), path.join('scripts', 'setup.js')]
  .every(relative => fs.existsSync(path.join(candidate, relative)))

const uninstall_main = (opts = {}) => {
  const argv = opts.argv || []
  const say = opts.say || (message => console.log(message))
  const ask = opts.ask || ask_tty
  const skills = argv.includes('--skills')
  const unknown = argv.find((argument, index) => argument !== '--skills' && argument !== '--profile' && argv[index - 1] !== '--profile')
  if (unknown) {
    say(`unknown uninstall option "${unknown}"`)
    return 1
  }

  if (argv.includes('--profile') && (!argv[argv.indexOf('--profile') + 1] || argv[argv.indexOf('--profile') + 1].startsWith('--'))) {
    say('--profile requires the path from PowerShell $PROFILE')
    return 1
  }
  const shell = detect_shell(opts.shell || (argv.includes('--profile') ? 'powershell' : process.env.SHELL) || (process.platform === 'win32' ? 'powershell' : ''))
  const home = opts.home || os.homedir()
  const profile_index = argv.indexOf('--profile')
  const cfg = opts.profile || (profile_index >= 0 ? argv[profile_index + 1] : null) || config_file_for(shell, home)
  const original = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : ''
  let next = original
  try {
    next = uninstall_content(shell, original)
  } catch (error) {
    say(`${error.message}; uninstall did not change ${cfg}.`)
    return 1
  }

  const skill_moves = []
  const unsafe = []
  if (skills) {
    for (const host of installation_roots) {
      const candidate = path.join(home, `.${host}`, 'skills', 'agentflow')
      let stat
      try { stat = fs.lstatSync(candidate) } catch { continue }
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        unsafe.push(`${candidate} is not a real directory`)
        continue
      }
      if (!complete_skill_installation(candidate)) {
        unsafe.push(`${candidate} is not a complete Agentflow installation`)
        continue
      }
      const backup = `${candidate}.agentflow-uninstalled`
      if (fs.existsSync(backup)) {
        unsafe.push(`${backup} already exists`)
        continue
      }
      skill_moves.push({ candidate, backup })
    }
  }

  say('Agentflow uninstall preview:')
  if (next !== original) say(`  - remove managed shell settings from ${cfg}`)
  for (const item of opts.extra_preview || []) say(`  - ${item}`)
  for (const move of skill_moves) say(`  - move ${move.candidate} to ${move.backup}`)
  for (const problem of unsafe) say(`  - leave unchanged: ${problem}`)
  if (unsafe.length > 0) {
    say('nothing changed because one selected target could not be verified safely')
    return 1
  }

  const has_changes = next !== original || skill_moves.length > 0 || (opts.extra_preview || []).length > 0
  if (!has_changes) {
    say('nothing to remove — selected Agentflow items are already absent')
    return 0
  }
  if (!is_yes(ask('Remove these Agentflow items? (Y/n) '))) {
    say('nothing changed')
    return 1
  }

  if (next !== original) {
    backup_config(cfg)
    fs.writeFileSync(cfg, next)
    say(`removed managed shell settings from ${cfg}`)
  }
  if (opts.after_confirm && opts.after_confirm() !== 0) return 1
  for (const move of skill_moves) {
    fs.renameSync(move.candidate, move.backup)
    say(`moved ${move.candidate} to ${move.backup}`)
  }
  if (next !== original) say(`open a new terminal or run \`${shell === 'powershell' ? `. ${powershell_argument(cfg)}` : `source ${cfg}`}\``)
  return 0
}

const backup_config = (cfg_path) => {
  if (!fs.existsSync(cfg_path)) return null
  const bak = `${cfg_path}.bak-agentflow-setup`
  fs.copyFileSync(cfg_path, bak)
  return bak
}

const write_marker = (marker_path) => {
  try { fs.writeFileSync(marker_path || MARKER, 'checked\n') } catch {}
}

// ---------- tty ----------

const is_yes = (answer) => answer !== null && /^\s*(y|yes|)\s*$/i.test(String(answer))

const ask_tty = (question) => {
  process.stderr.write(question)
  try {
    const buf = Buffer.alloc(1024)
    const n = fs.readSync(0, buf, 0, 1024)
    return n === 0 ? null : buf.slice(0, n).toString('utf8')
  } catch { return null }
}

// ---------- main ----------

const main = (opts = {}) => {
  const argv = opts.argv || process.argv.slice(2)
  const fix = argv.includes('--fix')
  const quiet = argv.includes('--quiet')
  const say = quiet ? () => {} : (opts.say || ((m) => console.log(m)))

  if (argv.includes('--profile') && (!argv[argv.indexOf('--profile') + 1] || argv[argv.indexOf('--profile') + 1].startsWith('--'))) {
    say('--profile requires the path from PowerShell $PROFILE')
    return 1
  }
  const shell = detect_shell(opts.shell || (argv.includes('--profile') ? 'powershell' : process.env.SHELL) || (process.platform === 'win32' ? 'powershell' : ''))
  const home = opts.home || os.homedir()
  const profile_index = argv.indexOf('--profile')
  const cfg = opts.profile || (profile_index >= 0 ? argv[profile_index + 1] : null) || config_file_for(shell, home)
  const skill_dir = path.resolve(opts.skill_dir || SKILL_DIR)
  const shortcut_paths = shortcut_paths_for(skill_dir, home)
  const formal_shortcuts = formal_installations_for(skill_dir, home)
  const accepted_shortcuts = formal_shortcuts.length > 0 ? formal_shortcuts : [shortcut_paths]
  const marker = opts.marker || MARKER
  const env = opts.env || process.env
  const ask = opts.ask || ask_tty

  say(`agentflow setup check (shell: ${shell})\n`)

  if (shortcut_paths === null) {
    say('  ✗ the active Agentflow installation is incomplete, and no complete formal skill installation is available')
    say('run setup from a complete Agentflow skill installation; setup did not change your shell config.')
    return 1
  }

  const results = [
    check_node(),
    check_git(),
    check_skill_files(skill_dir),
    check_agf_script(skill_dir),
    check_looper_script(skill_dir),
    check_agf_function(shell, cfg, accepted_shortcuts.map(candidate => candidate.agf)),
    check_looper_function(shell, cfg, accepted_shortcuts.map(candidate => candidate.looper)),
    check_agf_open(env, shell, cfg),
  ]

  for (const r of results) say(`  ${r.ok ? '✓' : '✗'} ${r.label}`)

  const problems = results.filter((r) => !r.ok)

  if (problems.length === 0) {
    say('\nall good.')
    write_marker(marker)
    return 0
  }

  say(`\n${problems.length} item${problems.length > 1 ? 's' : ''} to fix.`)

  const needs_fn = !results[3].ok || !results[5].ok
  const needs_looper = !results[4].ok || !results[6].ok
  const needs_open = !results[7].ok
  const fixable = needs_fn || needs_looper || needs_open

  if (!fixable) {
    say('the items above cannot be fixed by this script.')
    return 1
  }

  if (needs_fn) {
    const script_check = check_agf_script(skill_dir)
    if (!script_check.ok) {
      say(`cannot create agf() shortcut — ${script_check.label}; setup did not change ${cfg}.`)
      return 1
    }
  }

  if (needs_looper) {
    const script_check = check_looper_script(skill_dir)
    if (!script_check.ok) {
      say(`cannot create agf-looper() shortcut — ${script_check.label}; setup did not change ${cfg}.`)
      return 1
    }
  }

  if (!fix) {
    say(`run with --fix to install or update them (backs up ${path.basename(cfg)} first).`)
    return 1
  }

  let next_content
  try {
    next_content = fixed_content({
      shell,
      content: fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '',
      needs_fn,
      needs_looper,
      needs_open,
      shortcut_paths,
    })
  } catch (error) {
    say(`${error.message}; setup did not change ${cfg}.`)
    return 1
  }
  say(`\nAgentflow shortcut content for ${cfg}:\n`)
  say(lines_to_append(shell, needs_fn, needs_open, skill_dir, needs_looper, shortcut_paths))
  say('')

  const answer = ask(`Install or update these Agentflow shortcuts in ${path.basename(cfg)}? (Y/n) `)
  if (!is_yes(answer)) {
    say('nothing changed — paste them yourself when ready.')
    return 1
  }

  backup_config(cfg)
  fs.mkdirSync(path.dirname(cfg), { recursive: true })
  fs.writeFileSync(cfg, next_content)
  say(`done — open a new terminal tab or run \`${shell === 'powershell' ? `. ${powershell_argument(cfg)}` : `source ${cfg}`}\`.`)

  write_marker(marker)
  return 0
}

module.exports = {
  detect_shell, config_file_for, check_node, check_git, check_skill_files,
  check_agf_script,
  check_looper_script, check_agf_function, check_looper_function, check_agf_open, lines_to_append, backup_config,
  formal_installations_for, formal_installation_for, shortcut_paths_for, function_blocks, fixed_content,
  uninstall_content, complete_skill_installation, uninstall_main,
  write_marker, is_yes, MARKER, main,
}

if (require.main === module) {
  try { process.exit(main()) }
  catch (err) { console.error(err.message); process.exit(1) }
}
