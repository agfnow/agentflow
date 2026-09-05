# STATUS

Project: agentflow-on-omarchy

Notebook: .agentflow/devlog.md — root.

Current commit: reviewed implementation 703fe6e; closeout records tracked at HEAD.

Tests/scenarios: harness-boundaries.test.js + round-linter.test.js — 293/293 passed.

Configuration: ag.json — schema v7; validated for codex this round.

Proven: all 30 round checks run through exactly one model-sensitive or model-stable harness; legacy flat order and CLI output remain compatible; targeted external review PASS.

Open: project hook installation remains unavailable because .codex/hooks.json is read-only.

Next: await the next owner request.

Artifacts: .agentflow/A-001-harness-boundaries/ — frozen facts, brief, and accepted cross-check report.

Archived eras: none.

Streams: none.

---

# → Ask / A-001

+ godev
+ 值得去做且合理的話，再把程式裡可能因為 model 進步而改變與幾乎不會因為 model 進步的 harness 分開
+ ok

## [RUN-001] Event — 2026-09-05 15:56 (during round A-001)

- **Route:** direct.
- **Material result:** Agentflow records initialized and bounded intake passed; project hook installation is limited by read-only `.codex/hooks.json`.

## [RUN-002] Event — 2026-09-05 16:03 (during round A-001)

- **Review result:** external-runner-v1 launched codex-default in an independent no-remote clone, but Codex exited 1 before producing a report.
- **Failure:** Codex could not initialize its app-server because required home-directory writes are read-only; clone changes were false and no review conclusion was accepted.

## [RUN-003] Event — 2026-09-05 16:06 (during round A-001)

- **Review result:** the elevated external-runner-v1 retry completed in an independent no-remote clone with a valid worker stamp and direct commit inspection.
- **Gate:** Outcome PASS and Minimality PASS; Conformance BLOCKING because the frozen coordinator facts file was absent from the reviewed commit.
- **Correction:** include the frozen facts and brief in the bootstrap commit, update the exact commit reference, and rerun the targeted review.

## [RUN-004] Event — 2026-09-05 16:09 (during round A-001)

- **Review result:** the final allowed external-runner-v1 attempt completed in an independent no-remote clone, but the frozen dispatch supplied `2b4bd696cde3c56ea036e62f687a9f2fd14ef3d` instead of the actual implementation commit `2b4bd69243513e57f7f8e61c4ac42557757de9c4`.
- **Gate:** the worker inspected the candidate HEAD but returned Outcome, Minimality, Conformance, and Verdict BLOCKING; no PASS report was produced.
- **Recovery:** the cross-check stage reached its fixed three-start ceiling; no further automatic review starts are permitted. The round remains open and no Reply was written.

## [RUN-005] Event — 2026-09-06 00:57 (during round A-001)

- **Route:** direct.
- **Task start:** inspect the current harness boundaries and change history, then separate model-sensitive policy from model-stable mechanics only if a smaller boundary has a concrete maintenance benefit.
- **Scope:** source, focused tests, required Agentflow records, and review evidence only; preserve the existing untracked Agentflow installation and unrelated work.

## [RUN-006] Event — 2026-09-06 01:03 (during round A-001)

- **Design result:** the split is justified by the repository's own distinction between model-dependent record hygiene and model-independent integrity boundaries; all existing checks remain enforced and the legacy flat result order remains compatible.
- **Red proof:** `node --test harness-boundaries.test.js` failed because the two harness modules did not exist.
- **Green proof:** elevated `node --test harness-boundaries.test.js round-linter.test.js` passed all 293 tests; `git diff --check` passed.
- **Scope:** four new harness boundary/test files plus `round-linter.js`, its scripts README, and this required record; pre-existing `.agents/` and `skills-lock.json` remain untouched.

## [RUN-007] Event — 2026-09-06 01:06 (during round A-001)

- **Review preflight:** working directory, focused tests, Codex executable, and ChatGPT authentication passed; targeted reviewer profile resolved to `codex-default` with `gpt-5.6-terra/high`.
- **Review launch:** blocked before process/model start because sending the declared repository diff and test context to the external Codex service needs explicit owner approval; no repository payload was transmitted and the free pre-start failure does not consume a review attempt.
- **Next action:** request explicit approval for the bounded external review, then resume from frozen commit `703fe6e665cb5cbc5ae7efc5ac52f2f20f0a547c` and brief `.agentflow/A-001-harness-boundaries/cross-check-brief.md`.

