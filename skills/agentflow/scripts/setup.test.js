'use strict'

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const setup = require('./setup.js')

const tmp = () => fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agf-setup-')))
const drop = (dir) => fs.rmSync(dir, { recursive: true, force: true })

const write_fake_agf = (skill_dir, output_dir = skill_dir) => {
  const scripts_dir = path.join(skill_dir, 'scripts')
  fs.mkdirSync(scripts_dir, { recursive: true })
  fs.writeFileSync(path.join(scripts_dir, 'agf.js'), `process.stdout.write(${JSON.stringify(`${output_dir}\n`)})\n`)
  fs.writeFileSync(path.join(scripts_dir, 'looper.js'), 'process.stdout.write("looper ready\\n")\n')
}

// ---------- detect_shell ----------

test('detect_shell returns zsh for /bin/zsh, empty, or unknown', () => {
  assert.equal(setup.detect_shell('/bin/zsh'), 'zsh')
  assert.equal(setup.detect_shell('/usr/local/bin/zsh'), 'zsh')
  assert.equal(setup.detect_shell(''), 'zsh')
  assert.equal(setup.detect_shell(undefined), 'zsh')
  assert.equal(setup.detect_shell('/bin/sh'), 'zsh')
})

test('detect_shell returns bash for bash paths', () => {
  assert.equal(setup.detect_shell('/bin/bash'), 'bash')
  assert.equal(setup.detect_shell('/usr/local/bin/bash'), 'bash')
})

test('detect_shell returns fish for fish paths', () => {
  assert.equal(setup.detect_shell('/usr/bin/fish'), 'fish')
  assert.equal(setup.detect_shell('/opt/homebrew/bin/fish'), 'fish')
})

// ---------- config_file_for ----------

test('config_file_for returns the right path per shell', () => {
  const h = '/Users/test'
  assert.equal(setup.config_file_for('zsh', h), path.join(h, '.zshrc'))
  assert.equal(setup.config_file_for('bash', h), path.join(h, '.bashrc'))
  assert.equal(setup.config_file_for('fish', h), path.join(h, '.config', 'fish', 'config.fish'))
})

// ---------- check_node ----------

test('check_node passes on the current runtime', () => {
  const r = setup.check_node()
  assert.ok(r.ok)
  assert.ok(r.label.startsWith('node v'))
})

// ---------- check_git ----------

test('check_git passes when git is installed', () => {
  const r = setup.check_git()
  assert.ok(r.ok)
  assert.ok(r.label.startsWith('git '))
})

// ---------- check_skill_files ----------

test('check_skill_files passes when SKILL.md exists', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'SKILL.md'), 'x')
  assert.ok(setup.check_skill_files(dir).ok)
  drop(dir)
})

test('check_skill_files fails when SKILL.md is absent', () => {
  const dir = tmp()
  assert.ok(!setup.check_skill_files(dir).ok)
  drop(dir)
})

// ---------- check_agf_function ----------

test('check_agf_function detects zsh/bash function', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  write_fake_agf(skill)
  const cfg = path.join(dir, '.zshrc')
  fs.writeFileSync(cfg, `export FOO=bar\n${setup.lines_to_append('zsh', true, false, skill)}\n`)
  assert.ok(setup.check_agf_function('zsh', cfg, path.join(skill, 'scripts', 'agf.js')).ok)
  assert.ok(setup.check_agf_function('bash', cfg, path.join(skill, 'scripts', 'agf.js')).ok)
  drop(dir)
})

test('check_agf_function accepts harmless indentation differences in a managed function', () => {
  const dir = tmp()
  const cfg = path.join(dir, '.zshrc')
  const script = '$HOME/.claude/skills/agentflow/scripts/agf.js'
  fs.writeFileSync(cfg, `agf() {\n\tlocal dir\n\tdir=$(node "${script}" "$@") || return 1\n\t[ -n "$dir" ] && cd "$dir"\n\treturn 0\n}\n`)

  assert.ok(setup.check_agf_function('zsh', cfg, script).ok)
  drop(dir)
})

test('check_agf_function detects fish function', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  write_fake_agf(skill)
  const cfg = path.join(dir, 'config.fish')
  fs.writeFileSync(cfg, `set -gx PATH\n${setup.lines_to_append('fish', true, false, skill)}\n`)
  assert.ok(setup.check_agf_function('fish', cfg, path.join(skill, 'scripts', 'agf.js')).ok)
  drop(dir)
})

