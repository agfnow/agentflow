<!-- Stream/worktree rulebook. Load before any stream-triggered action. -->

# Streams and worktrees

`stream(branch/worktree)` is the compact name for an isolated feature workspace: a Git branch in a separate worktree, together with the stream notebook and adjacent configuration. A non-code notebook-only request is the explicit exception: it can create a stream file and root pointer without a branch, even when Git exists. Ordinary notebook work can continue in a no-Git folder, but `new-feature:` needs a repository before it can create a Git worktree. The owner/session worktree is distinct from a delegated worker's disposable no-remote clone.

Read this file whenever a stream trigger in `SKILL.md` fires. Its rules apply even when it is not otherwise loaded: feature triggers preempt resume; only the main checkout writes the configured main notebook and STATUS; foreign uncommitted files belong to the other session (I-018/I-031/I-035).

Rule-editing guard: `— I-NNN` marks a failure-born rule. Read its narrative in `docs/incidents-log.md` before changing or removing it.

## Paths, triggers, and ownership

Use `SKILL.md` → Task artifact locations for notebook, task-root, and queue paths. The configured main STATUS lists active streams as `stream: <taskkey> — active — <path>`; closed, delivered, and ditched streams remain in their own records, not this current-state list.

The stream notebook is its own owner surface. Never add a branch-key directory. Completion metadata is stored separately with no generated link or hash in new Replies: `$workspace_dir/.tmp/features/<taskkey>/A-NNN/completion.json` prevents Ask-ID collisions and is not a tracked stream artifact. Legacy links remain readable.

Triggers are `new-feature: <name>`, plain feature-starting words, parallel-work evidence (another active stream, non-default branch, teammates, or foreign files), `merge-back`, `cleanup:<taskkey>`, any trigger on a non-default branch, a leftover `.worktrees/<key>`, or an active root pointer whose stream STATUS is closed. A changed target notebook alone is not foreign work when `resume-intake.js` proves that HEAD ended in its empty final Ask and the working copy changes only that final Ask into one unresolved owner request. Any other notebook edit, or any second changed path, remains foreign work.

Revalidate adjacent `ag.json` first. `streams: always` proceeds for plain feature/parallel triggers; `ask` batches the same question; `off` reports the signal but neither asks to open a stream nor opens one. `off` does not remove path-ownership or concurrent-work safety rules. Explicit `new-feature:` is always immediate authorization.

`new-feature:` runs exactly `agf new "<name>" [taskkey]`. The CLI validates config, creates the worktree, copies stream configuration, writes STATUS, commits stream-open files, pushes when a remote exists, and leaves the owner in the worktree. It never writes the configured main notebook; the agent adds at most one main-notebook pointer. If `agf` is unavailable, report it and stop; do not substitute manual Git.

After opening, tell the owner to exit and run the shell-quoted absolute continuation command from the CLI result. If no work request followed the feature name, close the stream-open round with an empty Ask scaffold; do not invent work. A plain notebook-only request creates one stream file plus its root pointer, without branching; never offer it instead of `new-feature:` for code work.

From a second terminal, preserve foreign uncommitted files exactly: do not commit, stash, clean, revert, or absorb them. Defer the root pointer to the main session and state the deferral in the stream Reply. A stream session never writes the root notebook, even though the worktree contains its checked-out copy.

A dirty checkout alone does not make the active notebook foreign. The main-checkout session that received the current Ask must answer it and update the configured main STATUS, while staging only its notebook and any current task records or review evidence required by that Ask; it never creates a new audit side file. If ownership is unknown, leave the notebook unchanged and report the conflict.

Startup, prompt hooks and notebook writers enforce a persistent local owner for each checkout/notebook/Ask. The same host/session resumes; a different session cannot write its prompts, progress, STATUS or completion evidence. `streams: off` retains this guard. Actual linked worktrees accept only their canonical stream notebook, including custom workspaces. A notebook rename by its owner locks both paths and transfers ownership; its old forwarding card does not grant write authority.

Owner-requested first activation can claim a populated A-001 in the canonical linked-worktree notebook when no owner exists, no progress or Reply exists, and Git HEAD proves the same notebook had only an empty A-001 with unchanged text through its heading. This uses the committed stream-opening notebook; no extra confirmation or creation record is needed. Other unowned populated notebooks still require adoption.

