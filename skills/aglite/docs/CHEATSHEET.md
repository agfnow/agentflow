# aglite cheatsheet

Chat instructions, not shell commands. Use unquoted. Details: [guide](AG_GUIDE.md), [configuration](../references/configuration.md), [features](../references/features.md).

Owner-input capture: prefix each prose paragraph with `+ `; related paragraphs may share one first prefix. Preserve code interiors, existing prefixes and history; blank lines separate groups, with no standalone `--`. [Capture rule](../SKILL.md#activate-and-recover).

Codex subagents: every `spawn_agent` explicitly sets `fork_turns: "none"`; supply all necessary context in the task message. [Delegation](../SKILL.md#records-and-review).

Workflow proof: reuse the tracker; without one, keep brief checks in Proven or enabled RUN and save needed detail that would crowd the notebook in `<ag-dir>/.tmp/A-NNN.md`, linked from Current and the producing Ask before Reply for recovery/review. Other notebooks use `<ag-dir>/.tmp/<notebook-basename>/A-NNN.md` with notebook/Ask identity; verify namespace association and choose a safe unused location on collision. Preserve linked evidence; no automatic ignore/deletion or mandatory per-round file. Check Git ignores before creating/linking; use an unused nonignored artifacts path if needed and include it in authorized delivery. Keep each fact once; Reply retains answers and decision-changing limits. [Round evidence](../SKILL.md#round-evidence).

## Commands — alphabetical

- **`3ways`** — Challenge an approach and simpler alternative; different-family first (Codex ↔ Claude), then fresh same-family only after recorded unavailability/failure. Overrides `review-order`; explicit review requirements prevail. No implementation approval.

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

- **`devlog`** — Activate aglite; prefer `godev` for start/resume.

- **`drop-feature <name>`** — Abandon feature; inspect local work, move checkout to verified Trash/Recycle Bin, delete branch. No permanent-deletion fallback.

- **`fast-lane <task>`** — Small task, direct host execution; skip advisors, ordinary delegation/separate review, new design/tracker and routine RUN/WIP.

- **`gdd`** — Activation alias; prefer `godev`.

- **`godev [request]`** — Start/resume; initialize eligible clean repos, ask for work when idle.

- **`grill-me [topic]`** — Explicit adaptive requirements interview: inspect evidence first, ask connected rounds with alternatives/recommendation, use answers for follow-ups and stop when ready. At least one owner round confirms/corrects the inferred outcome, key assumptions and strongest relevant challenge. Bare command uses a clear active topic or asks for one without persisting a mode; quoted mentions do not trigger. Existing answer routing applies; no implementation authority.

- **`merge-feature <name>`** — Verify/merge; retain checkout/branch. Add `and cleanup` to retire both.

- **`new-feature <name>`** — Prepare `.wts/ft-<name>` on `feature/<name>` without acquiring main’s claim or recording creation there; an existing main owner checkpoints/releases its own claim. Record preparation in the feature notebook, then open a new session there. Git inventory replaces a ledger/index. No unspecified implementation.

- **`nolog: <request>`** — Execute/answer off-record; exclude this exchange from records and later summaries.

- **`noop: <request>`** — Same as `nolog:`; still executes.

- **`off: <request>`** — Same as `nolog:`.

- **`show-diff`** — Show verified file diffs with reasons; presentation only.

- **`skip: <request>`** — Same as `nolog:`.

- **`skip-review <task>`** — Host review only for one task; keep planning and checks, waive ordinary separate review including its risk-boundary rule.

`grill-me` explicitly selects its interview despite fast-lane’s advisor skip, retaining other rules; no persistent setting or mandatory worker/document. `fast-lane` and `skip-review` last until their task finishes, including resume; their bare invocation needs unfinished work. Neither changes settings. Host checks, explicit plans/reviews, gates and feature rules remain. `skip-review` replaces earlier review requests; same-message/later explicit reviews prevail. Off-record aliases affect one exchange only.

## Quick recipes

Advice, design/tracker creation, delegation and model choice are separate decisions in one workflow. Mandatory contracts stay in [host rules](../SKILL.md#records-and-review), final-review checks in [review.md](../references/review.md#inspect-the-finished-result); optional advisors add focused reasoning.

- **Small edit:** `fast-lane fix the README typo`.

- **Challenge first:** `3ways compare these approaches`.

- **Plan, then pause:** “Plan first and wait.”

- **Resume/answer:** `godev`; reply in chat or the saved question's `ans:` field.

- **Future work:** Ask to review backlog; select before execution.

- **Rename/archive:** Above 750 lines or on request, append older completed rounds to one adjacent `<notebook-stem>.archive.md`; preserve prior history, unresolved work and latest completed round. No numbered era files. Explicit notebook rename includes that archive.

- **New repo:** `godev`; proactive setup requires no selected notebook, configured ag-dir, history or retirement. [Setup](../SKILL.md#first-time-setup) creates missing main/root backlog/empty registry and `artifacts/`, `features/`, `.tmp/` placeholders; adapts root config/resolved notebook, preserves existing/custom records and rejects unsafe paths. Managed feature initialization reuses shared records and creates only config/notebook. Empty registry creation still gets an invariant notice with no accepted IDs. Archives, round documents and actual worktrees remain on demand. Off-record/feature rules prevail; no Git initialization or rules.md copy.

- **Registry comparison:** Retain each authoritative registry’s physical path and original exact-byte/SHA-256 baseline (or absence) at first task read; preserve across recovery, saving needed bytes/retrievable snapshot reference in existing evidence before interruption. Compare before shared-record writes and closeout; inspect all content/format diffs, retain original baseline and record accepted updates. Reconcile foreign changes without overwrite/silent adoption; missing baseline/bytes stays a disclosed proof limit. Content changes get the mandatory notice; path-only moves get relocation notice. Hash equality proves bytes only; no self-hash, sidecar or runtime. [Policy](../references/invariants.md#discover-and-reconcile).

- **Project rules:** Read the [shared baseline](../references/project-rules.md) plus optional local rules before work/review; no workflow activation by reading. Setup or an existing project’s next work session adds missing host-only default session-start use of the `aglite` skill, discovered, loaded and followed through that agent's supported skill mechanism, without fixing a host, path or installation scope; if unavailable, report the missing skill without assuming a path or auto-installing. Preserve owner overrides; report broken existing project-relative skill targets with a proposed correction, never silently accept/rewrite them; delegated workers/reviewers never activate from this directive. Later owner sessions need no `godev` when the host honors activation. Baseline reading may use installed/verified checkout-local source or host-supplied text; generated activation names the skill and leaves discovery to the host. Preserve existing overrides/custom paths; missing baseline defers shared-record writes/invariant or review acceptance; report the gap, continue independent authorized work.

- **Tracker labels:** Use `TODO` (not started), `DOING` (in progress, including checks/review/delivery), `BLOCKED` (cannot proceed; name blocker) and `DONE` (proved complete), e.g. `- [DOING] T-1 — Update activation`. Keep task IDs ordered; put goal/progress, Tasks, Recovery, then verification/review. [Tracker contract](../SKILL.md#records-and-review).

- **Ask rounds:** Prefix every new Ask heading with standalone `---`, one blank line before and after, including initial and feature notebooks; preserve existing history. See [notebook rules](../SKILL.md#notebook-and-delivery).

- **Replies/reports:** [Conclusion first, plain words, short bullets](../references/writing.md). Chat citations use `[file:line](checkout-relative-path:line)` from the verified checkout root; use absolute paths when the chat host cannot resolve relative targets, never report-relative `../`. Saved Markdown uses document-relative file/anchor links with line numbers outside targets; wrap targets containing spaces in `<...>`. Reply/subrequest quotes: first paragraph, at most 100 Unicode code points including spaces/punctuation, without splitting a combined character (grapheme); `...` whenever text is omitted. Keep literal backticks without backslash escapes; cut before an unmatched backtick left by truncation. Preserve credential redaction and full Ask input. Cut repetition; list several documents as nested `-` items with blank lines.

- **Unfinished handoff:** Keep work/authorization/recovery in the tracker, or Current without one; link it from next Ask without duplicating state. [Git delivery](../references/configuration.md#git-delivery) retains claim/retry/failure safeguards.

- **Windows:** [Platform guidance](../references/windows.md); alternative cleanup needs same-volume recycle/restore proof and must refuse permanent deletion of the actual checkout.

- **Web checks:** Default to Stagehand automation code and Browserbase `browse` CLI Chrome operations ([official browser skill](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md)); owner/project preferences override. [Browser testing](../references/browser-testing.md) covers owned local/headless sessions, access safeguards and actual journey evidence. No new advisor or permission.

## `ag.json` → `switches` — alphabetical

Below: **values → effect; missing-key default**. Edit named keys explicitly. `ag.json` is checkout-root configuration; supplied `schema-version` must be `aglite-5`.

- **`ag-dir`** — Safe checkout-relative directory → record location; default `.agentflow`. No `..`/symlink escape. Path changes do not move files.

- **`auto-commit`** — `on`: commit verified work, owner edits separately; `off`: no automatic commits. Default `on`.

- **`auto-push`** — `on`: push authorized commits to verified remote/branch; `off`: no automatic push. Default `on`; does not enable commits.

- **`gate-design`** — `on`: await design approval before implementation; `off`: no added gate. Default `off`; overrides `skip-plan`.

- **`gate-tracker`** — `on`: await checked-result approval before final delivery; `off`: no added gate. Default `off`; no tracker → no gate. Feature integration prerequisites remain.

- **`inline-reply`** — `on`: full saved answer in chat; `off`: short receipt. Default `off`; notices, explicit requests, unfinished work, taskless setup and feature handoffs retain exceptions.

- **`notebook-name`** — Safe filename under ag-dir → notebook; default `<short-dirname>.devlog.md` from the physical checkout root/session folder: lowercase ASCII, non-alphanumeric runs → `-`, trim, cap stem at 32 characters, trim trailing `-`; empty → `devlog.md`. New configuration saves the generated name. No paths or `.owner` suffix; explicit/feature routing prevails.

- **`review-order`** — First usable permitted review route:

  - `external-first` — Counterpart CLI → fresh-context native → labelled host fallback; default.

  - `native-first` — Native → counterpart CLI → host fallback.

  - `host-only` — Host directly; no worker probes.

- **`skip-asker`** — `on`: omit owner name from new Ask headings; `off`: include it. Default `on`.

- **`skip-plan`** — `on`: no new design/tracker; `off`: create when warranted. Default `off`; explicit requests/gates prevail.

- **`skip-run`** — `on`: omit RUN milestones; `off`: record them. Default `on`; keep evidence elsewhere.

- **`skip-wip`** — `on`: recovery elsewhere; `off`: WIP every ten active minutes, before context reset/unfinished handoff. Default `on`, setup template `off`.

- **`use-lang`** — Locale tag, e.g. `en-us`, `zh-TW` → chat/writing language; default detected OS locale, then `en-us`. Explicit target language prevails; input language alone does not switch it.

Review constraints/required independence prevail over routing; unsupported selected model/effort needs a decision. Empty answers/defaults grant no approval. Git switches grant no publication authority. Worker model/tier choices: [worker settings](../references/configuration.md#worker-settings).

## Product documentation

Update affected maintained guidance with accepted behavior changes, including fast-lane/skip-review; no impact means no doc record. Reuse reader roles in existing pages, one owner per changing fact and checked summaries/examples/translations. Optional multi-doc map: existing index or `<ag-dir>/doc-ledger.md`, default `.agentflow/doc-ledger.md`; private maps are not shipped dependencies. Check affected contradictions, links and necessary journeys/distribution; missing proof stays unproved. Ordinary host updates need no advisor/full audit; `advisors: product-docs` requests focused advice. [Maintenance](../references/product-docs.md).