test('check_agf_function fails when absent', () => {
  const dir = tmp()
  const cfg = path.join(dir, '.zshrc')
  fs.writeFileSync(cfg, 'export FOO=bar\n')
  assert.ok(!setup.check_agf_function('zsh', cfg).ok)
  drop(dir)
})

test('check_agf_function fails when config file missing', () => {
  assert.ok(!setup.check_agf_function('zsh', '/nonexistent/.zshrc').ok)
})

test('check_looper_function detects the installed shortcut for zsh, bash, and fish', () => {
  for (const shell of ['zsh', 'bash', 'fish']) {
    const dir = tmp()
    const skill = path.join(dir, 'skill')
    fs.mkdirSync(skill)
    write_fake_agf(skill)
    const cfg = path.join(dir, shell === 'fish' ? 'config.fish' : `.${shell}rc`)
    fs.writeFileSync(cfg, `${setup.lines_to_append(shell, false, false, skill, true)}\n`)
    assert.ok(setup.check_looper_function(shell, cfg, path.join(skill, 'scripts', 'looper.js')).ok)
    drop(dir)
  }
})

// ---------- check_agf_open ----------

test('check_agf_open passes when set', () => {
  assert.ok(setup.check_agf_open({ AGF_OPEN: 'code' }).ok)
  assert.ok(setup.check_agf_open({ AGF_OPEN: 'subl' }).ok)
})

test('check_agf_open fails when unset', () => {
  assert.ok(!setup.check_agf_open({}).ok)
})

// ---------- lines_to_append ----------

test('lines_to_append gives zsh/bash templates', () => {
  const both = setup.lines_to_append('zsh', true, true)
  assert.ok(both.includes('export AGF_OPEN="code"'))
  assert.ok(both.includes('agf()'))
  assert.ok(both.includes('agf-looper()'))

  const fn_only = setup.lines_to_append('bash', true, false)
  assert.ok(!fn_only.includes('AGF_OPEN'))
  assert.ok(fn_only.includes('agf()'))
})

test('lines_to_append gives fish templates', () => {
  const both = setup.lines_to_append('fish', true, true)
  assert.ok(both.includes('set -gx AGF_OPEN'))
  assert.ok(both.includes('function agf'))
  assert.ok(both.includes('function agf-looper'))
  assert.ok(!both.includes('agf()'))
})

test('lines_to_append uses the actual installed skill path and quotes spaces', () => {
  const skill_dir = '/Users/test user/.codex/skills/agentflow space'
  const script_path = path.join(skill_dir, 'scripts', 'agf.js')

  for (const shell of ['zsh', 'bash', 'fish']) {
    const rendered = setup.lines_to_append(shell, true, false, skill_dir)
    assert.match(rendered, new RegExp(script_path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(rendered, /\$HOME\/\.claude\/skills\/agentflow\/scripts\/agf\.js/)
  }
})

test('formal shortcut paths prefer the installed Codex skill and use HOME instead of a machine path', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const skill = path.join(home, '.codex', 'skills', 'agentflow')
  write_fake_agf(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  const selected = setup.shortcut_paths_for(skill, home)
  assert.deepEqual(selected, {
    host: 'codex',
    agf: '$HOME/.codex/skills/agentflow/scripts/agf.js',
    looper: '$HOME/.codex/skills/agentflow/scripts/looper.js',
  })
  const rendered = setup.lines_to_append('zsh', true, false, skill, true, selected)
  assert.match(rendered, /node "\$HOME\/\.codex\/skills\/agentflow\/scripts\/agf\.js"/)
  assert.doesNotMatch(rendered, new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  drop(dir)
})

test('plugin-only shortcut paths use the verified active skill without guessing a cache root', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const plugin = path.join(home, '.claude', 'plugins', 'cache', 'agentflow release', 'skills', 'agentflow')
  fs.mkdirSync(home, { recursive: true })
  write_fake_agf(plugin)
  fs.writeFileSync(path.join(plugin, 'SKILL.md'), 'x')

  assert.deepEqual(setup.shortcut_paths_for(plugin, home), {
    host: 'active',
    agf: path.join(plugin, 'scripts', 'agf.js'),
    looper: path.join(plugin, 'scripts', 'looper.js'),
  })
  drop(dir)
})

test('formal shortcut paths prefer a usable shared agents installation over host aliases', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const shared = path.join(home, '.agents', 'skills', 'agentflow')
  const codex = path.join(home, '.codex', 'skills', 'agentflow')
  const claude = path.join(home, '.claude', 'skills', 'agentflow')
  for (const skill of [shared, codex, claude]) {
    write_fake_agf(skill)
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  }

  assert.deepEqual(setup.shortcut_paths_for(shared, home), {
    host: 'agents',
    agf: '$HOME/.agents/skills/agentflow/scripts/agf.js',
    looper: '$HOME/.agents/skills/agentflow/scripts/looper.js',
  })
  drop(dir)
})

test('formal shortcut paths skip an incomplete agents installation and use a complete direct host installation', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const shared = path.join(home, '.agents', 'skills', 'agentflow')
  const claude = path.join(home, '.claude', 'skills', 'agentflow')
  fs.mkdirSync(shared, { recursive: true })
  fs.writeFileSync(path.join(shared, 'SKILL.md'), 'incomplete')
  write_fake_agf(claude)
  fs.writeFileSync(path.join(claude, 'SKILL.md'), 'x')

  assert.deepEqual(setup.shortcut_paths_for(shared, home), {
    host: 'claude',
    agf: '$HOME/.claude/skills/agentflow/scripts/agf.js',
    looper: '$HOME/.claude/skills/agentflow/scripts/looper.js',
  })
  drop(dir)
})

