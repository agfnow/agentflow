<!--
`2026-08-13` agentflow pipeline of the agentflow skill. Loaded on demand by SKILL.md's Triage — never eagerly — so small work pays no pipeline tokens.
-->

# Agentflow pipeline

The pipeline turns user wishes (tasks) that produce or change product behavior into evidence: settled requirements, an implementable specification, isolated implementation, and independent acceptance. Understand the desired outcome, keep workflow details hidden unless the owner asks, and choose the smallest route that preserves the required evidence.

## Standing context

- This file never runs standalone. When it loads, the devlog protocol is already active: $target_doc (`devlog.md`) is the single owner conversation surface, and `references/delegation.md` is the delegation rulebook for every dispatch — its confinement rules and background-process watchdog are mandatory here.

- The verbatim pass-down blocks (KISS, scope discipline) live in SKILL.md's "Design and scope discipline" section; copy them word for word into every advisor and coder brief.

- Model routing follows delegation.md's model family guide; the Advisor defaults below only say which station gets which tier. External-CLI dispatch is subject to $cli_provider (`off` removes other-family CLIs, keeping only the same-host CLI as a confinement fallback per SKILL.md Modes; `any`/`codex`/`claude` permit it).

- **Fail closed on unenforceable isolation:** when no available executor can enforce a brief's declared write authority, do not dispatch — report in `devlog.md` that the required evidence chain is unavailable, and ask the owner with the smallest safe alternative as the suggested default.

## Front door and recovery

- Read `STATUS`, the latest unfinished Ask, Git state, and relevant current artifacts (including `runlog.md`) before choosing the next action.

- Use `devlog.md` as the only owner conversation surface for questions, suggested defaults, progress, evidence, fallbacks, and next actions.

- Record stable decisions, the selected route, exact artifact paths, evidence, and dependency state in the current round, while keeping advisor names, filenames, model parameters, and routing syntax hidden unless the owner asks to inspect or control them.

## Route selection

- Answer pure explanations, status requests, and codebase questions directly in `devlog.md` without creating pipeline artifacts.

- For every wish that proceeds to code, run `references/advisors/requirements.md` → `references/advisors/spec.md` → one coding subagent → `references/advisors/acceptance.md`; when accepted decisions already cover the work, requirements may scale down to confirming or refreshing the final summary, and brownfield work also runs `references/advisors/codewalk.md` before dependent specification work, scaled down to a freshness confirmation or delta update when an exact-surface map is current. Requirements and brownfield codewalk cannot be omitted because owner intent, repository evidence, an implementable contract, isolated implementation, and independent acceptance are the minimum development evidence.

- Use evidence-triggered advisors only for their named need: `references/advisors/explore.md` for material risk or uncertainty after requirements and discovery; `references/advisors/spike.md` for one technical question needing observed evidence before specification; `references/advisors/security-scan.md` over changed files and affected trust boundaries when security is touched or requested; and `references/advisors/learn.md` after a real lesson, error, surprise, workaround, or recommendation, not an uneventful task.

- Mandatory advisors may scale down but still produce their artifact; evidence-triggered advisors may decline with a short prose explanation.

- **Scale-down changes depth, never authorship.** Every mandatory artifact — requirements, brownfield codewalk, specification, acceptance — is produced by a fresh dispatched executor under the Subagent execution contract, including its scaled-down forms (a freshness confirmation, a delta update, a summary refresh). An evidence-triggered advisor answered "run" is also dispatched fresh; otherwise it is declined with the required runlog evidence. A coordinator read or a coordinator-authored file never satisfies an advisor station, and acceptance is never coordinator-authored in any form. — incident 2026-08-14: two e2e coordinators "scaled down" requirements, spec, and acceptance to self-authored artifacts (one omitted requirements.md and codewalk.md entirely), dissolving independent acceptance.

- Reconsider the route after every report instead of launching the remaining pipeline in advance.

### Trigger questions — auditable skips

The evidence-triggered advisors run on the master's judgment, and a prompt-only skill cannot enforce judgment in software. The control is visibility: before running or skipping any of the four, answer its fixed trigger question in the runlog in one line, with the concrete evidence behind the answer.

- explore: does material risk or uncertainty remain after requirements and discovery?

- spike: does one named technical question need observed evidence before the specification can be trusted?

- security-scan: does the change touch security or a trust boundary, or did the owner request a scan?

- learn: did this work item produce a real lesson, error, surprise, workaround, or recommendation?

