# Task work

Read for task selection, execution/checkpoints or diff presentation, not ordinary Q&A. Before task edits apply [planning criteria/gates](planning.md), retaining mode exceptions.

## Optional browfield path

Unquoted `browfield [task]` selects eight-step [brownfield development](browfield.md) for authorized feature work; quoted mentions/examples do not. Bare invocation uses an unambiguous active task, otherwise asks without inventing work. Retain selection in Current/tracker through resume/completion; change no settings. Read browfield.md before dependent work for this selection or a named material need for structured discovery/regression protection in unfamiliar code; an existing repository alone is insufficient. Select only when useful within authorized feature scope; follow all eight knowledge/proof gates, reusing applicable advisor methods/records. Task modes/configured gates prevail; selection adds no workflow, advisor, mandatory worker sequence or authority. Do not load for idle, greenfield or standalone audit.

## Task modes

- Unquoted `grill-me [topic]` selects the [requirements interview](advisors/requirements.md) even without a gap; read it and [advisor rules](ag.md). Bare invocation uses an unambiguous active topic or asks without inventing work/persisting a mode; quoted mentions do not trigger. The host conducts connected rounds at existing answer locations under `inline-reply`; no mandatory worker/document/setting or implementation authority. This interview overrides only fast-lane’s advisor skip. Stop at the prompt’s readiness; resume only authorized work.

- Unquoted `skip-review [task]` selects host review for one identified request (possibly several tracker items), waiving ordinary separate review including risk-boundary review. Mentions/examples do not trigger. Bare invocation uses unambiguous unfinished work; ambiguity requires a task choice, none means wait without override/Ask closure. Record boundary/override once in Current/existing tracker, retain through follow-ups/resume, expire at completion; change no settings. Keep other steps, `inline-reply` and host checks/review. It replaces earlier same-work review requests; same-message/later explicit requirements prevail. Clarify unclear scope/intent. Exclude selected work from other tasks’ separate-review inputs/scope unless prevailing requirements cover it. Stop only task-owned ordinary reviewers; verify settled/stopped before host review, retaining completed advice.

- Unquoted `fast-lane [task]` selects direct host execution for one task; mentions/examples do not trigger. Bare invocation uses current unfinished work, asks if ambiguous, otherwise waits without inventing work/closing the Ask. Record boundary/mode once in Current/existing tracker; retain through follow-ups/resume, expire at completion, change no settings. Mode switches do not stop workers: settle them under existing authority before host edits.