test('main accepts an existing shortcut to any other usable formal installation', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const shared = path.join(home, '.agents', 'skills', 'agentflow')
  const codex = path.join(home, '.codex', 'skills', 'agentflow')
  const claude = path.join(home, '.claude', 'skills', 'agentflow')
  for (const skill of [shared, codex, claude]) {
    write_fake_agf(skill)
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  }
  const claude_paths = {
    agf: '$HOME/.claude/skills/agentflow/scripts/agf.js',
    looper: '$HOME/.claude/skills/agentflow/scripts/looper.js',
  }
  fs.writeFileSync(path.join(home, '.zshrc'), `${setup.lines_to_append('zsh', true, false, claude, true, claude_paths)}\n`)

  const code = setup.main({
    argv: ['--quiet'], shell: '/bin/zsh', home, skill_dir: shared,
    marker: path.join(dir, '.marker'), env: { AGF_OPEN: 'code' }, ask: () => 'y',
  })

  assert.equal(code, 0)
  drop(dir)
})

test('a managed old-host shortcut is replaced instead of duplicated', () => {
  const content = `# existing\n\nagf() {\n\tlocal dir\n\tdir=$(node "$HOME/.claude/skills/agentflow/scripts/agf.js" "$@") || return 1\n\t[ -n "$dir" ] && cd "$dir"\n\treturn 0\n}\n`
  const result = setup.fixed_content({
    shell: 'zsh', content, needs_fn: true, needs_looper: false, needs_open: false,
    shortcut_paths: { agf: '$HOME/.codex/skills/agentflow/scripts/agf.js', looper: '$HOME/.codex/skills/agentflow/scripts/looper.js' },
  })
  assert.equal((result.match(/^agf\(\) \{/gm) || []).length, 1)
  assert.match(result, /\$HOME\/\.codex\/skills\/agentflow\/scripts\/agf\.js/)
  assert.doesNotMatch(result, /\.claude\/skills\/agentflow\/scripts\/agf\.js/)
})

test('main refuses to create a shortcut when the installed agf.js is unavailable', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const cfg = path.join(home, '.zshrc')
  const original = '# existing\n'
  fs.writeFileSync(cfg, original)

  const code = setup.main({
    argv: ['--fix', '--quiet'], shell: '/bin/zsh', home, skill_dir: skill,
    marker: path.join(dir, '.marker'), env: {}, ask: () => 'y',
  })

  assert.equal(code, 1)
  assert.equal(fs.readFileSync(cfg, 'utf8'), original)
  drop(dir)
})

// ---------- is_yes ----------

test('is_yes accepts y, yes, and empty', () => {
  assert.ok(setup.is_yes('y'))
  assert.ok(setup.is_yes('Y'))
  assert.ok(setup.is_yes('yes'))
  assert.ok(setup.is_yes(''))
  assert.ok(setup.is_yes(' '))
})

