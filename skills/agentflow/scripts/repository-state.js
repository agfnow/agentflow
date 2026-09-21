'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const present = file => {
  try { fs.lstatSync(file); return true; }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
};

// A failed Git command is not proof of a plain folder. Inspect ancestors too:
// callers may be below a checkout root, and worktrees use a .git file.
const has_metadata = root => {
  for (let directory = root; ; directory = path.dirname(directory)) {
    if (present(path.join(directory, '.git')) || ['HEAD', 'objects', 'refs'].every(name => present(path.join(directory, name)))) return true;
    if (path.dirname(directory) === directory) return false;
  }
};

const detect = project_root => {
  try {
    const root = fs.realpathSync(project_root);
    const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4096,
      env: { ...process.env, LC_ALL: 'C' },
    });
    if (result.status === 0 && result.stdout.trim()) {
      // An unborn repository is still Git-backed; HEAD is not the discriminator.
      return { state: 'git', root: fs.realpathSync(result.stdout.trim()) };
    }
    const missing = result.error?.code === 'ENOENT';
    const not_repository = !result.error && result.status === 128 && /^fatal: not a git repository\b/u.test(result.stderr);
    if ((missing || not_repository) && !process.env.GIT_DIR && !process.env.GIT_WORK_TREE && !has_metadata(root)) {
      return { state: 'plain', root, reason: missing ? 'git_not_installed' : 'not_a_repository' };
    }
    return { state: 'error', detail: 'Cannot determine repository state safely; check Git availability, repository metadata, permissions, and Git environment overrides before retrying.' };
  } catch {
    return { state: 'error', detail: 'Cannot inspect the project or its ancestors; check the path and permissions before retrying.' };
  }
};

module.exports = { detect };
