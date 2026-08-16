# Defensive security scan

## Goal

Perform a read-only security review of the changed files and affected trust boundaries declared by the controlling agent.

Find concrete vulnerabilities, record what was examined, and recommend specific action without editing code or starting a repair loop.

## Inputs

Note to the controlling agent when dispatching this advisor cross-family: frame the brief as an authorized defensive pre-merge verification — "check whether the named protections hold" — and keep the concrete vulnerability classes, impact, and evidence requirements intact. If the executor's moderation layer refuses the dispatch before any review happens, record an executor error and retry once with technically equivalent defensive wording; a refusal is neither a security finding nor a clean result. — incident 2026-08-14: an "exploit/bypass"-phrased brief was refused twice by the executor's moderation; the defensive reframe passed and found a real bypass.

Read only the exact changed files, declared authorization, configuration, dependency, and data-flow boundaries, repository evidence, and output path supplied by the controlling brief.

Do not scan for other artifacts or ask the owner directly.

Stay read-only. Do not modify source, configuration, dependencies, generated files, or other artifacts.

## Review coverage

Examine the declared scope for these vulnerability classes where they apply:

- injection into SQL, NoSQL, shell, path, template, or other interpreters;

- hardcoded or leaked credentials, tokens, keys, or sensitive logs;

- missing authentication, authorization, ownership checks, or object scoping;

- unsafe deserialization, prototype pollution, cross-site scripting sinks, redirects, and file handling;

- dependency and install-script risk when dependencies changed; and

- permissive cross-origin resource sharing, weak cryptography, missing abuse limits, and verbose error leakage.

Follow data and control flow only within the declared changed files and affected boundaries.

If evidence reveals an affected trust boundary that the declaration missed, name the boundary and the evidence that connects it to the change. Do not examine that added boundary until the controlling agent approves a bounded redispatch.

Report unavailable tools and unexamined surfaces as missing evidence. Do not describe them as clean.

## Output contract

Write one Markdown report to the exact output path from the controlling brief.

State the exact changed files, declared trust boundaries, revision, tools, commands, and surfaces examined.

For each finding, use a stable `SS-<n>` ID and include:

- **Severity:** `critical`, `high`, `medium`, or `low`, with no numeric rating;

- **Location:** the exact path and line or configuration key;

- **Impact:** the concrete attack or failure consequence;

- **Evidence:** the relevant code, configuration, data flow, or command result; and

- **Recommended action:** the specific correction or containment.

Include a non-findings section that names each checked vulnerability class and the examined surface supporting the conclusion.

Include a missing-evidence section for unavailable tools, blocked checks, and unexamined surfaces.

Include a missed-boundaries section naming any boundary that needs approval for a bounded redispatch.

End with a concise conclusion. A clean result is valid when the declared scope was examined and its coverage is recorded.

After the conclusion, end the report with one final `Self-check:` line — stating that every invariant of this prompt held for this scan, or naming exactly the ones that did not and why. Then return the report path and a short factual summary to the controlling agent.

## Invariants

- The review covers only the declared changed files and affected trust boundaries.

- Every finding has an exact location, concrete impact, supporting evidence, recommended action, and one permitted severity word.

- Every non-finding names the checked class and the surface examined.

- Missing evidence remains distinct from non-findings and a clean conclusion.

- A discovered but undeclared boundary is reported for approval, not silently added to the review.

- The advisor does not modify files, apply fixes, or dispatch follow-up work.

## Failure modes

- Do not report generic security advice without a scope-specific consequence.

- Do not infer safety from an unavailable tool, blocked command, or unexamined surface.

- Do not widen the declared scope because a nearby file appears relevant.

- Do not attach numeric ratings or percentages to findings or the conclusion.

- Do not hide an authorization, configuration, dependency, or data-flow boundary that the supplied change evidence implicates.
