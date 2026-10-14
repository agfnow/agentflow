# aglite v0.3.0

**English** · [繁體中文](README.zh-tw.md)

Give your coding assistant a project notebook so a fresh session can resume your work. aglite keeps requests, decisions, evidence and results in readable files, with proportionate plans, optional advisors and result review.

The host agent follows Markdown instructions directly. The package has no hooks, runners or executable helpers. It is a separate project from Agentflow.

## Install

Use an assistant with file and command tools. The [Skills CLI](https://github.com/vercel-labs/skills) can install for Codex, Claude Code and other hosts:

```sh
npx skills add agfnow/aglite --skill aglite
```

Choose your assistant and project/global scope. Node.js is required by that installer, not by the aglite workflow. Git is needed for versioned delivery and feature worktrees; ordinary notebook work can use an existing folder without Git.

For the Claude Code plugin route, use its [marketplace commands](https://code.claude.com/docs/en/discover-plugins):

```text
/plugin marketplace add agfnow/aglite
/plugin install aglite@aglite
```

Start a new assistant session after installation or updates. Install through one route per host to avoid duplicate discovery. Then send:

```text
godev
Improve the welcome page. Keep its links; let me review before publishing.
```

## Switch from Agentflow in Claude Code

Finish or checkpoint active Agentflow work first. In Claude Code, run:

```text
/plugin disable agentflow@agentflow
/plugin marketplace add agfnow/aglite
/plugin install aglite@aglite
```

Open `/plugin` → Installed to confirm Agentflow is disabled and aglite is enabled at the intended scope, then start a new session. Plugin installation defaults to user scope; project/local settings can override it. For a specific scope, use shell commands such as `claude plugin disable agentflow@agentflow --scope user` and `claude plugin install aglite@aglite --scope user`, substituting `project` or `local` where needed. See [plugin scopes](https://code.claude.com/docs/en/discover-plugins#choose-an-install-scope).

Disabling the plugin leaves its files and notebook history intact. It does not disable a separate manually installed Agentflow skill or change project instructions that still require Agentflow. Inspect those before using aglite in an existing project; no automatic configuration/history migration or backward compatibility is provided. Keep the old records and explicitly select the notebook to continue. Use one aglite installation route per host.

## Everyday use

[Command and settings cheatsheet](skills/aglite/docs/CHEATSHEET.md)

- `godev` activates the workflow or resumes unfinished work. A verified Git repo with no selected notebook, configured ag-dir, history or prior retirement initializes proactively, even without a task; off-record and feature rules prevail. Other bare idle activation asks for the next request without writes.

- Read results in the notebook named by the final receipt. By default, chat ends with `Updated: A-NNN | <notebook>` followed by the working directory on the next line; set `inline-reply` to `on` for the saved answer in chat.

- `fast-lane [task]` keeps one task with the host and skips advisors, new design/tracker, ordinary separate review and routine RUN/WIP. Host review, necessary checks and explicit checkpoints remain.

- `advisors: requirements, codewalk` selects optional reasoning roles. The host loads only relevant prompts; advisors grant no new implementation authority.

- `3ways` requests a challenge to the approach before implementation. Result review follows `review-order`; explicitly required independent review needs usable separate-agent tools.

- Unquoted `nolog:`, `noop:`, `off:` or `skip:` makes that exchange off-record; the next unmarked message resumes recording.

Defaults include automatic commits/pushes when applicable and notebook ownership for actual work. `review-order: external-first` (default) tries counterpart CLI → fresh-context native → labelled host fallback; `native-first` reverses the separate routes; `host-only` uses host directly without worker probes. Stop at the first usable permitted route; record availability failures before fallback. Invalid or unsupported selected model/effort requires a decision. Required independence (including the skill’s unwaived risk-boundary rule) and explicit review requirements prevail over every order; same-message/later explicit requests prevail over the `skip-review` command; incompatible fallback stays pending. `skip-review [task]` selects host review for one task, waiving ordinary separate review including the skill’s risk-boundary requirement, while retaining other steps/settings. It replaces earlier owner review requests for the same work; same-message/later explicit review requirements prevail. It persists through follow-ups/resume and expires at completion; it is a command, not a configuration switch. Tell the assistant when you want local changes only. Controls and gates come from project `ag.json`; ideas alone do not authorize implementation, publishing or deletion.

## Updates and limits

For a Skills CLI installation, update by installed name, using `-g` for global scope or `-p` for project scope:

```sh
npx skills update aglite
```

Plugin installations follow Claude Code's marketplace/plugin update controls. Maintainer symlinks instead follow their local source checkout.

aglite depends on the host following its instructions; it does not enforce completion or run an unattended scheduler. Cooperating sessions use ownership markers, and conflicting claims require an explicit handoff. Missing required tools or checks remain unresolved. No broad host/platform compatibility claim is implied.

Read the [everyday guide](skills/aglite/docs/AG_GUIDE.md), [繁體中文指南](skills/aglite/docs/AG_GUIDE.zh-tw.md), [configuration reference](skills/aglite/references/configuration.md) and [changelog](CHANGELOG.md).
