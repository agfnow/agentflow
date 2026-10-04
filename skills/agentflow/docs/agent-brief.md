# Agentflow: brief for a new assistant

Agentflow is a project workflow for an AI assistant. Its main record is a Markdown notebook, normally `.agentflow/devlog.md`, with the owner's Ask, progress, decisions, and a complete Reply. Read the installed `skills/agentflow/SKILL.md` and the current notebook before acting: this brief is orientation, not an authority that replaces live rules, settings, or owner instructions. Check the adjacent `ag.json` for this project; defaults and permissions vary by repository.

## First five minutes

1. Read the complete installed Agentflow skill at the path provided by the host. Do not guess its installation path. Read the repository's `AGENTS.md` or other host instructions when applicable.

2. Run the skill's single `agf start` command with the exact owner message on standard input. Use the returned notebook path, Ask number, configuration, Git state, and stream decision. Codex and Claude can install project capture and stop hooks; other hosts need a stable explicit host and session ID and manual capture.

3. Read the live notebook to its end. Carry forward any unanswered question that the owner later answered inline. A bare `godev` with an empty Ask only activates the workflow; an existing Ask resumes it.

4. Record each later owner message in the current Ask before acting unless the input hook already captured it. Keep historical completed rounds unchanged. Save material progress in RUN entries, and a WIP checkpoint after ten active minutes when logging permits it.

5. Before closing, verify the requested outcome, inspect every changed path, run the relevant checks and required review, save the full Reply, and use `agf close`. With `inline-reply: off`, the final chat message is only the exact path receipt returned by close; the answer is in the notebook.

## What the records mean

- **Ask and Reply:** One numbered round holds the owner's messages and the complete answer. In the Reply, `[SUMMARY]` gives one concise bullet per numbered `[FINAL REPORT]` item, in the same order. A follow-up normally extends the open Ask; a clear cancellation stops the named work. Empty `- ans:` fields and suggested defaults are not approval. A new assistant must inspect later answers before repeating questions. Each numbered final-report item starts with a verbatim quotation of the first 30 words of its original request or question, or the full text when shorter, with an ellipsis outside the quotation when words are omitted.

- **STATUS:** A short current projection, not the source of configuration or permission. `ag.json` controls settings. RUN entries record material events; WIP records recovery state. A tracker under `.agentflow/artifacts/A-NNN-name/` tracks split work; designs, reports, and verification live nearby. The `.agentflow/.tmp/` records hold local completion evidence.

- **History and streams:** Completed rounds are append-only. At 750 lines or 768 KiB, startup and prompt capture automatically archive eligible completed rounds. Agentflow can verify and move old complete rounds to an adjacent archive while preserving the active round and unanswered inline decisions. Startup and prompt capture report the round that blocks archiving. Recover its answers and requests and verify complete saved answers before using `compact --include-answered true`; unresolved history stays live. A feature stream has its own branch, worktree, notebook, and ownership; only its active session writes that notebook. Plain folders can use Agentflow without Git, but feature branches and Git delivery require Git.

- **Possible intentions:** Keep possible tasks from discussion in the existing tracker, with the original wording, desired outcome, next action and pending decision. Discuss first when requested, then ask a specific saved Reply question with a suggested default and empty `ans:`. A pending item grants no implementation permission; preserve existing authorization and record rejection or deferral.

## Choose the right route

- **Direct:** Clear, reversible work uses the main assistant or a bounded worker. Necessary tests, notebook records, host inspection, and ordinary review still apply.

- **Selected advisors:** Use only advisors needed for a named material uncertainty. Available advisor roles include requirements, codewalk, explore, spike, spec, security-scan, acceptance, and learn. `advisors: requirements, spec` requests a subset; it does not silently cancel the rest of an authorized task.

- **Full pipeline:** `ag`, `agentflow`, and `all-in` request the development process when `allow-ag` permits it. Requirements, specification, implementation, and acceptance are mandatory; existing projects also need discovery. Optional codewalk, exploration, spike, security, and learning stages run when triggered; `all-in` requests all optional stages. `make-plans` freezes a queue and stops before implementation. `run-plans` or `run-looper` runs an existing queue according to its own reference.