Fail-safe: a skip is legal only when the master can cite concrete evidence for "no". When the answer is uncertain, run the advisor or ask the owner — never skip on uncertainty. Stated honestly: this reduces under-triggering and makes every trigger decision a written, dated fact the owner can audit, but judgment stays with the model — a prompt-only skill cannot eliminate it, and the sign-off gates cannot catch every wrong skip (a wrongly skipped security scan is invisible to a spec-sealed acceptance).

### Second triage guard

- If the pipeline receives a trivial development wish with no product ambiguity, no new behavior contract, and one bounded mechanical change, ask a `devlog.md` deviation question with the direct route as its suggested default — a one-paragraph mini-spec, one coding subagent, the master's verification, and no artifact directory — and pause unless $auto_reply_mode `on` applies that default.

- When the ask carries the `all_in` control phrase (defined in SKILL.md's Triage), this guard is closed: the deviation question is not asked and the direct route may not be taken. Additionally, every trigger question above is answered "run" for that ask, and no mandatory advisor may scale down — full depth, full artifacts, with the phrase's presence noted in the runlog.

### Natural-language triggers

```text
“I have an idea” starts by settling requirements.
“Where should I change this?” maps the brownfield surface before dependent work.
“Explain this code” is answered directly when no behavior change is requested.
“Define the behavior” settles owner intent, then creates the specification.
“Implement this feature” follows the required development chain.
“This is broken” adds a tight reproduction and regression loop during coding.
“Test this approach first” may add one spike for the named uncertainty.
“Review this security-sensitive change” adds a scan over the declared boundary.
“Is this ready?” checks the accepted specification against the implementation.
“Continue” recovers the current route and evidence from the devlog and Git state.
“Learn from this incident” adds a lesson only when the evidence supports one.
```

## Artifact namespace

- Allocate one root per branch and work item at `artifacts/<branch-key>/<work-key>/`, and allocate every exact path before dispatch.

- Derive `<branch-key>` from the current Git branch by replacing unsafe path characters and `/` with `-`, or use `detached-<short-commit>` or `no-branch`; write the raw branch identity to `artifacts/<branch-key>/.branch` in the first artifact commit, and use the smallest numeric suffix when an existing or merge-conflicted marker names another identity.

- Assign one short stable `<work-key>` when accepting the wish, record it in the current devlog round, and use the smallest numeric suffix when that key collides.

- Use canonical current-state filenames `requirements.md`, `codewalk.md`, `explore.md`, `spec.md`, `implementation-report.md`, `security-scan.md`, `acceptance.md`, `learn.md`, and `runlog.md`; put each spike at `spikes/<question-key>.md` and its throwaway code under `spikes/scratch/`.

- **Every artifact document opens with one stamp line before any other content:** `* _<YYYY-MM-DD HH:MM:SS> (<model/effort>)_` — Taipei time plus the exact model that wrote the file (for example `claude-fable-5/medium`), same shape as the devlog Reply stamp. The writer stamps its own output: an advisor or coder uses the Model and Effort values from its brief; the master stamps the files it writes itself. `runlog.md` stamps its allocation once at the top; its entries already carry their own timestamps. Obtain the time by shelling out immediately before writing each stamp — never copy, round, reuse, or project one — and always write the full `<model>/<effort>` pair from the runtime or brief (`metadata unavailable` when the runtime provides none, never an invented or shortened identity). — incident 2026-08-14: a session that ended at 16:06 stamped its artifacts 16:20 and 16:22, with the effort field dropped.

- Create only files required by the selected route; do not create empty placeholders.

- Commit a canonical artifact before replacing it, and keep all of `artifacts/`, including every `.branch` marker, Git-tracked and committed. Git is the current-state artifact history and branch identity must survive merges.

- If `.gitignore` explicitly excludes `artifacts/`, ask the owner in `devlog.md` instead of force-adding it.

- Advisors receive exact paths and do not scan `artifacts/` for a likely or latest file.

## Runlog — the execution audit trail

- **Governed by the `runlog` setting (SKILL.md Modes, default `on`).** When `runlog: off`, do NOT allocate, create, or append to `runlog.md` — skip every rule in this section, including the reconcile-before-Reply step; the devlog round remains the record of route, dispatches, and decisions. Everything below applies only while `runlog: on` (the default).

- Append one entry to `artifacts/<branch-key>/<work-key>/runlog.md` at the moment each pipeline event happens, so the owner can audit afterward exactly what ran, in what order, what was skipped and why, and what went wrong.

- Entry shape: `## <Taipei timestamp> — <step name>` plus a few short bullets. When a result lives in its own artifact, name that file instead of duplicating its content.

- Allocate `runlog.md` when the pipeline route is accepted, together with the other artifact paths.

- Events that must land in the runlog: every route decision, including every skipped or declined advisor with its trigger-question answer; every dispatch — advisor, executor kind (built-in subagent or which external CLI), model, effort, and the active mode values; every result (accepted, or rejected with the reason — for example why a report was sent back); every sign-off gate verdict; every $auto_reply_mode auto-answer; every model substitution or fallback; and every error, hang, kill, relaunch, deviation, or surprise.

- Single writer: only the master writes `runlog.md`; advisor briefs never name it as an input or output.

- **Reconcile before every Reply:** before writing a round's Reply in `devlog.md`, check `runlog.md` against all work performed since its last entry; every event this section requires must already be present. Append any missing entries first, and record the late repair itself as a deviation. — incident 2026-08-14: an e2e run logged only the allocation entry; the coding dispatch, both gate verdicts, the scan, and acceptance all went unlogged.

- The trivial direct route has no artifact directory, so its record stays in the devlog round; state there that the direct route ran.

## Dependencies and invalidation

- Keep the dependency view current in `devlog.md`, and rerun only evidence affected by a change.

- A changed owner decision invalidates its dependent exploration, specification, implementation, security, and acceptance evidence.

- A changed brownfield surface invalidates affected codewalk claims and specification assumptions.

- A new exploration or spike finding invalidates the affected specification section.

- A changed specification invalidates implementation completion and every post-implementation report for the changed behavior.

- A changed implementation invalidates affected security and acceptance evidence.

- A late requirements change requires the affected specification to be refreshed before implementation continues.

## Owner sign-off gates

Both gates run whenever a new or changed requirements or spec artifact is about to authorize coding — one after the requirements final summary, one after the specification. Both direct routes are exempt because neither creates such an artifact: the outer triage-direct route (which never enters this file) and this file's second-guard direct route (the only one with a deviation question).

- With `auto_reply: off`, ask one batched `devlog.md` question — "does this requirements summary match your wish?" or "does this spec match your wish?" — with suggested default yes, and pause dependent stages until the owner answers. A suggested default is not an owner answer. Keep each unanswered `Q-<n>` or `D-<n>` open, and do not relabel it as an owner decision or use its suggested value as a fixed observable behavior, scope, or constraint. Continue only with work that does not depend on that decision. — incident: A-016 learn review P-1; both live trials silently promoted suggested defaults to "owner decisions".

- With `auto_reply: on`, perform the review yourself on the owner's behalf and record the verdict in the runlog: at the requirements gate, check every `R-<n>` and every decision used by later artifacts against ALL recorded accepted owner statements — the verbatim ask plus later devlog answers and explicit auto-answers. An explicit auto-answer must name the `Q-<n>` or `D-<n>` it resolves. At the spec gate, check that the coverage ledger maps every `R-<n>` to a spec section and its `INV-<n>` IDs, and do not treat a decision still marked open as settled. Escalate to the owner only on a found mismatch.

## Subagent execution contract

Every advisor call uses a fresh executor — the host's subagent mechanism or, when $cli_provider is not `off`, an external CLI per delegation.md — and this frozen brief:

```text
Advisor: <name>
Advisor prompt: <exact references/advisors/... path>
Goal: <one bounded result>
Repository root: <exact path>
Read inputs: <exact paths only>
Write output: <one exact artifact path>
Model: <selected model>
Effort: <selected effort>
Output language: <the resolved $output_language — detected once by the master;
                  never re-detect inside the sandbox>
Write authority: source read-only; exactly the output path is writable.
                 Spike additionally gets its declared scratch directory.
                 Acceptance additionally gets execute rights for the declared
                 build/test commands, run in a disposable clone or worktree by
                 default (per delegation.md's confinement shapes); bounded
                 write authority over those commands' own output paths
                 (caches, coverage, generated files, build directories) in
                 the real checkout is the fallback only when a disposable
                 root is unavailable, with git status verified afterward.
                 It never intentionally edits source or other artifacts.
Owner decisions: <only the current accepted decisions needed here>
Completion: open the report with the stamp line
            `* _<YYYY-MM-DD HH:MM:SS> (<Model>/<Effort>)_` (Taipei time,
            obtained by shelling out — never guessed; Model/Effort from this
            brief), write the report, then return its path and a short
            factual summary
```

- Include the exact-scope and KISS rules — SKILL.md's verbatim pass-down blocks — and only the evidence needed for the bounded call.

- Advisors put missing decisions in their report and do not ask the owner directly.

- Read every report, verify that its artifact exists, check practical claims, and read its final `Self-check:` line; a report whose self-check names a failed invariant is rejected and redone, and a completion message is not acceptance evidence. Then decide the next route.

- Run every dispatch under delegation.md's background-process watchdog: a stated deadline, an early check, periodic liveness checks, an independent fallback wake armed whenever a turn ends with the dispatch still running, termination and `devlog.md` reporting for a hang, and at most one corrected relaunch. — incident 2026-08-01: an unbounded background test wait cost about ten silent hours.

## Model, effort, and advisor defaults

- **Executor choice per dispatch:** the host's built-in subagent mechanism, or — when $cli_provider is not `off` — an external CLI from a different model family (under `off`, the same-host CLI stays available as a confinement fallback per SKILL.md Modes). The master chooses per dispatch at its discretion, under delegation.md.

- Use a high-level planner/reviewer tier from delegation.md's model family guide for `references/advisors/requirements.md`, `references/advisors/codewalk.md`, `references/advisors/explore.md`, `references/advisors/spike.md`, `references/advisors/spec.md`, and `references/advisors/security-scan.md`.

- Use the default worker tier for the coding subagent; use a planner/reviewer tier for `references/advisors/acceptance.md`, preferring a model family decorrelated from the coder model. When $cli_provider leaves no different-family worker available (`off`, or a family name equal to the host's own), use the strongest available same-family reviewer and record the substitution.

- Apply an owner's model or effort override to one call, one phase, or the whole work item as stated.

- If a model the master selected itself is unavailable, fall back to the nearest available tier and record the substitution in the runlog and round. If the unavailable model was an owner override, ask and pause — never substitute silently (unless the owner explicitly allows it).

- If any route, model, effort, artifact, or content choice conflicts with an explicit owner instruction, ask a `devlog.md` question with a suggested compliant default and pause affected work unless an approved fallback or $auto_reply_mode `on` applies.

## Coding subagent handoff

Dispatch one coding subagent with the accepted specification and exact relevant evidence paths. Its frozen brief requires it to:

- Decompose internally at the smallest useful size and implement the complete approved specification.

- **Stop and return when a gap appears, at any stage:** if internal planning or decomposition — or the implementation work itself — finds an unclear, ambiguous, contradictory, wrong, or missing requirement or specification, stop immediately and return the concrete question to the master instead of guessing or inventing a product decision — the master reruns the affected requirements or specification work until the question is settled, then re-dispatches coding with the refreshed contract.

- Deliver narrow end-to-end vertical slices across affected layers through small, useful public seams that permit behavior tests without reaching into internals, keeping each change and its tests together and avoiding abstractions without a current need.

- Use red-capable feedback loops: for TDD, agree the seam, write the behavior test, confirm the intended red result, make the smallest green change, and refactor with tests green; for bugs, minimize the reproduction, probe falsifiable causes, lock the fix with a regression test, and rerun the original symptom.

- Keep every regression test in the same commit as its fix.

- Run focused tests while working and the repository's declared verification before completion, then verify every specification invariant under its existing `INV-<n>` ID.

- Preserve existing user changes and stay inside approved scope.

- Write `implementation-report.md` — opening with the artifact stamp line (its own model/effort, per the Artifact namespace rule) — with changed files, invariant coverage, commands and results, open issues, and commit identity.

## Acceptance and completion

- Give `references/advisors/acceptance.md` the accepted specification, the requirements final summary, implementation report, changed repository state, relevant codewalk, and security report when present; require it to first verdict every `R-<n>` as covered, missing, or not proven, then re-verify every `INV-<n>` with executed evidence, keeping behavior findings separate from code-quality and convention findings. A missing requirements record is missing evidence: acceptance reports it and cannot conclude.

- When acceptance finds a violated or unproven invariant, or a missing or unproven requirement: preserve untouched evidence, invalidate only affected security and acceptance evidence, rerun the affected upstream stage carrying the named corrections — specification for a dropped or unmapped requirement, coding for a behavior violation — and re-run acceptance for the affected IDs. If the correction would change observable behavior, scope, or an invariant's starting condition, treat that correction as an owner decision. Do not amend the specification, call the choice settled, or dispatch coding until the owner answers or an explicit auto-answer is recorded in the devlog. — incident: A-016 learn review P-2; trial v2's coordinator narrowed a failed contract (D-11) and labeled its own ruling an owner decision.

- Run at most two automatic fix-and-reverify rounds; after the second failure, ask the owner in `devlog.md` with evidence and remaining options. This escalation is an owner-must-decide question by nature (hard-stop category 1 in SKILL.md's Modes): it is never auto-answered, in any mode — under `auto_reply: on` the turn still ends and waits for the owner, so the two-round cap is a true ceiling.

- Claim completion only when required artifacts exist, current acceptance verdicts every agreed `R-<n>` as covered — `missing` and `not proven` both block completion — and every `INV-<n>` as satisfied, relevant security evidence is current, declared verification passes, and Git state supports the claim.
