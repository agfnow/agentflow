# Fast-lane command

For a pipeline-only opt-out, use `skip-ag [task]` and read [skip-ag.md](skip-ag.md). It retains ordinary delegation, stream rules and normal independent review. Unquoted `no-ag [task]`, `no-ag: [task]` or `no-ag, [task]` skips the entire Agentflow protocol for that submitted message, including notebook capture and closeout. Quoted mentions and conditional statements do not activate it; the next ordinary message resumes the workflow; these controls are not aliases.

`fast-lane [task]` and `/fast-lane [task]` select direct host execution for one task. The task text is optional. A bare command applies to the current unfinished task; with no task yet, keep the Ask open and reply `Fast-lane ready. Send the task when ready.` Do not invent a task or write a closing Reply for activation alone.

The command persists through follow-ups and resumed sessions in the current Ask, expires when that task closes, and leaves the next task using normal behavior. Do not change `ag.json` or add an on/off setting. Quoted examples, mentions, and `fast-lane: on` are not command invocations.

## Waived requirements

- Skip AG and its advisors, delegated execution, new streams, and external review. Work in the current authorized checkout; preserve existing stream ownership and foreign edits. Do not move or close an existing stream merely to enter fast-lane.

- Skip pipeline Design Go/Result Go rounds, frozen plans, queues, and advisor artifacts. Do not require their completion or repair records after the owner switches an unfinished task to fast-lane.

- Do not launch model probes or paid evaluations unless the task requires them or the owner requests them. Run the tests needed for the change; avoid unrelated full-suite runs and repetition of unchanged passing evidence. This does not authorize skipping a necessary test or ignoring a failure.

## Requirements that remain

- Keep mandatory trackers for decomposed work, timed WIP checkpoints, detailed progress reports, and the complete final Reply. Normal progress and record rules still apply.

- Host self-review is mandatory. Compare final changed paths and behavior with the accepted request, including retained requirements; check for unauthorized additions and unintended reversions. Inspect verification evidence, address blocking findings, and record `Host review: PASS — <inspected scope, evidence and findings>` in the Reply. This is the host's review, not an external review verdict.

- Keep owner-input capture, valid notebook boundaries and configuration, protection of user edits, truthful evidence and delivery claims, and scoped commit/push rules. Fast-lane does not grant new destructive or external-action permissions.

The linter and hooks derive fast-lane from current owner input and waive only the specified workflow gates. Ask before adding further skips or reverting an agreed part of this behavior; a question about alternatives is not authorization to change scope.
