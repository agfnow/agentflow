# Agentflow v9.1.2

**English** · [繁體中文](README.zh-tw.md)

Give your coding assistant a project notebook. It saves your requests, decisions and answers so another session can pick up unfinished work.

This is stable Agentflow 9. Version 8 remains available at [agfnow/agentflow-v8](https://github.com/agfnow/agentflow-v8); use `npx skills add agfnow/agentflow-v8 --skill agentflow` to choose v8 explicitly. Version 9 replaces the ordinary helper/hook runtime with host instructions; read the [v8 comparison](skills/agentflow/docs/agv8-agv9-comparison.md) before upgrading.

## Install

Use an assistant that can read and edit files and run commands. Choose one installation route per host to avoid loading duplicate copies.

With the [Skills CLI](https://github.com/vercel-labs/skills), run:

```sh
npx skills add agfnow/agentflow --skill agentflow
```

Choose your assistant when prompted. Installation defaults to this project; add `-g` for global scope.

The [Skills CLI installer](https://github.com/vercel-labs/skills#install-a-skill) requires Node.js 22.20 or later. Ordinary notebook work has no agentflow runtime to install.

For the [Claude Code plugin route](https://code.claude.com/docs/en/discover-plugins), enter these commands in Claude Code:

```text
/plugin marketplace add agfnow/agentflow
/plugin install agentflow@agentflow
```

Open a new assistant session after installation or an update. Your host must support and honor skill instructions; installing files alone does not prove automatic loading on every host.

## Start with one task

Open your project and send:

```text
godev Improve the welcome page. Keep its links and let me review before publishing.
```

You can also run `agf init [--lang en-US]` in the target directory to create Git and an editable Agentflow notebook without model calls. Requires Node 20+, Git and a working commit identity; English and Traditional Chinese are supported; bare `zh` is preserved and uses Traditional Chinese; other Chinese locale variants use Traditional Chinese and save `zh-tw`; other valid locales automatically use English and save `use-lang: en-us` for subsequent work. Complete existing projects skip unchanged; partial/conflicting state stops. It commits only setup changes with Git hooks suppressed, without push or shell installation.

Missing Codex/Claude leaves looper routes empty until configured; ordinary host work still runs. See [first setup](skills/agentflow/docs/AG-GUIDE.md#finish-your-first-task).

On first use, agentflow creates the missing settings and records. It preserves existing files and asks before initializing Git in a non-Git folder.

Eligible setup in a repository with no commits creates one empty bootstrap, preserving staged/untracked contents. Explicit commit prohibitions prevail; bootstrap alone grants no push. The [guide](skills/agentflow/docs/AG-GUIDE.md#finish-your-first-task) explains first-delivery exclusions and failure handling.

Setup also adds missing root `AGENTS.md` instructions for the owner-facing agent to load agentflow in later sessions. Your existing rules stay intact; delegated workers keep their bounded assignment.

Next time, open the same project and send `godev`. The agent resumes unfinished work, waits at an actual approval or asks for your next request when idle.

By default, complete answers are saved in the notebook. Chat ends with a receipt such as:

```text
→ Updated: A-001 | .agentflow/example.devlog.md
  (/path/to/example)
```

Open that file to read the answer. Set `inline-reply: on` for full saved answers in chat, or explicitly request a particular answer there. Human labels and receipts follow `use-lang`.

## Everyday choices

- Send an ordinary follow-up to steer the current task.

- Start a message with `append-rounds <work>` or its exact alias `append-tasks <work>` to save a later batch. Each batch gets its own Ask/Reply round after current work and delivery finish.

- Use `fast-lane <task>` for direct host work, or `skip-review <task>` for host review. Required checks and explicit approvals still apply.

- Use `grill-me <topic>` for an interview, `3ways <request>` for blind independent Claude/Codex drafts, reciprocal debate and Codex’s final synthesis/technical decisions (record dissent; claim consensus only on exact dual acceptance), or `advisors: <names>` for focused advice. A plan or suggestion does not approve implementation.

- Include unquoted `nolog:`, `noop:`, `off:` or `skip:` to keep one exchange off-record. The requested work still executes; an off-record append request is neither staged nor executed.

The [everyday guide](skills/agentflow/docs/AG-GUIDE.md) explains the choices. The [cheatsheet](skills/agentflow/docs/CHEATSHEET.md) lists every command, advisor, setting and default.

## Work beside main

`new-feature <name>` prepares an isolated Git worktree. Follow the returned handoff before implementing there.

`merge-feature <name>` verifies and integrates finished work, retaining its branch and checkout unless you add “and cleanup.” `drop-feature <name>` abandons the inspected feature using recoverable cleanup.

Creation and merge use feature records; drop reports in chat. All three avoid main’s root notebook and claim.

Real Git conflicts and another session’s target-feature claim still matter.

See [feature workflows](skills/agentflow/references/features.md) for exact handoffs and recovery. Git is required for these operations.

## Terminal feature CLI

Use the terminal feature CLI when you want to work directly in your shell. It needs Node.js 20+ and Git (2.38+ for merge using `merge-tree --write-tree`), plus one current canonical project configuration; migration or ambiguous configuration stops for the host. These commands do not access main's root notebook, archive or claim.

Main’s final files may exclude a root notebook while the original feature commits still retain it in history. Automatic push stops if unpublished feature history contains protected root records; the owner decides how to handle that history. The CLI preserves the original parents.

If a private inherited configuration differs from main, the CLI stops for a host decision and preserves main’s private copy.

Notebook-writing CLI supports English and Traditional Chinese; unsupported locales stop before mutation for host rendering. Raw terminal diagnostics may be English.

- `agf drop-feature [name] [--abandon]` (alias `dropft`) removes an already merged feature only when it has no tracked, untracked or ignored local data. Add `--abandon` to deliberately discard dirty or unmerged contents. Target claims and Git locks still block removal.

  For retained CLI merge bookkeeping, follow the `agf merge-feature <name> --cleanup` continuation; other local data still needs resolution.

- `agf merge-feature [name] [--cleanup] [--check '<JSON argv>'] [--include <checkout-relative-path>]` (alias `mergeft`) integrates feature work while preserving unrelated main files/staging and excluding root records. The checkout/branch stay unless `--cleanup` is supplied. Repeat `--check` for literal argv checks, for example `--check '["node","--test"]'`; no shell evaluates them. Without explicit checks, the CLI uses merged candidate’s root package.json test when available; without either, it merges and explicitly reports no repository checks configured. Selected checks run on candidate and integrated main; failures still block completion.

  Repeat `--include <checkout-relative-path>` to authorize committing only named dirty task files plus feature records. Dirty product files without this authority stop with an `--include` continuation; unrelated files/index entries remain untouched, with no all-files sweep.

- `agf new-feature <name> [--open]` (alias `newft`) creates the managed checkout and feature notebook from committed main, preserving main's uncommitted work. Exact open preparation can resume without duplicate history. `--open` opens that notebook; editor failure warns while retaining the successful feature.

  Set top-level `ag.json` `default-editor` (default `"vscode"`, launched as `code`) to an executable name or path; it receives the notebook as one literal argument with terminal IO inherited.

  Relative editor paths resolve from the feature checkout; review repository settings before using `--open`.

- `agf shell <zsh|bash|powershell>` prints a caller-directory function for review/copy; it never installs or upgrades a binding.

Merge/drop may omit the name only inside their own registered managed feature. Claims never transfer automatically because a process is dead or a marker is old. Retired features cannot resume development. Failed or uncertain effects retain recovery information; inspect it and follow the exact next action rather than repeating destructive steps.

Actual merge conflicts use Codex in a separate candidate checkout. `workspace-write` limits writes; it does not provide OS read isolation, and broader reads remain possible. Root records are excluded from the workspace and outside access is forbidden by instructions; main is not thereby unreadable.

The CLI independently checks changed paths, unresolved entries and required tests before integration. Missing approval gates or owner decisions stop for host continuation; process success alone proves no correct merge.

The operator chooses required checks. Candidate checks run in a separate checkout containing tracked files, without installed dependencies; where appropriate use `--check '["npm","ci"]' --check '["npm","test"]'` in that order. Each selected check and conflict resolution has a 10-minute limit; timeout blocks completion and retains recovery state. Changed Gitlinks stop before effects for host continuation.

`auto-commit` and `auto-push` default on: merge can commit and push MAIN. No remotes skips pushing; a sole remote works, while ambiguous remote selection stops. This grants no release authority.

A definite settled check/resolver failure before integration may be explicitly renewed after fixes. Unknown, unsettled or partial main effects require host reconciliation, with no implicit retry loop. On Windows, `--open` needs a directly executable editor; the default may warn because of `code.cmd` launch limits; the successfully created feature remains usable.

For automatic caller-directory switching, review the function printed by `agf shell <zsh|bash|powershell>`. Eligible first setup adds a missing binding; an existing binding requires an explicit upgrade request. See [shell setup](skills/agentflow/references/setup.md#agf-command-setup). The function keeps ordinary output visible and reads only a separate successful destination file.

Creation and drop results have blank lines between output blocks. After successful creation and directory switching, the current generated function suggests opening your coding agent there; it omits the `cd` instruction. Existing bindings retain the continuation until explicitly upgraded.

Direct Node/package-bin use prints one quoted `cd` command and suggests opening the agent after switching; a terminal workflow needs no coding-agent `/cd`.

macOS is primary and cleanup uses verified recoverable Trash. Windows is best effort: explicit feature cleanup/drop may permanently delete the exact target; necessary feature CLI bookkeeping may also dispose of exact UUID-owned claims and destination files, never foreign claims or other files, and native behavior remains untested without Windows evidence.

Linux may refuse before any work when recoverable disposal of owned claims is unavailable, as well as refuse cleanup. These exceptions apply only to this feature CLI, not host chat or looper cleanup. See the [complete feature contract](skills/agentflow/references/features.md#terminal-cli).

## Optional grouped execution

Give the host a work list with outcomes and examples. `prepare-tasks <request>` groups the work and saves a linked queue, then stops for inspection.

The saved preparation result offers two choices: terminal `agf looper status <run-root>` then `agf looper run <run-root>`, or chat `run-tasks`; it substitutes the actual run-root.

`run-tasks` executes or resumes that queue. `handle-tasks <request>` combines preparation and execution.

Groups use separate worktrees, and each task runs in a fresh session. Earlier-group dependencies wait for checked integration; ready groups merge through one serial lane.

New configurations detect supported Codex/Claude CLIs and fill all three routes, preferring Codex when both exist. Existing settings stay unchanged; configure missing routes before running. Settings live in `ag.json`, including concurrency (default 3) and repair budget (default 2); queues keep progress and immutable attempt evidence.

Prefer CLI task routes when choosing a route. An explicit native route needs the live host; closing it never silently selects CLI instead.

The optional looper needs Node.js 20+ and Git. To register its zero-dependency shell launcher, run `npm install -g <resolved-skill>`, then use `agf looper run [run-root]` or `agf looper status [run-root]`.

`run` streams progress to stderr and prints the final outcome to stdout: exit 0 means complete, 2 blocked/stopped, 1 error. Saved-state runs save latest `<run-root>/results.md` with navigation and a historical `evidence/run-<time>-<UUID>.txt` summary with outputs, blockers and next steps; `status` reads current state without changing it. See the [progress and results contract](skills/agentflow/references/looper.md#progress-and-results).

Reports are derived and may lag a running queue; foreign or edited `results.md` is preserved with a warning. Rerun alone does not reopen a blocked group: have the host diagnose, supply actual answers or technical corrections, then resume the same queue. See [operator recovery](skills/agentflow/docs/AG-GUIDE.md#read-results-and-resume-a-failed-group).

Sections and progress events have blank lines. Timestamped progress has two columns: the timestamp, then the message. Wrapped text and reviewer details align in the message column; terminal wrapping follows its current width. Pipes keep full hanging logical lines; status and saved reports preserve complete commands and paths.

Opt in with `agf looper cleanup <run-root>` afterward, or add `--cleanup` to `agf looper run`.

Cleanup requires completed, settled work. Outputs, branches and queue/request/group plans stay; reports (including `results.md`), answers, task records and other run-root extras move to recoverable Trash. Avoid cleanup to retain full history.

Cleanup currently requires macOS and accessible same-volume Trash. Task success plus cleanup failure exits 1; resolve the blocker and retry the manual command. Default, blocked and stopped runs retain scratch; see [cleanup safety](skills/agentflow/references/looper.md#explicit-cleanup).

CLI tasks obtain their ordinary independent review through a coordinator relay that preserves the task sandbox and configured fresh reviewer. Blocked results include worker evidence and attempt paths; failed execution/result parsing retains `failure.json` beside the transcript.

Questions pause their group while independent groups continue. Retained worktrees and evidence support recovery; cleanup, push and release still need their own authority.

See the [looper contract](skills/agentflow/references/looper.md) and [settings](skills/agentflow/references/looper.md#looper-settings) before running.

## Upgrade an Agentflow project

Finish or safely hand off active old workers, streams and queues first. Keep their records; old queue files cannot become new looper jobs by renaming them.

When the host encounters a recognized Agentflow 8 project, it loads a separate migration procedure. Safe cases upgrade automatically to schema 13; unsupported restrictions, old consequential-only approval rules or ambiguous ownership wait for a specific decision.

Migration updates project configuration and STATUS, retires confirmed old project hooks/startup units, and retains private recoverable originals. Conversation history and unrelated settings survive.

Known agentflow schemas9/10/11/12 also migrate. The required `saving-mode` is added as `off` when missing; an existing valid value stays unchanged.

In particular, `skip-wip: off` becomes `omit-wip: off`, preserving its meaning.

Shared/global integrations require their own scope authority. Restart the host when old hooks were already loaded, and read the saved result before continuing.

See [migration steps](skills/agentflow/docs/AG-GUIDE.md#migration-and-installation) and the [migration prompt](skills/agentflow/references/legacy-migration.md). This is project-format migration; replacing an installed skill remains a separate explicit action.

### Switch Claude Code from the old plugin

Version 8 and v9 share `agentflow@agentflow`; a cached marketplace can still point to v8. Inspect `/plugin` → Installed and your marketplace sources first. To deliberately replace a user-scope v8 plugin with v9, use the Claude Code CLI:

```sh
claude plugin uninstall agentflow@agentflow --scope user
claude plugin marketplace remove agentflow
claude plugin marketplace add agfnow/agentflow
claude plugin install agentflow@agentflow --scope user
```

Use the actual `project` or `local` scope when appropriate. For the earlier beta, disable `aglite@aglite` at its installed scope before enabling v9. Open a new session afterward; this release does not replace any installed copy automatically.

Both v8 and v9 also use the skill name `agentflow` and project directory `.agentflow/`. Choose one active version per host/project. To stay on v8, explicitly reinstall/rebind from `agfnow/agentflow-v8` before using an updater that still records the old source URL. Keep existing work and hooks until the guarded project migration has settled them; do not load both versions for the same project.

## Configuration and limits

Project settings live at `<checkout>/<ag-dir>/ag.json`; `.agentflow` is the default directory. Configuration schema 13 is separate from package version 9.1.2.

Use `use-lang` for new human-facing text, `plan-mode` for document creation, and `plan-order`/`review-order` for already-needed planning and review. Ordinary planning prefers a Claude draft followed by Codex challenge, correction and final synthesis within supported route controls. Missing or unsupported selected controls block rather than silently changing the model.

`auto-commit` and `auto-push` default on. Check them before starting if you want local edits only; they grant no publication or deployment authority.

Release lookups consult the Agentflow stable feed on their scheduled date. Agentflow 8.x is not an upgrade for v9 or the earlier aglite beta; installation replacement still needs approval.

The workflow relies on the host following its instructions. Native Windows, editor and provider behavior require their own evidence; a successful CLI or another platform’s test proves only that surface.

Read the [English guide](skills/agentflow/docs/AG-GUIDE.md), [繁體中文指南](skills/agentflow/docs/AG-GUIDE.tw.md), [cheatsheet](skills/agentflow/docs/CHEATSHEET.md), [Copilot selection](skills/agentflow/docs/CHEATSHEET.md#copilot-selection) and [changelog](CHANGELOG.md) for details.
