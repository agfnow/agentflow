<!-- Loaded only for selected-advisor or full-pipeline work. -->

# Agentflow pipeline

Use this file only after the devlog protocol and adjacent `ag.json` are validated. The pipeline turns a behavior wish into requirements, a current repository map when justified, a specification, isolated implementation, and independent acceptance. Keep workflow detail out of owner-facing prose unless needed.

Incident citations explain earlier failures, not permanent remedies. Approved replacements retain protection against hazards that still exist.

## Front door and route

Read `references/delegation.md` before selecting or dispatching a worker; it owns frozen-brief transport, external/native/host selection, confinement limits, profiles, watchdog, attempts, and acceptance.

Read and validate adjacent `ag.json`, STATUS, the latest unfinished Ask, Git state, and exact current artifacts before choosing work. Record one route: `direct`, `selected_advisors`, `full_pipeline`, or `blocked`, naming operation, `allow-ag`, material risks, named questions, owner confirmation, and plain-language reason. `$target_doc` is the owner conversation and live recovery surface; STATUS is recovery projection, not settings storage.

- `direct`: clear local reversible work whose files, focused test, and final relevant suite are identifiable. The host executes directly when a handoff is unlikely to pay off, or plans a bounded worker assignment when its expected benefit justifies the overhead; neither choice requires pipeline advisors. Honor explicit executor choices, no-delegation, and fast-lane; execution choice does not waive applicable checks or approvals.

- `selected_advisors`: each named advisor answers an important question that direct work cannot settle; naming a stage without stating its question is insufficient.
- `full_pipeline`: expensive-to-reverse behavior, important trust/subsystem boundary, serious hidden-test risk, or enabled explicit trigger.
- `blocked`: an `allow-ag`/owner decision, unavailable confinement, missing evidence, exhausted attempts, or other hard stop prevents work.

`allow-ag: on` permits selected/full routes; `off` blocks them before Agentflow and never silently downgrades; `ask` requires recorded owner approval for complex pipeline jobs. A simple job can use the direct planning route with host or delegated execution under every setting. Ordinary delegation is governed by `references/delegation.md`, not permission to launch pipeline advisors. A route trigger is not a settings change and never overrides `off`; only a separate validated `allow-ag: on` change can enable a later complex pipeline route.

The schema-8 `allowed-worker` list is an unordered permission list among `external`, `internal`, and `host`; it governs execution eligibility, not review assurance. For each task, the host chooses an eligible permitted kind based on context, handoff cost, useful parallel work, capabilities, and owner constraints, and records a brief reason. With multiple eligible kinds and no choice, the selector returns `selection-required` plus the eligible alternatives for the host to choose autonomously without asking the owner again; a sole eligible kind may be selected automatically. A forbidden or ineligible choice is unsatisfied and is never silently replaced. New projects use all three kinds and `review-policy: prefer-independent`. A v7 configuration migrates conservatively to `["external", "host"]` and `require-independent` until the owner explicitly opts in. `cli-provider` filters only external profiles, and an unknown host family never matches `off`.

Direct work needs no additional approval when execution is already authorized and no owner-requested planning, review or wait checkpoint remains. Follow SKILL.md's planning contract. Explicit `ag`, `agentflow`, and `all-in` force full pipeline when allowed. `make-plans` classifies each job as simple or complex, publishes self-contained simple plans directly, retains the accepted requirements/specification gate for complex plans, names blocked complex jobs, and stops after frozen queue publication.

The exact owner trigger `3ways` or `threeways` is the narrow exception: it permits one read-only pre-implementation `threeways` review through the unified runner even when `allow-ag` is off. It neither enables a pipeline nor authorizes implementation. The host records its immutable debate artifacts, consensus or unresolved state, and the later human Design Go or Stop boundary.

Before calling `plan_jobs`, the natural-language host inspects the owner request and relevant repository evidence for each job and supplies `complexity_reasons`: a unique list containing only applicable reasons from `material_uncertainty`, `cross_subsystem_coordination`, `public_or_stored_data_contract`, `trust_boundary`, and `unresolved_material_decision`. Empty routes directly as simple; non-empty routes through the complex pipeline. The owner supplies the work request, not a route, and job length is never used. For execution, looper uses `select_frozen_ready_plans`, and an ordinary host uses `select_host_ready_plans`; both names refer to the exact same function object.

## Pipeline stages and codewalk gate

The canonical durable `pipeline-roles` names are `requirements`, `codewalk`, `explore`, `spike`, `spec`, `implementation`, `security-scan`, `acceptance`, `cross-check`, and `learn`; each is a configured tier or `off`. `cross-check` selects the configured review preference for the separate post-implementation gate and is not added to the full-pipeline stage order. A separate external or native reviewer is preferred; `prefer-independent` permits a clearly labelled host review only after availability is recorded, while `require-independent` does not. Per-request `advisors:` remains a validated fixed roster and narrows/overrides durable defaults for that Ask.