- Fast-lane skips advisors, ordinary delegation, new design/tracker, ordinary separate review and routine RUN/WIP, even when normal creation/review criteria apply. Keep existing records minimally current and save recovery in Current/tracker at interruption or unfinished handoff. Keep identity/ownership, input capture, Reply, scope, system invariants, necessary checks, host review and authorized delivery. Explicit owner plans, reviews, executor choices, checkpoints, configured gates and feature lifecycle requirements prevail; resolve incompatible choices before dependent work. Record host review once under [Round evidence](session.md#round-evidence) with inspected scope, findings and unresolved limits.

- Work directly when ordinary inspection/checks suffice. Name material investigation questions raised by request/inspection/evidence against the approach; only these, explicit advisors or release-candidate audits load [advisor selection](ag.md) before dependent work, then selected prompts only. Judge unresolved product choices, unfamiliar paths, cross-subsystem contracts, technical uncertainty and trust/failure risk, not length. No ag.md/advisors for idle, routine work or fast-lane except explicit grill-me. Ordinary planning/delegation/review needs none; findings add no authority.

## Records and review

- Follow [session record locations and evidence](session.md#round-evidence); link carried work/raw evidence instead of duplicating it. Create no owner-facing verification report unless requested.

- Before scope selection, inventory every owner question/task/constraint/correction/idea and map its source to an answer, task, applied constraint, deferred discussion or unresolved decision in existing records (chat off-record). Exclude feature-lifecycle exchanges/results from root records/summaries under [features](features.md). Reconcile inputs/corrections/results/exclusions before delivery; ideas authorize no implementation.

- Read [review](review.md) before result review or worker dispatch; load [Copilot](copilot.md) only for a Copilot host or selected Copilot route/profile. The host verifies and reviews every task. Unless fast-lane or the skip-review command applies, use configured review-order for result review after host verification for each task changing code, operational machine prompts, product artifacts, or implementation-ready plans/contracts. Ordinary Q&A, explanations and illustrative examples use host review; saving them in workflow records alone does not trigger independent review.

Explicit owner review requirements remain required unless the owner replaces them; apply task-mode precedence above.

Every Codex `spawn_agent` call explicitly sets `fork_turns: "none"` with complete task-message context; never inherit host conversation.

Outside fast-lane, prefer bounded native workers for substantial implementation and investigation, except looper tasks, which follow the [CLI preference](looper.md#prepare-and-route). Keep scope, decisions, integration and communication with the host. Except reached [append-rounds batches](batches.md), implement trivial/tightly coupled work directly; do not delegate for a quota.

## Execute and checkpoint

- Every change must trace to the Ask or repair a concrete failure preventing an accepted outcome. Keep adjacent improvements as proposals; neither they nor reviewer suggestions authorize implementation. Implement the whole accepted job, including later corrections.

- When accepted work changes a fact in maintained user/contributor/maintainer guidance or authorizes documentation authoring/handover, read [documentation guidance](product-docs.md), including its scoped authoring trigger; update affected owners/dependents alongside behavior, including fast-lane/skip-review. No doc impact means no doc record; a first-time suite requires an authorized documentation/handover outcome. Preserve scope, plan-only, gates and waived stages.

- Reproduce executable bugs before fixing; then check affected behavior and ordinary user journeys, including rendered output, saved data or actual receipt when requested. Reuse passing evidence until relevant source, inputs or environment change; name the uncovered risk before expanding checks. Unit tests, provider acceptance, receipt and deployment prove different things. For affected web journeys/requested end-to-end checks, read [browser testing](browser-testing.md).

- Inspect saved identity before retrying an external write with an unknown result. Unavailable required checks stay blocked/unproved; reviewer approval cannot replace them. Continue independent work.

- `omit-run: off`: append `## [RUN-NNN] Event — YYYY-MM-DD HH:mm:ss ±HHMM (A-NNN)` at substantial completed milestones; promptly record material blockers/decisions/recovery transitions needed before dependent work or safe resume. Batch routine reads/commands/edits/checks; no startup/dispatch entry unless material, transcript or duplicated tracker state. Use short outcome-first milestone/decision/blocker bullets linking saved evidence, never technical check/review accounting. Save remaining RUN facts once before Reply, optionally in closeout. `on`: omit RUN; keep proof/decisions in [Round evidence](session.md#round-evidence), recovery in Current/tracker.

- `omit-wip: off`: every ten active minutes, before context reset/unfinished handoff, save `## [WIP-NNN] Checkpoint — YYYY-MM-DD HH:mm:ss ±HHMM (A-NNN)` unless complete Reply is ready. Use `**Finished:**`, `**Running now:**` (observed handles/none), `**Still to do:**` (including blockers), `**Next work action:**`; link current tracker state, not repeated events. First inspect records/handles and compare changed paths with accepted scope (Ask if no tracker); linked evidence marks failed/unverified checks `[ ]` with explanation, absent/inapplicable records `N/A` with reason. Link this accounting; no devlog check footer or RUN solely for it. `on`: omit WIP but refresh tracker/STATUS recovery at the same boundaries. Suppressed RUN checks are N/A. Number RUN/WIP independently from 001 per Ask, continuing on resume; A-NNN is the Ask ID. Use actual-clock timestamps in shown timezone/format; concise chat updates.

- Tracker owns task state; devlog `Current:` links to it. Without a tracker, Current is the recovery note. Update canonical state; history states what was true then. After interruptions, verify running handles before replacing workers. Never promise background work without a live handle or automatic continuation the platform cannot provide.

- Inspect diffs; stage named paths/hunks, never `git add .`/`-A`. Follow [Git delivery](delivery.md#git-delivery): verified task changes first, owner edits in a separate commit, then configured push. Separate mixed files safely or report blocked delivery; add no release/deployment/send/deletion authority.

- On stop, immediately stop named work and tracked descendants, verify stopped state and preserve unrelated work. No relaunch without renewed authority; silence is not a hung-worker diagnosis.

## Diff handling

When asked for a diff, use a verified pre-edit snapshot or prior commit matching the requested comparison; never assume HEAD is the original. If unavailable, state that without inventing hunks. Preserve owner edits. Generate valid unified diffs with file headers, accurate `@@ -start,count +start,count @@` ranges and minimal context; fence Markdown diffs. Describe binary changes without fabricated text. For `show-diff`, group by filename with a concise `Reason:` per logical change. It requests presentation only, grants no edit authority or persistent setting change, and follows `inline-reply`.
