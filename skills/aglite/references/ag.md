# Optional development advisors

Use only after SKILL.md selects advisor work. The host chooses questions, depth and order; advisors support normal development, never a mandatory stage sequence or separate workflow. Preserve Task modes, configuration, ownership, scope, gates and review rules.

## Select by question

Choose the smallest useful set; apply the common rules below with each selected prompt. Read only selected linked prompts. Explicit `advisors: name, name` selects from these exact names; reject empty/unknown names before reads or dispatch, deduplicate in given order and honor dependencies. If the requested question/target cannot be inferred, ask only for that missing scope. Selection authorizes advice within the accepted task, not implementation of proposals.

- [requirements](advisors/requirements.md): material product intent, scope or success is unclear.

- [codewalk](advisors/codewalk.md): affected paths, data flow or interfaces are unfamiliar or a relevant map is stale.

- [explore](advisors/explore.md): consequential alternatives, cross-subsystem risks or assumptions remain unresolved.

- [spike](advisors/spike.md): one technical unknown needs an observed experiment before a dependent decision.

- [spec](advisors/spec.md): decided behavior needs a coherent implementation contract across interfaces, stored data or failure states.

- [security-scan](advisors/security-scan.md): an affected trust boundary or explicit defensive question needs focused examination.

- [acceptance](advisors/acceptance.md): final outcome/invariant evidence needs adversarial examination; reuse the required result review under review.md.

- [final-audit](advisors/final-audit.md): release-candidate readiness or a named distribution/interaction proof gap within accepted release work; `advisors: final-audit` and natural-language requests to audit an identified release candidate select it; ordinary review requests remain result review. Full assessment follows ordinary checks and candidate assembly; earlier focused advice cannot claim readiness. Reuse `acceptance` settings and matching review; never trigger from project size/completion alone.

- [learn](advisors/learn.md): requested learning, repeated failure or a serious unexplained incident warrants an evidence-backed lesson.

- [product-docs](advisors/product-docs.md): a named product-map, first-time suite, maintainer/agent handover or substantial documentation-drift gap within authorized work; ordinary updates use host maintenance.

Ordinary implementation and result review remain under SKILL.md/review.md; neither requires an advisor. Do not load unselected prompts, run all advisors because the project is large, or create a report for a skipped advisor.

## Adapt and stop

For each selected advisor, name one question, affected scope, missing evidence, depth and stopping condition in the existing design/tracker/devlog. Scale from focused evidence on one known surface to implicated interfaces, journeys and failure paths; expensive reversal, uncertain cross-subsystem behavior or consequential trust/data risk warrant competing explanations, failure/recovery and the strongest relevant counterexample.

Escalate only for a named unresolved evidence gap; shrink or stop when evidence settles it. No word quota, compulsory sections or generic risk catalogue. Resolve dependencies before dependent work: clarify intent before specifying it, use a spike only when reading cannot settle the technical claim, and assess acceptance against the final source. Reuse current findings; refresh only evidence affected by changed intent, contracts, source or environment. Missing evidence stays unproved and blocks only dependent work.

## Execute and retain

The host may apply the prompt directly; an advisor is a reasoning role, not a required worker. Delegate only when useful and authorized, following [review.md](review.md) with a bounded assignment and real handle; supply these common rules, the selected prompt and its required canonical sections/linked constraints through readable files or exact text for tool-restricted workers. Required independence still needs a separate context; never label host reasoning independent or start nested advisors.

Return the answer, checked sources/observations, remaining uncertainty and next implication. Keep owner decisions, facts, assumptions and proposals distinct; send material owner questions through the host to the existing answer location. Advisors cannot broaden scope, approve changes or resolve owner-only choices.

Keep contracts in the existing design and recovery in Current/tracker; store useful workflow evidence once under [Round evidence](../SKILL.md#round-evidence). Specification updates the design when needed under normal creation rules; no second spec. Save a separate report only for substantial reusable evidence or an explicit request, under the producing Ask's artifacts with the exact source/scope and limitations. Probe files use an explicitly bounded scratch path there; do not package hooks, runners or helpers. The host checks actual results, updates canonical contracts and continues the next authorized work when the question is resolved.
