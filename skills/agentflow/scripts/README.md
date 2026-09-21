# Agentflow scripts

These zero-dependency Node scripts provide the host-side checks and mechanical
helpers for Agentflow. They are not model instructions: the host runs the
Stop-hook referee after a turn, and the coordinator invokes the other helpers
with explicit paths and literal data.

The referee is intentionally limited. It runs only where a hook is installed,
grades the applicable notebook and host-owned facts, asks for at most one
correcting turn, and fails open on its own internal errors. A passing verdict is
not a general guarantee that code or a model claim is honest.

## Active scripts

- **`round-linter.js`** — host-neutral, no-AI validation of a completed round. Its `cross_check` gate refuses a completed implementation unless the named current-Ask report is a bounded regular file with standard worker boundaries, exactly one PASS each for Outcome, Minimality, and Conformance plus one overall PASS verdict, and the same final implementation commit recorded by the round. Matching pipeline acceptance may supply that report. Exact current-Ask `skip-review: <accepted tradeoff>` skips this review only. A valid report stamp with a different model or effort produces a warning. The gate does not request a model review for first-time Agentflow bookkeeping when Git proves that the repository has no product files and only Agentflow records, the bootstrap `ag.json`, and `.gitignore` were created.

- **Review evidence:** `completion-record.js` validates one version-1 `Review record:` JSON line for `external-review`, `native-review`, or `host-review`, including exact source identity, report, Outcome/Minimality/Conformance verdicts, independence facts, limitations, and transport facts. The line is mutually exclusive with legacy Cross-check and Host review lines. `completion-context.js` supplies effective `allowed-worker` and `review-policy`; host fallback is accepted only after separate-review unavailability is recorded.

- **`terminal-preflight.js`** — coordinator-run recovery wrapper around the complete round linter. The Reply writer and `agf close` run the same candidate checks before notebook replacement. Use this wrapper only when a manual or recovery path does not use `agf close`; do not repeat it after a successful one-command closeout.

- **`cross-check-plan.js`** — deterministic proportional-review selector. Give it a JSON facts file with changed paths, changed-line count, behavior, trust-boundary, breadth, and optional owner control; it returns `narrow`, `targeted`, `full`, or a valid explicit `skip` result and the exact reviewer obligations.
  It preserves ordered `{checks, ok}` results. Only `fail` blocks; `pass`,
  `warn`, and `skip` do not. Factual gates such as timestamps, push claims,
  invented Ask ids, material pipeline evidence, configuration, and status
  projection can fail. The parser grades Ask headings in physical order, and
  malformed current-checkpoint `Still to do:` presentation is a warning when
  the underlying completion evidence is present.

- **`stop-hook.js`** — the independent final host check. It reads the real clock and repository push state, supplies transcript terminal output when a devlog was edited, and exits `2` only when a completed round fails the linter. An unfinished round produces repair warnings without blocking the active turn. A failure keeps the current round open for repair; it does not ask the host to create a new owner-looking Ask. `stop_hook_active` exits `0` so one correction cannot trap a session in a loop. A valid `AGENTFLOW_EXTERNAL_DELEGATE` marker bypasses owner-round checks; the launcher remains responsible for provenance and isolation.

- **`ag-settings.js`** — the shared settings module and CLI. It resolves the
  adjacent configuration, rejects duplicate or malformed JSON, validates the
  schema, writes atomically, displays settings, applies changes, projects the
  fixed STATUS health line with one adjacent archive pointer, and resolves
  worker tiers. Configuration values are data and are never evaluated as shell
  text.

  The current configuration is Version 8. Existing Version 7 files migrate atomically when opened, using the conservative JSON value `["external", "host"]` and `require-independent` posture until explicitly opted in.

  The public root keys are exactly `schema-version`, `switches`, `pipeline-roles`, and `external-workers`. The required public switch keys are `target-doc`, `workspace-dir`, `allowed-worker`, `review-policy`, `cli-provider`, `auto-reply`, `lang`, `streams`, `ask-names`, `allow-ag`, and `large-work-minutes`; optional controls are `git-timeout-ms`, `log-verbosity`, `inline-reply`, `completion-cleanup`, and `completion-cleanup-interval-days`.

  `git-timeout-ms` accepts a positive integer in milliseconds and defaults to `30000`. A valid positive-integer `AGF_GIT_TIMEOUT_MS` value overrides the project setting; otherwise Agentflow uses the project value and then the default. `log-verbosity` accepts `off`, `wip`, or `all` and defaults to `all`; `inline-reply` accepts `on` or `off` and defaults to `off`; `completion-cleanup` accepts `on` or `off` and defaults to `off`; and `completion-cleanup-interval-days` accepts an integer from 1 through 365 and defaults to `7`.

  `allowed-worker` is a nonempty unordered JSON permission array containing unique `external`, `internal`, and `host` values; its order has no execution meaning. `review-policy` is `prefer-independent` or `require-independent`. `cli-provider` filters only external profiles; unknown host family never matches `off`.

  Each worker profile has `id`, `command`, `priority`, and `tiers`, with an
  optional `family`. Tiers always include `best`, `better`, `basic`, and
  `cheap`; custom tier names use lowercase ASCII letters, digits, and hyphens.
  Pipeline roles use the ten canonical task names and select a tier or
  `off`. Unknown keys are diagnosed as nonblocking warnings and ignored by
  canonical output; unknown keys never satisfy a missing recognized key.

  ```text
  agf init
  agf settings validate
  agf settings show
  agf settings change --set 'auto-reply: off'
  agf settings rename --from devlog.md --to features/ag/ag.devlog.md
  ```

