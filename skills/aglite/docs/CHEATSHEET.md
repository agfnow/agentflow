# aglite cheatsheet

The alphabetical chat commands below are owner instructions, not shell commands. Use unquoted. Looper has a separate [shell CLI](#looper-cli--alphabetical). Details: [guide](AG_GUIDE.md), [configuration (configuration.md, line 1)](../references/configuration.md), [features (features.md, line 1)](../references/features.md).

Owner-input capture: prefix each prose paragraph with `+ `; related paragraphs may share one first prefix. Preserve code interiors, existing prefixes and history; blank lines separate groups, with no standalone `--`. [Capture rule (session.md, line 5)](../references/session.md#activate-and-recover).

Codex subagents: every `spawn_agent` explicitly sets `fork_turns: "none"`; supply all necessary context in the task message. [Delegation (review.md, line 32)](../references/review.md#give-one-bounded-assignment).

Workflow evidence belongs outside the devlog. Keep useful technical checks, review findings, invariant accounting and debugging proof in linked evidence; the devlog keeps outcomes, answers, required notices and recovery pointers.

Use `<ag-dir>/.tmp/A-NNN.md` for useful new proof, linked from Current and its producing Ask before Reply. Other notebooks use `<ag-dir>/.tmp/<notebook-basename>/A-NNN.md`; verify the notebook and Ask identity before reuse.

Existing explicit destinations remain authoritative. Check Git ignores before creating evidence, choose a safe unused nonignored location on collision, and include the evidence in authorized delivery.

Before interruption, link resume-critical evidence directly from Current or through a tracker's Recovery section. Name its purpose and the next safe action; STATUS Current keeps the canonical recovery link while work remains.

Resume reads those links and verifies identity and live state before dependent work. Missing or mismatched proof remains unproved; filenames alone are not proof.

Honor legacy Ask links without copying them into new Asks. New Asks contain owner input, while Current and trackers carry recovery links.

Preserve linked evidence and history. There is no automatic deletion, ignore rule or required file for every round; keep each fact once.

Lifecycle recovery also retains the authorized operation/cleanup scope, exact retry-prevention references, last proven result, pending gates/path updates and next safe action. Multiple unfinished threads use one tracker, or labelled Current evidence links when tracker creation is waived.

Follow the complete [Round evidence (session.md, line 45)](../references/session.md#round-evidence) rules for recovery and proof placement.

Codex/Claude Code handoffs use `/cd <destination>` then `godev`; every Codex/Claude Code surface must show successful creation using the exact three numbered template steps in the selected language: created branch/worktree, continuation commands and an editor-open suggestion with the actual configured feature-notebook path.

Creation paths are relative to the verified source session directory (absolute fallback when needed), explicitly labelled for the notebook; other handoffs use absolute paths; incomplete authorized cleanup uses its exact recovery command.

Verify host directory context, Git/configuration and notebook ownership before destination work; shell `cd` does not switch the session. Other hosts reopen at the destination.

Merge/drop must give numbered result and next-action steps. Step 1 may contain short indented paragraphs or sub-items, preserving required facts and step order.

A successful validated merge’s editor suggestion points to main’s configured root notebook, verified by metadata without reading or changing it; drop’s appears only for a verified surviving feature notebook outside Trash.

Main-rooted sessions explicitly remain in main; partial cleanup uses its exact recovery command and failed merges stay in their checkout.

Never abbreviate to a bare command block. Other hosts keep the numbered template with restart instructions.

## Optional browfield path

Use `browfield <task>` or ask for the eight-step brownfield procedure when a feature needs structured discovery of unfamiliar existing code. The host may also select it for a named material discovery/regression-protection need; an existing repository alone does not activate it.

Once selected, the [bundled reference (browfield.md, line 1)](../references/browfield.md) supplies discovery, rule tracing, impact/risk ranking, baseline characterization, specification, implementation, verification and preservation. Existing aglite modes, gates, records and review remain; advisor methods are reused only as needed. No separate skill installation or eight-advisor sequence.

## Commands — alphabetical

- **`3ways`** — Claude writes the main plan with complete context and approved source/prior-plan read access; Codex challenges/reviews. Keep Claude’s plan unless a high-confidence defect is proved.

  Selects 3ways for one plan, independently of review-order; unavailable routes degrade with honest labels, explicit constraints still prevail. No implementation approval. [Planning routes (review.md, line 54)](../references/review.md#planning-routes).

- **`advisors: <names>`** — The host selects advice for named material questions needing structured investigation before dependent work; this command selects explicitly, e.g. `advisors: requirements, explore`. Available roles:

  - `acceptance` — Apply the canonical final-review checklist; reuse a matching required review.

  - `codewalk` — Map unfamiliar code.

  - `explore` — Compare alternatives/risks.

  - `final-audit` — Audit candidate readiness after ordinary checks/assembly, before external release: `advisors: final-audit` or a natural-language request to audit an identified release candidate; host selection needs a named gap within accepted release work. Reuse `acceptance` settings/review; no size/completion trigger.

    Focused advice returns gap findings/coverage/limits without a readiness verdict; missing required artifact rehearsal is unproved/NO-GO; GO grants no publication authority. [Prompt (final-audit.md, line 1)](../references/advisors/final-audit.md).

  - `learn` — Investigate lessons/failures.

  - `product-docs` — Resolve a named product-map, first-time suite, handover or substantial doc-drift gap; advice only, bundled `better`, missing role inherits. [Prompt (product-docs.md, line 1)](../references/advisors/product-docs.md).

  - `requirements` — Clarify intent/success; evidence-informed connected interview rounds when exploration is needed or `grill-me` requests it.

  - `security-scan` — Examine trust boundaries; select source/dependency/secret checks and record reproducible findings/coverage.

  - `spec` — Resolve a named contract gap in the existing design; no second specification.

  - `spike` — Experiment on one unknown.

- **`append-rounds <work>`** — Start a message with this command to stage one later batch; multiple tasks stay one batch. Preserve input/order in tracker Pending batches (Current-linked evidence without a tracker), outside active Ask.

  After current Reply, gates and delivery settle, execute each batch in its own Ask/Reply; ordinary messages steer current work. Bare command asks to resend with work; quoted examples do nothing.

  Off-record or lifecycle-containing batch requests are neither staged nor executed; resend ordinary work without an off-record marker, or resend remaining work without the lifecycle request and send the lifecycle command separately when ready. Staged commands/modes apply only when reached.

  Reached batches, even small/direct ones, prefer a fresh native implementation worker for separable work; fast-lane/explicit executor choices prevail. Host keeps queue, claims, acceptance and delivery. Worker settings, fallback and tracker rules remain in the linked batch rules.

  With no active work, pending batch or unsettled delivery and an empty trailing Ask, start there directly; otherwise stage in the same Current-linked pending section. Resume with `godev`; no host wake or reserved future IDs. [Batch rules (batches.md, line 1)](../references/batches.md#append-rounds).

- **`append-tasks <work>`** — Exact alias of `append-rounds`: all batch rules apply, and captured input keeps the spelling you typed. It adds later Ask/Reply batches, not tasks to a looper queue. [Batch rules (batches.md, line 1)](../references/batches.md#append-rounds).

- **`browfield [task]`** — Select the optional eight-step brownfield path within aglite for authorized features in unfamiliar existing code. Bare invocation uses a clear active task or asks which task; no persistent setting or invented work. [Procedure (browfield.md, line 1)](../references/browfield.md).

- **`devlog`** — Activate aglite; prefer `godev` for start/resume.

- **`drop-feature <name>`** — Abandon feature; inspect local work, move checkout to verified Trash/Recycle Bin, delete branch. Run inside the target worktree (name optional there); remove it before handing off with `/cd <absolute-main-checkout>` then `godev`.

  Report in chat; no durable retirement record, root-notebook access or commit/push. A missing target notebook is allowed; target claims/Git locks still apply. No permanent-deletion fallback.

- **`fast-lane [task]`** — One task, direct host execution; skip advisors, ordinary delegation/separate review, new design/tracker and routine RUN/WIP.

- **`gdd`** — Activation alias; prefer `godev`.

- **`godev [request]`** — Start/resume; initialize eligible fresh folders, asking before non-Git setup whether to create a Git repository; ask for work when idle.

- **`grill-me [topic]`** — Explicit adaptive requirements interview: inspect evidence first, ask connected rounds with alternatives/recommendation, use answers for follow-ups and stop when ready. At least one owner round confirms/corrects the inferred outcome, key assumptions and strongest relevant challenge.

  Bare command uses a clear active topic or asks for one without persisting a mode; quoted mentions do not trigger. Existing answer routing applies; no implementation authority.

- **`handle-tasks <request>`** — Prepare groups with optional earlier-group dependencies, then execute their queue; combines `prepare-tasks` and `run-tasks`. [Contract (looper.md, line 23)](../references/looper.md#prepare-and-route).

- **`merge-feature <name>`** — Verify/merge with feature-specific records/claims only; exclude main root-notebook/archive/claim changes. Retain checkout/branch; `and cleanup` retires both after required gates. Main’s notebook/claim never blocks it; Git conflicts/locks still apply.

- **`new-feature <name>`** — Prepare `.wts/ft-<name>` on `feature/<name>` without accessing main’s root notebook/archive/claim, even this session’s; no main checkpoint/release or retirement ledger.

  Record preparation in the feature notebook, then show the exact localized three-step creation handoff on every Codex/Claude Code surface (other hosts keep numbered steps with restart instructions). Git inventory replaces a ledger/index. No unspecified implementation.

- **`nolog: <request>`** — Execute/answer off-record; exclude this exchange from records and later summaries.

- **`noop: <request>`** — Same as `nolog:`; still executes.

- **`off: <request>`** — Same as `nolog:`.

- **`prepare-tasks <request>`** — Prepare Current-linked `planned/queue.json`, `planned/request.md` and `planned/group-NNN.md` under `<ag-dir>/artifacts/A-NNN-<name>/`, then stop. Run-root is `planned/`.

- **`run-tasks [run-root]`** — Start/resume the Current-linked prepared queue; an explicit root overrides it. Prefer CLI when choosing task routes; host launches the coordinator and handles owner answers or explicitly selected native dispatch.

- **`show-diff`** — Show verified file diffs with reasons; presentation only.

- **`skip: <request>`** — Same as `nolog:`.

- **`skip-review [task]`** — Host review only for one task; keep planning and checks, waive ordinary separate review including its risk-boundary rule.

`grill-me` explicitly selects its interview despite fast-lane’s advisor skip, retaining other rules; no persistent setting or mandatory worker/document. `fast-lane` and `skip-review` last until their task finishes, including resume; their bare invocation needs unfinished work. Neither changes settings.

Host checks, explicit plans/reviews, gates and feature rules remain. `skip-review` replaces earlier review requests; same-message/later explicit reviews prevail. Off-record aliases affect one exchange only.

## Looper CLI — alphabetical

Install with `npm install -g <resolved-skill>`; the zero-dependency package registers `agf`. [Execution contract (looper.md, line 1)](../references/looper.md).

- **`agf loop run [run-root]`** — Start/resume the prepared queue; host launches it.

- **`agf loop status [run-root]`** — Read saved group/task totals, current tasks, completion/ready/integration state and questions without dispatch or mutation; also observe coordinator live/dead-or-uncertain/absent.

Shell root defaults to cwd; missing `queue.json` errors. Chat `run-tasks` resolves Current instead. Queue schema 2 is separate from `ag.json` schema 12.

`request` is a run-root-relative file path (normally `request.md`); required `request_sha256` preserves its exact preparation-time UTF-8 request. Commit the file with preparation. Missing/empty/unsafe/changed inputs block run/resume before claims; status reports input errors alongside progress. Schema 1 inline requests need explicit conversion, never silent adoption.

The owner-facing host reads top-level `ag.json` `next_update_date` (UTC `YYYY-MM-DD`; missing/null means due). Before that date it makes no release request; when due it checks only the [Agentflow stable feed](https://github.com/agfnow/agentflow/releases), then schedules the next check two calendar days later even if lookup fails.

Delegates/isolated looper sessions and off-record exchanges do neither. Aglite is the beta name for Agentflow 9; Agentflow 8.x is never its upgrade. Replacement, including the 9+ transition, still requires approval and preserves source WIP. See [release checks (configuration.md, line 29)](../references/configuration.md#session-release-check).

Queue JSON alone owns scheduling/progress; `ag.json` alone owns editable settings.

Set transport/provider/catalog in `looper-routes.task`, `repair`, `acceptance`; task/repair reuse `implementation`, review/renewed acceptance reuse `acceptance`.

Set `looper-limits.max-workers` (default 3), `max-repairs` (default 2). [Settings (looper.md, line 5)](../references/looper.md#looper-settings).

Configure routes before running; bundled routes stay empty. When selecting task routes for `handle-tasks`/`run-tasks`, prefer `cli`, including Codex CLI tasks launched by the coordinator through `codex exec` on a Codex host; preserve explicit native choices without silent fallback.

Each attempt saves its actual selection as evidence; resumed attempts keep it, while new attempts use the current invocation’s settings.

Groups use separate stable worktrees and sequential fresh ordinary task sessions, preserving workflow/review/executor settings. Optional `depends_on` lists unique earlier groups; wait without slots/worktrees until their checked integrations, then start from the latest checked target. Status names unmet IDs; started bases stay fixed.

Native dispatch needs the live host; CLI sessions support Codex/Claude/Copilot without silent substitution.

Each CLI task uses a new short-lived process with bounded context, no inherited conversation or session resume, and exits before the next task in its group's isolated worktree.

Codex task/repair commands keep workspace-write restrictions and permitted outbound network; `CODEX_SANDBOX_NETWORK_DISABLED=1` in the parent retains the network block.

Group records stay in `.aglite-records/`, excluded from product integration.

Ready groups merge FIFO through one target-wide lane. Clean checked merges add no agents; repairs retain independent review, acceptance and checks.

Questions block their group; answer the host while independent groups continue.

Resume preserves unfinished work and first proves old writers stopped; unresolved native attempts require host stopped attestation before supersession. Unsettled writers retain claims/slots. Each CLI attempt times out after 20 minutes and preserves/blocks unfinished work. No group gates, waves, final gate, promotion, cleanup, push or release authority.

## Quick recipes

Advice, design/tracker creation, delegation and model choice are separate decisions in one workflow. Already-needed planning follows `plan-order`, including prepare-tasks grouping; this creates no extra plan or advisor stage. Mandatory contracts stay in [host rules (planning.md, line 1)](../references/planning.md), final-review checks in [review.md (review.md, line 82)](../references/review.md#inspect-the-finished-result); optional advisors add focused reasoning.

Planning: adequacy → accepted scope → minimality; preserve purpose and guarantees, justify additions/removals and count host attention/recovery. [Host rules (planning.md, line 1)](../references/planning.md) cover architecture checks, separate responsibility decisions and optional technical intake; [review (review.md, line 82)](../references/review.md#inspect-the-finished-result) uses original inputs and explicit deltas. Run authorized checks; ask only unresolved authority/outcome/constraint choices.

These checks add no document, mandatory alternative or review stage and do not reopen settled decisions without new conflicting evidence.

- **Small edit:** `fast-lane fix the README typo`.

- **Claude-led plan:** `3ways plan <topic>`.

- **Plan, then pause:** “Plan first and wait.”

- **Resume/answer:** `godev`; reply in chat or the saved question's `ans:` field.

- **Future work:** Ask to review backlog; select before execution. For already-chosen later work, send `append-rounds <work>` as a separate message for each batch.

  Each Reply is saved as its batch completes; the final receipt names the latest completed Ask, or inline-on displays all newly completed Replies in order before that receipt; include required notices from every newly completed batch in order.

- **Rename/archive:** Above 750 lines or on request, append older completed rounds to one adjacent `<notebook-stem>.archive.md`; preserve prior history, unresolved work and latest completed round. No numbered era files. Explicit notebook rename includes that archive.

- **Fresh folder:** `godev`; Git is optional: before setup writes, ask in chat (even with `inline-reply: off`) unless already explicitly chosen. Yes initializes Git; no continues without Git; no answer waits. Failures require inspected recovery; approval excludes pre-existing unrelated files, remotes and publication.

  Proactive setup requires no selected notebook, configured ag-dir, history or retirement. [Setup (setup.md, line 9)](../references/setup.md#first-time-setup) creates missing main/root backlog/empty registry and `artifacts/`, `features/`, `.tmp/` placeholders; adapts root config/resolved notebook, preserves existing/custom records and rejects unsafe paths. Managed feature initialization reuses shared records and creates only config/notebook.

  Empty registry creation still gets an invariant notice with no accepted IDs. Archives, round documents and actual worktrees remain on demand. Off-record/feature rules prevail; no automatic Git initialization or rules.md copy.

- **Registry comparison:** Retain each authoritative registry’s physical path and original exact-byte/SHA-256 baseline (or absence) at first task read; preserve across recovery, saving needed bytes/retrievable snapshot reference in existing evidence before interruption.

  Compare before shared-record writes and closeout; inspect all content/format diffs, retain original baseline and record accepted updates. Reconcile foreign changes without overwrite/silent adoption; missing baseline/bytes stays a disclosed proof limit. Content changes get the mandatory notice; path-only moves get relocation notice.

  Hash equality proves bytes only; no self-hash, sidecar or runtime. [Policy (invariants.md, line 5)](../references/invariants.md#discover-and-reconcile).

- **Project rules:** Read the [shared baseline (project-rules.md, line 1)](../references/project-rules.md) plus optional local rules before work/review; no workflow activation by reading.

  Setup or an existing project’s next work session adds missing host-only default session-start use of the `aglite` skill, discovered, loaded and followed through that agent's supported skill mechanism, without fixing a host, path or installation scope; if unavailable, report the missing skill without assuming a path or auto-installing.

  Preserve owner overrides; report broken existing project-relative skill targets with a proposed correction, never silently accept/rewrite them; delegated workers/reviewers never activate from this directive. Later owner sessions need no `godev` when the host honors activation.

  Baseline reading may use installed/verified checkout-local source or host-supplied text; generated activation names the skill and leaves discovery to the host. Preserve existing overrides/custom paths; missing baseline defers shared-record writes/invariant or review acceptance; report the gap, continue independent authorized work.

- **Tracker labels:** Use `TODO` (not started), `DOING` (in progress, including checks/review/delivery), `BLOCKED` (cannot proceed; name blocker) and `DONE` (proved complete), e.g. `- [DOING] T-1 — Update activation`. Keep task IDs ordered; put goal/progress, Tasks, Recovery, then evidence links/update details. [Tracker contract (planning.md, line 1)](../references/planning.md).

- **Ask rounds:** Prefix every new Ask heading with standalone `---`, one blank line before and after, including initial and feature notebooks; preserve existing history. See [notebook rules (delivery.md, line 5)](../references/delivery.md#notebook-and-delivery).

- **Replies/reports:** [Ultimate comprehension first (writing.md, line 1)](../references/writing.md): brevity/formatting/terminology serve understanding. Conclusion first, plain words.

  Before every delivery, check that the intended reader can explain the result, relevant responsibilities, significance and needed decision/action without guessing or opening links; clarify or rewrite gaps.

  Use short, single-concept prose paragraphs or list items, usually 1–3 short sentences, with blank lines; lead each with its main point. Split long/multi-concept blocks before delivery; a single dense bullet fails too.

  Machine-only documents/skill prompts may be aggressively compressed without losing requirements, exceptions, safeguards, precision or correctness; mixed documents follow each audience’s rule.

  Saved Markdown line links use `path#<line-number>`, never `path:<line-number>`, with document-relative paths, e.g. `[features.md (features.md, line 31)](../references/features.md#31)`; section links keep named anchors. In chat, follow host link requirements; otherwise use `#<line-number>` with verified checkout-root-relative paths, or absolute paths when the host cannot resolve relative targets.

  Never use report-relative `../` in chat. Wrap targets containing spaces in `<...>`.

  Reply/subrequest quotes: first paragraph, at most 100 Unicode code points including spaces/punctuation, without splitting a combined character (grapheme); `...` whenever text is omitted. Keep literal backticks without backslash escapes; cut before an unmatched backtick left by truncation. Preserve credential redaction and full Ask input.

  Cut repetition; list several documents as nested `-` items with blank lines.

  Every report opens with conclusions, key findings, applicable recommendations/decisions and material limits before detail; split rather than cut required content; keep the opening complete across short blocks. Postmortems/root-cause reports also lead with causes/prevention.

  Pass writing guidance to delegated report authors.

  Before consequential choices (including any changing accepted outcomes, guarantees or owner-chosen designs), explain requested/current and alternative approaches, who does what, retained/changed/lost capabilities and effect on the goal; name conflicts and distinguish tested behavior from assumptions/examples.

  Rewrite before asking if an unfamiliar reader cannot retell the work and consequence; respect settled decisions.

- **Unfinished handoff:** Keep work/authorization/recovery in the tracker, or Current without one; link canonical recovery from STATUS Current, keeping new Asks empty apart from owner input and honoring legacy Ask links. [Git delivery (delivery.md, line 40)](../references/delivery.md#git-delivery) retains claim/retry/failure safeguards.

- **Closed-round claim release:** Verify Reply plus next Ask; settle task-owned workers/operations and save unfinished authority, exact identities and next action before yielding. Open-round pauses and feature-lifecycle exceptions retain their rules. Release grants neither completion nor approval. Reacquire/reread before continuing.

  See [ownership, identity and refusal rules (session.md, line 31)](../references/session.md#notebook-ownership) and [prior-delivery separation (delivery.md, line 40)](../references/delivery.md#git-delivery).

- **Windows:** [Platform/runtime guidance (windows.md, line 1)](../references/windows.md); native/explicit Node entrypoints and verified npm Node shims use literal argv, Copilot stdin handles long prompts, CRLF bytes stay intact and unknown process observations retain claims. Unsupported custom wrappers need an explicit entrypoint. Native Windows execution needs its own proof.

  Alternative cleanup needs same-volume recycle/restore proof and must refuse permanent deletion of the actual checkout.

- **Web checks:** Default to Stagehand automation code and Browserbase `browse` CLI Chrome operations ([official browser skill](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md)); owner/project preferences override. [Browser testing (browser-testing.md, line 1)](../references/browser-testing.md) covers owned local/headless sessions, access safeguards and actual journey evidence. No new advisor or permission.

## `ag.json` → `switches` — alphabetical

Below: **values → effect; missing-key default**. Edit named keys explicitly. Config lives at `<checkout>/<ag-dir>/ag.json` for existing/new projects; `.agentflow` is the default. Discovery matches the file parent to its declared ag-dir and stops on ambiguity.

Settings can contain private values. The host inspects them locally and reports needed nonsecret fields or hashes/status; it does not print whole configuration or hook files.

Supplied `schema-version` must be JSON integer `12`; future revisions increment it independently of the package version. Missing fields use defaults; current reads write nothing.

Known predecessors migrate on owner-facing host reads, preserving valid choices and unknown/comment keys. Unknown/newer schemas and ambiguous or lossy changes require a decision.

A sole legacy config at the root or old default location can relocate safely to the configured ag-dir under owned migration. Multiple sources or candidates stop migration, even when identical.

Recognized Agentflow 8 configurations use the separate [legacy migration (legacy-migration.md, line 1)](../references/legacy-migration.md); only lossless, authorized cases proceed automatically. Unsupported old approval/restriction, ownership, queue or integration decisions pause the affected migration.

Schemas 9/10/11 and `aglite-5` migrate to 12. Old omission keys map to the corrected names; 11 → 12 changes only the schema stamp.

Old `skip-plan: off` becomes `plan-mode: optional`; `on` becomes `off`, which permits needed trackers. See [migration (upkeep.md, line 5)](../references/upkeep.md#automatic-migration).

- **`ag-dir`** — Safe checkout-relative directory → configuration and record location; default `.agentflow`. No `..`/symlink escape. Explicit edits relocate config safely; records need separate move authority.

- **`auto-commit`** — `on`: commit verified work, owner edits separately; `off`: no automatic delivery commits. Git initialization approval still authorizes one immediate empty initial commit unless explicitly forbidden. Default `on`.

- **`auto-push`** — `on`: push authorized commits to verified remote/branch; `off`: no automatic push. Default `on`; does not enable commits.

- **`gate-design`** — `on`: await design approval before implementation; `off`: no added gate. Default `off`; requires a design under optional/must; conflicts with `plan-mode: off` and stops dependent work for a choice.

- **`gate-tracker`** — `on`: await checked-result approval before final delivery; `off`: no added gate. Default `off`; no tracker → no gate. Feature integration prerequisites remain.

- **`inline-reply`** — `on`: full saved answer in chat; `off`: short receipt. Default `off`; only explicit chat/terminal display requests permit answers there. “Show me”, output examples and future-output changes do not.

  Verify saved answers silently; explicit answer display and `on` still end with the two-line receipt. Notices, unfinished work, the pre-setup Git choice, taskless setup and actual feature handoffs retain their operational rules; hypothetical handoffs stay saved.

- **`notebook-name`** — Safe filename under ag-dir → notebook; default `<short-dirname>.devlog.md` from the physical checkout root/session folder: lowercase ASCII, non-alphanumeric runs → `-`, trim, cap stem at 32 characters, trim trailing `-`; empty → `devlog.md`. New configuration saves the generated name.

  No paths or `.owner` suffix; explicit/feature routing prevails.

- **`omit-asker`** — `on`: omit owner name from new Ask headings; `off`: include it. Default `on`.

- **`omit-run`** — `on`: omit RUN milestones; `off`: record them. Default `on`; keep evidence elsewhere.

- **`omit-wip`** — `on`: recovery elsewhere; `off`: WIP every ten active minutes, before context reset/unfinished handoff. Default `on`, setup template `off`.

- **`plan-mode`** — `must`: design.md + tracker.md before actual task edits; `optional`: create when warranted (default); `off`: no new design, tracker when needed.

  Existing contracts/checks/review stay required; idle/off-record/setup/lifecycle/Q&A/staged batches create no records just from this setting.

  Explicit owner task instructions and fast-lane creation waivers prevail. Gate-design on + off stops for a settings choice.

- **`plan-order`** — Already-needed planning, including advice that authors/revises plans and task grouping; default `external`. Interviews/evidence gathering keep ordinary advice rules. Fast-lane plans with host unless you explicitly select another task planning route. Claude leads where reachable; Codex challenges concrete defects.

  Start at the selected value and record inspected failures: `3ways → external → native → host`, `external → native → host`, or `native → host`; `host` is terminal. `native` means internal fresh-context planning. Invalid settings and explicit constraints still block incompatible fallback:

  - `3ways` — Claude primary plan → Codex challenge/review → host resolution.

  - `external` — Claude CLI planner; no automatic Codex challenge.

  - `native` — Fresh native planner; prefer Claude only if supported, label actual provider.

  - `host` — Active host plans directly; no worker probes.

- **`review-order`** — Ordinary order; [planner diversity (review.md, line 82)](../references/review.md#inspect-the-finished-result) prefers a different family from the known principal planner, then another supported configured model, for already-required separate review. The host may reselect ordinary defaults with disclosure; task-level hard constraints prevail, and repeated family/model remains allowed with a disclosed limit.

  - `external` — Counterpart CLI → fresh-context native → labelled host fallback; default.

  - `native` — Native → counterpart CLI → host fallback.

  - `host` — Host directly; no worker probes.

- **`saving-mode`** — `on`: load [saving mode (saving-mode.md, line 1)](../references/saving-mode.md) for minimum sufficient prose/records, fewer optional documents and valid-proof reuse; `off`/absent: normal behavior (default `off`). Routine 100–200 words is a soft target; explicit detail, comprehension, safeguards, required records/checks/review, gates and deliverables prevail. No model/route changes or retroactive restoration.

- **`use-lang`** — Locale tag, e.g. `en-us`, `zh-TW` → language for every new human string, including template/scaffold labels, notices and receipt `Updated`; default detected OS locale, then `en-us`. English prompts/assets supply meaning.

  For `zh-TW`, render `STATUS` as `狀態`, `Questions`/`None` as `問題`/`無`, WIP `Checkpoint` as `進度檢查`, and receipt `Updated` as `已更新`; `en-us` stays English.

  STATUS field labels also follow the locale: `Checkout` becomes `工作目錄`, `Current` becomes `目前工作`. English field names are examples to translate, not fixed tokens. Reuse locale labels; preserve machine tokens, input/history and established artifact languages.

  Explicit target language prevails; input language alone does not switch it. [Locale policy (configuration.md, line 5)](../references/configuration.md#discovery-and-validation).

Planning/review constraints and required independence prevail over routing. Unsupported selected model/effort needs a decision. Empty answers/defaults grant no approval. Git switches grant no publication authority. Planning workers use their selected advisor role, otherwise `threeways`; challenges use `threeways`, result review/final-audit use `acceptance`.

Missing native roles inherit host defaults; missing external roles use transport defaults; selected looper roles/routes must be configured; the bundled/root roles include `product-docs: better`. Worker model/tier choices: [worker settings (review.md, line 11)](../references/review.md#worker-settings).

Validate the selected review route's ordinary settings before considering another model for planner diversity. Missing, invalid or unsupported selected settings need a decision; another model cannot bypass them.

Diversity compares the actual principal planner with the reviewer. Another alias or effort value does not establish a different family/model; unknown or repeated identity remains allowed with a disclosed limitation.

Explicit task provider/model/effort, privacy, read-only and independence requirements prevail. Usable separate routes precede host fallback; host review does not prove independence, and required independent review under host order uses a fresh native context.

Looper routes and saved attempt selections keep their explicit settings. See [review selection (review.md, line 82)](../references/review.md#inspect-the-finished-result).

## Copilot selection

For a Copilot host or selected route, load [Copilot (copilot.md, line 1)](../references/copilot.md).

Optional `native-workers` binds `planner`, `challenger`, `implementation`, `acceptance` to `{ "model-family": "catalog", "agent": "optional-verified-preset" }`. Pairs stay in catalogs; roles select tiers; task overrides precede validation.

Absent bindings retain current resolution. Explicit looper routes and saved attempts prevail.

Selected external profiles and looper routes support `copilot`; default Codex↔Claude routing remains. Verified Copilot sessions may share transport with fresh independent contexts and observed-family/model diversity preference; unknown/repeated family is disclosed.

Pinned model/effort needs actual supported controls; native editor proof, CLI outcome and effective provider effort are separate observations. No CLI substitute for an absent native host. [Worker schema (review.md, line 11)](../references/review.md#worker-settings).

## Product documentation

Update affected maintained guidance with accepted behavior changes, including fast-lane/skip-review; no impact means no doc record. Reuse reader roles in existing pages, one owner per changing fact and checked summaries/examples/translations.

Optional multi-doc map: existing index or `<ag-dir>/doc-ledger.md`, default `.agentflow/doc-ledger.md`; private maps are not shipped dependencies. Check affected contradictions, links and necessary journeys/distribution; missing proof stays unproved. Ordinary host updates need no advisor/full audit; `advisors: product-docs` requests focused advice. [Maintenance (product-docs.md, line 1)](../references/product-docs.md).
