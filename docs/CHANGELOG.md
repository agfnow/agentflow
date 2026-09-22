# Changelog

Notable Agentflow changes, with the newest version first. Release metadata uses major.minor.patch; the current release is 8.4.0. Earlier dates identify recorded source milestones, not independently verified public publication dates.

## [Unreleased]

## [8.4.0]

### Added

- Manual notebook compaction accepts `--include-answered true` to archive completed rounds containing filled-in answers while preserving their exact bytes. Automatic compaction still retains answered rounds, and the current open round remains live.

## [8.3.1]

### Fixed

- Explicit first activation can claim a newly created stream after its first Ask is filled, using the committed empty notebook as proof while preserving session ownership protections.

- Stream cleanup preserves recognized Agentflow local records, hook files and Finder metadata in private recovery storage before removing the worktree. Unknown files, active ownership and changes during cleanup still stop removal.

## [8.3.0]

### Added

- Schema-8 unordered `allowed-worker` permission policy for external, internal, and host execution, with all three kinds enabled for new projects and conservative v7 migration.

- Portable hookless host support with safe host identity, optional known family, honest model and permission limits, and native host-tool handoff data.

- Version-1 shared review records for external, native, and host review, with `prefer-independent` and `require-independent` policy semantics.

- Hook handoff notices now carry the owning session and prompt-capture diagnostics are nonblocking.

### Changed

- Ordinary worker assignments may be passed directly; separate brief files remain for queued/resumable work, launcher requirements, and requested review records.

- Availability fallback is finite and availability-only; write ownership must be settled before a replacement attempt, and standalone looper hands pending work back to an interactive host when external execution is unavailable.

- Documentation now distinguishes portable-core support, verified Codex/Claude integrations, and unavailable optional named integrations.

- Added persistent `git-timeout-ms`, `log-verbosity`, `inline-reply`, and completion-cleanup controls with bounded interval validation; `AGF_GIT_TIMEOUT_MS` remains the valid environment override above the 30-second default.

- Moved the changelog from the repository root to `docs/CHANGELOG.md`; release assembly now publishes it at the same path.

- A shared default-branch resolver accepts `git config agentflow.default-branch` before cached `origin/HEAD` and compatibility names, supporting custom branch names across the commit guard, startup and stream commands.

- Removed the unfinished metrics helper, setting, and active documentation; existing history is preserved.

### Fixed

- Public test files no longer contain references to omitted private sources. Development-only checks remain in the development repository, and release checks validate the assembled package's file references.

- Cleanup and confirmed discard protect local and remote branch tips against concurrent changes, refuse mismatched push destinations, and stop when branch or worktree inspection fails.

- Release assembly now validates source and destination ignored state before deletion, keeps `Unreleased` empty for a candidate, and pushes and verifies an explicit origin branch even when reusing an existing release commit.

- Notebook compaction reports retained answered rounds while keeping the live suffix authoritative; named Ask grammar, CRLF STATUS separators, and global regular-expression state are handled consistently.

- Standalone generated queues refuse to launch without their authority envelope; cleanup refuses uncertain Git state, remote-ahead or diverged tips, ignored collisions, and untrusted status inspections.

- Closeout delivery retries a saved verified commit without taking ownership from a newer Ask; completion records block unsafe target-document renames; hook commands use literal shell paths.

### Limits

- Complete OS sandboxing, credential isolation, arbitrary CLI recipes, and unverified named integrations remain deferred. This release does not claim Pi, Gemini, or OpenCode live verification.

## [8.2.0] — 2026-09-13

### Added

- Ordinary notebook work in folders without Git, including local completion. Git remains necessary for commits, branches, and feature worktrees; Agentflow does not initialize it automatically.

- An on-demand `agf skills audit` command to inventory discoverable skills and prepare a read-only conflict assessment.

- Optional completion-record cleanup through `completion-cleanup` and `completion-cleanup-interval-days`. Cleanup is off by default and uses Trash for eligible completed, inactive records older than 30 days.

- `show-diff` output with a reason for each logical change and unified diff hunks that mark removed and added lines.

- This changelog in the public release, with plugin metadata derived from the skill’s release version.

### Changed

- Rewrote the English and Taiwan Traditional Chinese guides around everyday tasks, retaining the YouTube introduction and placing advanced details in expandable sections.

- Refreshed public READMEs with installation maintenance, weekly crontab guidance, direct-agent help, and the maintainer’s `gpt-5.6-sol/low` recommendation for Codex coordination. Update examples use the Skills CLI’s installed-name syntax: `npx skills update agentflow`.

- Kept completion metadata in local supporting records, so new notebook Replies no longer contain generated evidence links or hashes.

- Used the active Codex transcript turn for new Reply model/effort attribution. Added the Ask identifier to new RUN and WIP headings while preserving old records.

- Refined direct execution and delegation guidance around the benefit of a handoff, retained necessary checks, and consolidated task artifact locations and writing rules.

### Fixed

- Closeout failures caused by archives exceeding the former 1 MiB read limit. Corrected retries now inspect archives in chunks; unchanged verified retries reuse their evidence.

- Recovery of filled question answers and preservation of configured asker names. Handled answers are not replayed, and empty fields do not count as approval.

- Duplicate capture when a prompt hook receives a manually recorded submission, while preserving separate later submissions.

- Recognition of explicit review waivers and comma-separated fast-lane controls during completion and hook checks.

- Requirements-refresh guidance that must preserve question history even outside an advisor-only workflow.

### Notes

- Agentflow’s release number changes to 8.2.0; the `ag.json` configuration format remains schema version 7.

- Current host and worker support centers on Codex and Claude; broader compatibility remains proposed work.

## [8.0.1] — 2026-09-09

### Changed

- Introduced explicit release-version metadata in `SKILL.md`, with a matching visible heading and a single authoritative version source.

- Reduced completion friction: presentation-only issues are advisory, and routine informational or cosmetic changes can complete after host inspection without unnecessary external review.

- Kept task scope, truthful evidence, and explicit owner review waivers central to closeout; fast-lane retains host self-review and necessary checks.

### History

- This is the earliest explicit semantic release version found in the retained skill source history. Earlier development is not assigned invented release numbers or dates here.