test('is_yes rejects no, n, null', () => {
  assert.ok(!setup.is_yes('n'))
  assert.ok(!setup.is_yes('no'))
  assert.ok(!setup.is_yes(null))
  assert.ok(!setup.is_yes('x'))
})

// ---------- backup_config ----------

test('backup_config copies and returns the path', () => {
  const dir = tmp()
  const cfg = path.join(dir, '.zshrc')
  fs.writeFileSync(cfg, 'original')
  const bak = setup.backup_config(cfg)
  assert.ok(bak.endsWith('.bak-agentflow-setup'))
  assert.equal(fs.readFileSync(bak, 'utf8'), 'original')
  drop(dir)
})

test('backup_config returns null when the file is missing', () => {
  assert.equal(setup.backup_config('/nonexistent/.zshrc'), null)
})

// ---------- write_marker ----------

test('write_marker creates the file', () => {
  const dir = tmp()
  const m = path.join(dir, '.setup-checked')
  setup.write_marker(m)
  assert.ok(fs.existsSync(m))
  drop(dir)
})

// ---------- main: all good ----------

test('main returns 0 and writes marker when everything is set up', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  fs.writeFileSync(path.join(home, '.zshrc'), `${setup.lines_to_append('zsh', true, false, skill)}\n`)
  const marker = path.join(dir, '.marker')

  const code = setup.main({
    argv: [], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: { AGF_OPEN: 'code' }, ask: () => 'y',
  })
  assert.equal(code, 0)
  assert.ok(fs.existsSync(marker))
  drop(dir)
})

test('main rejects unrelated or stale agf functions for zsh, bash, and fish', () => {
  const shells = [
    ['zsh', 'agf() {\n  echo unrelated\n}'],
    ['bash', 'agf() {\n  echo unrelated\n}'],
    ['fish', 'function agf\n  echo unrelated\nend'],
  ]

  for (const [shell, unrelated] of shells) {
    for (const function_text of [unrelated, setup.lines_to_append(shell, true, false, `/old/${shell}/agentflow`)]) {
      const dir = tmp()
      const skill = path.join(dir, 'current skill')
      fs.mkdirSync(skill, { recursive: true })
      fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
      write_fake_agf(skill)
      const home = path.join(dir, 'home')
      fs.mkdirSync(home)
      const cfg = setup.config_file_for(shell, home)
      fs.mkdirSync(path.dirname(cfg), { recursive: true })
      fs.writeFileSync(cfg, `${function_text}\n`)
      const original = fs.readFileSync(cfg, 'utf8')
      const marker = path.join(dir, '.marker')

      const output = []
      const original_log = console.log
      console.log = (...values) => output.push(values.join(' '))
      let code
      try {
        code = setup.main({
          argv: [], shell: `/${shell}`, home, skill_dir: skill,
          marker, env: { AGF_OPEN: 'code' }, ask: () => 'y',
        })
      } finally {
        console.log = original_log
      }

      assert.notEqual(code, 0, `${shell} invalid shortcut must not return success`)
      assert.doesNotMatch(output.join('\n'), /all good\./)
      assert.equal(fs.existsSync(marker), false, `${shell} invalid shortcut created a success marker`)
      assert.equal(fs.readFileSync(cfg, 'utf8'), original)
      assert.equal(setup.check_agf_function(shell, cfg, skill).ok, false)
      drop(dir)
    }
  }
})

// ---------- main: --fix appends ----------

test('main --fix appends function and AGF_OPEN on yes', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const cfg = path.join(home, '.zshrc')
  fs.writeFileSync(cfg, '# existing\n')
  const marker = path.join(dir, '.marker')

  const code = setup.main({
    argv: ['--fix'], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: {}, ask: () => 'y',
  })
  assert.equal(code, 0)
  const content = fs.readFileSync(cfg, 'utf8')
  assert.ok(content.includes('agf()'))
  assert.ok(content.includes('export AGF_OPEN="code"'))
  assert.ok(fs.existsSync(`${cfg}.bak-agentflow-setup`))
  drop(dir)
})

// ---------- main: --fix declined ----------

test('main --fix does nothing when user says no', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const cfg = path.join(home, '.zshrc')
  fs.writeFileSync(cfg, '# existing\n')
  const marker = path.join(dir, '.marker')

  setup.main({
    argv: ['--fix'], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: {}, ask: () => 'n',
  })
  assert.ok(!fs.readFileSync(cfg, 'utf8').includes('agf()'))
  drop(dir)
})

