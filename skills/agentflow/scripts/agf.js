#!/usr/bin/env node
'use strict'
const path = require('node:path')
const fs = require('node:fs')
const L = require('./looper')
const R = require('./looper-report')

async function main(args, io = {}) {
  const stdout = io.stdout || process.stdout, stderr = io.stderr || process.stderr
  const write = (stream, value) => { try { stream.write(value) } catch {} }
  const featureVerbs = { 'new-feature': 'create', newft: 'create', 'merge-feature': 'merge', mergeft: 'merge', 'drop-feature': 'drop', dropft: 'drop' }
  if (args[0] === 'shell') {
    try {
      if (args.length !== 2) throw Error('Usage: agf shell <zsh|bash|powershell>')
      write(stdout, require('./feature-shell').binding(args[1])); return 0
    } catch (error) { write(stderr, `${error.message}\n`); return 1 }
  }
  if (Object.hasOwn(featureVerbs, args[0])) {
    const action = featureVerbs[args[0]], options = { cwd: io.cwd || process.cwd(), stdout, stderr, checks: [], include: [], invocation: ['agf', ...args] }
    let name
    try {
      if (Number(process.versions.node.split('.')[0]) < 20) throw Error('Feature commands require Node.js 20 or later')
      const seen = new Set()
      for (let n = 1; n < args.length; n++) {
        const arg = args[n]
        if (arg === '--include' && action === 'merge') {
          const file = args[++n]
          if (!file || file.startsWith('-') || file.includes('\0') || path.isAbsolute(file) || file.split(/[\\/]/).some(part => part === '..' || part === '.' || !part))
            throw Error('--include requires a safe checkout-relative path')
          if (options.include.includes(file)) throw Error(`Duplicate included path: ${file}`)
          options.include.push(file); continue
        }
        if (arg === '--check' && action === 'merge') {
          const command = JSON.parse(args[++n])
          if (!Array.isArray(command) || !command.length || command.some(value => typeof value !== 'string' || value.includes('\0')) || !command[0])
            throw Error('--check requires a nonempty JSON argv array')
          options.checks.push(command); continue
        }
        if ((arg === '--open' && action === 'create') || (arg === '--cleanup' && action === 'merge') || (arg === '--abandon' && action === 'drop')) {
          if (seen.has(arg)) throw Error(`Duplicate option: ${arg}`)
          seen.add(arg); options[arg.slice(2)] = true; continue
        }
        if (!arg || arg.startsWith('-') || name !== undefined) throw Error(`Unexpected feature argument: ${arg}`)
        name = arg
      }
      if ((action === 'create' && !name) || (name !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)))
        throw Error('Feature name must match [a-z0-9]+(-[a-z0-9]+)*')
      const shell = require('./feature-shell'), cdFile = io.cdFile === undefined ? process.env.AGF_CD_FILE : io.cdFile
      shell.channel(cdFile)
      const fn = io.feature?.[action] || (action === 'merge' ? require('./feature-merge').merge : require('./feature')[action])
      const controller = new AbortController(), cancel = () => controller.abort()
      options.signal = controller.signal
      process.on('SIGINT', cancel); process.on('SIGTERM', cancel)
      io.signal?.addEventListener('abort', cancel, { once: true })
      if (io.signal?.aborted) cancel()
      let result
      try {
        if (controller.signal.aborted) throw Error('Feature operation interrupted before execution')
        result = await fn(name, options)
        if (controller.signal.aborted) throw Error('Feature operation interrupted; inspect its reported state before continuing')
      } finally {
        process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
        io.signal?.removeEventListener('abort', cancel)
      }
      const shellHint = cdFile && (io.cdHint ?? process.env.AGF_CD_HINT) === '1'
      if (result?.message) write(stdout, result.message.replace(/\n?$/, '\n'))
      if (result?.destination && cdFile) shell.destination(cdFile, result.destination, shellHint ? result.hint : undefined)
      if (result?.destination && !(shellHint && result.hint)) {
        if (result.continuation) write(stdout, `\n${result.continuation}\n\n${result.directHint}\n`)
        else if (!cdFile) write(stdout, process.platform === 'win32'
          ? `\nSet-Location -LiteralPath ${shell.psQuote(result.destination)}\n`
          : `\ncd -- ${shell.quote(result.destination)}\n`)
      }
      return 0
    } catch (error) { write(stderr, `${error.message}\n`); return 1 }
  }
  const verb = args[1], flags = args.slice(2).filter(arg => arg === '--cleanup')
  const roots = args.slice(2).filter(arg => arg !== '--cleanup')
  const cleanup_requested = flags.length === 1
  if (args[0] !== 'looper' || !['cleanup', 'run', 'status'].includes(verb) || roots.length > 1 ||
      roots.some(arg => !arg.length || arg.startsWith('-')) || flags.length > 1 ||
      (verb !== 'run' && cleanup_requested) || (verb === 'cleanup' && roots.length !== 1)) {
    write(stderr, 'Usage: agf looper cleanup <run-root>\n       agf looper run [run-root] [--cleanup]\n       agf looper status [run-root]\n       agf new-feature <name> [--open] (alias: newft)\n       agf merge-feature [name] [--cleanup] [--include <path>] [--check \'["command","arg"]\'] (alias: mergeft)\n       agf drop-feature [name] [--abandon] (alias: dropft)\n       agf shell <zsh|bash|powershell>\n')
    return 1
  }
  let root = path.resolve(roots[0] || process.cwd())
  try { root = fs.realpathSync(root) } catch {} // Validation retains missing-path diagnostics.
  if (args[1] === 'status') {
    try { write(stdout, (io.status || L.status)(root)); return 0 }
    catch (error) { write(stderr, `${error.message}\n${R.dictionary().status_hint}\n${root}\n`); return 1 }
  }
  let locale, initial_queue, locale_unavailable = false
  try {
    const q = (io.load || L.load)(root)
    initial_queue = q
    locale = (io.read_settings || L.read_settings)(q.repo).config.switches?.['use-lang']
  } catch { locale_unavailable = true } // The coordinator owns validation; presentation must not block recovery.
  locale = R.resolve_locale(locale)
  const w = R.dictionary(locale)
  const cleanup = (directory, options) => (io.cleanup || require('./looper-cleanup').cleanup)(directory, options)
  if (verb === 'cleanup') {
    try {
      const q = await cleanup(root)
      write(stdout, `${w.cleanup}: ${w.cleanup_complete}\n\n${R.details(q, root, locale)}`)
      return 0
    } catch (error) {
      write(stderr, R.terminal_text(`${w.cleanup}: ${w.cleanup_failed}\n\n${error.message}\n`, stderr, locale, io.env))
      return 1
    }
  }
  let timer
  const arm = () => {
    (io.clearTimeout || clearTimeout)(timer)
    timer = (io.setTimeout || setTimeout)(() => progress.heartbeat(), 30000)
    timer?.unref?.()
  }
  const progress = R.observer({ write: line => write(stderr, R.terminal_text(line, stderr, locale, io.env)), locale, now: io.now, on_activity: arm,
    columns: () => stderr.isTTY ? stderr.columns : undefined })
  progress.emit(`${w.starting}: ${root}; ${w.preparing}`)
  if (locale_unavailable) progress.emit(w.locale_missing)
  if (!R.supported_locale(locale)) progress.emit(`${w.fallback}: ${locale}`)
  let code = 1, failure
  try { code = await (io.run || L.run)(root, { on_save: progress.update }) }
  catch (error) { failure = error }
  finally {
    (io.clearTimeout || clearTimeout)(timer)
  }
  let q = progress.snapshot() || (initial_queue?.cleanup ? initial_queue : undefined), cleanup_error
  const task_code = code
  if (cleanup_requested && code === 0 && !failure) {
    try { q = await cleanup(root, { on_save: progress.update }); progress.update(q) }
    catch (error) {
      cleanup_error = error; code = 1
      try { q = (io.load || L.load)(root) } catch {} // Keep the last observed task result if recovery cannot be read.
    } finally { (io.clearTimeout || clearTimeout)(timer) }
  }
  const options = { code, task_code, error: failure, cleanup_error, cleanup_requested, locale }
  let content = R.summary(q, root, options)
  if (q && !(q.cleanup?.state === 'complete' && q.cleanup.compaction?.state === 'complete')) {
    try {
      const saved = (io.save_report || R.save_report)(fs.realpathSync(root), q, options)
      content = saved.content
      if (saved.warning) {
        const warning = `${w.latest_failed}: ${saved.warning}`
        content += `\n${warning}\n`
        write(stderr, R.terminal_text(`${warning}\n`, stderr, locale, io.env))
      }
    }
    catch (error) { write(stderr, R.terminal_text(`${w.report_failed}: ${error.message}\n`, stderr, locale, io.env)) }
  }
  write(stdout, R.terminal_text(content, stdout, locale, io.env))
  return code
}

if (require.main === module) {
  // A closed output pipe must not crash a coordinator with live workers.
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => {})
  main(process.argv.slice(2)).then(code => { process.exitCode = code })
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
module.exports = { main }
