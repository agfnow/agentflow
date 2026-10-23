# Agentflow v9.0.0

**English** · [繁體中文](README.zh-tw.md)

Give your coding assistant a project notebook. It saves your requests, decisions and answers so another session can pick up unfinished work.

This is stable Agentflow 9. Version 8 remains available at [agfnow/agentflow-v8](https://github.com/agfnow/agentflow-v8); use `npx skills add agfnow/agentflow-v8 --skill agentflow` to choose v8 explicitly. Version 9 replaces the ordinary helper/hook runtime with host instructions; read the [v8 comparison](skills/agentflow/docs/agv8-aglite-comparison.md) before upgrading.

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

- Use `grill-me <topic>` for an interview, `3ways <request>` for Claude-led planning with a Codex challenge, or `advisors: <names>` for focused advice. A plan or suggestion does not approve implementation.

- Include unquoted `nolog:`, `noop:`, `off:` or `skip:` to keep one exchange off-record. The requested work still executes; an off-record append request is neither staged nor executed.

The [everyday guide](skills/agentflow/docs/AG-GUIDE.md) explains the choices. The [cheatsheet](skills/agentflow/docs/CHEATSHEET.md) lists every command, advisor, setting and default.

## Work beside main

`new-feature <name>` prepares an isolated Git worktree. Follow the returned handoff before implementing there.

`merge-feature <name>` verifies and integrates finished work, retaining its branch and checkout unless you add “and cleanup.” `drop-feature <name>` abandons the inspected feature using recoverable cleanup.

Creation and merge use feature records; drop reports in chat. All three avoid main’s root notebook and claim.

Real Git conflicts and another session’s target-feature claim still matter.

See [feature workflows](skills/agentflow/references/features.md) for exact handoffs and recovery. Git is required for these operations.

## Optional grouped execution

Give the host a work list with outcomes and examples. `prepare-tasks <request>` groups the work and saves a linked queue, then stops for inspection.

`run-tasks` executes or resumes that queue. `handle-tasks <request>` combines preparation and execution.

Groups use separate worktrees, and each task runs in a fresh session. Earlier-group dependencies wait for checked integration; ready groups merge through one serial lane.

Configure routes first: the bundled routes are empty. Settings live in `ag.json`, including concurrency (default 3) and repair budget (default 2); queues keep progress and immutable attempt evidence.

Prefer CLI task routes when choosing a route. An explicit native route needs the live host; closing it never silently selects CLI instead.

The optional looper needs Node.js 20+ and Git. To register its zero-dependency shell launcher, run `npm install -g <resolved-skill>`, then use `agf loop run [run-root]` or `agf loop status [run-root]`.

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

Project settings live at `<checkout>/<ag-dir>/ag.json`; `.agentflow` is the default directory. Configuration schema 13 is separate from package version 9.0.0.

Use `use-lang` for new human-facing text, `plan-mode` for document creation, and `plan-order`/`review-order` for already-needed planning and review. Missing or unsupported selected controls block rather than silently changing the model.

`auto-commit` and `auto-push` default on. Check them before starting if you want local edits only; they grant no publication or deployment authority.

Release lookups consult the Agentflow stable feed on their scheduled date. Agentflow 8.x is not an upgrade for v9 or the earlier aglite beta; installation replacement still needs approval.

The workflow relies on the host following its instructions. Native Windows, editor and provider behavior require their own evidence; a successful CLI or another platform’s test proves only that surface.

Read the [English guide](skills/agentflow/docs/AG-GUIDE.md), [繁體中文指南](skills/agentflow/docs/AG-GUIDE.tw.md), [cheatsheet](skills/agentflow/docs/CHEATSHEET.md), [Copilot selection](skills/agentflow/docs/CHEATSHEET.md#copilot-selection) and [changelog](CHANGELOG.md) for details.
