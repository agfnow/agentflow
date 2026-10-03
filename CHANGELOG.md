# Changelog

Notable Agentflow changes, with the newest version first. Release metadata uses major.minor.patch; the current release is 8.4.10. Earlier dates identify recorded source milestones, not independently verified public publication dates.

## [8.4.10]

- Raise automatic notebook archiving from 500 to 750 lines. Keep the 768 KiB threshold, exact-byte verification, active-round protection and pending inline-answer protection.

- Add on-demand guidance for large mixed requests: track each requested outcome, preserve authorization and dependencies, and carry unfinished work forward without claiming that continuation has started.

- Start each numbered devlog final-report item with a verbatim quotation of the original request or question, limited to its first 30 words; quote shorter requests in full and place any omission marker outside the quotation.

- Clarify line-start examples for the existing skip-ag control; normal review, delegation and stream requirements remain in effect.

## [8.4.9]

- Generate Codex, Claude, and Git guard hook commands using the installed Agentflow skill directory rather than the development checkout. Migrate recognized old commands while preserving unrelated hooks and settings; keep worktree cleanup compatible with separately installed copies.

- Installed paths retain their symlink spelling. If an installation is a symlink to a development checkout, moving that checkout still requires updating the symlink target. Existing project hooks are migrated when the updated installer runs.

- Trigger automatic notebook archiving at 500 lines instead of more than 1,000 lines. The 768 KiB threshold, exact-byte verification, and protection of the current round and pending inline answers remain unchanged.

## [8.4.8]

