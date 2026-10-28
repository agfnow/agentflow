'use strict'

const fs = require('node:fs')
const path = require('node:path')

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const psQuote = value => "'" + value.replaceAll("'", "''") + "'"

// The caller creates this private channel. Ordinary command output never
// participates in directory switching, and no shell source is evaluated.
function channel(file) {
  if (!file) return
  if (!path.isAbsolute(file)) throw Error('AGF_CD_FILE must be absolute')
  const before = fs.lstatSync(file)
  if (!before.isFile() || before.nlink !== 1 || before.size !== 0 ||
      (process.platform !== 'win32' && (before.uid !== process.getuid() || (before.mode & 0o077))))
    throw Error('AGF_CD_FILE must be an empty private regular file with one link')
  return before
}

function destination(file, directory, hint) {
  if (!file) return
  if (hint !== undefined && (typeof hint !== 'string' || /[\x00-\x1f\x7f]/.test(hint))) throw Error('Invalid directory-switch hint')
  const before = channel(file)
  const target = fs.realpathSync(directory)
  if (!fs.statSync(target).isDirectory() || /[\x00-\x1f\x7f]/.test(target))
    throw Error('Invalid directory-switch destination')
  const fd = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0))
  try {
    const current = fs.fstatSync(fd), named = fs.lstatSync(file)
    if (current.dev !== before.dev || current.ino !== before.ino || current.size !== 0 ||
        current.nlink !== 1 || named.dev !== current.dev || named.ino !== current.ino || !named.isFile())
      throw Error('AGF_CD_FILE changed before publication')
    fs.writeFileSync(fd, target + '\n' + (hint ? hint + '\n' : ''), 'utf8')
  } finally { fs.closeSync(fd) }
}

function binding(shell, launcher = path.resolve(__dirname, 'agf.js')) {
  if (shell === 'zsh' || shell === 'bash') return `agf() {
  case "\${1-}" in
    new-feature|newft|merge-feature|mergeft|drop-feature|dropft) ;;
    *) node ${quote(launcher)} "$@"; return $? ;;
  esac
  local agf_cd_file agf_exit agf_destination agf_hint
  agf_cd_file="$(mktemp "\${TMPDIR:-/tmp}/agf-cd.XXXXXXXX")" || return 1
  if AGF_CD_HINT=1 AGF_CD_FILE="$agf_cd_file" node ${quote(launcher)} "$@"; then
    agf_exit=0
  else
    agf_exit=$?
  fi
  if [ "$agf_exit" -eq 0 ] && [ -s "$agf_cd_file" ]; then
    {
      IFS= read -r agf_destination
      IFS= read -r agf_hint || agf_hint=''
    } < "$agf_cd_file"
    if [ -d "$agf_destination" ]; then
      if cd -- "$agf_destination"; then
        [ -z "$agf_hint" ] || printf '\\n%s\\n' "$agf_hint"
      else
        agf_exit=$?
        printf '\\ncd -- %q\\n' "$agf_destination"
        [ -z "$agf_hint" ] || printf '\\n%s\\n' "$agf_hint"
      fi
    else
      printf '%s\\n' 'agf: destination is no longer a directory' >&2
      agf_exit=1
    fi
  fi
  if command -v trash >/dev/null 2>&1; then
    command trash "$agf_cd_file" >/dev/null || printf '%s\\n' "agf: retained temporary channel $agf_cd_file" >&2
  else
    printf '%s\\n' "agf: retained temporary channel $agf_cd_file (trash unavailable)" >&2
  fi
  return "$agf_exit"
}
`
  if (shell === 'powershell') return `function agf {
  if ($args.Count -eq 0 -or $args[0] -notin @('new-feature','newft','merge-feature','mergeft','drop-feature','dropft')) {
    & node ${psQuote(launcher)} @args
    return
  }
  $agfPreviousChannel = $env:AGF_CD_FILE
  $agfPreviousHint = $env:AGF_CD_HINT
  $agfChannel = [System.IO.Path]::GetTempFileName()
  $agfExit = 1
  $agfDestination = $null
  $agfLines = @()
  try {
    $env:AGF_CD_FILE = $agfChannel
    $env:AGF_CD_HINT = "1"
    & node ${psQuote(launcher)} @args
    $agfExit = $LASTEXITCODE
    if ($agfExit -eq 0) {
      $agfLines = [System.IO.File]::ReadAllLines($agfChannel)
      $agfDestination = if ($agfLines.Length) { $agfLines[0] } else { '' }
      if ($agfDestination) {
        if (Test-Path -LiteralPath $agfDestination -PathType Container) {
          Set-Location -LiteralPath $agfDestination -ErrorAction Stop
          if ($agfLines.Length -gt 1 -and $agfLines[1]) { Write-Output ""; Write-Output $agfLines[1] }
        } else { throw 'agf: destination is no longer a directory' }
      }
    }
  } catch {
    Write-Error $_
    $agfExit = 1
    if ($agfDestination -and (Test-Path -LiteralPath $agfDestination -PathType Container)) {
      Write-Output ""
      Write-Output ("Set-Location -LiteralPath '" + $agfDestination.Replace("'", "''") + "'")
      if ($agfLines.Length -gt 1 -and $agfLines[1]) { Write-Output ""; Write-Output $agfLines[1] }
    }
  } finally {
    $env:AGF_CD_FILE = $agfPreviousChannel
    $env:AGF_CD_HINT = $agfPreviousHint
    if ($env:OS -eq 'Windows_NT') {
      [System.IO.File]::Delete($agfChannel)
    } elseif (Get-Command trash -ErrorAction SilentlyContinue) {
      & trash $agfChannel
    } else {
      Write-Warning "agf: retained temporary channel $agfChannel (trash unavailable)"
    }
    $global:LASTEXITCODE = $agfExit
  }
}
`
  throw Error('Usage: agf shell <zsh|bash|powershell>')
}

module.exports = { channel, destination, binding, quote, psQuote }
