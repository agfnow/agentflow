# Agentflow 9.1.0 — everyday guide

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

During first project setup, the host also checks `agf`. If missing, it automatically adds a small shell function for your configured zsh/bash or PowerShell shell (Windows is best effort and native behavior remains unproved) and visibly tells you which startup files changed; open a new shell to use it.

Existing commands are preserved. Missing Node 20+, unsupported shells or unsafe files are reported with a direct command instead. See [command setup](../references/setup.md#agf-command-setup).

Your coding agent must support and honor that instruction. If loading does not happen, load the skill and send `godev` yourself. A missing skill is reported, never installed silently.

Git is optional. In a folder without Git, the host asks before setup writes whether you want a repository; no answer means wait, and declining continues without Git.

If you approve Git initialization, or eligible first setup finds an existing repository with no commits, the host creates one empty first commit. Explicit `new-feature` preparation can do the same when main has no commits.

This bootstrap works even with `auto-commit: off`, unless commits are explicitly forbidden. It preserves staged and untracked files; first delivery includes only verified task/setup changes, leaving unrelated pre-existing contents out unless you authorize their inclusion.

Existing HEAD is reused. Other refs or an unsafe Git state stop bootstrap; a failed commit preserves the partial state and stops setup or feature preparation. A commit prohibition permits setup without the bootstrap, but feature worktrees still need a commit. Bootstrap alone grants no push or publication authority.

If setup began without a task, the host asks for your next request when finished. See [agent setup rules](../references/setup.md#first-time-setup) for exact eligibility and recovery.

## Resume unfinished work

Open the same project and send `godev`. The host reads the active request, saved questions and linked recovery notes, then checks live files and operations before continuing.

The host loads instructions by route and section, reusing static rules still in context. An idle start checks configuration and current work; execution, planning, workers and special procedures load when needed. Required safety checks remain; no timing or cost reduction is guaranteed. See [loading rules](../SKILL.md#load-only-the-applicable-procedure).

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

Simple planning stays with the host when requirements, approach and dependencies are understood and risk is low. Several tasks or groups alone do not make a plan complex; the six-task writing/news/archive example can be grouped directly, while factual news research remains an execution requirement.

Material uncertainty, consequential architectural tradeoffs, cross-system coupling or changed security/privacy/destructive/external-action boundaries use `plan-order` (default `external`). Worker routes prefer Claude’s first draft, then Codex’s challenge, corrections and final plan. Explicit task routes/requirements and configured `3ways` prevail; configured `host` stays direct. The host records a short reason and reassesses if complexity appears.

This changes planning delegation, not required designs/trackers, review, checks or approval gates. Reuse matching plans, review and passing evidence; keep handoffs concise and forbid nested agents. A Codex host can challenge a Claude draft directly, without a second planning worker.

Use `3ways <request>` for separate blind Claude and Codex plans, followed by comparison and reciprocal debate. Neither sees the other’s current-task draft or hints until both finish; shared original evidence and accepted prior contracts are allowed.

Codex writes the final synthesis and makes reasoned technical decisions. A participating host must draft before reading the other output or use a fresh clean participant; otherwise its work stays provisional and cannot count as blind 3ways.

`plan-order: 3ways` selects that identical procedure for already-needed planning, including recommendation reports. No fixed round cap or minimum applies.

Technical dissent is recorded with Codex’s final reasons; consensus means both explicitly accepted identical final content.

Missing required participants or valid blind drafts leaves provisional work. Owner-only choices, required proof and approval gates remain binding; this grants no implementation approval. See [review.md, line 76](../references/review.md#3ways-compare-before-implementation).

External planning prefers Claude CLI drafting followed by Codex challenge/synthesis; a Codex host can do the latter directly. Native prefers the same roles within supported native/direct-host controls.

Host and fast-lane plan directly without worker probes.

Unavailable preferred roles are disclosed; explicit provider, model, effort, independence or read-only requirements still block incompatible fallback. Invalid selected controls need a decision, not silent replacement.

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

## Use feature commands in your terminal

The CLI writes feature notebooks: creation saves preparation, merge saves lifecycle progress/completion, and drop updates an existing feature notebook’s retirement/cleanup STATUS before removal. Drop creates no separate durable record.

These generated records support English and Traditional Chinese; unsupported locales stop before mutation for host rendering in the configured locale, with no English notebook fallback. Raw terminal diagnostics may be English.

Use the terminal feature CLI when you want to work directly in your shell. It needs Node.js 20+ and Git (2.38+ for merge using `merge-tree --write-tree`), plus one current canonical project configuration; migration or ambiguous configuration stops for the host. These commands do not access main's root notebook, archive or claim.

- `agf drop-feature [name] [--abandon]` (alias `dropft`) removes an already merged feature only when it has no tracked, untracked or ignored local data. Add `--abandon` to deliberately discard dirty or unmerged contents. Target claims and Git locks still block removal.

  For retained CLI merge bookkeeping, follow the `agf merge-feature <name> --cleanup` continuation; other local data still needs resolution.

- `agf merge-feature [name] [--cleanup] [--check '<JSON argv>'] [--include <checkout-relative-path>]` (alias `mergeft`) integrates feature work while preserving unrelated main files/staging and excluding root records. The checkout/branch stay unless `--cleanup` is supplied. Repeat `--check` for literal argv checks, for example `--check '["node","--test"]'`; no shell evaluates them. Without explicit checks, the CLI uses merged candidate’s root package.json test when available; without either, it merges and explicitly reports no repository checks configured. Selected checks run on candidate and integrated main; failures still block completion.

  Repeat `--include <checkout-relative-path>` to authorize committing only named dirty task files plus feature records. Dirty product files without this authority stop with an `--include` continuation; unrelated files/index entries remain untouched, with no all-files sweep.

- `agf new-feature <name> [--open]` (alias `newft`) creates the managed checkout and feature notebook from committed main, preserving main's uncommitted work. Exact open preparation can resume without duplicate history. `--open` opens that notebook; editor failure warns while retaining the successful feature.

  Set top-level `ag.json` `default-editor` (default `"vscode"`, launched as `code`). Set a nonempty executable name such as `"vim"` or a full path such as `"/opt/my editor/bin/edit"`; it receives the notebook as one argument with terminal IO inherited. The value is an executable, with no embedded arguments or shell parsing.

  Relative editor paths resolve from the feature checkout; review repository settings before using `--open`.

- `agf shell <zsh|bash|powershell>` prints a caller-directory function for review/copy; it never installs or upgrades a binding.

Merge/drop may omit the name only inside their own registered managed feature. Claims never transfer automatically because a process is dead or a marker is old. Retired features cannot resume development. Failed or uncertain effects retain recovery information; inspect it and follow the exact next action rather than repeating destructive steps.

Actual merge conflicts use Codex in a separate candidate checkout. `workspace-write` limits writes; it does not provide OS read isolation, and broader reads remain possible. Root records are excluded from the workspace and outside access is forbidden by instructions; main is not thereby unreadable.

The CLI independently checks changed paths, unresolved entries and required tests before integration. Missing approval gates or owner decisions stop for host continuation; process success alone proves no correct merge.

The operator chooses required checks. Candidate checks run in a separate checkout containing tracked files, without installed dependencies; where appropriate use `--check '["npm","ci"]' --check '["npm","test"]'` in that order. Each selected check and conflict resolution has a 10-minute limit; timeout blocks completion and retains recovery state. Changed Gitlinks stop before effects for host continuation.

`auto-commit` and `auto-push` default on: merge can commit and push MAIN. No remotes skips pushing; a sole remote works, while ambiguous remote selection stops. This grants no release authority.

A definite settled check/resolver failure before integration may be explicitly renewed after fixes. Unknown, unsettled or partial main effects require host reconciliation, with no implicit retry loop. On Windows, `--open` needs a directly executable editor; the default may warn because of `code.cmd` launch limits; the successfully created feature remains usable.

For automatic caller-directory switching, review the function printed by `agf shell <zsh|bash|powershell>`. Eligible first setup adds a missing binding; an existing binding requires an explicit upgrade request. See [shell setup](../references/setup.md#agf-command-setup). The function keeps ordinary output visible and reads only a separate successful destination file.

Creation and drop results have blank lines between output blocks. After successful creation and directory switching, the current generated function suggests opening your coding agent there; it omits the `cd` instruction. Existing bindings retain the continuation until explicitly upgraded.

Direct Node/package-bin use prints one quoted `cd` command and suggests opening the agent after switching; a terminal workflow needs no coding-agent `/cd`.

macOS is primary and cleanup uses verified recoverable Trash. Windows is best effort: explicit feature cleanup/drop may permanently delete the exact target; necessary feature CLI bookkeeping may also dispose of exact UUID-owned claims and destination files, never foreign claims or other files, and native behavior remains untested without Windows evidence.

Linux may refuse before any work when recoverable disposal of owned claims is unavailable, as well as refuse cleanup. These exceptions apply only to this feature CLI, not host chat or looper cleanup. See the [complete feature contract](../references/features.md#terminal-cli).

Main’s final files may exclude a root notebook while the original feature commits still retain it in history. Automatic push stops if unpublished feature history contains protected root records; the owner decides how to handle that history. The CLI preserves the original parents.

If a private inherited configuration differs from main, the CLI stops for a host decision and preserves main’s private copy.

## Run groups with the optional looper

Looper divides authorized work into isolated worktree groups. Tasks within a group run sequentially in fresh sessions; independent groups can run together. Ordinary single tasks do not need it.

Give the host numbered outcomes, examples and guarantees to preserve. `prepare-tasks <request>` saves group plans, a queue and the exact original request, then stops for inspection.

The preparation result saves both execution choices and shows them in the final visible reply before the receipt, even with `inline-reply: off`: from the shown checkout directory, terminal `agf looper status <run-root>` then `agf looper run <run-root>`, or chat `run-tasks`. Actual paths replace placeholders; if `agf` is unavailable, verified installed Node-entrypoint commands are shown. Printing does not start execution.

The default run root is `.agentflow/artifacts/A-NNN-<name>/planned/`, containing `group-NNN.md`, `queue.json` and `request.md`, linked from Current. You do not need to handwrite queue JSON.

Use `run-tasks` to execute or resume that linked queue, or `run-tasks <run-root>` to select one explicitly. `handle-tasks <request>` combines preparation and execution.

First setup detects installed Codex/Claude CLIs and fills task, repair and acceptance routes; Codex wins when both are present. The template supplies Codex defaults, adapted during setup. Existing settings and explicit native choices remain binding; shared `model-family` holds model and effort. Detection does not prove login or model access. With neither CLI, supported native routes need a live host; otherwise setup reports the missing capability. See [detected defaults](../references/setup.md#detected-worker-defaults).

Repaired results can use the available configured reviewer, including the same provider, in a separate fresh session. Checks, independent review and renewed acceptance remain required; explicit stricter provider requirements prevail.

Main can advance while the looper runs. The coordinator records compatible forward changes and merges onto the latest main; you do not manually refresh the queue base. If main advances during checks or landing, it carries the checked result into a new merge and checks again, retaining completed tasks, accepted repairs and earlier evidence. Branch changes, rewritten history, uncertain landing effects or conflicting authority still require reconciliation.

An active Git operation or lock can pause landing. Resume the same queue after it ends; successful tasks stay preserved.

Defaults are 3 working groups and 2 repairs per group, set in `looper-limits`. Active attempts retain their selections; new attempts use the settings read for that run. Each CLI attempt has a 20-minute timeout that preserves and blocks unfinished work on expiry.

Native dispatch needs the live host and its result mailbox. Closing the host does not authorize switching to CLI or another provider.

Dependencies wait until earlier groups are checked and integrated. Ready groups use one integration lane in arrival order. Questions pause their group while independent groups continue; answer through the host.

Resume preserves unfinished edits and first reconciles old writers. Missing, changed or unsafe `request.md` blocks execution; do not edit prepared input silently to change the job. Clean merges run combined checks; repairs retain review and acceptance. Changed contract text is compared with the original authority and revalidated through review/acceptance even for a clean merge.

Group records live in `.aglite-records/` and stay out of product integration. Default runs retain worktrees/evidence; explicit cleanup keeps only queue/request/group plans in the run-root and recycles the other history. No push or release permission follows.

For shell use, install `agf` as described by the [agent looper contract](../references/looper.md) and use `agf looper run [run-root]` or `agf looper status [run-root]`. Shell omission means the current directory; chat `run-tasks` instead follows Current. See the [CLI/settings reference](CHEATSHEET.md#looper-cli--alphabetical) and [retained files](../references/looper.md#retained-files).

`run` shows timestamped progress on stderr and a final result on stdout. Quiet periods get a 30-second heartbeat; this is not an ETA or proof that a worker is advancing. The result distinguishes completed tasks from groups checked and integrated, lists output/evidence locations and saved blocking reasons, and tells you what to resolve before resuming.

Sections and progress events have blank lines. Timestamped progress has two columns: the timestamp, then the message. Wrapped text and reviewer details align in the message column; terminal wrapping follows its current width. Pipes keep full hanging logical lines; status and saved reports preserve complete commands and paths.

Opt in with `agf looper cleanup <run-root>` afterward, or add `--cleanup` to `agf looper run`.

Cleanup requires a completed, settled run. It keeps only `queue.json`, the queue-referenced request and group plans (six files for a four-group run).

All other run-root entries, including records, reports, answers, released claims and unknown ordinary files, move to recoverable Trash. Delivered outputs and branches stay.

Avoid cleanup to retain full history; `status` and completed-run repeats still work from the retained files, without recreating reports.

Cleanup currently requires macOS and accessible same-volume Trash. Task success plus cleanup failure exits 1; resolve the blocker and retry the manual command. Default, blocked and stopped runs retain scratch; see [cleanup safety](../references/looper.md#explicit-cleanup).

CLI tasks request their ordinary independent review through the coordinator, which launches the configured reviewer outside the task sandbox. This avoids nested CLI startup failures while preserving task write restrictions, reviewer independence and ordinary closeout. No additional review stage is added. Blocked results show worker evidence and exact attempt paths; execution/result failures also retain `failure.json` beside the transcript.

Exit codes are 0 (complete), 2 (blocked or stopped), and 1 (error). When saved state was observed, a unique `evidence/run-<time>-<UUID>.txt` report retains the result; an early validation error may have no report. Reports are historical snapshots; `queue.json` remains current execution state. `status` changes no files and also shows declared outputs, blockers, dependencies and report locations. A draft in a worktree is not yet an integrated result; listed output paths do not prove files exist.

Final results list each group with its nested tasks, saved success summaries, declared outputs and concise saved failure/blocker reasons. Checked tasks awaiting group integration remain distinguishable from integrated results; dependency waits are unfinished work. Uncertain writer state calls for reconciliation, not a failure verdict.

Terminal summaries put blockers and next actions before detailed outputs. TTY output highlights failures in bright red and next actions in cyan; NO_COLOR or TERM=dumb disables color. Saved reports and pipes remain plain. Codex task/repair/review sessions select live search explicitly unless the parent sets CODEX_SANDBOX_NETWORK_DISABLED=1, which disables search without relaxing sandbox restrictions.

If an old `agf` function treats captured ordinary output as a directory or executable input, explicitly request an upgrade and review the function generated by `agf shell <zsh|bash|powershell>` before safe replacement under [shell setup](../references/setup.md#agf-command-setup). Preserve current wrappers that use the separate destination file; they may change directory. Do not remove claims or bypass checks to resume a blocked run.

### Read results and resume a failed group

Use `handle-tasks <work list>` for a new job when you want the host to prepare and operate it. Use `run-tasks` for an existing queue; sending the original list to `handle-tasks` again can prepare another job. The shell command operates the coordinator directly and has no host reasoning loop.

Open `<run-root>/results.md` after a run for the latest derived result, group/task outcomes, declared outputs, blocker question IDs and evidence links. `evidence/run-<time>-<UUID>.txt` preserves each invocation. Check `agf looper status <run-root>` for current saved progress: reports can be older than a running queue.

`results.md` updates only a verified generated file for that run. Owner files, edited reports, registered inputs, declared outputs and unsafe paths are preserved with a warning; the unique snapshot still remains. To restore updates after annotating the report, ask the host to preserve it under another filename, then resume the same queue.

Reporting failures do not change the run exit code. Explicit cleanup recycles both report forms; cleaned repeats do not recreate them.

A task marked checked has passed its task checks; its group must also be checked and integrated before its outputs are delivered to the target. A blocker does not erase earlier successful tasks. Dependent groups wait; independent groups continue when shared state is safe.

For example, if G01/T01 passed and T02 is blocked, ask the host: “Inspect this queue’s blocker and evidence, fix authorized technical causes, then resume the same queue. Ask me only for decisions you cannot make.” The host inspects the actual cause and writer/Git identities before acting; a rerun alone does not reopen a saved blocked group.

The host supplies a verified technical correction through `<run-root>/inbox/answers.json`, using the exact question ID displayed by status:

```json
[{ "id": "QUESTION_UUID_FROM_STATUS", "answer": "Verified technical correction and evidence", "source": "host" }]
```

This is an example, not an answer to submit without diagnosis. The host preserves existing entries and supplies actual findings. For an owner-only question, answer the host in normal language; it passes your exact answer with `"source": "owner"` (also the default). You do not normally edit this file yourself. The inbox directory/file is supplied when needed, not a required preparation artifact.

On the next `run-tasks` or `agf looper run <run-root>`, the coordinator imports answers by question ID and reopens the affected unfinished task or integration. It retains earlier successful work and rechecks saved candidates where supported.

Identical answers are idempotent; conflicting replacements are rejected. An answer alone does not fix the cause or prove a worker stopped.

Outstanding native work additionally needs actual stopped-result proof; see [the inbox contract (looper.md, line 119)](../references/looper.md#119).

“Resume” means continue preserved work, not roll the repository back or rerun everything. Repair/review of merge conflicts is bounded (default 2 repairs). Failed tasks, provider errors and timeouts have no general automatic retry/backoff; technical corrections and another invocation may be needed. Missing identity or unknown external effects can still require human investigation.

A live host can diagnose technical blockers within existing authority, operate the inbox and resume.

`handle-tasks` does not create a persistent supervisor, survive host shutdown or guarantee autonomous recovery.

Native work requires that live host; CLI-only execution can proceed without native dispatch. Neither mode proves reliable completion of 1,000 unattended tasks.

Preserve evidence until failures are understood; do not clear claims or rewrite queue state to force progress.

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

Read the [Agentflow 8 comparison](agv8-agv9-comparison.md) for retained capabilities, removed runtime enforcement and migration consequences.

Known compatible settings migrate without resetting owner choices. Unknown/newer schemas, conflicting old/new fields and ambiguous sources stop for a decision. Configuration migration moves neither history nor installed skills implicitly.

Recognized Agentflow 8 input loads a separate procedure. Safe mappings run automatically; old approval policies, ownership conflicts or unsupported restrictions wait. Recognized old fields also need reconciliation behind supported newer stamps.

Proven V8 input with no `threeways` tier retains its effective `better`; explicit tiers survive. The host updates config and current STATUS, removes only confirmed old project hooks/startup units, and keeps history, foreign settings and recoverable private originals.

Earlier aglite schemas 9–12 upgrade to 13. Missing `saving-mode` becomes off; existing on/off survives. For example, `skip-wip: off` maps to `omit-wip: off`, preserving its meaning rather than using a missing-key default.

Read the saved result and restart if old integrations were loaded. Old active queues/streams need completion or handoff before retirement; they do not become new looper queues. Exact mappings are [agent migration rules](../references/legacy-migration.md), with [later-format upkeep](../references/upkeep.md#automatic-migration).

Use one installation route per host and follow that route's updates in the [package README](https://github.com/agfnow/agentflow#install). Open a new session after installation or update. Replacement needs explicit approval of a concrete route that preserves unfinished changes, including source checkouts or symlinked installations.

When `next_update_date` is due, the host checks the Agentflow stable feed once and schedules another check two calendar days later. Agentflow 8.x is not an upgrade for v9 or the earlier aglite beta. Discovering an update grants no replacement or publication authority; see [agent release-check rules](../references/configuration.md#session-release-check).

## Know the limits and keep docs current

Agentflow relies on the host following instructions. Installed files and valid paths do not prove discovery, unattended continuation or support on every host. Ordinary work needs no hooks or background runner; looper and the terminal feature CLI are bounded runtime exceptions.

Windows looper use needs Node.js 20+ and Git for Windows. Follow the [agent Windows rules](../references/windows.md); tests on another platform do not prove native Windows or provider/editor behavior.

Browser journeys use Stagehand and Browserbase `browse` by default, subject to your tool preferences and project rules. The host checks actual behavior and access boundaries under the [agent browser-testing rules](../references/browser-testing.md).

Behavior changes update affected current documentation, examples and translations together. Each fact has an authoritative source; summaries are checked dependents. No documentation impact means no extra documentation record.

Use `advisors: product-docs` for a documentation map, handover or substantial drift gap. Advice grants no publication; exact maintenance requirements are [agent rules](../references/product-docs.md).

## Find an exact rule

Use the [cheatsheet](CHEATSHEET.md) for complete lookup. `ag`, `agf`, `gdd` and `devlog` also activate agentflow; prefer `godev` in daily use. `show-diff` requests verified differences and reasons, granting no additional edits.

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