Its selection is frozen in the brief/run record, survives recovery and amendments, and never widens because context was lost. `all-in` runs every optional advisor and forbids scaled-down mandatory stages for that Ask.

Full pipeline order is requirements, existing-repository discovery, codewalk when triggered, applicable explore/spike, specification, implementation, security review, acceptance, and applicable learn. Requirements, specification, implementation, and acceptance are mandatory: if their durable setting is `off`, validation warns that the full pipeline is unavailable; never claim a complete pipeline. Codewalk, explore, spike, security-scan, and learn may be skipped only with recorded evidence and the configured/route reason.

When the Ask contains `cross-check`, apply it to the final implementation result, not to each pipeline stage. A mandatory separate acceptance may serve as the one cross-check only when its report covers the same final implementation source identity and satisfies the shared review-record contract in `references/closeout.md`; otherwise select one allowed external or native read-only reviewer after implementation. If no separate route is available, record host review only under `prefer-independent`; do not claim independent acceptance. Requirements, codewalk, explore, spike, specification, security, acceptance, and learn do not each receive another cross-check.

For an existing repository, discovery is recorded. Codewalk is required only when at least one trigger is true: unfamiliar code, multiple subsystems, public interface, stored data, trust boundary, or stale/missing map. With a trigger, one accepted current codewalk record can satisfy both logical obligations only when it has an explicit shared-coverage marker, current codewalk evidence, answered questions, and the required discovery facts: verified paths, fact/inference labels, public boundaries, conventions, likely edit locations, focused commands, and unexamined areas.

Without a trigger, retain the small discovery record and do not dispatch codewalk. The codewalk advisor starts at the named surface, reads necessary context only, and does not run commands by default; later work refreshes only affected parts.

The four evidence-trigger answers are recorded in a devlog RUN event before run/skip: explore — material risk or uncertainty remains after requirements/discovery; spike — one named technical question needs observed evidence before specification; security-scan — security/trust boundary is touched or requested; learn — explicitly requested, a repeated failure, or a serious unexplained incident. Routine observations stay in the existing RUN or Reply and do not launch a learning advisor. Skip only with concrete evidence for “no”; uncertainty runs the relevant advisor or asks the owner. `all-in` answers every trigger “run”. Mandatory advisors may scale depth but still produce their artifact; every selected/run advisor uses the permitted transport selected for that stage. Prefer a separate worker; when none is available, `prefer-independent` permits explicitly labelled host work and host acceptance. Strict or explicit independence requirements remain pending.

After the pipeline is selected, one final route check may move a trivial, unambiguous, mechanical request back to direct work. Record that change as a devlog question with a suggested default, use one brief, let the coordinator verify the result, and create no artifact directory. `$auto_reply_mode=on` may accept the safe default; `all-in` disables this shortcut.

## Queue, artifacts, and live events

Decomposition runs `tracker-contract.js template` and fills that exact output as `<work-root>/tracker.md` before dependent work. Validate it before each checked checkpoint. Refresh it after scope changes, milestones, checkpoints, and before long work or completion; continue after writing. It supplements the devlog and never replaces queue or looper authority.

`make-plans` freezes simple jobs directly and freezes complex jobs only after accepted requirements/specification and no unresolved material choice. Publish candidate plan bytes privately, move without overwrite, and publish `.queue-generation.json` last. Schema-v2 envelopes bind each simple plan to its owner request and repository evidence, each complex plan to the accepted contract, and the final integration plan to every published route authority. One self-contained simple job performs the complete relevant checks in its own final plan; multiple or complex jobs retain a separate integration plan. Only schema-v2 queues are executable; older queue files remain historical records.

A denied mixed request may publish only an independent simple-only queue whose final integration claim excludes blocked work. Check open/completed names and queue collisions before staging. Plans gain authority only when the envelope exists and digests match; make-plans never starts implementation.

Use `SKILL.md` → Task artifact locations for work roots, queues, and completion-metadata separation. Ordinary native or supported direct input carries the assignment without a separate brief file. Use paired `*-brief.md`/`*-report.md` names when the route needs a durable file, including queued or resumable work, a launcher that requires a file, or an owner-requested review record; `implementation-brief.md`/`implementation-report.md` and `spikes/<question-key>-brief.md`/`-report.md` remain available for those cases.

Existing allocated paths remain authoritative. Record raw branch identity because the root path no longer names it; use the smallest numeric suffix on a collision.

Every artifact opens with one fresh machine-local numeric-offset stamp `* _YYYY-MM-DD HH:MM:SS ±HHMM (<model>/<effort>)_` and ends with exactly one final `Self-check:` content line. The artifact gate checks path, size, freshness, boundaries, and verified generation reference; trailing newline is allowed. A syntactically valid model or effort that differs from trusted dispatch metadata produces a warning and never triggers a paid retry. Create no placeholders. Commit a canonical artifact before replacing it and keep artifacts and branch markers tracked.

