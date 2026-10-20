# aglite cheatsheet

The alphabetical chat commands below are owner instructions, not shell commands. Use unquoted. Looper has a separate [shell CLI](#looper-cli--alphabetical). Details: [guide](AG_GUIDE.md), [configuration](../references/configuration.md), [features](../references/features.md).

Owner-input capture: prefix each prose paragraph with `+ `; related paragraphs may share one first prefix. Preserve code interiors, existing prefixes and history; blank lines separate groups, with no standalone `--`. [Capture rule](../SKILL.md#activate-and-recover).

Codex subagents: every `spawn_agent` explicitly sets `fork_turns: "none"`; supply all necessary context in the task message. [Delegation](../SKILL.md#records-and-review).

Workflow proof: retain only evidence with a concrete recovery/review/decision use; omit routine success detail reproducible from source, preserving required proof and linked history. Keep technical verification, check/review results, invariant accounting and debugging logs out of the devlog, including STATUS, RUN/WIP and Reply; preserve historical records. Omit unnecessary detail; save useful new proof in `<ag-dir>/.tmp/A-NNN.md`, linked from Current and its producing Ask before Reply. Trackers retain task/recovery state and link proof rather than repeat it. Other notebooks use `<ag-dir>/.tmp/<notebook-basename>/A-NNN.md` with notebook/Ask identity; verify namespace association and choose a safe unused location on collision. Explicit destinations and established evidence locations remain unchanged. Devlogs retain concise outcomes, recovery pointers, required milestones/notices, answers, Questions and decision-changing blockers/limits. Before interruption/handoff, Current links directly to resume-critical evidence or to a tracker whose Recovery section links it; identify its purpose and next safe action, and keep STATUS Current linked to canonical recovery while work remains. Honor legacy Ask links without repeating them in new Asks. Multiple unfinished threads use one tracker, or labelled Current links to existing evidence when tracker creation is waived. Restart/resume reads these links before dependent work, checks notebook/Ask identity and live state, and leaves missing/mismatched proof unproved; no guessing from `.tmp` filenames. Preserve linked evidence; no automatic ignore/deletion or mandatory per-round file. Check Git ignores before creating/linking; use an unused nonignored artifacts path if needed and include it in authorized delivery. Lifecycle recovery keeps notebook/Ask identity, authorized operation/cleanup scope, exact retry-prevention refs, last proven result and next safe action; link proof, retaining pending gates/path updates and necessary failure/check/review/decision detail. Keep fresh safety checks; create no new record location or durable drop record. Preserve history. Keep each fact once; Reply retains answers and decision-changing limits. [Round evidence](../SKILL.md#round-evidence).

Codex/Claude Code handoffs use `/cd <destination>` then `godev`; every Codex/Claude Code surface must show successful creation using the exact three numbered template steps in the selected language: created branch/worktree, continuation commands and an editor-open suggestion with the actual configured feature-notebook path.

Creation paths are relative to the verified source session directory (absolute fallback when needed), explicitly labelled for the notebook; other handoffs use absolute paths; incomplete authorized cleanup uses its exact recovery command.

Verify host directory context, Git/configuration and notebook ownership before destination work; shell `cd` does not switch the session. Other hosts reopen at the destination.

Merge/drop must give numbered result and next-action steps. Step 1 may contain short indented paragraphs or sub-items, preserving required facts and step order.

A successful validated merge’s editor suggestion points to main’s configured root notebook, verified by metadata without reading or changing it; drop’s appears only for a verified surviving feature notebook outside Trash.

Main-rooted sessions explicitly remain in main; partial cleanup uses its exact recovery command and failed merges stay in their checkout.

Never abbreviate to a bare command block. Other hosts keep the numbered template with restart instructions.

## Optional browfield path

Use `browfield <task>` or ask for the eight-step brownfield procedure when a feature needs structured discovery of unfamiliar existing code. The host may also select it for a named material discovery/regression-protection need; an existing repository alone does not activate it. Once selected, the [bundled reference](../references/browfield.md) supplies discovery, rule tracing, impact/risk ranking, baseline characterization, specification, implementation, verification and preservation. Existing aglite modes, gates, records and review remain; advisor methods are reused only as needed. No separate skill installation or eight-advisor sequence.

## Commands — alphabetical

- **`3ways`** — Claude writes the main plan with complete context and approved source/prior-plan read access; Codex challenges/reviews. Keep Claude’s plan unless a high-confidence defect is proved. Selects 3ways for one plan, independently of review-order; unavailable routes degrade with honest labels, explicit constraints still prevail. No implementation approval. [Planning routes](../references/review.md#planning-routes).

- **`advisors: <names>`** — The host selects advice for named material questions needing structured investigation before dependent work; this command selects explicitly, e.g. `advisors: requirements, explore`. Available roles:

  - `acceptance` — Apply the canonical final-review checklist; reuse a matching required review.

  - `codewalk` — Map unfamiliar code.

  - `explore` — Compare alternatives/risks.

  - `final-audit` — Audit candidate readiness after ordinary checks/assembly, before external release: `advisors: final-audit` or a natural-language request to audit an identified release candidate; host selection needs a named gap within accepted release work. Reuse `acceptance` settings/review; no size/completion trigger. Focused advice returns gap findings/coverage/limits without a readiness verdict; missing required artifact rehearsal is unproved/NO-GO; GO grants no publication authority. [Prompt](../references/advisors/final-audit.md).

  - `learn` — Investigate lessons/failures.

  - `product-docs` — Resolve a named product-map, first-time suite, handover or substantial doc-drift gap; advice only, bundled `better`, missing role inherits. [Prompt](../references/advisors/product-docs.md).

  - `requirements` — Clarify intent/success; evidence-informed connected interview rounds when exploration is needed or `grill-me` requests it.

  - `security-scan` — Examine trust boundaries; select source/dependency/secret checks and record reproducible findings/coverage.

  - `spec` — Resolve a named contract gap in the existing design; no second specification.

  - `spike` — Experiment on one unknown.

- **`append-rounds <work>`** — Start a message with this command to stage one later batch; multiple tasks stay one batch. Preserve input/order in tracker Pending batches (Current-linked evidence without a tracker), outside active Ask. After current Reply, gates and delivery settle, execute each batch in its own Ask/Reply; ordinary messages steer current work. Bare command asks to resend with work; quoted examples do nothing. Off-record or lifecycle-containing batch requests are neither staged nor executed; resend ordinary work without an off-record marker, or resend remaining work without the lifecycle request and send the lifecycle command separately when ready. Staged commands/modes apply only when reached. Reached batches, even small/direct ones, prefer a fresh native implementation worker for separable work; fast-lane/explicit executor choices prevail. Host keeps queue, claims, acceptance and delivery. Worker settings, fallback and tracker rules remain in the linked batch rules. With no active work, pending batch or unsettled delivery and an empty trailing Ask, start there directly; otherwise stage in the same Current-linked pending section. Resume with `godev`; no host wake or reserved future IDs. [Batch rules](../SKILL.md#append-rounds).

- **`browfield [task]`** — Select the optional eight-step brownfield path within aglite for authorized features in unfamiliar existing code. Bare invocation uses a clear active task or asks which task; no persistent setting or invented work. [Procedure](../references/browfield.md).

- **`devlog`** — Activate aglite; prefer `godev` for start/resume.

- **`drop-feature <name>`** — Abandon feature; inspect local work, move checkout to verified Trash/Recycle Bin, delete branch. Run inside the target worktree (name optional there); remove it before handing off with `/cd <absolute-main-checkout>` then `godev`. Report in chat; no durable retirement record, root-notebook access or commit/push. A missing target notebook is allowed; target claims/Git locks still apply. No permanent-deletion fallback.

- **`fast-lane [task]`** — Small task, direct host execution; skip advisors, ordinary delegation/separate review, new design/tracker and routine RUN/WIP.

- **`gdd`** — Activation alias; prefer `godev`.

- **`godev [request]`** — Start/resume; initialize eligible fresh folders, asking before non-Git setup whether to create a Git repository; ask for work when idle.

- **`grill-me [topic]`** — Explicit adaptive requirements interview: inspect evidence first, ask connected rounds with alternatives/recommendation, use answers for follow-ups and stop when ready. At least one owner round confirms/corrects the inferred outcome, key assumptions and strongest relevant challenge. Bare command uses a clear active topic or asks for one without persisting a mode; quoted mentions do not trigger. Existing answer routing applies; no implementation authority.

- **`handle-tasks <request>`** — Prepare groups with optional earlier-group dependencies, then execute their queue; combines `prepare-tasks` and `run-tasks`. [Contract](../references/looper.md#prepare-and-route).

- **`merge-feature <name>`** — Verify/merge with feature-specific records/claims only; exclude main root-notebook/archive/claim changes. Retain checkout/branch; `and cleanup` retires both after required gates. Main’s notebook/claim never blocks it; Git conflicts/locks still apply.

- **`new-feature <name>`** — Prepare `.wts/ft-<name>` on `feature/<name>` without accessing main’s root notebook/archive/claim, even this session’s; no main checkpoint/release or retirement ledger. Record preparation in the feature notebook, then show the exact localized three-step creation handoff on every Codex/Claude Code surface (other hosts keep numbered steps with restart instructions). Git inventory replaces a ledger/index. No unspecified implementation.

- **`nolog: <request>`** — Execute/answer off-record; exclude this exchange from records and later summaries.

- **`noop: <request>`** — Same as `nolog:`; still executes.

- **`off: <request>`** — Same as `nolog:`.

- **`prepare-tasks <request>`** — Prepare Current-linked `planned/queue.json`, `planned/request.md` and `planned/group-NNN.md` under `<ag-dir>/artifacts/A-NNN-<name>/`, then stop. Run-root is `planned/`.

- **`run-tasks [run-root]`** — Start/resume the Current-linked prepared queue; an explicit root overrides it. Host launches the coordinator and handles native dispatch/owner answers.

- **`show-diff`** — Show verified file diffs with reasons; presentation only.

- **`skip: <request>`** — Same as `nolog:`.

- **`skip-review [task]`** — Host review only for one task; keep planning and checks, waive ordinary separate review including its risk-boundary rule.

`grill-me` explicitly selects its interview despite fast-lane’s advisor skip, retaining other rules; no persistent setting or mandatory worker/document. `fast-lane` and `skip-review` last until their task finishes, including resume; their bare invocation needs unfinished work. Neither changes settings. Host checks, explicit plans/reviews, gates and feature rules remain. `skip-review` replaces earlier review requests; same-message/later explicit reviews prevail. Off-record aliases affect one exchange only.

## Looper CLI — alphabetical

Install with `npm install -g <resolved-skill>`; the zero-dependency package registers `agf`. [Execution contract](../references/looper.md).

- **`agf loop run [run-root]`** — Start/resume the prepared queue; host launches it.

- **`agf loop status [run-root]`** — Read saved group/task totals, current tasks, completion/ready/integration state and questions without dispatch or mutation; also observe coordinator live/dead-or-uncertain/absent.

Shell root defaults to cwd; missing `queue.json` errors. Chat `run-tasks` resolves Current instead. Queue schema 2 is separate from `ag.json` schema 9.

`request` is a run-root-relative file path (normally `request.md`); required `request_sha256` preserves its exact preparation-time UTF-8 request. Commit the file with preparation. Missing/empty/unsafe/changed inputs block run/resume before claims; status reports input errors alongside progress. Schema 1 inline requests need explicit conversion, never silent adoption.

The owner-facing host reads top-level `ag.json` `next_update_date` (UTC `YYYY-MM-DD`; missing/null means due). Before that date it makes no release request; when due it checks only the [Agentflow stable feed](https://github.com/agfnow/agentflow/releases), then schedules the next check two calendar days later even if lookup fails. Delegates/isolated looper sessions and off-record exchanges do neither. Aglite is the beta name for Agentflow 9; Agentflow 8.x is never its upgrade. Replacement, including the 9+ transition, still requires approval and preserves source WIP. See [release checks](../references/configuration.md#session-release-check).

Queue JSON alone owns scheduling/progress; `ag.json` alone owns editable settings.

Set transport/provider/catalog in `looper-routes.task`, `repair`, `acceptance`; task/repair reuse `implementation`, review/renewed acceptance reuse `acceptance`.

Set `looper-limits.max-workers` (default 3), `max-repairs` (default 2). [Settings](../references/configuration.md#looper-settings).

Configure routes before running; bundled routes are empty rather than assuming a host. Each attempt saves its actual selection as evidence; resumed attempts keep it, while new attempts use the current invocation’s settings.

Groups use separate stable worktrees and sequential fresh ordinary task sessions, preserving workflow/review/executor settings. Optional `depends_on` lists unique earlier groups; wait without slots/worktrees until their checked integrations, then start from the latest checked target. Status names unmet IDs; started bases stay fixed.

Native dispatch needs the live host; CLI sessions support Codex/Claude without silent substitution.

Group records stay in `.aglite-records/`, excluded from product integration.

Ready groups merge FIFO through one target-wide lane. Clean checked merges add no agents; repairs retain independent review, acceptance and checks.

Questions block their group; answer the host while independent groups continue.

Resume preserves unfinished work and first proves old writers stopped; unresolved native attempts require host stopped attestation before supersession. Unsettled writers retain claims/slots. Each CLI attempt times out after 20 minutes and preserves/blocks unfinished work. No group gates, waves, final gate, promotion, cleanup, push or release authority.

## Quick recipes

Advice, design/tracker creation, delegation and model choice are separate decisions in one workflow. Already-needed planning follows `plan-order`, including prepare-tasks grouping; this creates no extra plan or advisor stage. Mandatory contracts stay in [host rules](../SKILL.md#records-and-review), final-review checks in [review.md](../references/review.md#inspect-the-finished-result); optional advisors add focused reasoning.

Planning: adequacy → accepted scope → minimality; preserve purpose and guarantees, justify additions/removals and count host attention/recovery. [Host rules](../SKILL.md#records-and-review) cover architecture checks, separate responsibility decisions and optional technical intake; [review](../references/review.md#inspect-the-finished-result) uses original inputs and explicit deltas. Run authorized checks; ask only unresolved authority/outcome/constraint choices. These checks add no document, mandatory alternative or review stage and do not reopen settled decisions without new conflicting evidence.

- **Small edit:** `fast-lane fix the README typo`.

- **Claude-led plan:** `3ways plan <topic>`.

- **Plan, then pause:** “Plan first and wait.”

- **Resume/answer:** `godev`; reply in chat or the saved question's `ans:` field.

- **Future work:** Ask to review backlog; select before execution. For already-chosen later work, send `append-rounds <work>` as a separate message for each batch. Each Reply is saved as its batch completes; the final receipt names the latest completed Ask, or inline-on displays all newly completed Replies in order before that receipt; include required notices from every newly completed batch in order.

- **Rename/archive:** Above 750 lines or on request, append older completed rounds to one adjacent `<notebook-stem>.archive.md`; preserve prior history, unresolved work and latest completed round. No numbered era files. Explicit notebook rename includes that archive.

- **Fresh folder:** `godev`; Git is optional: before setup writes, ask in chat (even with `inline-reply: off`) unless already explicitly chosen. Yes initializes Git; no continues without Git; no answer waits. Failures require inspected recovery; approval excludes pre-existing unrelated files, remotes and publication. Proactive setup requires no selected notebook, configured ag-dir, history or retirement. [Setup](../SKILL.md#first-time-setup) creates missing main/root backlog/empty registry and `artifacts/`, `features/`, `.tmp/` placeholders; adapts root config/resolved notebook, preserves existing/custom records and rejects unsafe paths. Managed feature initialization reuses shared records and creates only config/notebook. Empty registry creation still gets an invariant notice with no accepted IDs. Archives, round documents and actual worktrees remain on demand. Off-record/feature rules prevail; no automatic Git initialization or rules.md copy.

- **Registry comparison:** Retain each authoritative registry’s physical path and original exact-byte/SHA-256 baseline (or absence) at first task read; preserve across recovery, saving needed bytes/retrievable snapshot reference in existing evidence before interruption. Compare before shared-record writes and closeout; inspect all content/format diffs, retain original baseline and record accepted updates. Reconcile foreign changes without overwrite/silent adoption; missing baseline/bytes stays a disclosed proof limit. Content changes get the mandatory notice; path-only moves get relocation notice. Hash equality proves bytes only; no self-hash, sidecar or runtime. [Policy](../references/invariants.md#discover-and-reconcile).

- **Project rules:** Read the [shared baseline](../references/project-rules.md) plus optional local rules before work/review; no workflow activation by reading. Setup or an existing project’s next work session adds missing host-only default session-start use of the `aglite` skill, discovered, loaded and followed through that agent's supported skill mechanism, without fixing a host, path or installation scope; if unavailable, report the missing skill without assuming a path or auto-installing. Preserve owner overrides; report broken existing project-relative skill targets with a proposed correction, never silently accept/rewrite them; delegated workers/reviewers never activate from this directive. Later owner sessions need no `godev` when the host honors activation. Baseline reading may use installed/verified checkout-local source or host-supplied text; generated activation names the skill and leaves discovery to the host. Preserve existing overrides/custom paths; missing baseline defers shared-record writes/invariant or review acceptance; report the gap, continue independent authorized work.

- **Tracker labels:** Use `TODO` (not started), `DOING` (in progress, including checks/review/delivery), `BLOCKED` (cannot proceed; name blocker) and `DONE` (proved complete), e.g. `- [DOING] T-1 — Update activation`. Keep task IDs ordered; put goal/progress, Tasks, Recovery, then evidence links/update details. [Tracker contract](../SKILL.md#records-and-review).

- **Ask rounds:** Prefix every new Ask heading with standalone `---`, one blank line before and after, including initial and feature notebooks; preserve existing history. See [notebook rules](../SKILL.md#notebook-and-delivery).

- **Replies/reports:** [Ultimate comprehension first](../references/writing.md): brevity/formatting/terminology serve understanding. Conclusion first, plain words.

  Before every delivery, check that the intended reader can explain the result, relevant responsibilities, significance and needed decision/action without guessing or opening links; clarify or rewrite gaps.

  Use short, single-concept prose paragraphs or list items, usually 1–3 short sentences, with blank lines; lead each with its main point. Split long/multi-concept blocks before delivery; a single dense bullet fails too.

  Machine-only documents/skill prompts may be aggressively compressed without losing requirements, exceptions, safeguards, precision or correctness; mixed documents follow each audience’s rule.

  Saved Markdown line links use `path#<line-number>`, never `path:<line-number>`, with document-relative paths, e.g. `[features.md](../references/features.md#31)`; section links keep named anchors. In chat, follow host link requirements; otherwise use `#<line-number>` with verified checkout-root-relative paths, or absolute paths when the host cannot resolve relative targets. Never use report-relative `../` in chat. Wrap targets containing spaces in `<...>`.

  Reply/subrequest quotes: first paragraph, at most 100 Unicode code points including spaces/punctuation, without splitting a combined character (grapheme); `...` whenever text is omitted. Keep literal backticks without backslash escapes; cut before an unmatched backtick left by truncation. Preserve credential redaction and full Ask input.

  Cut repetition; list several documents as nested `-` items with blank lines.

  Every report opens with conclusions, key findings, applicable recommendations/decisions and material limits before detail; split rather than cut required content; keep the opening complete across short blocks. Postmortems/root-cause reports also lead with causes/prevention.

  Pass writing guidance to delegated report authors.

  Before consequential choices (including any changing accepted outcomes, guarantees or owner-chosen designs), explain requested/current and alternative approaches, who does what, retained/changed/lost capabilities and effect on the goal; name conflicts and distinguish tested behavior from assumptions/examples. Rewrite before asking if an unfamiliar reader cannot retell the work and consequence; respect settled decisions.

- **Unfinished handoff:** Keep work/authorization/recovery in the tracker, or Current without one; link canonical recovery from STATUS Current, keeping new Asks empty apart from owner input and honoring legacy Ask links. [Git delivery](../references/configuration.md#git-delivery) retains claim/retry/failure safeguards.

- **Closed-round claim release:** Verify Reply plus next Ask; settle task-owned workers/operations and save unfinished authority, exact identities and next action before yielding. Open-round pauses and feature-lifecycle exceptions retain their rules. Release grants neither completion nor approval. Reacquire/reread before continuing. See [ownership, identity and refusal rules](../SKILL.md#notebook-ownership) and [prior-delivery separation](../references/configuration.md#git-delivery).

- **Windows:** [Platform guidance](../references/windows.md); alternative cleanup needs same-volume recycle/restore proof and must refuse permanent deletion of the actual checkout.

- **Web checks:** Default to Stagehand automation code and Browserbase `browse` CLI Chrome operations ([official browser skill](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md)); owner/project preferences override. [Browser testing](../references/browser-testing.md) covers owned local/headless sessions, access safeguards and actual journey evidence. No new advisor or permission.

## `ag.json` → `switches` — alphabetical

Below: **values → effect; missing-key default**. Edit named keys explicitly. `ag.json` is checkout-root configuration; supplied `schema-version` must be the JSON integer `9`, incremented by one for future schema revisions. Known predecessor schema/values migrate on each host read, preserving valid choices and unknown/comment keys; unknown/newer schemas and ambiguous/lossy changes require a decision. Missing new keys follow defaults; current reads write nothing. [Migration](../references/configuration.md#automatic-migration). Package version is separate.

- **`ag-dir`** — Safe checkout-relative directory → record location; default `.agentflow`. No `..`/symlink escape. Path changes do not move files.

- **`auto-commit`** — `on`: commit verified work, owner edits separately; `off`: no automatic delivery commits. Git initialization approval still authorizes one immediate empty initial commit unless explicitly forbidden. Default `on`.

- **`auto-push`** — `on`: push authorized commits to verified remote/branch; `off`: no automatic push. Default `on`; does not enable commits.

- **`gate-design`** — `on`: await design approval before implementation; `off`: no added gate. Default `off`; overrides `skip-plan`.

- **`gate-tracker`** — `on`: await checked-result approval before final delivery; `off`: no added gate. Default `off`; no tracker → no gate. Feature integration prerequisites remain.

- **`inline-reply`** — `on`: full saved answer in chat; `off`: short receipt. Default `off`; only explicit chat/terminal display requests permit answers there. “Show me”, output examples and future-output changes do not. Verify saved answers silently; explicit answer display and `on` still end with the two-line receipt. Notices, unfinished work, the pre-setup Git choice, taskless setup and actual feature handoffs retain their operational rules; hypothetical handoffs stay saved.

- **`notebook-name`** — Safe filename under ag-dir → notebook; default `<short-dirname>.devlog.md` from the physical checkout root/session folder: lowercase ASCII, non-alphanumeric runs → `-`, trim, cap stem at 32 characters, trim trailing `-`; empty → `devlog.md`. New configuration saves the generated name. No paths or `.owner` suffix; explicit/feature routing prevails.

- **`plan-order`** — Already-needed planning, including advice that authors/revises plans and task grouping; default `external`. Interviews/evidence gathering keep ordinary advice rules. Fast-lane plans with host unless you explicitly select another task planning route. Claude leads where reachable; Codex challenges concrete defects. Start at the selected value and record inspected failures: `3ways → external → native → host`, `external → native → host`, or `native → host`; `host` is terminal. `native` means internal fresh-context planning. Invalid settings and explicit constraints still block incompatible fallback:

  - `3ways` — Claude primary plan → Codex challenge/review → host resolution.

  - `external` — Claude CLI planner; no automatic Codex challenge.

  - `native` — Fresh native planner; prefer Claude only if supported, label actual provider.

  - `host` — Active host plans directly; no worker probes.

- **`review-order`** — Ordinary order; [planner diversity](../references/review.md#inspect-the-finished-result) prefers a different family from the known principal planner, then another supported configured model, for already-required separate review. The host may reselect ordinary defaults with disclosure; task-level hard constraints prevail, and repeated family/model remains allowed with a disclosed limit.

  - `external` — Counterpart CLI → fresh-context native → labelled host fallback; default.

  - `native` — Native → counterpart CLI → host fallback.

  - `host` — Host directly; no worker probes.

- **`skip-asker`** — `on`: omit owner name from new Ask headings; `off`: include it. Default `on`.

- **`skip-plan`** — `on`: no new design/tracker; `off`: create when warranted. Default `off`; explicit requests/gates prevail.

- **`skip-run`** — `on`: omit RUN milestones; `off`: record them. Default `on`; keep evidence elsewhere.

- **`skip-wip`** — `on`: recovery elsewhere; `off`: WIP every ten active minutes, before context reset/unfinished handoff. Default `on`, setup template `off`.

- **`use-lang`** — Locale tag, e.g. `en-us`, `zh-TW` → chat/writing language; default detected OS locale, then `en-us`. Explicit target language prevails; input language alone does not switch it.

Planning/review constraints and required independence prevail over routing; unsupported selected model/effort needs a decision. Empty answers/defaults grant no approval. Git switches grant no publication authority. Planning workers use their selected advisor role, otherwise `threeways`; challenges use `threeways`, result review/final-audit use `acceptance`. Missing roles inherit transport defaults; the bundled/root roles include `product-docs: better`. Worker model/tier choices: [worker settings](../references/configuration.md#worker-settings).

## Product documentation

Update affected maintained guidance with accepted behavior changes, including fast-lane/skip-review; no impact means no doc record. Reuse reader roles in existing pages, one owner per changing fact and checked summaries/examples/translations. Optional multi-doc map: existing index or `<ag-dir>/doc-ledger.md`, default `.agentflow/doc-ledger.md`; private maps are not shipped dependencies. Check affected contradictions, links and necessary journeys/distribution; missing proof stays unproved. Ordinary host updates need no advisor/full audit; `advisors: product-docs` requests focused advice. [Maintenance](../references/product-docs.md).
