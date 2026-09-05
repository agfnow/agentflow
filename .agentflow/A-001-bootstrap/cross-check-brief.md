# Cross-check brief — A-001-bootstrap

Stage: cross-check

Route: external-runner-v1

Goal: Independently review the Agentflow bootstrap commit for outcome, minimality, and conformance.

Original Ask: `godev`

Evidence: Review the exact implementation commit supplied in the dispatch; its bootstrap paths are `.agentflow/devlog.md`, `.gitignore`, `ag.json`, and the frozen review records under `.agentflow/A-001-bootstrap/`. The bounded intake passed after initialization. The repository test suite was attempted but is not a clean baseline in this sandbox: release tests expect absent paths, and some tests require read-only home-directory writes. Focused review evidence is the exact commit diff and direct configuration/notebook inspection.

Normal journey: A user enters `godev`; Agentflow creates project records and configuration, records the owner Ask, validates intake, and leaves the repository ready for the next owner request.

Material uncertainties: The Codex project hook could not be installed because `.codex/hooks.json` is read-only. Existing untracked `.agents/` and `skills-lock.json` are outside this bootstrap commit and must remain untouched.

Frozen facts: `.agentflow/A-001-bootstrap/cross-check-facts.json`; plan result: targeted review.

Reviewer: codex-default, model `gpt-5.6-terra`, effort `high`, active host family `codex`, configured `cli-provider: off`.

Write authority: write only the declared worker report in the disposable clone; do not modify source, configuration, hooks, the live checkout, or dependencies.

Required checks: inspect the exact commit diff; inspect the behavior boundary and affected configuration/notebook records; use the coordinator's test evidence without claiming unavailable tests passed; reconstruct the outcome directly from the original Ask; account for every added concept and name its current owner outcome or reproduced failure; return exactly one each of `Outcome: PASS|BLOCKING`, `Minimality: PASS|BLOCKING`, and `Conformance: PASS|BLOCKING`.

Forbidden scope: no source changes, no test changes, no configuration changes, no dependency changes, no hook changes, no commits, no network operations, no Agentflow invocation, no delegation, and no review of files outside the frozen bootstrap paths except to understand their repository context.

Scope discipline — implement exactly the ask; park everything else as a proposal. The ask's scope is what the user wrote plus tests, commits, the notebook, STATUS, and any records required by the active route. Do not refactor, rename, reformat, add dependencies, or repair adjacent behavior unless the Ask requires it. Pass this paragraph verbatim in every worker brief.
