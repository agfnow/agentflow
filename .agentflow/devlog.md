# STATUS

Project: agentflow-on-omarchy

Notebook: .agentflow/devlog.md — root.

Current commit: initialization pending.

Tests/scenarios: none.

Configuration: ag.json — schema v7; validated for codex this round.

Proven: the host template was initialized.

Open: none.

Next: await the first request.

Artifacts: none.

Archived eras: none.

Streams: none.

---

# → Ask / A-001

+ godev
+ 值得去做且合理的話，再把程式裡可能因為 model 進步而改變與幾乎不會因為 model 進步的 harness 分開

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
