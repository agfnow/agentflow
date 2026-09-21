'use strict'

// The reader returns stdout on success (including an empty string), or null.
// Selection is read-only and offline; callers retain their own Git runner.
const resolve_default_branch = read => {
  const valid_name = name => name && !name.startsWith('-') && !name.startsWith('refs/')
    && read(['check-ref-format', `refs/heads/${name}`]) !== null
  const local = name => read(['show-ref', '--verify', '--quiet', `refs/heads/${name}`]) !== null
  const configured = read(['config', '--get', 'agentflow.default-branch'])
  if (configured !== null) {
    const branch = configured.trim()
    if (!valid_name(branch) || !local(branch)) {
      return { branch: '', source: 'config', error: 'agentflow.default-branch must name an existing local branch; set it with git config --local agentflow.default-branch <branch>, or remove it with git config --local --unset agentflow.default-branch' }
    }
    return { branch, source: 'config', error: '' }
  }
  const head = read(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
  const prefix = 'refs/remotes/origin/'
  const remote = head?.trim().startsWith(prefix) ? head.trim().slice(prefix.length) : ''
  if (valid_name(remote)) return { branch: remote, source: 'origin/HEAD', error: '' }
  const branch = ['main', 'master'].find(local) || ''
  return { branch, source: branch ? 'compatibility' : 'unknown', error: '' }
}

module.exports = { resolve_default_branch }
