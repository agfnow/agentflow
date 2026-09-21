<!-- Load only for run-looper, run-plans, or work that changes looper behavior. -->

# Looper operation

Use this file for all looper operation, monitoring, recovery, and delivery work.

## Triggers

- `run-looper` authorizes direct execution through `agf-looper`. Run `agf-looper [options] [planned-directory]` from the checkout where the plans must change files.

- `run-plans` authorizes completion of the existing workspace-default queue defined in `SKILL.md` → Task artifact locations. Run the installed `agf-looper` shell command from the checkout where the work belongs. Do not replace it with a handwritten loop.

- A plain mention of looper, plans, `planned/`, or a request to create plans does not start the queue. `make-plans` routes each job as simple or complex, publishes a frozen queue, and stops before implementation. Before `plan_jobs`, the natural-language host inspects the owner request and relevant repository evidence and supplies `complexity_reasons`: a unique list containing only applicable reasons from `material_uncertainty`, `cross_subsystem_coordination`, `public_or_stored_data_contract`, `trust_boundary`, and `unresolved_material_decision`.

  Empty routes directly as simple; non-empty routes through the complex pipeline. The owner supplies the work request, not a route, and job length is never used.

## Supported queues

- A handwritten queue contains regular files named exactly `plan-NNN.md`, where `NNN` is three digits. Use the default queue or select another with `--tasks-dir`, following `SKILL.md` → Task artifact locations. It does not need `.queue-generation.json` and uses the configured notebook completion line.

- A queue produced by `make-plans` contains numbered plans plus `.queue-generation.json`. Leave every plan and that file unchanged. The envelope records route-specific authority: simple plans use the owner request and repository evidence, and complex plans use the accepted contract. Looper checks their saved fingerprints, order, dependencies, notebook, and final integration plan before it starts work.

- Interactive queue execution uses the same unordered `allowed-worker` eligibility and task-specific host selection contract as ordinary work. The host chooses among eligible permitted kinds, while preserving frozen plan bytes, dependencies, one-at-a-time ownership, stop records, completion evidence, and archive proof. A native action is a host-tool handoff, not a command invented from the host name.

- For an interactive handoff, call `looper.claim_host_plan({root, tasks_dir, completion_path, host, session, selection_facts})` from the current host. Retain its actual host/session identity; omitted values use the ordinary identity discovery rules. Supply observed external/native/host capabilities and `selection_facts.task.executor_choice` to the shared selector. If the claim returns `status: selection-required`, no ownership was acquired; choose from the returned alternatives and retry autonomously. The optional `candidate_id` can override default external profile priority within eligible candidates. Save the returned claim before running its selected action; it records both queue ownership and the reserved notebook Ask. After inspecting the product and completing exactly one notebook round, call `looper.finish_host_plan(claim, execution_record)`. Bind `task_id` to `claim.task.name`, `attempt_id` to `claim.owner_token`, candidate/kind and `source_identity` to the claim, and `outputs.completion_line` to the configured notebook completion line. The shared validator and existing digest, ownership and archive checks must pass. Cancellation, failed acceptance or uncertain ownership leaves the plan pending; never edit the claim or reset ownership to manufacture success.

- Run only from the checkout where the plan must change files. Use `agf-looper --tasks-dir <path>`.

## Normal operation

- Stay responsible for the command until it exits. Looper runs one ready plan at a time, verifies its notebook round and exact completion response, moves a proven plan into `$workspace_dir/planned/done/`, and then starts the next ready plan.

- Each launch reserves the empty next notebook Ask under its normal writer lock. A foreign owner or unresolved populated Ask blocks launch. Standalone workers use the controller's retained `looper` identity; interactive claims use the current host/session so normal host closeout remains available. The attempt and claim retain the ownership token. Completion checks that token and releases the reservation after notebook and archive validation; an already verified interactive host close is accepted only while its matching token remains current.

- Looper calls the shared `select_frozen_ready_plans` boundary for generated queues. An ordinary host agent must call the exported `select_host_ready_plans` name before choosing work; it is the exact same function object, so both paths accept the same frozen authority and return the same ordered ready plans.

- Relay each important plan, test, review, commit, or failure milestone to the owner. Provide a short update at least every 60 seconds while useful new facts arrive.

- `Still running` proves the child process is alive. Do not call quiet reasoning a hang. If looper itself produces no update for more than two expected 60-second intervals, inspect only the process this host started before deciding whether it has stopped making progress.

- Use `--show-output` to page only the bounded final worker-output tail. Use `--dump` to save complete stdout and stderr for every worker under `$workspace_dir/artifacts/looper-output/<run>/`. The option is off by default. Looper prints the exact easy-to-open file paths when it creates them.

## Stop, review, and recovery

- Interrupt only the looper process owned by this host. Looper forwards the signal to its child and prints the recovery paths.

- When a plan stops, inspect the plan, notebook, Git changes, `.stop.txt`, and the protected attempt record named by looper. Preserve evidence that matters.

- If another host truly completed the plan, move it to `$workspace_dir/planned/done/` only after the inspection proves completion. Otherwise leave it pending.

- Use `agf-looper --reset` only after confirming that no child or queue owner is live. Reset retires reviewed stale control records and exits. Run plain `agf-looper` separately to resume. Never reset, move a plan, or claim completion while ownership or completion evidence is uncertain.

- A failed, interrupted or uncertain plan retains notebook ownership; `--reset` does not release or transfer it. Inspect `agf owner inspect --notebook <path>` alongside the saved attempt. After owner-authorized recovery, use the inspected Ask, token and notebook hash with `agf owner adopt` to hand the round to the recovering host/session. Finish any populated round before launching another plan; an empty reservation may continue through an interactive claim by that same retained host/session. Never remove ownership records or infer abandonment from a helper's exit.

- Standalone looper is intentionally narrower: it supplies only checked external capability facts and has no interactive native or host tool. If external is forbidden or unavailable, exit before lock or ownership claim and leave the exact queue pending. Print an actionable handoff telling the owner to resume the pending queue in an interactive host; do not invent a second scheduler or archive the plan.

## Changes to looper behavior

Every change that can alter looper behavior has one mandatory final gate: run `node skills/agentflow/scripts/looper-live-gate.js --report <work-root>/looper-live-gate.json` before the cross-check target is frozen. This gate must create a temporary Git repository, install and invoke the real `agf-looper` shell shortcut, run two real low-cost provider plans, and prove a successful process exit, both exact product files, two completed notebook rounds, and both plans archived under `planned/done/`. Fake workers, injected process functions, a manually invoked `looper.js`, or an earlier run against another implementation cannot replace this evidence. A missing, stale, incomplete, or failed report blocks delivery. — I-064.
