'use strict'

// Native PowerShell is not covered by the zsh/bash/fish shortcuts.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const setup = require('./setup.js')
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })

test('PowerShell shortcuts preserve arguments and support managed replacement', () => {
  assert.equal(setup.detect_shell('C:\\Program Files\\PowerShell\\7\\pwsh.exe'), 'powershell')
  const shortcuts = { agf: "C:\\Users\\O'Brien\\.agents\\skills\\agentflow\\scripts\\agf.js", looper: 'C:\\Users\\test\\.agents\\skills\\agentflow\\scripts\\looper.js' }
  const content = setup.fixed_content({ shell: 'powershell', content: '', needs_fn: true, needs_looper: true, needs_open: true, shortcut_paths: shortcuts })
  assert.match(content, /O''Brien/)
  assert.match(content, /@args/)
  assert.match(content, /Set-Location -LiteralPath/)
  assert.equal(setup.uninstall_content('powershell', content), '')
})
test('PowerShell executes shortcuts with literal paths and forwards arguments', { skip: process.platform !== 'win32' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agf O'Brien "))
  try {
    const script = path.join(root, 'agf.js')
    fs.writeFileSync(script, 'process.stdout.write(process.argv[2])')
    const content = setup.lines_to_append('powershell', true, false, root, false)
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.copyFileSync(script, path.join(root, 'scripts', 'agf.js'))
    const profile = path.join(root, 'journey.ps1')
    fs.writeFileSync(profile, `${content}\nagf '${root.replaceAll("'", "''")}'\n(Get-Location).Path\n`)
    const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', profile], { encoding: 'utf8' })
    assert.equal(output.trim(), root)
  } finally { drop(root) }
})

