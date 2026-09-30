# Skip the development pipeline

`skip-ag [task]` and `/skip-ag [task]` select the direct route for the current Ask. Do not invoke AG's development pipeline or its advisor stages, even when `allow-ag` is on. Follow-ups and resumed sessions retain this choice until the task closes. The next Ask uses normal routing. Do not change `ag.json`.

With a bare command and no task yet, leave the Ask open and reply `Direct route ready. Send the task when ready.` Do not invent a task or write a closing Reply. Quoted examples, questions, mentions, and `skip-ag: on` are not command invocations.

Keep owner-message capture, progress and tracker records, the complete saved Reply, STATUS, necessary tests, normal review requirements, ownership and file safety, and scoped Git delivery. Ordinary delegated execution and existing stream rules remain available; this command does not select a particular executor or waive independent review.

Skip pipeline-specific advisor artifacts, prepared queues, pipeline acceptance/security stages, and Design Go/Result Go requirements. Retain any independently required permission or safety condition; skipping the pipeline does not authorize destructive actions or expand the task.

`no-ag` skips the entire host Agentflow protocol. `fast-lane` additionally disables delegation, new streams and independent review. Neither is an alias for `skip-ag`.
