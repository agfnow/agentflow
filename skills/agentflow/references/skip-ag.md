# Skip the development pipeline

Starts the line with `skip-ag` or `/skip-ag` selects the direct route for the current Ask. Do not invoke AG's development pipeline or its advisor stages, even when `allow-ag` is on. Follow-ups and resumed sessions retain this choice until the task closes. The next Ask uses normal routing. Do not change `ag.json`.

Examples: 
1. skip-ag fix the login bug
2. /skip-ag fix the login bug

With a bare command and no task yet, leave the Ask open and reply `Direct route ready. Send the task when ready.` Do not invent a task or write a closing Reply. Quoted examples, questions, mentions, and `skip-ag: on` are not command invocations.

Keep normal Agentflow requirements. Ordinary delegation and stream rules remain available; this command does not select an executor or waive independent review.

Skip pipeline-specific advisor artifacts, prepared queues, pipeline acceptance/security stages, and Design Go/Result Go requirements. Retain any independently required permission or safety condition; skipping the pipeline does not authorize destructive actions or expand the task.

Unquoted line-start `no-ag`, alone or followed by a task separated by whitespace, a colon or a comma, skips the entire host Agentflow protocol for that message, including capture and closeout. Quoted examples and conditional statements do not activate it; the next ordinary message resumes the workflow. `fast-lane` additionally disables delegation, new streams and independent review. Neither is an alias for `skip-ag`.
