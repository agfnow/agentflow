# Simplicity check

Canonical adequacy/scope/minimality checklist. Existing callers use Check without adding stages, workers, records or authority; their timing, routes and gates remain unchanged.

## Command

Unquoted `simple-check [target]` reviews the named existing plan, or the unambiguous active plan; missing/ambiguous targets need clarification, not plan creation. This command grants no implementation authority.

Use [review.md’s worker settings, bounded assignment and result-review routes](review.md) with a fresh independent read-only worker using `acceptance`: exclude target-authoring sessions, inherited drafting context and host fallback. Preserve explicit controls, privacy and project/invariant rules. If no compatible independent route works, return BLOCKED; never claim the check passed.

Supply the original request, corrections, accepted decisions/exclusions, exact target revision, relevant source/contracts/invariants and evidence/limits. Label assumptions and suggestions; the author's summary/verdict is not authority. Missing material context blocks dependent conclusions.

## Check

Ask: “Are you overengineering or expanding scope again?” Start with the hypothesis that avoidable complexity exists; challenge it with evidence. Do not invent defects, demand global optimality or treat consensus as proof.

- Adequacy first: trace accepted outcomes, purpose, constraints and safeguards to the target. Missing outcomes fail; fewer parts never justify losing guarantees. Separate requested behavior, observed facts, assumptions and optional proposals.

- Scope: tie each material component, abstraction, integration, stage and deliverable to an accepted outcome/constraint or demonstrated blocking failure. Hypothetical future needs do not justify committed scope. Identify unsupported additions and their smallest adequate removal/replacement.

- Subtraction: challenge substantial mechanisms, starting with the highest burden. Remove or replace them with an existing capability, plain function, file or permitted human step; walk a concrete required lifecycle, including relevant failures/restart. Name what breaks, its source requirement and why a smaller repair is inadequate before retaining complexity. If already minimal, explain why the plausible reductions fail. Preserve required automation, safety and recovery.

- Compare total burden: implementation, operation, human/host attention, coordination, verification and recovery. Give a concrete adequate simpler replacement and its tradeoffs where justified; do not substitute shorter text, fewer files or manual work that violates accepted outcomes.

- Check proof: for plans, assess feasibility and proposed validation; do not demand unbuilt implementation. Distinguish plan reasoning, simulation and observed behavior. Require evidence appropriate to the claim; prototype/fake-worker results cannot prove real integration. Expose missing proof and owner-only choices; recommendations grant no scope or change authority.

## Result

Return PASS, REVISE or BLOCKED for the exact target, with concise evidence: requirement/source, target location, defect or retained-mechanism reason, smallest adequate change/tradeoff and missing proof. PASS requires adequate in-scope outcomes, justified material complexity and no unresolved blocking finding/proof gap; REVISE names supported defects, BLOCKED names missing authority/context/access/proof. Nonblocking preferences do not veto an adequate plan.

Save in existing review evidence/answer locations; no mandatory separate report. The host owns disposition and acceptance but cannot relabel unresolved findings as PASS. Recheck affected revisions before claiming they pass; reuse unchanged valid work, never rerun unchanged exchanges to manufacture agreement. This check does not replace other required review, checks, owner approvals or delivery gates; reuse a matching pass under [review.md](review.md#inspect-the-finished-result).