- **Blocked:** Stop dependent work for a real unresolved owner choice, missing capability, failed gate, or explicit stop. Continue independent authorized work. Do not mistake an assistant's proposed option for the owner's approval.

The host chooses among permitted `external`, `internal`, and `host` executors from `allowed-worker`. An external worker runs in a disposable no-remote clone; an internal worker uses an actual native host tool; host work stays in this session. The coordinator owns scope, acceptance, and delivery. Worker text or process exit alone is not proof. `review-policy` controls whether a recorded host fallback is allowed after independent review is unavailable; it does not grant an executor permission.

## Controls the owner may say

- `godev` or `devlog`: activate or resume notebook work. `continue` or `next`: reread and resume the open Ask.

- `no-ag`, alone or followed by a task separated by whitespace, a colon or a comma: skip the entire host Agentflow protocol for that message, including notebook capture and closeout. Quoted mentions, code examples and conditional statements do not activate it; the next ordinary message resumes the workflow. `skip-ag [task]`: skip only the pipeline and advisors for this Ask; keep notebook, checks, ordinary review, delegation, and delivery. Bare `skip-ag` waits for a task. `fast-lane [task]`: host-only execution with pipeline, delegation, and separate review waived; still test and inspect. These controls are different from persistent `allow-ag: off`.

- `3ways` or `threeways`: one independent pre-implementation critique, without approval to implement. `cross-check`: request review of the final result. `stronger`: raise review depth. `skip-review` or a clear instruction to review it yourself waives separate final review for this Ask, while retaining host review and tests. `no delegation` keeps execution with the host; it does not waive review.

- `review-only` with a named target asks for a review without product changes. A finished review may report BLOCKING or UNRESOLVED findings; recording that review as complete does not accept the product. Use the exact bounded control syntax in the current guide when requesting a reviewer or takeover.

- `show-diff`: request reasoned exact diff hunks in the answer; it does not authorize edits. `keep-going`: temporarily accept safe routine defaults, then reset. `auto-reply: on` is the persistent safe-routine setting. Neither supplies an owner-only choice.

- `Design Go: <7-hex-commit-prefix>` approves a particular committed plan for consequential implementation; `Result Go: <implementation commit>` approves its checked result. The current-Ask line `away: gates` permits Agentflow to supply those two gates after evidence passes. A validated `away-gates: on` setting grants the same narrow authority by default in that repository. Neither accepts a failed check, settles an open owner-only choice, enlarges scope, or authorizes unrelated irreversible actions.

- `new-feature: <name>` opens an isolated feature stream and requires Git. `merge-back` delivers that stream to the default branch. `cleanup:<taskkey>` removes a completed stream using guarded recovery. Read `references/streams.md` before any of these operations.

- `settings` shows the active configuration and change syntax. `lang: zh-tw`, `inline-reply: on`, and other `key: value` lines request validated settings changes. `agf skills audit` is a read-only conflict audit. `run-looper` invokes the sequential plan runner; its workers cannot launch more workers.

## Terminal commands versus chat controls

The controls above are messages to the assistant. The assistant uses the Node commands below to carry them out; an `agf` command name alone does not grant a new task or waive a gate.

- `agf start` initializes or resumes the project and installs hooks for the active Codex or Claude host. `agf setup` reports installation health; `agf setup --fix` repairs recognized shell shortcuts with backups. Project hooks are host-specific: run `godev` in Claude after Codex initialization if Claude hooks are needed. Hook commands prefer an existing global host installation, then use the running installation when neither global host script exists, and the installer migrates recognized old commands while preserving unrelated settings. A symlink installation still needs its target updated if the checkout moves.

- `agf settings show`, `validate`, and `change --set 'key: value'` inspect, check, and atomically update the applicable `ag.json`. A managed `target-doc` rename uses the settings rename command, not a manual file move.

- `agf review` reports whether final review is required from the actual change and policy; a reviewer still must do the review. `agf close --manifest-stdin` checks and saves a complete round and performs authorized local or push delivery. The installed skill defines the exact manifest and host/session flags; never infer success from a draft Reply.