## [RUN-008] Event — 2026-09-06 01:10 (during round A-001)

- **Owner authorization:** `ok` explicitly authorized the bounded external Codex review after disclosure that repository and test content may be transmitted to OpenAI.
- **Review attempts:** attempt 1 exited 2 before model work because the launcher combined mutually exclusive Codex flags; attempt 2 ran `gpt-5.6-terra/high` in an independent no-remote clone, changed only the declared report, and returned Outcome PASS, Minimality PASS, Conformance PASS, Verdict PASS for implementation `703fe6e665cb5cbc5ae7efc5ac52f2f20f0a547c`.
- **Formal repair:** coordinator added only the trusted dispatch stamp and fixed final `Self-check:` boundary; original body SHA-256 `eaa0721d0752dcd9560e64b9754252e4c4a98ab5b8b9b0c430ab6deb80d1c2ac`, repaired file SHA-256 `513221ee25a6f3518a85ac39ab20115ad323fe266af73f2ea70fb0faef91ef20`, and all body bytes remained unchanged.
- **Host gate:** PASS after independent report inspection, exact commit comparison, declared-write verification, boundary verification, and coordinator 293/293 suite evidence.

# ← Reply / A-001

* _2026-09-06 01:10:50 (GPT-5/Codex)_

## [SUMMARY]

- Succeeded: separated the runtime round linter into model-sensitive and model-stable harness groups because the repository's own evidence distinguishes model-dependent record hygiene from model-independent integrity controls.
- Preserved behavior: all 30 checks still run, the legacy flat check order and CLI output are unchanged, and grouped results are additive.
- Proven: the complete relevant suite passed 293/293; the independent targeted reviewer returned Outcome, Minimality, Conformance, and overall Verdict PASS.

## [FINAL REPORT]

### Request: decide whether the split is worthwhile and implement it if so

Succeeded. The public checkout intentionally omits the private `eval/` evaluation harness, so the maintainable boundary available here is the shipped runtime harness in `round-linter.js`. The split is worthwhile because `AG_GUIDE.md` identifies record hygiene as the behavior that varies with model strength, while evidence, authority, safety, filesystem, Git, artifact, and configuration controls remain necessary regardless of model improvement.

`model-sensitive-harness.js` now owns ten record-writing compatibility checks: terminal output, Reply and round shape, Ask scaffolding, tracker/checkpoint conventions, reporting/progress, and STATUS projection. `model-stable-harness.js` owns the other twenty integrity checks. `harness-group.js` rejects missing implementations or mismatched identities, and `round-linter.js` rejects any incomplete or duplicate partition before returning results.

No check was removed, relaxed, or skipped. `lint_round()` still returns `checks` in the exact previous order for compatibility and additionally returns `harnesses.model_sensitive` and `harnesses.model_stable` for explicit maintenance ownership.

Tests: the red test first failed because the two harness modules did not exist. After implementation, `node --test harness-boundaries.test.js round-linter.test.js` passed 293/293, and `git diff --check` passed.

Independent review: the configured `gpt-5.6-terra/high` reviewer inspected implementation commit `703fe6e665cb5cbc5ae7efc5ac52f2f20f0a547c` in an independent clone with no remotes and changed only its declared report. Its substantive result was Outcome PASS, Minimality PASS, Conformance PASS, Verdict PASS. The coordinator added only the trusted opening identity stamp and fixed final `Self-check:` boundary; SHA-256 verification proved every body byte stayed unchanged. Host gate: PASS.

Cross-check review: .agentflow/A-001-harness-boundaries/cross-check-report.md
Cross-check implementation: 703fe6e665cb5cbc5ae7efc5ac52f2f20f0a547c

The pre-existing untracked `.agents/` installation copy and `skills-lock.json` were preserved and not included. The earlier bootstrap limitation also remains: `.codex/hooks.json` is read-only, so project hook installation was not completed in this checkout.

## Questions (batched — each with a suggested default)

- None.

---

# → Ask / A-002

+