- **`resume-intake.js`** — one bounded local command for the first `godev` response. It validates adjacent configuration, returns STATUS, the final unresolved Ask, branch, and changed paths, and returns a `stream_decision` with one of `none`, `owner_input_only`, `bootstrap_files_only`, or `foreign_or_parallel_work`. It never fetches, reads the archive, or installs hooks; opening a valid v7 configuration performs its atomic v8 migration.

- **`delegation-route.js`** — the transport-neutral policy boundary. `select_executor_action(facts)` returns one external-runner, native-tool, host-direct, or unsatisfied action; `next_executor_action(facts, settled_attempt)` advances only after a settled `unavailable` attempt; `validate_execution_record(record, context)` validates common external, internal, and host attempt evidence while retaining legacy external records.

- **`external-runner.js`** — executes one literal command in an independent
  no-remote Git clone and returns bounded output, result-file facts, clone
  changes, and transport facts. Its pre-start Codex check keeps the declared
  result path worker-owned. Exit status is evidence, not acceptance.

- **`queue-contract.js`** — validates and publishes the planning-only frozen
  queue. It checks exact plan bytes, the digest-bound
  `.queue-generation.json`, dependencies, conflicts, private staging, the
  completion contract, and triggered codewalk shared-coverage evidence.
  Publication keeps only the queue contract; it does not start implementation
  or create a second in-repository execution state.

- **`looper.js`** — runs owner-written `plan-NNN.md` files sequentially in the current checkout. The installed `agf-looper` shortcut has built-in help, prints the working and plan directories, shows `current/total` progress and every plan state, streams child output, and gives a path-specific recovery checklist on failure. `agf-looper --reset` retires reviewed stale control records and exits without starting a plan; run plain `agf-looper` separately when ready to resume. It still requires exact notebook completion evidence, archives only verified plans in `done/`, and stops conservatively on uncertain ownership, recovery, file identity, child output, or interruption state.

- **`looper-live-gate.js`** — creates a disposable Git repository, installs and invokes the real shell shortcut, and runs two low-cost provider plans. It is the mandatory final gate for every change that can alter looper behavior. Success requires a zero process exit, both exact product files, two completed notebook rounds, and both plans archived in `planned/done/`.

- **`agf.js`** — the unified owner-facing command. It provides `start`, initialization, setup, hook management, settings, feature-stream work, and safe removal with focused subcommand help. `start --repo <path> --host <safe-id> [--host-family <known-family>] --message-stdin --json` resolves or initializes the project, records one exact owner message only in an empty Ask, runs intake, and returns structured startup facts without committing. Generic hosts report `hooks: not_available` with manual capture and closeout instructions; Codex and Claude keep their integrations. `agf-looper` intentionally remains standalone. Internal validation and writing scripts are not public command families. Stream actions do not write the root notebook or replace a protocol round with an unrecorded direct Git sequence.

- **`notebook-write.js`** — the bounded notebook writer. Keep `append-run`, `append-wip`, and `append-reply` for long-running work. Use `close-round --notebook <path> --input-stdin` with one JSON object containing `ask`, ordered `run_events`, complete `reply`, and `status` or `status_fields` when the whole round is ready; it validates the candidate and replaces the notebook once.

- **`devlog-guard.js`** — a fail-open pre-commit guard installed by
  `agf hooks --project`. It protects the root notebook and configuration
  from being staged on a feature branch.

- **`install-hook.js`** — installs or removes the Claude Code and Codex Stop and UserPromptSubmit hooks and the project pre-commit guard. It preserves backups and avoids duplicates; generic hosts do not receive another host's hooks. Restart a known host after installation so it loads the input hook. Hookless hosts use the documented manual capture and closeout calls. Input capture errors are reported in the hook handoff and do not block submission; the Stop referee still fails open on its own internal errors.

