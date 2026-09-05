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

- **`model-sensitive-harness.js` / `model-stable-harness.js`** — partition every
  `round-linter` check exactly once without changing the legacy flat result order.
  Model-sensitive checks cover record-writing compatibility such as Reply,
  checkpoint, tracker, and terminal-output conventions. Model-stable checks
  cover evidence, authority, safety, filesystem, Git, artifact, and
  configuration boundaries. Both groups remain mandatory; the split identifies
  which maintenance decisions may respond to improved model instruction
  following and prevents those decisions from weakening stable integrity gates.
  `harness-group.js` enforces each group's declared check identity at runtime.

- **`terminal-preflight.js`** — coordinator-run wrapper around the complete round linter. The Reply writer runs the same candidate check under its existing lock before notebook replacement and optional draft consumption. `notebook-write.js --input-stdin` accepts the complete WIP or Reply without creating a named draft file; the existing `--input <draft>` route remains compatible and consumes the unchanged draft after success. Run this wrapper before the terminal record commit; it prints every check and blocks terminal completion unless all required facts pass. The Stop hook independently checks the completed round again.

- **`cross-check-plan.js`** — deterministic proportional-review selector. Give it a JSON facts file with changed paths, changed-line count, behavior, trust-boundary, breadth, and optional owner control; it returns `narrow`, `targeted`, `full`, or a valid explicit `skip` result and the exact reviewer obligations.
  It preserves ordered `{checks, ok}` results. Only `fail` blocks; `pass`,
  `warn`, and `skip` do not. Factual gates such as timestamps, push claims,
  invented Ask ids, material pipeline evidence, configuration, and status
  projection can fail. The parser grades Ask headings in physical order, and
  malformed current-checkpoint `Still to do:` presentation is a warning when
  the underlying completion evidence is present.

- **`stop-hook.js`** — the independent final host check. It reads the real clock and repository push state, supplies transcript terminal output when a devlog was edited, and exits `2` only when the linter returned a failure. A failure keeps the current round open for repair; it does not ask the host to create a new owner-looking Ask. `stop_hook_active` exits `0` so one correction cannot trap a session in a loop. A valid `AGENTFLOW_EXTERNAL_DELEGATE` marker bypasses owner-round checks; the launcher remains responsible for provenance and isolation.

- **`ag-settings.js`** — the shared settings module and CLI. It resolves the
  adjacent configuration, rejects duplicate or malformed JSON, validates the
  schema, writes atomically, displays settings, applies changes, projects the
  fixed STATUS health line with one adjacent archive pointer, and resolves
  worker tiers. Configuration values are data and are never evaluated as shell
  text.

  The current configuration is Version 7.

  The public root keys are exactly `schema-version`, `switches`,
  `pipeline-roles`, and `external-workers`. The public switch keys are exactly
  `target-doc`, `cli-provider`, `auto-reply`, `lang`, `streams`,
  `ask-names`, `allow-ag`, `metrics`, and `large-work-minutes`.

  Each worker profile has `id`, `command`, `priority`, and `tiers`, with an
  optional `family`. Tiers always include `best`, `better`, `basic`, and
  `cheap`; custom tier names use lowercase ASCII letters, digits, and hyphens.
  Pipeline roles use the ten canonical task names and select a tier or
  `off`. Unknown keys are diagnosed as nonblocking warnings and ignored by
  canonical output; unknown keys never satisfy a missing recognized key.

  ```text
  node agf.js init
  agf init
  agf settings validate
  agf settings show
  agf settings change --set 'auto-reply: off'
  agf settings rename --from devlog.md --to features/ag/ag.devlog.md
  ```

- **`resume-intake.js`** — one bounded local command for the first `godev` response. It validates adjacent configuration, returns STATUS, the final unresolved Ask, branch, and changed paths, and distinguishes a normal owner-written final Ask from foreign concurrent changes. It never fetches, reads the archive, installs hooks, or writes files.

- **`delegation-route.js`** — validates the evidence record for the unified
  external worker.

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

- **`looper-git.js`** — experimental beside-current Git-backed runner. It uses one Git-local lock, one plan hash, one worker, an independently verified notebook round, a required worker commit, and committed `git mv` archival. It is not installed by `setup.js` and must not replace `looper.js` until the real two-plan, interruption, lock, rerun, generated-queue, and recovery comparisons pass.

- **`metrics.js`** — optionally writes validated metrics history and evaluates
  an evidence window. It writes no history when `metrics` is `off`, preserves
  unavailable provider fields as `unavailable`, and never changes routing.

- **`agf.js`** — the unified owner-facing command. It provides initialization, setup, hook management, settings, feature-stream work, and safe removal with focused subcommand help. `agf-looper` intentionally remains standalone. Internal validation and writing scripts are not public command families. Stream actions do not write the root notebook or replace a protocol round with an unrecorded direct Git sequence.

- **`devlog-guard.js`** — a fail-open pre-commit guard installed by
  `agf hooks --project`. It protects the root notebook and configuration
  from being staged on a feature branch.

- **`install-hook.js`** — installs or removes the Claude Code and Codex Stop
  hooks and the project pre-commit guard, preserving backups and avoiding
  duplicate entries.

- **`setup.js`** — checks Node, Git, the skill files, the user's `agf()` and `agf-looper()` shell functions, and `AGF_OPEN`; `--fix` prefers usable `$HOME/.agents/...`, `$HOME/.codex/...`, and `$HOME/.claude/...` installations in that order, then falls back to the verified active skill directory for a plugin-only installation without guessing cache paths. It accepts an existing managed shortcut to any usable matching installation despite indentation differences and replaces only a recognised stale Agentflow shortcut.

- **`suite-evidence.js`** — records bounded evidence for a declared test suite.

## Hosts and manual use

Claude Code and Codex use the same Stop-hook contract: JSON on stdin with a
working directory, `stop_hook_active`, and optional transcript path; exit `2`
blocks the turn. The installed command carries its owning host explicitly.
Other clients can call the same Node entry points when they can provide the
documented facts.

Run the final terminal preflight with a bounded JSON object on standard input so no permanent facts file is needed:

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

Run from this directory:

```text
node --test ag-settings.test.js agf.test.js alignment.test.js cross-check-plan.test.js delegation-route.test.js devlog-guard.test.js external-runner.test.js harness-boundaries.test.js install-hook.test.js looper.test.js metrics.test.js prompt-compression.test.js queue-contract.test.js release.test.js resume-intake.test.js round-linter.test.js setup.test.js stop-hook.test.js suite-evidence.test.js terminal.test.js
```
