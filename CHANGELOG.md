# Changelog

## 9.1.0 — 2026-10-28

- Added terminal feature lifecycle commands through `agf new-feature`, `agf merge-feature`, `agf drop-feature` and their short aliases, with caller-shell directory switching, the optional `default-editor` setting, isolated feature records and checked merge/drop recovery. Feature merges can proceed when no project checks are configured; configured checks still apply.

- Added explicit completed-run looper cleanup with recoverable macOS Trash, compact retained plans/queue, protected outputs and resumable cleanup identities. Ordinary runs keep their records; native Linux/Windows cleanup remains unsupported.

- Improved looper terminal reports and failure summaries, task-output limits, moving-target integration and completion/recovery checks.

- Updated planning to blind Claude/Codex drafts and reciprocal debate for `3ways`, with Codex final synthesis; simple work plans directly in the host. Added `ag`/`agf` activation aliases.

- New configurations detect supported Codex/Claude CLIs and fill looper routes; existing settings remain. Task preparation now shows terminal execution choices even with `inline-reply: off`.

- Added missing-binding setup guidance and aligned English/Traditional Chinese guides and cheatsheets with terminal features, shell refresh, cleanup and current schema 13 settings. Existing bindings require an explicit upgrade request.

- Preserved host-driven workflow, deliberate installation replacement and private/public packaging boundaries. Recorded checks cover packaged tests and representative macOS host journeys; native Windows, editor and provider behavior retain their stated limits.

## 9.0.0 — 2026-10-23

- Released stable Agentflow 9 under the `agentflow` skill/plugin/package identity at `agfnow/agentflow`, preserving v8 at `agfnow/agentflow-v8`. Existing beta/v8 installations require deliberate source/version selection; publication does not replace them.

- Shipped the public v8 comparison and aligned English/Traditional Chinese guides, cheatsheets and installation guidance with current prompts and schema 13.

- Required valid `saving-mode: on|off`, preserving existing values and adding off only when absent during setup/migration. Repaired private legacy-migration backups, residual v8-field detection and predecessor-effective planner tiers.

- Extended the empty-bootstrap contract to eligible existing repositories without commits and protected pre-existing owner contents through first delivery. Explicit prohibitions and safe retry boundaries remain.

- Applied the approved 440-byte planning-route consolidation without changing its requirements. Ordinary work remains host-driven; the optional dependency-free looper retains its bounded runtime and stored identifiers.

- Release evidence covers recorded package tests and representative macOS host journeys. Native Windows, editor and provider availability remain separately stated limits, not universal support claims.

## 9.0.0-beta.1 — 2026-10-21

- Reduced the default skill entrypoint and moved detailed procedures behind task-specific loading. Reviewed every machine prompt for conflicts, duplication and lost safeguards.

- Rewrote current English and Traditional Chinese user guidance in short passages. Added append-tasks as an exact append-rounds alias and made human template text follow use-lang.

- Added guarded, demand-loaded migration for recognized Agentflow8 projects, including configuration conversion, current STATUS and proven old project integration retirement. Existing schema9/10/11 mappings preserve real skip-wip values; ambiguous ownership or lost intent remains a decision.

- Expanded explicit worker routing with Copilot/native bindings and schema 12 settings. Preserved localized looper closeout and interrupted-work recovery; Windows and provider-specific limits remain explicit.

- Published as an Agentflow9 beta prerelease. The GitHub stable Latest release is retained.

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