// ---------- main: idempotent ----------

test('main --fix is idempotent — second run finds function already present', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const cfg = path.join(home, '.zshrc')
  fs.writeFileSync(cfg, '# existing\n')
  const marker = path.join(dir, '.marker')

  setup.main({
    argv: ['--fix'], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: {}, ask: () => 'y',
  })

  const fixed = fs.readFileSync(cfg, 'utf8')
  const backup = fs.readFileSync(`${cfg}.bak-agentflow-setup`, 'utf8')

  const code = setup.main({
    argv: ['--fix'], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: {},
    ask: () => { throw new Error('should not ask') },
  })
  assert.equal(code, 0)
  assert.equal(fs.readFileSync(cfg, 'utf8'), fixed)
  assert.equal(fs.readFileSync(`${cfg}.bak-agentflow-setup`, 'utf8'), backup)
  drop(dir)
})

// ---------- main: fish ----------

test('main --fix appends fish-syntax function', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  const fish_dir = path.join(home, '.config', 'fish')
  fs.mkdirSync(fish_dir, { recursive: true })
  const cfg = path.join(fish_dir, 'config.fish')
  fs.writeFileSync(cfg, '# fish\n')
  const marker = path.join(dir, '.marker')

  setup.main({
    argv: ['--fix'], shell: '/usr/bin/fish', home, skill_dir: skill,
    marker, env: {}, ask: () => 'y',
  })
  const content = fs.readFileSync(cfg, 'utf8')
  assert.ok(content.includes('function agf'))
  assert.ok(content.includes('set -gx AGF_OPEN'))
  assert.ok(!content.includes('agf()'))
  drop(dir)
})

// ---------- main: config file does not exist yet ----------