- `agf compact --notebook <path>` performs verified byte-preserving history compaction. `agf owner inspect` and `agf owner adopt` handle uncertain or transferred ownership when `notebook-ownership: on`; a stale session alone never authorizes takeover.

- `agf-looper` executes a prepared plan queue sequentially. `--tasks-dir` selects a queue, and `--reset` retires a reviewed stale stop state without starting plans. Inspect stopped processes and the looper reference before reset.

## Gates and proof

- Infer the owner's desired outcome, intended user, observable success, and limits before choosing a method. A question about how something works authorizes investigation, not a code change. Keep the smallest change that meets the request and preserve unrelated edits.

- For behavior changes, prove the missing behavior with a failing test, implement the smallest fix, then run the smallest complete relevant checks. For documentation, inspect the saved artifact and verify factual claims. User-facing terminal controls require a real terminal journey. Do not call an intermediate failed run green; keep its correction and final result distinct.

- Consequential work records a plan, normal journey, invariant and acceptance checks, exact commits, a Minimality check, and the required gates. Source work waits for the plan's Design Go. After implementation and acceptance, a reviewer checks Outcome, Minimality, and Conformance on the exact source; the host inspects that report. Result Go applies to the checked implementation. Current-Ask `away: gates` or configured `away-gates: on` can supply those two approvals only after the required evidence passes.

- Review eligibility comes from changed files, explicit controls, policy, and the host's documented effect classifications. `agf review` is a deterministic checker; it does not ask a model to classify arbitrary task words or perform the review. A separate reviewer actually examines the source when required. Routine informational writing may need host inspection only; behavior, tests, configuration, and operating instructions normally need separate review unless the owner waives it.

- In Git projects, commit meaningful units and push when a remote exists and delivery is authorized. Fetch and inspect incoming commits before the first push; never force-push or absorb another session's work. In a plain folder, local closeout still saves and validates the Reply. Do not claim tests, review, commits, pushes, host isolation, or model identity without direct evidence.

## Settings and where to verify detail

`ag.json` has `schema-version`, `switches`, `pipeline-roles`, and `external-workers`. Common switches include `target-doc`, `workspace-dir`, `lang`, `auto-reply`, optional `away-gates` (default `off`), `allow-ag`, `streams`, `ask-names`, `allowed-worker`, `review-policy`, `cli-provider`, `inline-reply`, `log-verbosity`, `notebook-ownership`, `large-work-minutes`, Git timeout, and completion cleanup. `auto-reply: on` fills only safe routine defaults in open decisions; it does not approve owner-only choices. `completion-cleanup: on` enables a stop-hook sweep of completed inactive local completion records at the configured interval (seven days by default); records qualify only after 30 days, and the sweep moves them to Trash while keeping active or still-needed evidence. Model tiers (`best`, `better`, `basic`, `cheap`) are local profile labels, not universal rankings. Never rebuild a missing setting from STATUS or assume the current repository has template defaults.

At startup, Agentflow adds missing settings properties from the current template and reports invalid saved values with suggestions. Safe display and timing values can use template defaults in memory; invalid path, ownership, permission, execution, and cleanup settings still stop startup. The assistant asks before changing any wrong saved value. After a verified close, the Stop hook checks the close receipt, commit, and saved Reply, so later working-file edits do not invalidate that completed round.

Startup and initialization preserve existing directory-specific ignore rules and project skill exceptions. Missing defaults precede the original ignore-file text, which keeps its comments, blank lines, and line endings. A conflicting broad rule left by an older version is preserved and needs separate inspection and adjustment; this release does not automatically repair it. Native Windows looper support remains unavailable.

For exact behavior, read the installed `SKILL.md` and only the references it triggers: `writing.md`, `progress.md`, `closeout.md`, `ag.md`, `delegation.md`, `streams.md`, `skip-ag.md`, `fast-lane.md`, or `looper.md`. The user guides explain normal use; `scripts/README.md` documents commands and tests. Recheck those sources when the installed version changes. This brief describes v8.4.14 source behavior, not a promise that every possible host/version has been tested.