- **`codex-live-journey.js`** — an opt-in, model-backed interactive terminal check. `node scripts/codex-live-journey.js --run [model]` creates a disposable repository, tests activation and a correction sent during work, and checks the resulting file, notebook, commit, and clean checkout. It retains the terminal transcript and result beside the test repository. It requires Codex login and macOS Expect, and uses paid model calls; it does not run with the normal unit tests.

- **`setup.js`** — checks Node, Git, the skill files, the user's `agf()` and `agf-looper()` shell functions, and `AGF_OPEN`; `--fix` prefers usable `$HOME/.agents/...`, `$HOME/.codex/...`, and `$HOME/.claude/...` installations in that order, then falls back to the verified active skill directory for a plugin-only installation without guessing cache paths. It accepts an existing managed shortcut to any usable matching installation despite indentation differences and replaces only a recognised stale Agentflow shortcut.

- **`suite-evidence.js`** — records bounded evidence for a declared test suite.

## Hosts and manual use

Claude Code and Codex use the same Stop-hook contract: JSON on stdin with a
working directory, `stop_hook_active`, and optional transcript path; exit `2`
blocks the turn. The installed command carries its owning host explicitly.
Other clients can call the same Node entry points when they can provide the documented facts. A generic host supplies a safe ID, optional known family, file/command tools, and enough state retention for capture and closeout; its hook status is `not_available`, and it must run manual capture with `--host <safe-id>` and `agf close` under the skill instructions. An unknown or conflicting automatic identity is never guessed as Codex or Claude.

The canonical host startup command is the direct Node entry point below. The
active host supplies the complete `<active-agentflow-skill-dir>` value; do not
probe a shell function or guess a `~/.claude` or `~/.codex` path. Send the
owner's exact message through standard input:

```text
node <active-agentflow-skill-dir>/scripts/agf.js start --repo <repo> --host <safe-id> [--host-family <known-family>] --message-stdin --json
```

The JSON result includes `repository`, `notebook`, `active_host`, `git`,
`next_run_id`, `setup`, `message`, `current_ask_identifier`, `changed_paths`,
and `stream_decision`. First setup separates tracked project records from
ignored machine-local host settings.
The stream reason is `none`, `owner_input_only`, `bootstrap_files_only`, or
`foreign_or_parallel_work`; only the last reason (or an explicit required
rulebook) needs the stream rules.

When a complete round is ready, send one bounded JSON manifest to the one-command closeout:

```text
node <active-agentflow-skill-dir>/scripts/agf.js close --manifest-stdin
```

The manifest contains `version`, `notebook`, `ask`, ordered `run_events`,
`reply`, `status`, `allowed_paths`, `commit_message`, and `delivery`. Local
delivery is the default and performs one shared validation, one guarded
notebook replacement, and one scoped commit. The commit includes one
`Agentflow-Close-Id` trailer so a retry reports the existing notebook and
commit instead of adding a duplicate.

`run_events` contains only new events to append. For an immediate close, put
`RUN-001` there instead of calling `append-run` first. If every RUN is already
in the notebook, close with `"run_events": []`. Use `agf close --help` for the
public syntax; `notebook-write.js` is an internal writer.

Push delivery requires both `delivery.mode: "push"` and the separate
`--push-authorized` flag. The command fetches the named remote, checks the
named branch, uses an ordinary non-force push, and verifies the resulting
remote SHA. Failed or timed-out network work is reported as failed or
unknown; it is never reported as successful without verification.

The older `notebook-write.js close-round` command remains supported for
recovery and compatibility. It still validates and replaces the notebook but
does not own Git delivery.

For a manual or recovery closeout that does not use `agf close`, run the terminal preflight with a bounded JSON object on standard input so no permanent facts file is needed:

```text
node terminal-preflight.js <devlog-path> --context-stdin
```

The compatible direct linter form still accepts a bounded context file:

```text
node round-linter.js <devlog-path> --context <facts.json>
```

The context may provide `terminal_output`, `now_ms`, `push`, `owner_ask_ids`,
`pipeline`, `project_root`, `notebook_path`, `config_path`, `active_host`,
`executables`, and `expected_settings`. Missing live facts are `skip`, not a
false pass. Supplied manual fact groups are strict: booleans, non-negative
numbers, integers, strings, and arrays must retain their declared JSON types.

## Tests

Run from `skills/agentflow/scripts`:

```text
node --test *.test.js
```
