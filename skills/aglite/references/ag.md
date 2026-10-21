# Optional development advisors

Use only after [task modes](work.md#task-modes) select advisor work. Host chooses questions, depth/order; advisors support ordinary development, never a mandatory sequence or separate workflow. Preserve Task modes, configuration, ownership, scope, gates and review.

## Select by question

Choose the smallest useful set; apply common rules with each selected prompt. Read selected prompts only. `advisors: name, name` selects exact names below; reject empty/unknown names before reads/dispatch, deduplicate in supplied order and honor dependencies. Ask only for uninferable question/target scope. Selection authorizes accepted-task advice, not implementing proposals.

- [requirements](advisors/requirements.md): unclear material product intent, scope or success.

- [codewalk](advisors/codewalk.md): unfamiliar affected paths/data flow/interfaces or a stale relevant map.

- [explore](advisors/explore.md): unresolved consequential alternatives, cross-subsystem risks or assumptions.

- [spike](advisors/spike.md): one technical unknown needs observed experimentation before a dependent decision.

- [spec](advisors/spec.md): decided behavior needs a coherent contract across interfaces, stored data or failure states.

- [security-scan](advisors/security-scan.md): affected trust boundary or explicit defensive question needs focused examination.

- [acceptance](advisors/acceptance.md): final outcome/invariant evidence needs adversarial examination; reuse required result review under review.md.

- [final-audit](advisors/final-audit.md): candidate readiness or named distribution/interaction proof gap within accepted release work; explicit `advisors: final-audit` or natural-language audit of an identified release candidate selects it. Ordinary review remains result review. Full assessment follows ordinary checks/candidate assembly; earlier focused advice cannot claim readiness. Reuse `acceptance` settings/matching review; size/completion alone never triggers it.

- [learn](advisors/learn.md): requested learning, repeated failure or serious unexplained incident needs evidence-backed lessons.

- [product-docs](advisors/product-docs.md): named product-map, first-time suite, maintainer/agent handover or substantial drift gap within authorized work; ordinary updates use host maintenance.

Ordinary implementation/result review follow [work](work.md)/[review](review.md), without requiring advisors. Never load unselected prompts, run every advisor because a project is large, or report skipped advisors.

## Adapt and stop

For each selected advisor, name its question, affected scope, missing evidence, depth and stopping condition in existing design/tracker/devlog. Scale from focused evidence to implicated interfaces, journeys/failures. Expensive reversal, uncertain cross-subsystem behavior or consequential trust/data risk warrant competing explanations, failure/recovery and the strongest relevant counterexample.

Escalate only for named unresolved evidence gaps; shrink/stop when settled. No word quota, compulsory sections or generic risk catalogue. Resolve dependencies first: clarify intent before specifying, spike only claims reading cannot settle, assess acceptance against final source. Reuse current findings; refresh evidence only for changed intent/contracts/source/environment. Missing proof stays unproved, blocking only dependent work.

## Execute and retain

Advisors are reasoning roles, not required workers. Planning advice follows [planning routes](review.md#planning-routes); other advice may use host reasoning or authorized useful delegation. Follow [review](review.md): bounded assignment, real handle, common rules, selected prompt and required canonical sections/linked constraints supplied through readable files or exact text for tool-restricted workers. Required independence needs separate context; never label host reasoning independent or start nested advisors.

Apply [writing](writing.md) to human-facing output: short, single-concept paragraphs/items. Return answer, checked sources/observations, uncertainty and next implication. Separate owner decisions, facts, assumptions and proposals; route material questions through the host to existing answer locations. Advisors cannot broaden scope, approve changes or settle owner-only choices.

Keep contracts in existing designs, recovery in Current/tracker and workflow proof once under [Round evidence](session.md#round-evidence). Specification updates the existing design or contract record when needed under normal creation rules; no second spec. Separate reports require substantial reusable evidence or explicit requests; place under the producing Ask’s artifacts with exact source/scope/limits. Probes use explicitly bounded scratch paths there; package no hooks/runners/helpers. Host checks actual results, updates canonical contracts and continues authorized work when resolved.
