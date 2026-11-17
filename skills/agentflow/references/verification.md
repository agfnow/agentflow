# Adaptive verification

Use within existing planning, implementation checks, result review and deep review; add no stage, worker, gate or authority. Apply task modes, selected routes, required independence, access controls and [evidence storage](session.md#evidence-storage). With storage off, assess in context without substitute proof records. Inline looper copies use the supplied constraints; links do not require outside access or grant nested dispatch.

## Choose a discriminating check

- For each consequential accepted outcome, AC or invariant still unproved, name a plausible violation and the cheapest check that distinguishes it from correct behavior. Derive expected results from accepted requirements, not implementation output. Challenge weak or self-confirming assertions/references. Reuse matching proof; run nothing extra when it closes the gap.

- Match method to failure mechanism, consequence and uncertainty, not file type, line count or available tools. Reviewers challenge implementation and test strength; host verification/acceptance remains required. Mid/high and explicit deep review retain their existing triggers/routes. Tool failures, flaky results, missing checks and inconclusive output are not passes.

- Prefer existing approved tools/fixtures; a safe manual equivalent may suffice. Review-only work remains read-only; request host probes when restricted. Mutation, crash or destructive probes require isolated disposable fixtures/copies without live effects. Persistent tests/fixes need implementation authority; installations, dependency changes, external access/uploads/sends and paid operations need applicable authority. Missing required tools/access leaves a named gap, never an invented pass.

## Select by failure mechanism

These are alternatives, not mandatory stages. Use the smallest adequate check; deepen only for a named remaining gap.

- **Examples/static/regression:** ordinary assertions and existing static checks for concrete expected results, caller/API contracts and known regressions. Exercise the supported entry and retained/reloaded result when relevant; mocks alone cannot prove actual wiring or external receipt.

- **Properties:** general requirement-derived rules over meaningful inputs, such as round trips or preserved totals. Generate/reduce/replay failures when useful; assert the required value, not a weaker property satisfied by a wrong implementation.

- **Differential/metamorphic:** compare against a credible independent reference or a justified relationship between related inputs/results. Shared bugs or an unjustified relationship defeat the oracle.

- **Fuzzing:** malformed/unexpected input at parsers and trust boundaries, with meaningful assertions or fault detectors. Fuzzing does not discover business intent. Use existing [security](advisors/security-scan.md) guidance for implicated trust/data flow.

- **Targeted mutation:** when assertion strength is uncertain, deliberately inject a plausible consequential fault in isolation and check detection. Investigate survivors; equivalent mutants need no changed behavior. No universal score, mutation pass or refactor target.

- **Integration/faults:** real entry points, dependencies, persistence and user journeys; controlled scheduling, bounded load, duplicate delivery, lost responses, restart and crash injection for implicated non-atomic boundaries. Sequential tests do not prove races covered. Affected web journeys retain [browser testing](browser-testing.md).

## State and ordering

- When cancellation, ownership, retry, recovery or concurrent ordering leaves a consequential gap, compare expected design transitions with implementation transitions in both directions. Use a small transition list first; hierarchy/parallel statecharts only when they clarify actual interactions. No application rewrite into a state-machine framework follows.

- Identify states, events, guards, side effects, in-flight operations, persisted versus in-memory state, terminal/rejected/ignored events and ownership generations where relevant. A missing transition can be an intended reject/ignore; missing material intent requires a decision, not an invented defect or requirement.

- Use stateful/model-based tests against actual code and a simpler independently justified model when sequence behavior needs proof. Exercise invalid actions as well as legal sequences; generators restricted to valid actions cannot prove rejection. Control relevant scheduling/crash points separately. Retain reduced failing sequences/replay inputs only under the applicable evidence rules or authorized regression tests.

## Formal methods

- Select only for a precise consequential guarantee whose remaining gap justifies the work over cheaper checks. Model checking (e.g. TLA+/TLC) suits coordination/interleavings; deductive verification (e.g. suitable Dafny code/contracts or TLAPS obligations) suits supported theorems/kernels. These do not automatically verify arbitrary repository code or require one tool before another.

- State the property, expected violation, assumptions, model/contract, relevant bounds and implementation-correspondence check before use. Safety forbids bad states; liveness promises eventual progress and needs explicit scheduling/delivery/recovery assumptions. Do not assume away the failure under review.

- For model checking, inspect actual enabled properties, configuration, bounds, search mode/completion and tool diagnostics. A completed finite exhaustive search supports only that explored model under its assumptions. Sampling/simulation, timeout, omitted properties or unjustified pruning cannot establish full configured coverage; justified reductions retain their stated proof limits. A diagram or counterexample-free partial run is not a pass.

- For deductive proof, require meaningful pre/postconditions, invariants, assumptions and discharged obligations. Report exactly the theorem established; unbounded/temporal claims require support for those claims. A weak contract proves only its weak statement. Failed verification can mean insufficient proof guidance, not a concrete code counterexample.

## Model and implementation

- Derive expected properties from accepted requirements independently of code extraction; then map modeled actions, guards, effects and atomicity/persistence boundaries to real implementation. Preserve interleavings that can cause failure. A copied buggy implementation is no independent reference.

- Check correspondence separately through appropriate implementation tests, model-based tests, mapped traces or supported refinement proof. Trace/sample conformance covers observed executions only. Translate model counterexamples into reproducible code tests where they correspond to actual behavior; separate abstraction errors from implementation defects.

- Without sufficient correspondence, report the scoped design/model result and leave affected implementation claims unproved. A verified model is not verified production code. A model/design conflict needs an authorized decision; never change accepted intent or safeguards to obtain proof.

## Repair and stopping

- A passing candidate needs no repair loop. For concrete failures: reproduce → identify violated requirement → bounded authorized repair → rerun affected checks and required review → accept only the checked final candidate. Reviewers return findings/host probes; repair authority stays with the authorized host/worker. Rebind proof and review to changed source; reuse unaffected matching proof.

- Preserve requirements, safeguards and meaningful assertions. Never skip checks, weaken tests/contracts or lower risk merely to pass. Correct a demonstrably wrong test only with requirement-based justification and applicable review. Distinguish product defects from flaky checks, infrastructure failures and missing proof; missing proof alone does not authorize product edits. Inspect external-operation identity before retrying an unknown effect.

- Before autonomous repair, honor existing attempt/time/cost limits (including looper max-repairs); absent an attempt limit, stop after two unsuccessful repairs of the same failure. Set finite task-appropriate time/resource bounds before repair; use observable limits and disclose unavailable monetary telemetry rather than claim an unenforced cost cap. These are host technical choices within existing authority, not new settings or routine owner gates.

- Stop dependent work at exhausted limits, unresolved consequential decisions, missing required safety-boundary proof or new authority needs. Preserve essential unfinished state/last failure/next safe action in existing recovery, without a substitute evidence sink; continue independent authorized work. No unchanged retry loop or implied background continuation.

## Acceptance and claims

- Accept only when required outcomes/checks/invariants and review/independence/gates are satisfied for the exact candidate. Agreement, test counts and persuasive explanations are not correctness proof, human approval, automatic-merge authority or a zero-regression guarantee. Surface decision-changing uncertainty and owner-only needs at the existing answer destination; keep required risk statements.

- No automatic experiment or measurement program follows. If reporting human-involvement rates, define the complete change/PR population, window, predeclared eligible subset/exclusions and blocked cases. Use matching denominators for rescue, required review/approval, audit and escalation; distinct total human-touch counts their union once. Pair rates with escaped-defect severity, reversions, false escalations, repair failures, elapsed time/cost and statistical uncertainty. Report all incoming changes separately from the eligible subset. Shadow estimates do not establish observed labor reduction; an unmeasured <5% or no-human-review claim is unsupported.
