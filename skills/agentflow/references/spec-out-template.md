# <Change name>

<Plain-language mental model: user problem, intended result and how the main parts work together.>

<Scope/readiness; reference material Q IDs below. Replace prompts with evidence. Give each rule/open choice one home; use short references elsewhere. Omit irrelevant detail; preserve the four required proof sections. Render all human labels in the configured language.>

## Authority and decisions

- Request and owners: <original request; accountable product, technical, design and affected domain owners>.

- Lifecycle: <overall accepted-scope readiness under [readiness and handoff](planning.md#specification-readiness-and-handoff); DRAFT gaps/affected R/AC IDs or ready scope/support, explicitly accepted stage/subset limits and remaining mandatory work; accepted interview/decision IDs and reusable evidence revisions; link the same tracker/Current for stage and next action. Readiness is not implementation approval or passed implementation checks>.

- Collaboration, if selected: <canonical repository/path/base revision; proposal PR and contributor branches/worktrees; role owners, reading/feedback/edit routes; accepted approval policy and revision-bound sign-off links>.

- Sources: <path/link, revision, status, inspected scope; authority per decision; inaccessible/stale inputs. Annex scope/owner/pinned revision if justified>.

- Status: <DECIDED with owner/source; OBSERVED with evidence; ASSUMPTION with consequence; PROPOSED alternative. Link OPEN choices under Changes and open work to their sole devlog question; use only applicable records>.

## Source request

- Original request: <faithful customer/raw-input summary; consequential exact wording, distinct from clarified requirements and solutions>.

- Provenance: <ticket/path/link, inspected revision/date and permitted original/raw-input link; inaccessible/uninspected source gaps, never inferred contents>.

## Product

- Purpose: <actor, starting situation, problem evidence and observable desired outcome>.

- Scope: <included change, affected platforms/product types/roles and exclusions>; constraints: <accepted obligations/tradeoffs>.

- R-1 — <condition → behavior, exceptions/failure, source/decision; define ambiguous terms>.

- Journey: <start → actions/state changes → outcome; relevant failure/recovery>.

## Tech

- Current behavior and impact: <verified code/tests/schema/interfaces/data/consumers and revisions; changed versus inherited behavior, feasibility assumptions/contradictions and remaining probes. If access is missing, state the gap briefly and reference Q IDs; do not invent architecture>.

- Approach and contracts: <only evidenced or decision-needed technical detail beyond R rules: responsibility/data flow, consequential choices, decided fields/types/defaults/keys/errors/units; link schemas/fixtures>.

- Recovery and delivery, if affected: <concurrency/retry/retention, migration, old clients, rollout/rollback; dependencies and owners>.

## Art

- Evidence: <relevant Figma frames/variables/variants, running product and reusable component/style revisions; discrepancies and accepted authority>.

- Flow/states: <only interaction detail beyond R rules: entry/actions/navigation, relevant loading/empty/error/permission/accessibility/platform behavior; reference R/Q IDs rather than repeat rules or unknowns>.

- Components/copy: <real component/variant, copy owner and required locales>.

- Prototype: <if the owner decided none is needed, link that decision and unproved interaction coverage; otherwise consolidate existing artifacts/reports under [Art integration](spec-out.md#write-and-reconcile); revision, task/scenario/report links, accepted versus illustrative scope, pending decisions and engineering proof gaps; authorized creation/revision follows [UX prototypes](ux-prototype.md)>.

## Measurement, if affected

- Metric/event: <purpose, population, numerator/denominator, units/window, baseline/target or unknown, sample counts, event/trigger/parameters, data owner and verification. Reuse canonical definitions>.

## Invariants

- System guarantees: <applicable canonical IDs/links; proposed promotion, existing coverage or no promotion with reason>.

- INV-1 — <starting condition; preserved guarantee; violation; authoritative source>.

## Acceptance criteria

- AC-1 — <R/INV refs>; Given <state/data>, when <action>, then <observable pass/fail>; proving check <method>; required environment <environment>.

- Coverage: <each retained requirement → section → AC/INV IDs; relevant negative and existing-behavior cases>.

## Validation

- <AC/INV IDs → exact check/fixture/manual task; revision/environment; evidence location; observed result or NOT RUN. State shared proof/access limits once; reference Q IDs for blockers, not their full explanations>.

## Changes and open work

- <Q-NNN-n — link to the sole devlog question; blocked scope and next action. Do not duplicate the question or add an answer field here>.

- <Integration: common base/current/incoming revisions, preserved distinct intent, conflict decision links; affected reviews (sign-off revisions live under Collaboration)>.

- <Accepted delta/source → affected rules/artifacts/checks and stale proof; retained history link. Execution status belongs in tracker>.

## Minimality check

<Trace requested outcome and relevant failure/recovery against original inputs. Compare a concrete smaller approach; explain retained complexity, burden, scope fit and missing proof.>
