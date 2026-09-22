'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const settings = require('./ag-settings.js')
const { send_tree_signal } = require('./process-tree.js')

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agentflow-windows-'))
const drop = directory => fs.rmSync(directory, { recursive: true, force: true })

// npm leaves an extensionless POSIX shim next to its .cmd wrapper. Windows
// spawns with shell:false, so only a real .exe or .com proves launchability.
test('Windows executable discovery requires a native executable extension', { skip: process.platform !== 'win32' }, () => {
  const root = tmp()
  try {
    fs.writeFileSync(path.join(root, 'claude'), '#!/bin/sh\nexec node "$@"\n')
    fs.writeFileSync(path.join(root, 'codex.cmd'), '@echo off\n')
    assert.equal(settings.executable_available('claude', { path_value: root }), false)
    assert.equal(settings.executable_available('codex', { path_value: root }), false)
    fs.writeFileSync(path.join(root, 'claude.exe'), '')
    assert.equal(settings.executable_available('claude', { path_value: root }), true)
  } finally { drop(root) }
})

test('Windows cancellation terminates descendants', { skip: process.platform !== 'win32', timeout: 15000 }, async () => {
  const { spawn } = require('node:child_process')
  const { once } = require('node:events')
  const code = `const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); console.log(child.pid); setInterval(()=>{},1000)`
  const child = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let descendant
  try {
    const [data] = await once(child.stdout, 'data')
    descendant = Number(String(data).trim())
    const closed = once(child, 'close')
    send_tree_signal(child, 'SIGTERM')
    await closed
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
  } finally {
    try { send_tree_signal(child, 'SIGKILL') } catch {}
    if (descendant) { try { process.kill(descendant) } catch {} }
  }
})
