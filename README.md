# aglite v0.3.1

**English** · [繁體中文](README.zh-tw.md)

Give your coding assistant a project notebook so a fresh session can resume your work. aglite keeps requests, decisions, evidence and results in readable files, with proportionate plans, optional advisors and result review.

The ordinary workflow follows host-agent Markdown instructions. Optional [looper](skills/aglite/references/looper.md) adds an explicitly authorized Node.js coordinator for independent task groups; no hooks or publisher are included. Aglite is the development beta name for the forthcoming Agentflow 9.

Looper routes and limits live in `ag.json`; queues retain instructions/progress and actual attempt selections as evidence.

Task/repair reuse `implementation`; review/renewed acceptance reuse `acceptance`. Configure the empty bundled routes before running; see [looper settings](skills/aglite/references/configuration.md#looper-settings).

Optional [brownfield guidance](skills/aglite/references/browfield.md) provides an eight-step procedure for authorized features in unfamiliar existing code. Use `browfield <task>`, ask for the eight-step procedure, or let the host select it for a named material discovery/regression-protection need; an existing repository alone does not activate it. It follows ordinary aglite modes, gates and records and reuses advisor methods as needed. No separate skill installation is required.

## Optional parallel groups

[Looper](skills/aglite/references/looper.md) runs ready groups in parallel, with fresh ordinary task workers running sequentially within each group. Use `prepare-tasks <request>` to prepare `queue.json`, `planned/request.md` and `planned/group-NNN.md`, then stop; `run-tasks` executes the Current-linked queue, and `handle-tasks <request>` combines both. The host derives technical inputs from your outcomes and repository evidence.

Default concurrency is 3 groups and repair budget is 2. Ready groups enter one FIFO integration lane; clean checked merges add no agents, while repairs retain review and acceptance. Ordinary workflow/review settings remain.

Optional `depends_on` lists earlier groups; downstream work starts after their checked integrations, with their files visible. Waiting uses no task slot; started worktrees keep their bases.


Native dispatch needs the live host; CLI task sessions support Codex/Claude.

Questions block their group while independent groups continue; answer the host to resume.

Group records stay isolated from product integration.

Install the zero-dependency launcher with `npm install -g <resolved-skill>`.

The host starts `agf loop run [run-root]`; `agf loop status [run-root]` reads saved progress/questions.

Shell root defaults to cwd and missing queue errors; chat `run-tasks` resolves Current instead.

Recovery preserves work and reconciles old writers/Git effects.

No daemon, separate promotion, cleanup, push or release authority follows. Read the execution contract before running.

## Install

Use an assistant with file and command tools. The [Skills CLI](https://github.com/vercel-labs/skills) can install for Codex, Claude Code and other hosts:

```sh
npx skills add agfnow/aglite --skill aglite
```

Choose your assistant and project/global scope. Node.js is required by that installer and optional looper; ordinary notebook work does not require it. Git is needed for versioned delivery and feature worktrees; ordinary notebook work can use an existing folder without Git.

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

Disabling the plugin leaves its files and notebook history intact. It does not disable a separate manually installed Agentflow skill or change project instructions that still require Agentflow. Inspect those before using aglite in an existing project; no automatic migration of Agentflow configuration/history or backward compatibility is provided. Keep the old records and explicitly select the notebook to continue. Use one aglite installation route per host.

## Everyday use

[Command and settings cheatsheet](skills/aglite/docs/CHEATSHEET.md)

- `godev` activates the workflow or resumes unfinished work. A verified Git repo with no selected notebook, configured ag-dir, history or prior retirement initializes proactively, even without a task; off-record and feature rules prevail. Other bare idle activation asks for the next request without writes.

- Read results in the notebook named by the final receipt. By default, chat ends with `Updated: A-NNN | <notebook>` followed by the working directory on the next line; set `inline-reply` to `on` for the saved answer in chat.

- `fast-lane [task]` keeps one task with the host and skips advisors, new design/tracker, ordinary separate review and routine RUN/WIP. Host review, necessary checks and explicit checkpoints remain.

- `advisors: requirements, codewalk` selects optional reasoning roles. The host loads only relevant prompts; advisors grant no new implementation authority.

- `3ways` selects Claude-led planning with complete context and approved source/prior-plan read access; Codex challenges/reviews, and only proved high-confidence defects displace Claude’s main plan. It grants no implementation authority. Result review follows `review-order`; required independence still needs separate tools.

- Unquoted `nolog:`, `noop:`, `off:` or `skip:` makes that exchange off-record; the next unmarked message resumes recording.

Current configuration uses JSON integer `schema-version: 9`; configuration schema is independent of the package version. Known predecessor settings migrate on each host read, preserving valid owner values and unknown/comment fields. Unknown/newer schemas or ambiguous/lossy changes need a decision. Missing keys follow current defaults. See [migration](skills/aglite/references/configuration.md#automatic-migration).

Planning defaults to `external`, with downward fallback `external → native → host`; explicit `3ways` starts one level above. Invalid settings and explicit constraints remain blockers. Release checks use `ag.json` `next_update_date` (UTC date), querying only Agentflow when due and scheduling two days ahead after each attempt. Aglite is the beta name for Agentflow 9; 8.x is not an upgrade. Replacement needs approval and preserves WIP. See [release checks](skills/aglite/references/configuration.md#session-release-check).

Already-needed planning, including task grouping and planning advice, follows `plan-order: external` by default.

Choices degrade on recorded unavailability: `3ways` (Claude plan/Codex challenge) → `external` (Claude CLI plan) → `native` (fresh native planner) → `host` (active host, no probes).

Prefer Claude where that route supports it; label other authorship and incomplete challenges honestly. Invalid selected settings and explicit provider/model/effort/independence/read-only constraints still block incompatible fallback. No extra plan or stage follows from a setting.

Defaults include automatic commits/pushes when applicable and notebook ownership for actual work. `review-order: external` (default) tries counterpart CLI → fresh-context native → labelled host fallback; `native` reverses the separate routes; `host` uses host directly without worker probes.

For an already-required separate review with a known principal planner, the host prefers a different model family, then another supported configured model, before ordinary route/tier defaults; task-level hard constraints still prevail. Same-family/model review remains allowed with the limitation disclosed. See [planner diversity](skills/aglite/references/review.md#inspect-the-finished-result).

Stop at the first usable permitted route; record availability failures before fallback. Invalid or unsupported selected model/effort requires a decision.

Required independence (including the skill’s unwaived risk-boundary rule) and explicit review requirements prevail over every order; same-message/later explicit requests prevail over the `skip-review` command; incompatible fallback stays pending.

`skip-review [task]` selects host review for one task, waiving ordinary separate review including the skill’s risk-boundary requirement, while retaining other steps/settings. It replaces earlier owner review requests for the same work; same-message/later explicit review requirements prevail. It persists through follow-ups/resume and expires at completion; it is a command, not a configuration switch. Tell the assistant when you want local changes only. Controls and gates come from project `ag.json`; ideas alone do not authorize implementation, publishing or deletion.

## Updates and limits

For a Skills CLI installation, update by installed name, using `-g` for global scope or `-p` for project scope:

```sh
npx skills update aglite
```

Plugin installations follow Claude Code's marketplace/plugin update controls. Maintainer symlinks instead follow their local source checkout.

Ordinary notebook work depends on the host following its instructions. Optional looper can continue selected CLI work while its coordinator runs; native dispatch still requires the live host.

Cooperating sessions use ownership markers, and conflicting claims require an explicit handoff. Missing required tools or checks remain unresolved. No broad host/platform compatibility claim is implied.

Read the [everyday guide](skills/aglite/docs/AG_GUIDE.md), [繁體中文指南](skills/aglite/docs/AG_GUIDE.zh-tw.md), [configuration reference](skills/aglite/references/configuration.md) and [changelog](CHANGELOG.md).