Owner-requested activation/resume through startup can claim a populated next Ask when its immediate sequential predecessor has a valid released owner and completed Reply; no second confirmation is needed. Hooks and ordinary writers cannot claim that populated Ask before activation. Use `agf owner inspect --notebook <path>` for other recovery. A populated legacy Ask without release proof, or an actively owned foreign Ask, requires owner-authorized `agf owner adopt` with the inspected Ask, expected token (or `unowned`), notebook SHA-256, host and retained session ID. Existing takeover authorization suffices. Never infer a handoff from dirty files, elapsed time or a stopped helper process. This guard coordinates cooperating writers; it is not a filesystem sandbox.

Every worktree is `.worktrees/<taskkey>` inside the repository and is ignored by `.gitignore`; it is a collision remedy, not a security boundary. One live CLI owns one worktree. The worktree does not stop processes from reaching the main checkout.

## `merge-back`

Run only in the matching stream worktree; elsewhere report nothing to merge. The exact sequence is:

1. `agf finish --prep [taskkey]` integrates the default branch into the stream, aborts conflicts, pushes the stream when a remote exists, and stops before delivery.
2. Write the stream closing Reply, set STATUS to closed, replace the active state with `Feature: <taskkey> — closed`, commit that record, and push it when a remote exists. The notebook must be tracked at the clean stream HEAD and the remote branch must equal it.
3. `agf finish --deliver [taskkey]` captures that immutable commit, verifies the main checkout is on the default branch, fetches, and fast-forwards locally and remotely when applicable. It refuses untracked/ignored paths that delivery would replace, and reports partial/rejected outcomes with recovery text.

If step 1 reports a merge conflict, it has already run `git merge --abort`; no half-merged state remains. Recover in this order:

1. Stay in the stream worktree and inspect the default-branch changes that conflict with the stream.
2. Reconcile those changes on the stream branch by editing or otherwise integrating the intended result, then commit the resolved stream state.
3. Run `agf finish --prep [taskkey]` again. Do not continue while it still reports a conflict.
4. After preparation succeeds, write and commit the closed stream notebook, push it when a remote exists, and run `finish --deliver` as step 3 above.

Do not run `git merge --continue` after the refusal because the CLI aborted that merge. Do not skip directly to delivery.

The delivery lock is exclusive, records process/repository/worktree/task/start/token facts, and releases only when pathname and token identity still match. It serializes Agentflow delivery, not manual Git. Without a remote, report the local-only result; do not call it a sandbox limit.

After success, give the owner the CLI's copy-ready command to exit and return to the main checkout. Cleanup is separate.

## `cleanup:<taskkey>`

Run `agf cleanup <taskkey>` from the main checkout. It merges, deletes the branch/worktree, and leaves the stream notebook and artifacts. It refuses from inside the target worktree because deleting the running host's current folder prevents its end-of-turn hook from starting; exit that session and use the copy-ready main-checkout command it prints. — I-058.

The resolved main checkout must be on the default branch. The key must match exactly one stream pointer, folder, worktree, or branch; no match, ambiguity, branch-without-stream, or stream-without-branch stops with facts and no guess.

Cleanup does not need a force option for Finder `.DS_Store` files, the target stream's Agentflow input/close receipts, released ownership and completion records, or local hook files containing only the current Agentflow hooks. Before Git removes the worktree, it copies these recognized files byte-for-byte into a new private `agentflow-cleanup/<taskkey>-<unique>/` directory inside the shared Git directory and prints its absolute path. The copy keeps the original relative paths; it is local recovery storage, not a pushed artifact or a new ownership claim. To recheck saved completion evidence later, restore the corresponding completion record/reference pair to its original workspace-relative location beside the retained notebook, without overwriting different existing records. Do not restore old ownership files as live ownership in another checkout.

Tracked changes, unknown untracked/ignored files, mixed host settings, symbolic links, active ownership, notebook locks, failed preservation and files changed during cleanup still stop removal. Recovery copies are retained even if a later removal step fails; existing copies are never overwritten. Exit the target host before cleanup, including when it has already released its last completed Ask. This command does not detect every unrelated operating-system process using that directory.

The CLI never writes the configured main notebook; the main session records merge, deletion, refusal, and pointer closure. `agf clean` and `agf merge` are aliases. `agf ditch <key>` is the owner's confirmed discard path: no merge, then worktree/branch deletion; the surviving notebook is recorded as ditched. A stream not marked closed may still be swept only on the owner's cleanup word, with that fact recorded.

## Housekeeping and safety

On every main-checkout round, rebuild root `Streams:` from active stream records and omit closed, delivered, or ditched entries. Sweep only leftovers whose branch is fully merged and whose stream STATUS is closed; invoke the exact cleanup CLI and record safe refusals. Leave unclosed or failed-check streams alone.

Never describe protocol or cross-checkout rules as filesystem sandbox limits. Manual branch switches, merges, fetches, or pushes must not run concurrently with delivery.
