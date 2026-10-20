# Looper execution contract

Machine-facing contract. Preserve ordinary task workflow, review settings, executor choices and owner authority; no extra supervisor, verifier or whole-group/wave/final gate. Looper is a scoped Node.js runtime exception, not general helper authority.

## Prepare and route

- **`prepare-tasks <request>`:** derive requirements, checks and grouping from repository evidence under [planning routes](review.md#planning-routes); ask only material unknowns. Preserve every original task/criterion exactly once. Keep tightly coupled tasks sequentially within one group, or register earlier-group `depends_on` edges when later work needs integrated predecessor outputs. Independent roots may run in parallel. Prepare `<ag-dir>/artifacts/A-NNN-<name>/planned/group-NNN.md`, adjacent `planned/queue.json` and `planned/request.md` with exact preparation-time request bytes; run-root is this `planned/` directory. Link run-root from Current, then stop. Feature work uses its feature-local artifact root; never route through main’s notebook.

- **`run-tasks [run-root]`:** execute/resume the Current-linked queue; an explicit root overrides it. Host launches `agf loop run <resolved-root>` and services native dispatch/owner responses. Missing queue is an error; never invent a second default.

- **`handle-tasks <request>`:** prepare as `prepare-tasks`, then execute as `run-tasks` within granted authority.

Require Git, Node.js and supported configured task providers. Resolve installed skill/provider controls and permissions; never invent flags, models or authority. CLI ordinary task sessions support Codex/Claude. Native task selection reserves its group slot until a stopped result and requires live-host dispatch and result-mailbox handoff; without that host, block native dispatch until `run-tasks`, never substitute CLI. Retain explicit model/effort and ordinary review/executor rules. Each CLI attempt retains a 20-minute timeout; preserve/block unfinished work on timeout, without a new timeout switch or stage. External sessions inherit environment/network; tool restrictions are not OS containment. No detached writers, daemon or automatic restart.

## Queue and records

`ag.json` owns editable settings; `queue.json` schema 2 owns instructions, scheduling/progress/recovery and immutable attempt evidence. `ag.json` remains schema 9. Markdown carries task instructions, not scheduling state. Reject unregistered handwritten groups. Registered task text may change before starting; do not silently revise started work. No `groups.json`, `state.json`, fingerprints, dependency waves or promotion command.

### Schema and inputs

The [queue example](../assets/looper-groups.example.json) illustrates schema only; replace placeholder repository/commit/request/checks and register real Markdown before launch. Its authorization booleans are not permission.

Require `schema_version: 2`, unique safe `run_id`, physical absolute Git-root `repo`, valid `target_branch`, full `base_commit`, `request` (a run-root-relative UTF-8 text-file path, normally `request.md`) and lowercase 64-hex `request_sha256` of its exact bytes. Preserve the decoded preparation-time request text without headings, added newlines or normalization. Create the request file exclusively and deliver it with preparation records. Reject inline requests, missing/empty files, absolute/traversal/symlink paths, invalid UTF-8 and digest mismatch before claims/worktrees on run/resume. Status remains read-only and reports request-input errors alongside saved progress. Read its verified contents into task and repaired-result review/acceptance prompts. Do not rewrite the request/digest after preparation or silently adopt changed input; changed authority requires reconciliation. Queue schema 1 is rejected, not implicitly upgraded. Unstarted queues may be explicitly converted by preserving their original decoded request bytes and other inputs; started queues require recovery before any migration. `authorization` requires `execute`, `worktrees` and `local_commits` true, backed by actual owner authority; booleans grant none by themselves.

Optional `contracts` lists repository-relative regular project rules/invariant files; include established authoritative constraints needed by tasks. The coordinator supplies their committed `base_commit` contents plus the shared project-rule baseline and existing AGENTS.md, as read-only constraints.

Resolve `<queue.repo>/ag.json` under [looper settings](configuration.md#looper-settings), never queue worker/limit overrides. `looper-routes.task` selects transport/provider/catalog; task and repair reuse `implementation`, review and renewed acceptance reuse `acceptance`. Require selected mappings; the shell coordinator has no host defaults. Preserve supported controls without substitution.

`checks` maps check IDs to `{ "command": ["executable", "argument"], "timeout_ms": 60000 }` (timeout optional). `integration_checks` and every task’s `checks` are nonempty registered check-ID lists. Commands use argument arrays, not shell text; checks must not modify product files. `integration_checks` runs on every partial merge, so use checks valid for every partial result; output-specific checks belong to tasks and are rerun for included groups. Do not require not-yet-started outputs in common checks.

`groups` contains unique `{ "id": "G01", "file": "group-001.md", "tasks": [{ "id": "T01", "allowed_paths": ["src/example.js"], "checks": ["test"] }]`. Files are relative to run-root; each task ID occurs once across the queue and exactly once as a Markdown heading, e.g. `## T01`, in its registered group file. Put instruction prose only in Markdown; JSON array order owns task order. Optional `depends_on` is an array of unique IDs of earlier groups; absent/empty means independent. Reject unknown/self/duplicate/forward references and nonarrays before claims/worktrees. Reject unsafe/reserved paths and unregistered group files.

Repair uses `looper-routes.repair`; review and renewed acceptance share `looper-routes.acceptance`. Resolve them only when needed. Native roles use the same mailbox; CLI repair and its actual reviewer must use different providers, including after settings changes on resume. No clean-merge gate. Supply applicable invariant/writing policies inline; no outside-file access is required.

Read settings once per `run` invocation. Save each new attempt’s resolved `selection` and `source` (ag.json digest, route, tier) as evidence. Resume that exact selection; later invocations’ settings affect new attempts only. Limits apply per invocation; lowering task/repair limits must still allow importing outstanding native results before future routes are resolved. Status requires no valid current worker configuration and never writes progress.

Coordinator state stays in the same queue: `expected_head`, `ready`, `questions`, `processes`, `handoffs`, `integration`, and group/task state. Never edit those fields to manufacture progress.

One coordinator alone writes queue state atomically. Save registered groups, ordered tasks, selected work, worker/result identities, ready order, candidates/bases/result heads, questions/answers and recovery there; artifact outputs are evidence, not a second state authority. Workers return results, never mutate queue, Git-commit, integrate or publish. Preserve shared notebook/backlog/registry/settings ownership.

Each group uses a distinct stable worktree. Explicit session overrides select `.aglite-records/devlog.md`, `ag-dir: .aglite-records`, `auto-commit: off` and `auto-push: off` without mutating `ag.json`. Coordinator adds the exact isolated-notebook marker ignore rule to common Git `info/exclude`, a small shared-local setting required by ordinary notebook ownership; workers need no Git-metadata write. Record ordinary notebook/design/tracker work there. Exclude those records from product integration; root notebook does not collect parallel task rounds. Status locates their records. Preserve established feature/worktree identities.

Task prompts assign a generated workflow session UUID equal to the attempt UUID before dispatch. After proving the task stopped, coordinator may archive only `.aglite-records/.devlog.md.owner` whose session exactly matches that UUID; preserve the open Ask for a fresh task continuing an owner answer. Refuse foreign markers untouched.

### Retained files

`planned/` remains the run-root after preparation. `queue.json` owns progress; `request.md`/`group-*.md` retain request/instructions; `inputs/` holds task snapshots. `attempts/<UUID>/` retains per-dispatch selections, prompts/assignments, identities and available results/transcripts; failed launches may lack results, and native/CLI records differ. `evidence/` retains check logs and process/descendant identities; `inbox/` holds supplied answers/corrections and native results. Resumes reuse successful work; new attempts/checks add evidence, not necessarily one set per task.

Safe claim release deliberately renames `.queue.owner` to `.queue.owner.released-<UUID>`; common Git metadata retains analogous target-claim archives. These are inactive history, not active locks or failed temporary writes. Each acquired/released invocation can add records. Group `.aglite-records/` notebooks/reviews stay outside product integration and may be ignored; clean Git status does not establish that a worktree is disposable. Integration retries can retain extra worktrees.

Completion performs no automatic retention cleanup; only `run`/`status` are shipped. Separately authorized retention must prove stopped writers, settled ownership and integrated tips; preserve/verify ignored task records and required request/instruction/queue/review/check evidence, with usable old-to-archive path mappings before retiring worktrees/merged branches. Preserve historical identities/progress; never infer deletion authority from `.tmp`, released-claim names or completion. Transcript/identity bundling or claim compaction remains future policy, not implemented behavior.

## Execute and integrate

`ag.json` `looper-limits.max-workers`: positive integer, default 3. Count groups performing task work; a finished or blocked group frees its slot only after its worker stops. Waiting for integration consumes no task slot. Within each group, fresh ordinary task workers run sequentially through plan → design/tracker when needed → implement → checks/review → closeout. The task must finish its ordinary Reply/next Ask before returning pass; coordinator checks that closeout, commits product changes and reruns declared task checks before advancing. No additional verifier session. A group waits without a slot/worktree until every `depends_on` predecessor has checked integration (`state: done`); status names unmet IDs. Newly starting dependent work uses the latest checked expected target head, which contains predecessor outputs. Lane errors block dependent launch. Resume re-proves done/integration evidence before descendants; a blocked ancestor leaves descendants waiting while unrelated work continues. Keep running groups on recorded bases; never refresh them from ongoing integrations.

After the final successful ordinary task, record the exact candidate commit and append the group to the FIFO ready list. Handle simultaneous readiness in group-ID order. Start integration immediately when its lane is free; do not wait for unfinished groups.

Refuse concurrent coordinators for one queue. Hold the target-wide exclusive claim across run roots for every merge/repair/check. One integration attempt at a time uses the latest checked target head. Recheck expected target/candidate identities and owner-edit protection before updates; external target movement stops the lane, including startup. Independent task work may finish; never silently adopt the moved target. Preserve unrelated target edits; never reset, clean, force or overwrite them.

Merge and run relevant combined checks; record the resulting checked target head before the next merge. Clean checked merges launch no extra agents. Conflict/behavior repair uses an isolated attempt, bounded by `ag.json` `looper-limits.max-repairs` (nonnegative integer, default 2), then independent review, renewed acceptance and affected checks. One repair may overlap task work outside the task concurrency limit. Refuse repair-worker index changes and remaining conflict markers before coordinator staging.

Blocked repair preserves its attempt and blocks its group. Release the lane only after proving all attempt writers stopped and shared Git/target state is safe; then other ready groups continue. Resume repair against the latest checked head and repeat affected review/acceptance/checks. Uncertain shared effects stop the lane, while independent task work may continue. A blocked required group prevents completion.

## Native handoff and owner inbox

Host reads pending `attempts/<uuid>/assignment.md` and dispatches through real native tools using its selected model/effort, explicit worktree and complete task context. Observe the worker/descendants stopped and verify ordinary workflow before writing only `inbox/<uuid>.json`:

```json
{
  "attempt_id": "UUID_FROM_ASSIGNMENT",
  "outcome": "pass",
  "summary": "Observed result",
  "evidence": [],
  "writer_stopped": true
}
```

Allowed `outcome`: `pass`, `repair`, `needs_owner`, `blocked`. `repair` is for concrete in-scope findings from a read-only review; missing proof blocks instead of triggering code edits. The result schema applies to worker output; the host adds `writer_stopped` only after observing settlement. Use exact attempt identity and truthful stopped evidence; do not infer success from process exit. Superseded handoffs are no longer pending. Superseding an unresolved native attempt requires host stopped attestation (`answer.writer_stopped: true`); an owner decision alone never proves settlement. Host writes inbox only, never queue. Re-run `agf loop run <run-root>` to import the result; no absent-host native dispatch.

Invalid/malformed native responses or missing `writer_stopped` leave the attempt outstanding and its slot reserved; status exposes the response error. Import a corrected response on the next run only, without same-run retry or inferred stopped proof.

Owner responses use `inbox/answers.json`: `[{ "id": "QUESTION_UUID", "answer": "exact owner text" }]`. Host preserves exact owner text and coordinator imports it on run. Re-reading the same answer is idempotent; conflicting replacement of a saved answer is rejected. Technical blockers may receive a host correction with `"source": "host"`; ordinary answers default to `"source": "owner"`. A `needs_owner` question requires actual owner input and rejects host substitution. No separate answer/decision shell command.

## Questions and recovery

Save a question in the affected group’s JSON state and status; block that group while independent groups continue. Owner answers the host; host passes an inbox response for the coordinator to save in queue state. No delegate supplies owner-only permission or changed-scope decisions.

Before fresh continuation, reconcile recorded coordinator/worker identities, candidate/base/result identities and actual Git effects; prove previous writers stopped. Preserve unfinished edits/worktrees and evidence. Unknown writer or task effects block the affected group; uncertain shared effects block the merge lane. Unsettled writers retain claims/slots and block new dispatch. Keep live identities in queue using snapshot/batched inventory updates; completed evidence remains under attempts. Never manufacture completion from an exit code, timeout or worker “done” text.

A proved distinct identity at a reused PID permits takeover; unknown identity still blocks. Technical host corrections recheck the exact saved candidate/checks rather than rerun successful task work. Recover coordinator-owned staged `commit_intent` by finishing its parent-scoped commit; reject worker staging without prior intent. A prepared isolated-merge crash preserves the attempt and retries fresh without reset. A merge already landed and proved checked is recorded once, never replayed; missing checks run before completion. No guessed PID signaling, claim deletion or destructive reset. A fresh host uses queue/evidence, not the previous conversation. Process/platform/crash guarantees require actual observations; mocked/unit results alone prove no OS/provider behavior.

## Shell entry — alphabetical

Install the resolved skill with `npm install -g <resolved-skill>`; its zero-dependency package registers `agf`. Only these shell commands exist:

- **`agf loop run [run-root]`** — start/resume the queue; host launches it.

- **`agf loop status [run-root]`** — read saved group/task progress, current tasks, ready/integration state and questions without dispatch.

Omitted shell root means cwd; missing `queue.json` errors. Status combines saved progress with a current coordinator observation (`live`, `dead-or-uncertain`, `absent`) and never mutates queue state. `run` exits 0 when complete, 2 when blocked/stopped, 1 on error; successful `status` exits 0. Chat `run-tasks` resolves Current before invoking the shell. No second owner terminal is required. Runtime/package portability is a validation target; do not claim Windows/Linux/macOS proof without actual observations on each OS.

## Scope and maintenance

Isolated task/repair/review sessions do no configuration migration writes or session release checks; those belong to the owner-facing host. Interpret documented legacy config mappings in memory without changing ag.json; unknown mappings remain blocked. Preserve task allowed_paths and read-only root configuration.

No cleanup, push, release or publication authority follows. Retain worktrees/evidence until separately authorized retention work. Ordinary host workflow remains instructions-only; reviewed runtime modules and the package/`agf` launcher are the narrow exception, with publication separately authorized.

This reference owns execution behavior. Keep [SKILL.md](../SKILL.md#looper-task-execution), [configuration](configuration.md#looper-execution-exception), [review](review.md#looper-task-review), both guides, cheatsheet and public README templates aligned. Prove concurrency, sequential freshness, native/CLI routing, FIFO/serialized integration, conflict repair, questions, moved/dirty target protection and crash recovery against original outcomes; missing proof stays unproved. Private operator docs/history are never shipped dependencies.
