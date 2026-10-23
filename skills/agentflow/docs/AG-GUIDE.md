# Agentflow 9.0.0 — everyday guide

English · [繁體中文](AG-GUIDE.tw.md)

Agentflow keeps your request, decisions and answer in your project, with enough recovery notes to resume in another session. Give the agent a goal, examples of success and anything it must preserve.

The stable Agentflow 9 skill is named `agentflow`. This guide explains everyday use; the [cheatsheet](CHEATSHEET.md) lists every command, advisor and setting.

## Finish your first task

Install agentflow using the [package README](https://github.com/agfnow/agentflow#install), then open your coding agent in the project and load the skill. Installation and project setup are separate steps.

Send one concrete request:

```text
godev fix the installation link in README.md and check the example against the current files.
```

The agent you are speaking to is the host. It understands the request, coordinates any workers, checks the result and saves the answer. Small tasks usually need only the development notebook, called the devlog; larger work may need a design and tracker.

First setup creates missing settings and records while preserving existing files. It adds missing root `AGENTS.md` instructions so the host can load agentflow in later sessions; delegated workers follow their bounded assignment without starting another workflow.

Your coding agent must support and honor that instruction. If loading does not happen, load the skill and send `godev` yourself. A missing skill is reported, never installed silently.

Git is optional. In a folder without Git, the host asks before setup writes whether you want a repository; no answer means wait, and declining continues without Git.

If you approve Git initialization, or eligible first setup finds an existing repository with no commits, the host creates one empty first commit. Explicit `new-feature` preparation can do the same when main has no commits.

This bootstrap works even with `auto-commit: off`, unless commits are explicitly forbidden. It preserves staged and untracked files; first delivery includes only verified task/setup changes, leaving unrelated pre-existing contents out unless you authorize their inclusion.

Existing HEAD is reused. Other refs or an unsafe Git state stop bootstrap; a failed commit preserves the partial state and stops setup or feature preparation. A commit prohibition permits setup without the bootstrap, but feature worktrees still need a commit. Bootstrap alone grants no push or publication authority.

If setup began without a task, the host asks for your next request when finished. See [agent setup rules](../references/setup.md#first-time-setup) for exact eligibility and recovery.

## Resume unfinished work

Open the same project and send `godev`. The host reads the active request, saved questions and linked recovery notes, then checks live files and operations before continuing.

You can answer in chat or in the saved question's `ans:` field. Empty answers, suggested defaults and elapsed time never count as approval.

Missing or mismatched records are reported rather than accepted as proof. With no unfinished work, the host asks for your next request; idle activation does not schedule backlog work or add records.

Notebook ownership prevents cooperating sessions from writing the same notebook together. Another session's claim requires a handoff; age or silence does not authorize taking it over.

See the [agent recovery and ownership rules](../references/session.md#activate-and-recover).

## Find your answer and records

The default record directory is `.agentflow/`; `ag-dir` can select another safe project-relative path. New notebooks normally use the checkout folder's short name: folder `a002` produces `.agentflow/a002.devlog.md`. Existing names and history are preserved.

Each round has an **Ask**, **Reply** and identifier such as `A-001`. The opening **STATUS** points to unfinished work through **Current**. You can write the next request in the next Ask, then activate it.

With the default `inline-reply: off`, the full answer stays in Reply and chat ends with a receipt:

```text
→ Updated: A-001 | .agentflow/a002.devlog.md
  (~/project/a002)
```

Open that notebook to read the answer. Set `inline-reply: on` for full chat answers, or explicitly request this answer in chat or the terminal. Discussing future output or saying “show me” alone does not change the destination.

Necessary notices, blockers and actual feature handoffs still appear in chat. Human labels, including the receipt, follow the configured language.

A design explains intended behavior, preserved guarantees and acceptance. A tracker lists tasks and a **Recovery** section; both are created when needed.

Task states are `TODO`, `DOING`, `BLOCKED` and `DONE`. Work awaiting checks, review or delivery remains `DOING`; `DONE` needs completion evidence.

Useful check and debugging evidence is linked separately, normally under `.agentflow/.tmp/`. Linked evidence is durable despite that name: do not delete it as temporary clutter. The notebook keeps answers, limits and recovery pointers instead of technical logs.

Above 750 notebook lines, or on request, older completed rounds can move into one adjacent `<notebook-stem>.archive.md`. Unresolved work and the latest completed round remain live. An explicit notebook rename includes its archive and preserves history.

`backlog.md` holds future work: `proposed` means suggested, and `deferred` means accepted but postponed. Ask to review the backlog and select work before execution; an entry grants no implementation authority.

`sys-invariants.md` holds accepted guarantees future changes must preserve. Registry content changes produce a dedicated notice in the saved answer and chat; path-only moves produce a relocation notice. An empty registry establishes no accepted guarantees.

See the [agent record rules](../references/session.md#round-evidence) and [delivery rules](../references/delivery.md).

## Steer current work or queue a later batch

Ordinary follow-ups correct or extend current work. State the change and any earlier constraint it replaces.

For work that should wait, send a separate message:

```text
append-rounds Update the installation examples.
```

One message creates one later batch, even with several tasks. `append-tasks` is an exact alias; neither command adds a looper job.

The host finishes the current answer, approval gates and authorized delivery, then handles each batch in its own Ask/Reply round. `godev` resumes pending batches after interruption; queued work does not wake a stopped host. Name the batch when canceling it.

Send feature creation, merge and drop commands separately. A batch containing lifecycle work is neither staged nor executed; resend the remaining ordinary work without it.

See the [agent batch rules](../references/batches.md#append-rounds).

## Keep one exchange off the record

Include an unquoted `nolog:`, `noop:`, `off:` or `skip:` to keep that exchange out of workflow notebooks and later summaries:

```text
nolog: Explain this setting in chat.
```

Authorized work still executes; `noop:` does not mean a dry run. The next unmarked message records normally. Quoted examples do not activate markers or modes.

An off-record append request is neither queued nor executed. Resend it without the marker. See the [agent routing rules](../SKILL.md#route-before-records).

## Choose a task mode or advisor

Ordinary work needs no mode. The host chooses enough investigation, planning and checking for the request.

Use `fast-lane <task>` for direct host execution. It skips ordinary delegation, advisors, new design/tracker creation, separate review and routine progress entries. Input capture, recovery, checks, host review and authorized delivery remain.

Use `skip-review <task>` to retain ordinary planning and execution while replacing ordinary separate review with host review, including the usual risk-boundary review requirement.

Both modes follow one identified task through corrections and resume, then expire. They change no project settings.

A bare command uses clear unfinished work; otherwise the host asks for a task or waits.

Explicit plans/reviews, configured gates and feature rules still apply; `skip-review` replaces earlier review requests, while same-message or later explicit review requirements prevail.

Use `grill-me <topic>` for a requirements interview. The host inspects context, asks connected short rounds about the goal, assumptions and strongest relevant challenge, then follows up on your answers.

At least one round lets you confirm or correct its understanding. The interview stops when material intent is clear; it authorizes discussion, and can be requested during fast-lane work.

Use `browfield <task>` for an eight-step path through unfamiliar existing code, from discovery and rule tracing to baseline, specification, implementation, verification and preservation. The spelling is intentional.

An existing repository alone does not activate it. No separate installation or eight-advisor sequence is required; ordinary approvals and review remain. See the [agent brownfield procedure](../references/browfield.md).

Use `advisors: requirements, explore` for focused advice. The host can also choose advisors for a named investigation gap; advice authorizes no proposed changes and requires no separate worker per role.

For a defined pre-release candidate, `advisors: final-audit` assesses readiness after checks and assembly. A GO verdict still grants no publication authority. Find all roles in the [cheatsheet](CHEATSHEET.md#commands--alphabetical); exact selection mechanics are [agent rules](../references/ag.md).

## Plan, check, review and approve

Say “plan first and wait” for a saved plan without implementation authority. “Plan and implement” permits both once material choices and configured gates are settled.

Planning starts with accepted outcomes and constraints, then seeks the simplest adequate approach. Give goals and examples; the host derives technical paths and checks, asking only material unknowns.

`plan-mode` defaults to `optional`: bounded reversible work usually needs no design, multiple outcomes/delegation/interruption need a tracker, and multi-part behavior changes need a design. `must` requires both before task edits; `off` prevents new designs but allows needed trackers. Existing contracts and checks remain.

`plan-order` chooses who writes an already-needed plan; its default is `external`. It creates no extra planning stage.

Use `3ways <request>` for Claude's main plan and Codex's challenge. The host retains the main plan unless a high-confidence, evidence-backed defect warrants correction. Three perspectives do not require three agents, and planning does not approve implementation.

Other routes use an external CLI, fresh native agent or host. Unavailable routes follow permitted fallback; explicit provider, model, effort, independence or read-only requirements still apply. Invalid selected controls need a decision, never silent substitution.

The host first checks the work. Changed code, operational prompts, product artifacts and implementation-ready contracts normally also receive result review; ordinary questions and examples receive host review.

`review-order` defaults to `external`: counterpart CLI, then fresh native agent, then disclosed host fallback. Separate review prefers a different known planner family when supported, then another configured model. Repeated or unknown identity is disclosed; it is not proof of diversity.

A host fallback cannot satisfy required independence. Missing checks remain unproved even when a reviewer accepts the source.

`gate-design: on` requires design approval before implementation and conflicts with `plan-mode: off`. `gate-tracker: on` requires approval of checked results before final delivery when a tracker exists.

Both gates default off. An empty answer never approves; an unchanged result already approved needs no repeated permission. See the [settings reference](CHEATSHEET.md#agjson--switches--alphabetical) and [agent planning](../references/planning.md#planning-modes-and-gates) / [review rules](../references/review.md).

## Work on a separate feature

A Git worktree is another checkout of the same repository, with its own branch and files. Send `new-feature search` to prepare `.wts/ft-search`, branch `feature/search` and its feature notebook.

The main checkout needs a commit. Preparation can create the narrow empty bootstrap described above; unrelated main files stay excluded. Creation alone authorizes no unspecified implementation.

Follow the actual numbered handoff. Codex and Claude Code use `/cd <feature-checkout>` followed by `godev`, plus an editor suggestion naming the actual feature notebook. Other hosts reopen there; shell `cd` alone does not move the host session.

The default feature notebook is `.agentflow/features/search/search.devlog.md` inside its checkout. Lifecycle commands avoid main's root notebook, archive and claim, even when those are busy; real Git conflicts and target-feature claims still matter.

Send `merge-feature search` to verify and integrate. It retains the checkout and branch unless you explicitly add `and cleanup`. Applicable approval gates precede destructive cleanup; main's unrelated files and staging are preserved.

Send `drop-feature search` to abandon the feature. The host inspects unmerged work and local files, then moves the checkout to verified Trash or Recycle Bin and removes its registration and branch. Unproved reversible cleanup stops; permanent deletion is no fallback.

Drop reports in chat and needs no durable retirement record. If a feature notebook exists, its STATUS is marked dropped/retired before removal; no replacement notebook is created.

Inside the target feature you can omit its name for drop, without switching to main first. Follow the returned main handoff afterward. Merged/dropped features are retired; partial failures require the exact recovery action, not recreating paths or repeating the whole operation.

Creation and merge use feature records. Exact handoffs and recovery are in the [agent feature rules](../references/features.md).

## Run groups with the optional looper

Looper divides authorized work into isolated worktree groups. Tasks within a group run sequentially in fresh sessions; independent groups can run together. Ordinary single tasks do not need it.

Give the host numbered outcomes, examples and guarantees to preserve. `prepare-tasks <request>` saves group plans, a queue and the exact original request, then stops for inspection.

The default run root is `.agentflow/artifacts/A-NNN-<name>/planned/`, containing `group-NNN.md`, `queue.json` and `request.md`, linked from Current. You do not need to handwrite queue JSON.

Use `run-tasks` to execute or resume that linked queue, or `run-tasks <run-root>` to select one explicitly. `handle-tasks <request>` combines preparation and execution.

Configure routes first: bundled `looper-routes` is empty. Task, repair and acceptance routes select transport/provider/catalog; shared `model-family` holds model and effort choices. Prefer an external CLI when choosing new task routes; explicit native choices and saved attempts remain binding.

Defaults are 3 working groups and 2 repairs per group, set in `looper-limits`. Active attempts retain their selections; new attempts use the settings read for that run. Each CLI attempt has a 20-minute timeout that preserves and blocks unfinished work on expiry.

Native dispatch needs the live host and its result mailbox. Closing the host does not authorize switching to CLI or another provider.

Dependencies wait until earlier groups are checked and integrated. Ready groups use one integration lane in arrival order. Questions pause their group while independent groups continue; answer through the host.

Resume preserves unfinished edits and first reconciles old writers. Missing, changed or unsafe `request.md` blocks execution; do not edit prepared input silently to change the job. Clean merges run combined checks; repairs retain review and acceptance.

Group records live in `.aglite-records/` and stay out of product integration. Worktrees and records remain afterward; preserve ignored records before separately authorized cleanup. No cleanup, push or release permission follows from a run.

For shell use, install `agf` as described by the [agent looper contract](../references/looper.md) and use `agf loop run [run-root]` or `agf loop status [run-root]`. Shell omission means the current directory; chat `run-tasks` instead follows Current. See the [CLI/settings reference](CHEATSHEET.md#looper-cli--alphabetical) and [retained files](../references/looper.md#retained-files).

## Change configuration deliberately

Settings live at `<checkout>/<ag-dir>/ag.json`, normally `.agentflow/ag.json`. Ask for named changes or edit deliberately; missing ordinary keys use defaults. Current configuration schema is 13, separate from package version.

`use-lang` controls new human text, including template labels and receipts. Without it, the host uses OS locale then `en-us`; typing in a language does not select it. Explicit response/target-language requests override the setting.

Original input, history, machine syntax and established artifact languages stay intact. Changing the setting does not translate the past.

`auto-commit` and `auto-push` default on and are independent. Ask for both off if you want neither automatic delivery action; the narrow bootstrap exception above still applies unless commits are forbidden.

Verified task changes and owner edits are committed separately, subject to the pre-existing-content exclusion after bootstrap. Git delivery grants no deployment, publication, external-message or unrelated-change authority.

`saving-mode` is required and defaults off. Migration adds a missing value as off and preserves existing on/off. Turning it on reduces optional prose/records and reuses evidence; comprehension, requested detail, required checks, gates and recovery remain. It changes no models or routes.

`pipeline-roles` and `model-family` select models/effort for work already chosen, and launch nothing alone. Unsupported selected settings block rather than change silently.

For Copilot, start with the [selection reference](CHEATSHEET.md#copilot-selection). The linked [Copilot agent rules](../references/copilot.md) explain transport controls; CLI success does not prove native editor support.

See all values/defaults in the [cheatsheet](CHEATSHEET.md#agjson--switches--alphabetical), with exact [agent configuration rules](../references/configuration.md#discovery-and-validation).

## Migration and installation

Read the [Agentflow 8 comparison](agv8-aglite-comparison.md) for retained capabilities, removed runtime enforcement and migration consequences.

Known compatible settings migrate without resetting owner choices. Unknown/newer schemas, conflicting old/new fields and ambiguous sources stop for a decision. Configuration migration moves neither history nor installed skills implicitly.

Recognized Agentflow 8 input loads a separate procedure. Safe mappings run automatically; old approval policies, ownership conflicts or unsupported restrictions wait. Recognized old fields also need reconciliation behind supported newer stamps.

Proven V8 input with no `threeways` tier retains its effective `better`; explicit tiers survive. The host updates config and current STATUS, removes only confirmed old project hooks/startup units, and keeps history, foreign settings and recoverable private originals.

Earlier aglite schemas 9–12 upgrade to 13. Missing `saving-mode` becomes off; existing on/off survives. For example, `skip-wip: off` maps to `omit-wip: off`, preserving its meaning rather than using a missing-key default.

Read the saved result and restart if old integrations were loaded. Old active queues/streams need completion or handoff before retirement; they do not become new looper queues. Exact mappings are [agent migration rules](../references/legacy-migration.md), with [later-format upkeep](../references/upkeep.md#automatic-migration).

Use one installation route per host and follow that route's updates in the [package README](https://github.com/agfnow/agentflow#install). Open a new session after installation or update. Replacement needs explicit approval of a concrete route that preserves unfinished changes, including source checkouts or symlinked installations.

When `next_update_date` is due, the host checks the Agentflow stable feed once and schedules another check two calendar days later. Agentflow 8.x is not an upgrade for v9 or the earlier aglite beta. Discovering an update grants no replacement or publication authority; see [agent release-check rules](../references/configuration.md#session-release-check).

## Know the limits and keep docs current

Agentflow relies on the host following instructions. Installed files and valid paths do not prove discovery, unattended continuation or support on every host. Ordinary work needs no hooks or background runner; looper is the scoped optional runtime exception.

Windows looper use needs Node.js 20+ and Git for Windows. Follow the [agent Windows rules](../references/windows.md); tests on another platform do not prove native Windows or provider/editor behavior.

Browser journeys use Stagehand and Browserbase `browse` by default, subject to your tool preferences and project rules. The host checks actual behavior and access boundaries under the [agent browser-testing rules](../references/browser-testing.md).

Behavior changes update affected current documentation, examples and translations together. Each fact has an authoritative source; summaries are checked dependents. No documentation impact means no extra documentation record.

Use `advisors: product-docs` for a documentation map, handover or substantial drift gap. Advice grants no publication; exact maintenance requirements are [agent rules](../references/product-docs.md).

## Find an exact rule

Use the [cheatsheet](CHEATSHEET.md) for complete lookup. `gdd` and `devlog` also activate agentflow; prefer `godev` in daily use. `show-diff` requests verified differences and reasons, granting no additional edits.

The [skill entrypoint](../SKILL.md) selects procedures; linked `references/*.md` files are compressed instructions for agents, not human manuals. Consult them when you need precise authority or failure rules.

- [Session](../references/session.md): input, recovery, claims and backlog.

- [Planning](../references/planning.md): contracts and approval gates.

- [Work](../references/work.md): task modes and checks.

- [Review](../references/review.md): routes, models and independence.

- [Delivery](../references/delivery.md): answers, Git and archives.

- [Features](../references/features.md): creation, integration, abandonment and handoffs.

- [Looper](../references/looper.md): grouped execution and retention.

- [Configuration](../references/configuration.md) and [upkeep](../references/upkeep.md): settings, migration and replacement.

- [Shared project rules](../references/project-rules.md) and [invariant policy](../references/invariants.md): standing constraints and preserved guarantees.