- Fix issue [22](https://github.com/agfnow/agentflow/issues/22): startup and initialization preserve existing directory-specific ignore rules, including project skill exceptions. Missing defaults are added before the original text without removing comments, blank lines, line endings, or a missing final newline. Repeated runs make no further changes.

- Existing conflicting broad ignore rules from earlier versions are preserved, not automatically repaired. Inspect and adjust such a rule if project skills are already hidden. Native Windows looper support remains unavailable.

## [8.4.7]

- At startup, add missing properties from the current settings template and report invalid saved values with suggested replacements. Safe invalid values use template defaults in memory while work continues; unsafe settings still stop startup. Wrong saved values are never changed without owner permission.

- Include `away-gates` in new project templates and alphabetize switch keys for easier lookup.

- Keep a verified completed round valid in the Stop hook when working files change later. The hook checks the close receipt, commit, and saved Reply before accepting that round.

## [8.4.6]

- Make the devlog `[SUMMARY]` contain one concise bullet for each numbered `[FINAL REPORT]` item, in the same order. This clarifies the answer format; runtime behavior is unchanged.

## [8.4.5]

- Add persistent `away-gates: on|off`, defaulting to off when absent. When on, Agentflow can supply Design Go and Result Go after their evidence passes; owner-only choices, Stop decisions, and failed checks still require the owner. Existing project settings are unchanged unless explicitly set.

- Add the updated assistant brief to the public skill at `skills/agentflow/docs/agent-brief.md` and link it from both public READMEs. The release procedure now requires refreshing the brief and checking its exact published bytes.

- Document the current `auto-reply` and completion-cleanup boundaries in the brief. Their runtime behavior is unchanged.

## [8.4.4]

- Clarify that the saved devlog Reply should retain requested answers without repeating content already saved in a report. Keep report links, essential results, evidence, limits and next actions in the Reply.

## [8.4.3]

### Added

- Add `skip-ag` to skip the development pipeline for the current request while retaining the devlog, normal execution, review and closeout. Update both guides and related command references.

### Fixed

- Resolve Claude Reply model and effort from the matching main-session transcript.

- Preserve older completed Reply bytes during retries and remove extra spacing from new inline replies.

- Stabilize the evaluation fixture by copying its skill inputs before fingerprinting, and keep private documentation checks out of the shipped test package.

### Documentation and verification

- Move `CHANGELOG.md` to the root of both the development and public repositories, and update publishing instructions and README links.

- Refine writing guidance to use short, clear bullets with enough explanation for readers without a technical background.

- Bring both user guides and related current documentation up to date. The release procedure now defaults to increasing only the patch number; larger increases require explicit owner instruction.

- Verify that Claude initialization in a Codex-first project installs Claude hooks while preserving Codex hooks. Retain the verified Claude/Codex terminal journeys and corrected affected tests from the preceding implementation work. Native Windows and case-sensitive-filesystem checks remain unavailable on the validation Mac; no universal host-parity claim is made.

## [8.4.2]

### Changed

- Update the Codex worker defaults in both host templates: `best` uses `gpt-6-astra/medium`, `better` uses `gpt-6.1-sol/high`, `basic` uses `gpt-6.1-sol/low`, and `cheap` uses `gpt-6-luna/high`. Existing project profiles remain unchanged.

- Require sub-lists for details in the concise writing guidance, while retaining its clarity, evidence and document-format rules.

### Verification

- Align existing settings assertions with the owner-selected defaults. Separate review was explicitly waived for this release; retain host inspection, relevant settings/routing checks and release verification.

## [8.4.1]

### Documentation

- Update the recommended Codex coordinator to `gpt-6.1-sol/medium` in the project README and both public README languages, including the model name, reasoning effort and official reference link. This does not change user settings.

- Add a release reminder to compare both rendered READMEs with their templates and check model recommendations, links, versions and installation/update commands before publication.

## [8.4.0]

### Added

- Make notebook ownership optional with `notebook-ownership: on|off`, default off in new templates and when absent. On retains session protection; off preserves owner records and file safety but permits sessions to mix work. Enable it for shared notebooks; a noticeable startup speed improvement has not been proven.

### Fixed

- Recognize the supported review-only activation, reviewer selection and exact takeover continuations. Completed reviews retain truthful BLOCKING or UNRESOLVED findings while source, delivered-scope, report-integrity and independence checks remain enforced. Quoted, unknown and mixed implementation instructions remain rejected.

- Refuse notebook rename publication when source or destination settings change during the operation, preserving the changed policy instead of overwriting it.

### Documentation and verification

- Update current settings, user guides, script reference, release pages and feature lessons for both changes. Configuration schema remains version 8; explicit project settings are preserved.

- Reuse the accepted implementation's focused tests, real terminal journeys and independent defensive/acceptance review. Native Windows execution of these new changes and a noticeable startup speed gain remain unproven. The prior release's two pre-existing skill-size/wording assertions remain unresolved; no entirely passing full-suite claim is made.

## [8.3.4]

### Fixed

- Preserve equivalent installed hook commands without rewriting user settings or creating unnecessary backups (#14).

- Run portable contributor tests on native Windows. Repair locale detection, physical path and notebook filename handling, provider executable recognition, shell-path matching, and CRLF release metadata validation. Keep exact published bytes and existing ownership protections (#15).

- Allow historical RUN and WIP timestamps in long-running rounds while retaining fresh Reply, valid-date and future-date checks (#19).

- Complete strictly scoped review-only work with truthful blocking findings. Preserve report integrity and source checks, reject unused dispatch evidence, and accept equivalent plain report stamps as a presentation variation (#20).

### Changed

- Include the owner's earlier review improvements: inspect the current decision with `agf review`, honor explicit self-review waivers while retaining host checks, and accept sound review records with equivalent source and verdict fields.

- Clarify goal-based requirements, scope authorization and acceptance guidance, and preserve `inline-reply` behavior for `show-diff`.

- Add optional `pipeline-roles.threeways` selection. Existing configurations keep `better`; `off` and unavailable requested capacity are rejected without silently lowering the tier (#18).

- Update the Claude basic-tier templates to `claude-sonnet-5-5/high`, alongside Claude Opus 5.5 and the owner-selected GPT-6 template choices. Existing project profiles retain their explicit choices.

- Clarify that regression tests are for contributors, not an installation requirement. Unix-only terminal and process tests skip on Windows; native Windows looper operation remains unsupported.

### Verification limits

- Native Windows checks verified the portability fixes. Stale model-default expectations were updated for the selected templates. Two pre-existing skill-size/wording assertions remain unresolved; this release does not claim an entirely passing regression suite or live provider verification.

## [8.3.3]

### Fixed

- Recognize Claude Code's `CLAUDE_CODE_SESSION_ID` for notebook ownership, host detection, reply identity and worker environment filtering, while retaining legacy compatibility and rejecting conflicting session IDs.

- Keep stream notebook paths in forward-slash form on Windows so startup and hooks can pass the canonical-path ownership check.

### Changed

- Release corrections must inspect the fetched public version and files before editing, preventing stale private checkouts from replacing newer published content.

## [8.3.2]

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
