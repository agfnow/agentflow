---
name: agentflow
description: Keep development work resumable with a devlog, proportionate plans, optional advisors and checked results. Trigger by browfield, godev, gdd, devlog, fast-lane, grill-me, skip-review, advisors, 3ways, append-rounds, append-tasks, prepare-tasks, run-tasks, handle-tasks, new-feature, merge-feature or drop-feature.
metadata:
  version: "9.0.0"
---

# Agentflow 9.0.0

Finish authorized work; keep development resumable with one devlog and proportionate records. Owner instructions prevail. Read [writing](references/writing.md) before human-facing authoring; apply configured locale to all new human text, including template labels. Preserve fixed identifiers, syntax, quotes and historical bytes. Pass writing/saving guidance to report authors.

`append-tasks` is an exact alias of `append-rounds` in every linked rule; capture the spelling the owner used. Commands in quoted examples do not activate modes; owner-quoted task payload remains input.

## Route before records

1. **Off-record first:** an owner message containing unquoted `nolog:`, `noop:`, `off:` or `skip:` is answered/executed in chat without notebook access or workflow records, now or in later summaries. Authorized product/config edits remain allowed; automatic upkeep defers. An off-record append command is neither staged nor executed: request resend without the marker, without notebook access. Subsequent unmarked messages record normally.

2. **Isolated looper task:** apply the coordinator-supplied inherited configuration and explicit record overrides under [looper](references/looper.md#queue-and-records), before generic discovery/setup/upkeep. Do not infer feature routing from authorized `aglite-*` worktrees.

3. **Configuration/routing:** verify the session's physical directory, Git root/branch/worktrees (or existing non-Git folder), then read [configuration](references/configuration.md). Read static rules once while retained in context; reread live configuration on every on-record owner message and before configuration-dependent delivery. Resolve `<ag-dir>` and notebook once from validated settings; never replace a configured name with a default. Missing startup checkout, Trash location or contradictory identity stops task work, allowing only read-only inspection or the feature contract's bounded transitions/terminal cleanup. A subprocess cwd never relocates the session.

4. **Lifecycle before root probes:** read [features](references/features.md) for `new-feature`, `merge-feature`, `drop-feature`, managed `.wts/` paths or feature branches, before generic notebook/setup/claim/recovery. Lifecycle commands bypass main/root notebook, archive, claim, capture and closeout; root state cannot block them. An append message containing lifecycle work is neither staged nor executed: request separate lifecycle command and resend remaining append work, without notebook/pending-record access.

5. **Fresh setup or idle:** in a verified existing folder with no selected notebook, established notebook/archive history or prior retirement and no configured ag-dir (or only its config), follow [setup](references/setup.md) before idle; non-Git setup requires the saved/prior explicit Git choice. Otherwise bare activation without a direct task/question inspects only configuration, selected latest Ask/Questions and Current/Next. Missing notebooks first require root/configured-directory history checks. Linked unfinished work/gates/delivery, pending batches, live operations or ambiguity require normal recovery. Only verified absence of all work permits asking for the next request without claim, setup, record update or retroactive capture. Skip unrelated commands/reads; narrowly date-gated release scheduling remains allowed, but due migration requires normal owned recovery.

6. **Owned work:** read [session](references/session.md) before claim, recovery, capture or task work; claim before full recovery/execution. Preserve unrelated edits. Follow shared/local project rules and [invariants](references/invariants.md) before affected work; unavailable authoritative rules defer dependent writes/acceptance. Bare `godev` resumes unfinished work; activation invents no project task.

## Load only the applicable procedure

- [Batches](references/batches.md): append command, correction targeting a pending batch, or recovery of pending rounds. The host owns queue/claim/capture/integration/delivery; reached batches prefer bounded native implementation workers under its exceptions.

- [Work](references/work.md): actual project execution, task modes (`browfield`, `fast-lane`, `grill-me`, `skip-review`, advisors/`3ways`) or requested diff. [Planning](references/planning.md): applicable design/tracker criteria, requested/materially revised contracts or gates; ordinary Q&A loads neither execution nor design contracts. Plan-only adds no implementation authority.

- [Review](references/review.md): before planning routes, result review or worker dispatch. Configured separate result review applies to changed code, operational prompts, product artifacts and implementation-ready contracts unless a valid task waiver applies. Host reviews ordinary Q&A. Read [Copilot](references/copilot.md) only on a Copilot host or selected Copilot route/profile. Every Codex `spawn_agent` explicitly uses `fork_turns: "none"` with complete bounded context.

- [Delivery](references/delivery.md): before STATUS/Reply rendering, closeout, archive, Git delivery or explicit notebook rename. With `inline-reply: off`, save all substantive answers/proposals/examples/questions at their existing record locations; chat contains activity, required notices/blockers/handoffs and the exact localized receipt. Only explicit chat/terminal destination requests permit their requested answers there. Do not echo saved answers through tools.

- [Setup](references/setup.md): eligible initial creation or AGENTS adoption on actual work. [Upkeep](references/upkeep.md): config migration/relocation or approved installation replacement; recognized Agentflow8/integration triggers first load [legacy migration](references/legacy-migration.md); neither grants publication or unrelated edits.

- [Looper](references/looper.md): before `prepare-tasks`, `run-tasks`, `handle-tasks`, execution or recovery. Preparation saves the Current-linked queue/planned files and stops; run executes it; handle combines both. Only this feature permits its scoped Node coordinator/`agf` launcher. Preserve ordinary task settings, isolation, native live-host/mailbox requirements and owner-only boundaries; no CLI substitution, cleanup/push/release authority follows.

- [Windows](references/windows.md): Windows or explicit portability work. Specialized advisor, brownfield, browser and product-document references load at the triggers in work/review; do not load all references routinely. With `saving-mode: on`, read [saving mode](references/saving-mode.md) before authoring; off preserves normal behavior; missing saving-mode follows configuration migration.

Keep scope tied to accepted input/corrections; proposals and reviewer suggestions add no authority. Inspect external operation identity before retrying an unknown result. Stop named work/descendants when asked; settle task-owned workers/mutating processes before yielding and release only the verified own closed-round claim under session rules. Never promise unsupported background continuation.

Batch independent reads/searches/tool calls when supported, with bounded concurrency/output; inspect every result, including failures. Keep dependencies, approvals and adaptive follow-ups sequential; parallelize mutations only when independent and safe. Obey tool restrictions; preserve authorization and required checks.