Append numbered RUN events to `$target_doc` after material transitions. Each event has a fresh machine-local numeric-offset timestamp, declares its Ask, and records one or more short facts. Record routes, dispatch identities, gates, results, answers, substitutions, failures, relaunches, deviations, and scope checks. Launches are recorded before start, results after collection, and gates before dependent work. WIP remains the complete ten-minute owner status and does not repeat the event trail.

Before each checkpoint or Reply, reconcile live handles, commits, gates, the tracker, and the current devlog events. Late repairs name the missing span. Noncompleted results include status, exit or signal, timeout, launch error, and up to 4,096 output bytes; absent values are `none`. — I-017/I-057.

Follow `SKILL.md`'s byte-preserving notebook compaction protocol. `Archived eras:` points only to the adjacent `<basename>.archive.md` or `none`, never labels, ranges, batches, or an index. Write the Reply before the final STATUS projection.

## Gates and evidence

Write enough design contract detail for a new implementer to execute without reconstructing prior conversation. Include the original Ask and authority, observable outcomes, retained requirements and exclusions, input/output boundaries, failure and recovery behavior, affected paths, acceptance examples and exact proof, unresolved choices, Minimality check, and applicable delivery gates. Scale detail to the change: a small prompt edit needs a concrete example; a trust-boundary change needs its failure cases and preserved guarantees. Use the readable summary plus necessary contracts, without a length gate or obsolete verification instructions.

Keep dependencies current and rerun only affected evidence: owner decisions invalidate dependent exploration/spec/implementation/security/acceptance; changed brownfield surfaces invalidate codewalk/spec assumptions; exploration/spikes invalidate affected spec; changed spec invalidates implementation and post-implementation reports; changed implementation invalidates security/acceptance; late requirements require spec refresh.

Worker findings do not change the accepted scope. Before a finding becomes a requirement, invariant, repair, test, or implementation change, the coordinator records the exact owner-request sentence or existing standing obligation that requires that observable behavior. Without that trace, reject the finding or park it as a proposal. Reviewer severity and hypothetical failure paths are evidence to consider, not authority to expand the product. — I-054.

Requirements and specification each have a sign-off gate before coding. With `auto-reply: off`, point only to the exact requirements report and open IDs in the devlog; owner answers go in one empty `- ans:` field per question and still require devlog sign-off. With `on`, only safe routine defaults receive explicit same-pass provenance; owner-only, conflicting, failed, missing, or hard-stop decisions remain open. The spec gate verifies each `R-<n>` coverage ledger maps to its section and `INV-<n>` IDs.

Security is one defensive pass over declared changed files and trust boundaries. A moderation refusal is an executor error, not a clean scan; retry once with equivalent defensive wording. The owner or coordinator must decide how to handle findings about data loss, destructive behavior, exposed credentials, or failure of the behavior the owner explicitly requested; record other findings as follow-up work.

Acceptance first marks every `R-<n>` as covered, missing, or not proven, then rechecks each `INV-<n>` with real commands, keeping behavior separate from record quality. Missing evidence remains not proven. Neither stage starts an automatic repair loop.

Formal repair is coordinator-only and limited to a fixed stamp, heading, path label, or final boundary from immutable authority/verified evidence; record before/after identities, span, and unchanged outside bytes, then rerun the gate. Substantive defects return to the responsible stage. Review stages keep one identity, preflight working directory/test/executable/authentication, and at most three total starts; one preflight failure before process/model start is free, all post-start failures count, and unavailable facts are `SKIP`.

## Worker implementation handoff

Use delegation's frozen-brief, write-authority, and delivered-checkout verification rules. The worker stops and asks the master on any unclear, contradictory, wrong, or missing requirement/specification. It uses narrow vertical slices, red-first tests, same-commit regression tests, focused checks, declared verification, and invariant IDs; it preserves user changes and edits only the source and result paths authorized in its brief.

Use configured `better` for requirements, codewalk, explore, spike, and spec; `best` for security-scan; `basic` for implementation; and `better` for acceptance, preferably a different family or native context. Apply owner overrides exactly; an unavailable coordinator-selected preference may use an inherited/default native model or the nearest external tier with a recorded substitution, but an unavailable exact owner choice pauses. Never launch when an explicitly required permission restriction cannot be enforced. Shared permissions, inherited context, clone separation, and native-tool visibility are evidence facts, not proof of isolation or independence.

Claim completion only when required artifacts exist, acceptance covers every requirement and satisfies every invariant, relevant security evidence is current, declared checks pass, and Git state supports the claim. Material claims cite coordinator-read or coordinator-executed evidence; worker text alone cannot prove identity, timing, transport, or acceptance.