test('main --fix creates the config file when it does not exist', () => {
  const dir = tmp()
  const skill = path.join(dir, 'skill')
  fs.mkdirSync(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  write_fake_agf(skill)
  const home = path.join(dir, 'home')
  fs.mkdirSync(home)
  const cfg = path.join(home, '.zshrc')
  const marker = path.join(dir, '.marker')

  setup.main({
    argv: ['--fix'], shell: '/bin/zsh', home, skill_dir: skill,
    marker, env: {}, ask: () => 'y',
  })
  assert.ok(fs.existsSync(cfg))
  assert.ok(fs.readFileSync(cfg, 'utf8').includes('agf()'))
  drop(dir)
})

test('generated zsh, bash, and fish shortcuts execute the installed agf.js and looper.js', { skip: process.platform === 'win32' ? 'requires native Unix shells; Windows Bash may cross into WSL' : false }, () => {
  const shells = [
    ['zsh', 'zsh'],
    ['bash', 'bash'],
    ['fish', 'fish'],
  ]
  const available = (binary) => {
    try {
      execFileSync(binary, ['-c', 'exit 0'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  for (const [shell, binary] of shells) {
    if (!available(binary)) continue

    for (const host of ['claude', 'codex']) {
      const dir = tmp()
      const home = path.join(dir, `${host} home with spaces`)
      const skill = path.join(dir, `${host} install`, `.${host}`, 'skills', 'agentflow space')
      const target = path.join(dir, 'opened target')
      fs.mkdirSync(home, { recursive: true })
      fs.mkdirSync(target)
      fs.mkdirSync(skill, { recursive: true })
      fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
      write_fake_agf(skill, target)

      const code = setup.main({
        argv: ['--fix', '--quiet'], shell: `/${shell}`, home, skill_dir: skill,
        marker: path.join(dir, '.marker'), env: {}, ask: () => 'y',
      })
      assert.equal(code, 0)
      const cfg = setup.config_file_for(shell, home)
      const content = fs.readFileSync(cfg, 'utf8')
      assert.match(content, new RegExp(skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

      const command = 'source "$CONFIG_PATH"; agf-looper; agf; pwd'
      const output = execFileSync(binary, ['-c', command], {
        encoding: 'utf8',
        env: { ...process.env, CONFIG_PATH: cfg },
      }).trim().split('\n')
      assert.equal(output[0], 'looper ready')
      assert.equal(output.at(-1), target)
      drop(dir)
    }
  }
})

test('uninstall preview and decline preserve managed and foreign shell content', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const skill = path.join(home, '.codex', 'skills', 'agentflow')
  fs.mkdirSync(home, { recursive: true })
  write_fake_agf(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  fs.writeFileSync(path.join(skill, 'scripts', 'setup.js'), 'x')
  const cfg = path.join(home, '.zshrc')
  const original = `export KEEP=yes\nexport AGF_OPEN="code"\n\n${setup.lines_to_append('zsh', true, false, skill, true)}\nforeign() {\n  echo keep\n}\n`
  fs.writeFileSync(cfg, original)
  const output = []

  const code = setup.uninstall_main({ home, shell: '/bin/zsh', skill_dir: skill, ask: () => 'n', say: message => output.push(message) })

  assert.equal(code, 1)
  assert.match(output.join('\n'), /preview/i)
  assert.match(output.join('\n'), new RegExp(cfg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(fs.readFileSync(cfg, 'utf8'), original)
  drop(dir)
})

test('uninstall removes only managed shortcuts and exact AGF_OPEN and is idempotent', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const skill = path.join(home, '.codex', 'skills', 'agentflow')
  fs.mkdirSync(home, { recursive: true })
  write_fake_agf(skill)
  fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
  fs.writeFileSync(path.join(skill, 'scripts', 'setup.js'), 'x')
  const cfg = path.join(home, '.zshrc')
  fs.writeFileSync(cfg, `export KEEP=yes\nexport AGF_OPEN="code"\n\n${setup.lines_to_append('zsh', true, false, skill, true)}\ncustom() {\n  echo keep\n}\n`)

  assert.equal(setup.uninstall_main({ home, shell: '/bin/zsh', skill_dir: skill, ask: () => 'y', say: () => {} }), 0)
  const content = fs.readFileSync(cfg, 'utf8')
  assert.match(content, /export KEEP=yes/)
  assert.match(content, /custom\(\)/)
  assert.doesNotMatch(content, /AGF_OPEN|agf\(\)|agf-looper\(\)/)
  assert.ok(fs.existsSync(`${cfg}.bak-agentflow-setup`))
  assert.equal(setup.uninstall_main({ home, shell: '/bin/zsh', skill_dir: skill, ask: () => { throw new Error('must not ask') }, say: () => {} }), 0)
  drop(dir)
})

test('optional skill uninstall moves verified directories and refuses symbolic links', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const agents = path.join(home, '.agents', 'skills', 'agentflow')
  const codex = path.join(home, '.codex', 'skills', 'agentflow')
  for (const skill of [agents, codex]) {
    write_fake_agf(skill)
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
    fs.writeFileSync(path.join(skill, 'scripts', 'setup.js'), 'x')
  }
  const linked = path.join(home, '.claude', 'skills', 'agentflow')
  fs.mkdirSync(path.dirname(linked), { recursive: true })
  fs.symlinkSync(codex, linked)

  assert.equal(setup.uninstall_main({ argv: ['--skills'], home, shell: '/bin/zsh', skill_dir: codex, ask: () => 'y', say: () => {} }), 1)
  assert.equal(fs.existsSync(agents), true)
  assert.equal(fs.existsSync(codex), true)
  assert.equal(fs.existsSync(`${agents}.agentflow-uninstalled`), false)
  assert.equal(fs.existsSync(`${codex}.agentflow-uninstalled`), false)
  assert.ok(fs.lstatSync(linked).isSymbolicLink())
  drop(dir)
})

test('optional skill uninstall moves every verified formal installation to a recoverable sibling', () => {
  const dir = tmp()
  const home = path.join(dir, 'home')
  const skills = ['agents', 'codex', 'claude'].map(host => path.join(home, `.${host}`, 'skills', 'agentflow'))
  for (const skill of skills) {
    write_fake_agf(skill)
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'x')
    fs.writeFileSync(path.join(skill, 'scripts', 'setup.js'), 'x')
  }

  assert.equal(setup.uninstall_main({ argv: ['--skills'], home, shell: '/bin/zsh', ask: () => 'y', say: () => {} }), 0)
  for (const skill of skills) {
    assert.equal(fs.existsSync(skill), false)
    assert.ok(fs.existsSync(`${skill}.agentflow-uninstalled`))
  }
  drop(dir)
})
