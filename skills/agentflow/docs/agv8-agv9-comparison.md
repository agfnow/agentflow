# Agentflow 8 → Agentflow 9: differences and practical impact

agentflow retains resumable development, planning, checks, review, feature work and queued execution. The biggest removal is the ordinary workflow runtime: startup, capture, notebook validation and closeout now depend on the host following instructions instead of the old helper and hook machinery.

That change has concrete consequences. An assistant can still violate the same workflow requirements, but ordinary agentflow has no legacy Stop-hook backstop to reject its closeout. Teams relying on that enforcement, strict worker permission lists, handwritten plan queues or old shell automation need a deliberate transition.

Treat this as a migration to a redesigned product. Agentflow 8 configuration and queues are not supported as drop-in inputs; configuration has a guarded conversion path, while old queues require separate recovery and new preparation. Start with the [guarded legacy migration rules](../references/legacy-migration.md); retain v8 for active work that cannot yet be safely handed off.

This public edition compares Agentflow **8.4.15** with **Agentflow 9.1.0**, configuration schema **13**. Current source references below belong to this package.

Version 8 is preserved at [`agfnow/agentflow-v8`](https://github.com/agfnow/agentflow-v8); stable v9 uses [`agfnow/agentflow`](https://github.com/agfnow/agentflow). Use the matching repository’s installation instructions. Existing installations must be rebound deliberately; the repository rename alone does not migrate them.

This is a source-backed comparison, not proof of a migrated real project, provider reliability, speed or cost improvement. The original twelve comparison topics are retained; migration guidance is refreshed to the current guarded conversion procedure.

## Who is affected most

- **Everyday single-session users:** the main work loop remains familiar. Expect different setup, notebook routing, settings and completion receipts.

- **Users who rely on enforced closeout or compliance checks:** high impact. Required checks remain policy, but the old ordinary mechanical validator is absent. Keep the old runtime until a separately chosen enforcement solution exists if that backstop is essential.

- **Teams with shell integrations or queued plans:** high impact. The reused `agf` name exposes a much smaller CLI, and the queue format/execution model changed.

- **Teams using multiple sessions or feature streams:** medium to high impact. Ownership becomes mandatory, feature records stop coordinating through main's root notebook, and merge/cleanup are separate decisions.

## 1. Ordinary runtime and hooks: removed implementation, retained obligations

**Before:** Agentflow startup called `agf.js start`; helper programs captured inputs, validated notebooks and completion evidence, and integrated host-specific hooks. Its referee/Stop mechanisms had bounded scope and error behavior, so even v8 was not an absolute correctness guarantee.

**Now:** agentflow directs the host to resolve identity, claim the notebook, capture input, recover work, validate outcomes and close the round with ordinary tools. There are no ordinary hooks, heartbeat or general workflow helper. The optional looper and [terminal feature CLI](../references/features.md#terminal-cli) are bounded runtime exceptions. [SKILL.md, line 1](../SKILL.md) [looper.md, line 1](../references/looper.md)

**Concrete impact:** if an assistant forgets a review or appends malformed history, a legacy ordinary Stop hook will not catch that omission under agentflow. A host can still detect and repair it through its required checks. Removing the helper also removes helper-installation and hook-restart steps from ordinary setup.

**Assessment:** the enforcement backstop is lost; review, recovery and history-preservation requirements are retained. No measured evidence here establishes that the tradeoff improves reliability or total effort.

## 2. Shell CLI: incompatible reuse of the name

**Before:** v8 exposed startup/setup, settings, hook management, notebook operations, stream operations and closeout through its helper surface.

**Now:** the agentflow launcher accepts the three `agf looper` commands and the separate [terminal feature commands](../references/features.md#terminal-cli): `new-feature`/`newft`, `merge-feature`/`mergeft`, and `drop-feature`/`dropft`. `agf shell <zsh|bash|powershell>` prints the caller-directory function. Chat commands such as `godev` and `prepare-tasks` remain host instructions. [agf.js, line 1](../scripts/agf.js) [features.md, line 1](../references/features.md)

**Concrete impact:** a script invoking `agf start`, `agf settings`, `agf close`, `agf new` or the old `agf-looper` cannot be fixed by changing its install directory alone. A shell alias may still resolve to v8 even when the assistant loads agentflow.

**Replacement:** inspect command resolution, retire only the owned v8 integration after its work settles, and use host instructions for ordinary operations. Pin the explicit launcher path when both installations coexist.

## 3. Configuration: guarded legacy conversion replaces drop-in reuse

**Before:** v8 used integer schema 8, `workspace-dir`, `target-doc`, `lang`, worker permission lists and per-profile model tiers. The old repository's local settings are owner choices, not universal defaults.

**Now:** agentflow uses `<checkout>/<ag-dir>/ag.json`, schema 13, locale tags and shared model catalogs. Known agentflow predecessor schemas and proven Agentflow 8 inputs follow different migration procedures. Schema 8 and residual v8 controls trigger guarded legacy classification before normal validation; a stamp alone does not prove full-v8 provenance. [configuration.md, line 1](../references/configuration.md), [legacy-migration.md, line 1](../references/legacy-migration.md).

**Concrete impact:** moving v8’s JSON and changing only its schema number can leave old settings without their intended effect. A preserved unknown key is not an implemented control. Ambiguous routing, unsupported settings and unrepresentable restrictions stop dependent changes rather than choose or reset silently.

**Replacement:** let the host classify the input, map effective policies without losing restrictions and preserve private recoverable originals before effects. Retire only proven authorized old project hooks/startup units, preserving foreign/global integrations and historical notebook bytes. Partial migration resumes from recorded source/backup identities; repeated completed migration performs no protected writes. Installation replacement remains separately approved.

## 4. Worker restrictions and model selection: changed policy

**Before:** `allowed-worker` was an unordered permission set; `cli-provider` filtered external families. `review-policy: require-independent` prevented host-only review fallback. Profiles carried their own `tiers`, with documented tier-substitution behavior.

**Now:** `plan-order` and `review-order` choose routes and fallback chains. Role tiers resolve through `model-family` catalogs; selected unsupported pairs block rather than silently changing the model. Native work can additionally use `native-workers` bindings. Explicit executor, provider and independence constraints still prevail. [configuration.md, line 1](../references/configuration.md)

**Concrete impact:** `review-order: host` does not mean “all execution must stay in the host.” Likewise, `review-order: native` alone does not preserve an old “independent review is mandatory” requirement because ordinary fallback remains possible.

**Priority also reverses:** v8 preferred higher external-profile priority numbers; agentflow prefers lower numbers. Re-rank profiles rather than copying their numeric values.

**Replacement:** carry former allowlists, no-delegation rules, counterpart-provider requirements and strict independence into explicit project/owner constraints. Then choose compatible routes. This is a policy translation, not a key rename.

## 5. External worker isolation: universal runner removed, safeguards retained

**Before:** ordinary external delegation used `external-runner-v1` with literal arguments, a disposable no-remote clone, frozen scope, bounded diagnostics and host acceptance. The old contract explicitly stated that a clone was not an OS sandbox.

**Now:** the host selects real transport controls, supplies bounded inputs and checks source identity. Review tooling that could mutate originals still requires a disposable no-remote checkout; sensitive-file exclusion and actual permission limits still matter. [review.md, line 1](../references/review.md)

**Concrete impact:** an old runner receipt or accepted artifact format no longer arrives automatically. The host must establish the isolation and result evidence that applies to the chosen route. Neither native subagents nor group worktrees prove OS containment.

**Assessment:** isolation obligations were not removed wholesale. A universal ordinary implementation and some normalized diagnostics were removed; operational assurance now depends more on the actual host/provider controls.

## 6. Full pipeline: replaced by question-driven advisors

**Before:** v8's selected/full pipeline had fixed routing and mandatory requirements, specification, implementation and acceptance stages. `all-in` selected all optional advisors; `allow-ag` controlled pipeline permission, and incident-linked stage artifacts/gates supported that structure.

**Now:** advisors answer named material questions. Their order and depth are chosen for the task; they are not a mandatory stage sequence. Normal design/tracker creation, checks and result review still apply. New roles include `final-audit` and `product-docs`. [ag.md, line 1](../references/ag.md)

**Concrete impact:** asking for a complex feature does not promise a full set of old stage reports. A team whose audit process needs a requirements or security report must explicitly request that deliverable and its acceptance conditions.

**Replacement:** describe the evidence and decisions required, then select focused advisors. `browfield` offers structured existing-code discovery; it is not an automatic recreation of the full v8 pipeline.

## 7. Approval gates and automatic defaults: changed semantics

**Before:** consequential work used Design Go/Result Go boundaries. `away-gates` could supply those gates after evidence; `auto-reply` and temporary `keep-going` could resolve safe routine defaults. Owner-only choices still required the owner. v8 templates differed: Codex setup used `away-gates: on`, while the general missing-key default was off, so inspect the actual old project rather than assume it paused.

**Now:** `gate-design` and `gate-tracker` default off. The former pauses before implementation; the latter pauses before final delivery when a tracker exists. During feature merge, its integration-specific timing must be respected. Empty answers and suggested defaults supply no approval. [configuration.md, line 1](../references/configuration.md)

**Concrete impact:** old consequential-work approval expectations can disappear if the new defaults are accepted without discussion. Conversely, carrying an old safe-default automation assumption can cause an inappropriate unattended continuation.

**Replacement:** explicitly choose new gates and retain stricter owner checkpoints where needed. Turning `gate-tracker` on does not create a tracker; `plan-mode: must` is the option when every actual task needs the documented design/tracker creation rule. `gate-design: on` conflicts with `plan-mode: off`.

## 8. Feature streams: replaced, with different record and cleanup behavior

**Before:** v8 used `new-feature:`, `merge-back`, `cleanup:<taskkey>`, `.worktrees/`, root stream pointers and script-controlled lifecycle operations. Notebook-only streams were an explicit exception without a Git branch.

**Now:** managed Git work uses `new-feature`, `merge-feature`, `drop-feature`, `feature/<name>` and `.wts/ft-<name>`. Lifecycle operations avoid main's root notebook and its claim. Creation/merge records remain feature-specific; drop has no required durable tombstone. [features.md, line 1](../references/features.md)

**Concrete impact:** a root notebook no longer serves as the same active-stream dashboard or retirement ledger. A plain `merge-feature` retains the checkout/branch; cleanup needs explicit authority. Trash-based cleanup replaces v8 Git worktree removal with recovery copies; bounded own-feature retirement is supported.

**Creation and hook behavior also change:** v8 creation committed stream-open files and could push them; agentflow preparation stays uncommitted/unpushed. New scoped merge plumbing bypasses commit hooks, so required repository checks run separately. [features.md, line 1](../references/features.md)

**Replacement:** finish or separately reconcile v8 streams; do not rename their directories into the new managed layout and assume adoption. For notebook-only separation, request an explicit notebook destination; the old automatic notebook-stream/root-pointer workflow has no direct managed-feature equivalent.

## 9. Looper: retained and redesigned, not removed

**Before:** `make-plans` froze generated queues; `run-plans`/`run-looper` ran one ready plan at a time. Handwritten `plan-NNN.md` queues were also accepted. Completed plans moved to `planned/done/`, with old claim/reset/completion rules.

**Now:** `prepare-tasks`, `run-tasks` and `handle-tasks` use registered groups and `queue.json` schema 2. Each group has a stable worktree; tasks within it use fresh sequential sessions. Independent groups can run concurrently, earlier-group dependencies are supported, and one coordinator serializes checked integration. [looper.md, line 1](../references/looper.md)

**Concrete impact:** old plan files are inputs for new preparation, not runnable migrated queues. The new coordinator rejects unregistered handwritten groups; recover started v8 queues on v8, then explicitly prepare new agentflow queues from their original requirements. agentflow’s own schema-1-to-2 conversion rule is not a v8 converter. The new queue's schema number is unrelated to v8's own queue-envelope numbering.

**Retention tradeoff:** the new system keeps attempts, inputs, check logs, released claims and isolated task records. Default completion does not clean them up; explicit `agf looper cleanup <run-root>` or `run --cleanup` recycles completed-run worktrees and all run-root extras except queue/request/group plans; branches and delivered products remain. Avoid cleanup to retain complete records. Users trading away the ordinary runtime should still expect a substantial evidence footprint when they choose looper execution.

**Availability limit:** configured CLI tasks can progress while their coordinator remains live; native dispatch needs the live host and stopped-result mailbox. Neither setting creates an automatic restart service or absent-host native executor.

## 10. Notebook ownership: stronger default, different recovery mechanism

**Before:** ownership was optional and defaulted off; both modes retained lower-level writer locks and safe-path/snapshot checks. Enabled ownership used inspected tokens/hashes and helper-assisted adoption.

**Now:** agentflow always exclusively claims a hidden sibling `.<notebook-basename>.owner` with session, Ask and time. Foreign or malformed claims stop task execution; the host may not infer abandonment from age, silence or a stopped helper. No separate ordinary writer lock/heartbeat is supplied. [SKILL.md, line 1](../SKILL.md)

**Concrete impact:** two cooperating sessions cannot intentionally mix a notebook under an old `notebook-ownership: off` choice. A stale-looking marker can require an explicit exact-notebook handoff rather than automatic expiry.

**Assessment:** cooperation rules become stricter while helper-enforced writer machinery shrinks. This is not an unconditional improvement in concurrency safety; unrestricted editors remain outside the mechanism.

## 11. Capture, logs, archive and cleanup: less ordinary automation

**Retained:** owner input, STATUS, Ask/Reply history, RUN/WIP when enabled, unresolved questions, tracker recovery and one adjacent archive remain part of the workflow. Current source also supports deferred `append-rounds` / `append-tasks` batches and explicit off-record exchanges. [SKILL.md, line 1](../SKILL.md)

**Archive naming changes too:** `project.devlog.md` maps to `project.archive.md` in v8 but `project.devlog.archive.md` in agentflow. A plain `devlog.md` maps to `devlog.archive.md` in both. Preserve existing archive bytes and reconcile the association explicitly before archive/rename operations; do not create a second archive beside unrecognized history.

**Changed:** v8's helper compacted at 750 lines or 768 KiB; current agentflow instructs the host to archive above 750 lines or on request, without the old byte-size trigger. Long lines can therefore pass the old size threshold without triggering the same documented action. [SKILL.md, line 1](../SKILL.md)

**Changed:** `log-verbosity` becomes separate omission controls. Missing `omit-wip` defaults on, but the bundled setup template explicitly sets it off; migrating users should choose deliberately. Legacy conversion maps effective v8 log choices; current agentflow schema migration is a separate procedure. Inspect the mapped result rather than assume identical log semantics. [configuration.md, line 1](../references/configuration.md) [ag.json, line 1](../assets/.agentflow/ag.json)

**Removed controls:** v8's `completion-cleanup` and interval do not carry over as ordinary agentflow controls. Looper cleanup is opt-in through its explicit command or run flag, never a default/timed collector. It requires completed settled work and supported same-volume Trash, preserving durable records and branches. [looper.md, line 1](../references/looper.md)

**Test policy is less prescriptive:** v8 required a failing test first for every executable behavior change and a real PTY journey for changed terminal features. Current agentflow specifically requires bug reproduction plus relevant behavior/journey checks, without those two universal v8 prescriptions. Retain test-first or PTY requirements as explicit project rules if they are essential.

## 12. Additions that prevent an oversimplified “lite means fewer capabilities” conclusion

- **Recoverable parallel groups:** explicit dependencies, fresh tasks, serial integration and bounded repair exist in the optional runtime. The current package is not entirely free of JavaScript. [looper.md, line 1](../references/looper.md)

- **Planning/review routing:** Host planning for simple understood low-risk work; configured routes for complex work, with Claude-first worker drafting and Codex final challenge/synthesis, optional blind-draft reciprocal 3ways with Codex final decisions, review diversity preferences, Copilot-specific bindings and honest provider proof limits are documented. These are contracts, not proof that every provider is available. [configuration.md, line 1](../references/configuration.md)

- **Durable project guidance:** canonical system-invariant maintenance, shared project rules and affected product-documentation maintenance are explicit current responsibilities. Their coverage should be assessed from source rather than inferred from a file-count reduction. [product-docs.md, line 1](../references/product-docs.md)

- **Task controls:** `fast-lane`, `skip-review`, `grill-me`, `saving-mode` and `append-rounds` cover different concerns. None should be treated as a blanket substitute for old `skip-ag` or `no-ag`. [SKILL.md, line 1](../SKILL.md) [configuration.md, line 1](../references/configuration.md)

- **Configuration upkeep and release checks:** known agentflow predecessor settings migrate without resetting owner choices; on-record activation may check stable Agentflow releases on a two-day schedule. Installation replacement still requires explicit approval. Agentflow 9 is the stable successor to the aglite beta; Agentflow 8.x is not an eligible upgrade. [configuration.md, line 1](../references/configuration.md)

## How to decide whether to migrate

**Proceed with a controlled pilot** if your essential need is resumable assistant-led work and you can accept host-owned ordinary checks. Use a disposable project first and verify notebook recovery, exact settings, review and Git behavior under your actual host.

**Keep v8 for the affected workflow for now** if you require its old hook enforcement, command API, permission-list implementation, stream ledger or directly executable legacy queue. A migration guide can explain those losses; it cannot make the old contracts compatible.

**Make policy decisions explicit** for gates, strict independence, permitted executors, outward writes and retention. Replacing an old program with host instructions preserves a requirement only when that requirement and its proving procedure remain clear.

## Evidence and maintenance

This edition preserves the source comparison’s twelve substantive topics while following the current package’s migration and settings rules. Its examples describe contracts and consequences; they are not reported as completed host journeys.

For current usage, start with the [everyday guide](AG-GUIDE.md), [cheatsheet](CHEATSHEET.md) and [guarded migration rules, legacy-migration.md, line 1](../references/legacy-migration.md). Verify the actual host, installed command resolution and project policy in a disposable pilot; source documentation alone proves neither provider availability nor release readiness.
