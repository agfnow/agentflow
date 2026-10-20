# Changelog

## 0.3.1 — 2026-10-20

- Added optional looper task execution with `prepare-tasks`, `run-tasks`, `handle-tasks` and the dependency-free `agf loop run/status` launcher. Groups use fresh task sessions, checked serial integration, recoverable attempts and optional earlier-group dependencies. Native work requires the live host; configured CLI work can continue while the coordinator runs.

- Added Claude-first `plan-order` and planner/reviewer diversity preferences, with bounded fallback and preserved task constraints. Review routes are `external|native|host`; configuration uses integer schema 9 and migrates known predecessor settings without resetting valid choices.

- Added startup checks for eligible Agentflow successor releases. Projects with `ag.json` schedule checks two calendar days apart; installation replacement still requires owner approval and preserves source work.

- Added the optional `browfield` discovery path and aligned English/Traditional Chinese guides, public installation guidance and the command/settings cheatsheet. Platform/provider coverage remains limited to recorded checks; this release does not claim validation on every host.

## 0.3.0 — 2026-10-15

- Standardized the project and installed skill name as aglite in a separate private source repository.

- Added English and Traditional Chinese documentation, Claude plugin metadata and a host-driven public release procedure for agfnow/aglite.

- Current skill includes notebook ownership/recovery, configurable records/planning/review, feature worktrees, system invariants, one-task fast-lane and optional advisors including product-docs.

- Removed the persistent skip-review switch; review-order selects reviewers, with a one-task skip-review command for host review. Configuration schema is aglite-5; managed features use only .wts/ft-<name>, without compatibility handling.

- Documented switching Claude Code from the Agentflow plugin, including scope and separate-installation limits.

Earlier refactor experiments remain private historical evidence; this release does not claim new validation across all hosts or platforms.
