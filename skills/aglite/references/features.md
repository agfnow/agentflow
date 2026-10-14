# Feature worktrees

Local commands: `new-feature`, `merge-feature`, `drop-feature`; quoted examples do not execute. Use Git directly, no hooks/runner. Execute only the requested operation; record lifecycle facts in enabled RUNs or tracker/STATUS/Reply, without a separate lifecycle record. Trackers follow planning/gate requirements. `merge-feature` retains branch/worktree unless cleanup is explicit (e.g. “and cleanup”), authorizing both checkout retirement and merged local branch deletion.

Follow [configuration.md](configuration.md); `.agentflow` means configured `ag-dir`. Read each participating checkout's ag.json before routing. Main-rooted `new-feature` bypasses root-notebook ownership/recovery/input capture and records creation only in its feature-local notebook; main inspection is read-only, including with a foreign main claim. Merge/drop claim every required main/feature result notebook before mutations. Handoffs override inline display. Gates precede implementation/final delivery; preparation is not implementation.

## Identity and routing

- Resolve original physical session directory, Git root/branch and registered worktrees; use absolute paths and explicit command working directories. Identify one registered local main checkout; missing/ambiguous main stops lifecycle mutations without switching branches.

- Managed layout: `<main>/.wts/ft-<name>` on `feature/<name>`; other layouts are unmanaged and require an explicit local notebook for development, never implicit relocation. Resolve symlinks and verify exact path/registration/branch, including from subdirectories; substring matches, detached HEAD or unregistered directories are invalid. Derive identity from the branch and exact matching path (`ft-demo` uses `ft-ft-demo`), never by stripping `ft-` blindly. Stop writes on disagreement; never nest worktrees inside feature checkouts.

- Names match `[a-z0-9]+(-[a-z0-9]+)*`. Ask for missing names; merge/drop may infer only the verified current feature. Main requires an explicit target, never an old handoff. Quote arguments; owner text is not shell code.

- Managed feature notebook: `<ag-dir>/features/<name>/<name>.devlog.md`; round artifacts use SKILL.md's `.agentflow/artifacts/A-NNN/` inside that feature checkout. Reject a supplied root/other-feature notebook and give the correct path. Never recover answers/tasks or write to the inherited root notebook. If missing, inspect configured notebook/archive history and retirement evidence before writes. Only an explicit `new-feature <name>` request or repeated command authorizes interrupted preparation without a notebook; bare activation or implementation input cannot infer that authority: give the main-session `new-feature <name>` handoff and stop. Never copy root work. Records are tracked relative to that checkout and reach main by merge. Unmanaged feature branches require an explicit local notebook; do not guess.

- Read-only idle screening may inspect STATUS and the tail before claiming; only a verified open, nonretired feature may use SKILL.md's idle shortcut, never lifecycle commands or retirement recovery. Otherwise apply SKILL.md's early Notebook ownership to the selected notebook and every additional notebook used, including routing exceptions and mirrored copies; claim all required existing notebooks before lifecycle mutations. Activation conflicts refuse the operation; late conflicts use only SKILL.md's bounded recording recovery, never repeat lifecycle effects. This session's matching claims are not cleanup blockers. For new-feature, reserve the feature-local notebook exclusively once its checkout exists, before config/notebook writes; retain its claim through local preparation closeout, then release only this session's claim. For authorized retirement, verify final feature records and release this session's feature claim before moving its checkout to Trash; main's claim remains through closeout. Never release another session's claim or edit Trash copies.

## STATUS and rejection

Read selected STATUS before task work at activation/recovery. Check original startup binding, not a subprocess cwd. Missing paths, Trash locations, identity conflicts or known retirement stop task writes except the bounded post-cleanup gate/delivery recovery below; never recreate/fall back. If a retired feature's notebook disappeared, inspect its preserved main copy only to determine rejection. Missing STATUS cannot override known retirement.

- New/verified open features: `Stream: open`, `Cleanup: N/A`, `Session: active`. Initialize missing fields only after live identity checks. Main omits these fields; reading a feature record does not retire main. Refresh the shared STATUS fields under SKILL.md as well.

- Successful validated integration: `Stream: merged`, `Session: retired`. Bind these to absolute checkout, branch, integrated feature tip and main merge commit. Ordinary feature work ends even if the directory remains. `Cleanup: N/A` means no cleanup authorized; `pending | failed | complete` records explicitly authorized cleanup, including uncertain/partial results. Complete requires verified Trash movement, exact unregistration and branch deletion.

- Merged/retired feature sessions reject further task work: **“Exit this session.”** Explain the feature branch was merged and can no longer be worked on. Only already-authorized terminal cleanup or final gate-controlled delivery in progress may finish; later requests go to a fresh main session. This is an agent instruction, not enforced host shutdown.

## `new-feature [name]`

1. Resolve main/name before generic root-notebook access. A feature-rooted invocation claims/records only an existing verified open feature notebook, then hands off to main with the exact command; if absent, give that handoff in chat without notebook initialization. Do not create there. Main-rooted preparation neither acquires main's claim nor records creation there or creates a ledger/index. If this session already owns main, checkpoint its existing work under normal rules and release only its matching claim before preparation, without closing unfinished work; a foreign main claim remains untouched. Main-rooted preparation performs no project-rules adoption or backlog/registry writes in main; defer them to an authorized feature or later main work session. Mixed unrelated main tasks require ordinary recovery/authority, never capture them as feature implementation. Inspect Git inventory and capture the committed local main tip read-only; preserve and explain exclusion of uncommitted edits. Resolve prerequisites without automatic fetch/pull/stash or unrelated commit.

2. Check exact target/branch/registration and configured notebook/archive history at the target, or in committed main before creation. Read live main lifecycle notebook/archive and linked recovery records only to check this target’s retirement, never recover root tasks or acquire its claim. Reuse only an exact registered managed pair without reset/move or replacing history; foreign feature claims block writes. Other path/branch collisions stop. Merged/dropped/retired history cannot reopen by reuse, including a same-name record inherited from main; choose a fresh name. For an absent notebook in an existing exact pair, require this explicit/repeated command as preparation authority; inspect partial config/ignore changes and known history, never infer implementation or recreate a missing historical notebook. A missing/ambiguous retirement identity stops. Git inventory suffices; create no pre-creation intent record.

3. If the pair is absent, use `git worktree add -b feature/<name> <absolute-target> <captured-main-tip>`. Once the checkout exists, resolve inherited/default configuration and its safe feature-local notebook path, then exclusively reserve that notebook under SKILL.md's ownership rules before initialization or other preparation writes. If reservation fails, retain the partial pair and report it; never reset/remove it or clear another claim. Ensure checkout-root ag.json exists from committed main or the default template without overwrite, resolving configured ag-dir. Ensure only the worktree container is ignored with a narrow local-exclude rule if needed; feature records must remain tracked. For shared excludes, preserve existing bytes, append one complete newline-delimited exact rule without replacement, then reread to verify rule meaning and concurrent additions. Never record preparation in main’s notebook or write main config/inherited root tasks.

4. Initialize an absent, history-free notebook exclusively from SKILL.md's scaffold. Populate STATUS/lifecycle fields and record exact checkout/branch, committed-main baseline and this creation request as local provenance; no main Ask link is required. Check a completed preparation first: verify/reuse its saved result and pending implementation without duplicate closeout or input; new supplied requirements cannot overwrite active work. Otherwise existing open notebooks retain IDs and pending work: use an empty trailing Ask with no pending work, or append preparation after a closed round; resume an unfinished preparation only after matching its recorded identity/authority to this command and inspecting actual state; other occupied/unresolved tails stop for owner reconciliation, never bury work. Rebind only this session's claim to the receiving Ask before mutation.

5. Capture the lifecycle command/context in that feature-local preparation Ask using SKILL.md's owner-input rules; preserve the supplied implementation portion for the next Ask, not as preparation work. Preserve the whole owner request across these locations with source links, without duplicate capture. Verify identity/config/notebook/ignore behavior and STATUS, recording checks locally in enabled RUN or configured recovery evidence. Close preparation there with the verified creation handoff as Reply and append the next Ask in the same write. Put only supplied authorized implementation requirements into that next Ask using owner-input capture, with their source; name-only leaves it empty and Current/Next awaiting a request. Preserve existing input exactly once; never invent implementation, empty design/tracker or implementation results.

6. Read back Reply, STATUS and next Ask, release own feature claim after preparation settles, display the handoff and end; no implementation in this session and no automatic commit/push. Partial failure retains exact observed Git/config/notebook state and its next safe action locally if claimed; before a notebook exists, report it in chat without a main record. Retrying absent-notebook preparation requires explicit `new-feature <name>` again.

## `merge-feature [name]`

1. Resolve target and cleanup authority separately. A feature-rooted session may merge only its own feature; another target requires main handoff. Main requires the name. Preserve unrelated changes; inspect completed work, checks, staged/unstaged and untracked/ignored contents. Locks/processes and other active sessions must be resolved before cleanup; merge alone does not require removal checks.

2. Require completed feature work/records; this merge request authorizes committing only verified task paths. With gate-tracker on, this feature snapshot and the merge commit are prerequisite integration operations, not final delivery; after integration/cleanup checks, pause before final delivery-record commits, push and handoff. Inspect main status/diff; overlapping edits or ambiguous validation stop without stash/reset. Run `git merge --no-ff feature/<name>` explicitly in main; resolve only understood conflicts. Failure retains the checkout. Before retries inspect tips, ancestry and in-progress merge; never repeat blindly.

3. Validate combined main and arrival of feature records. A retired feature session may finish only this already-authorized terminal gate/delivery sequence, never resume development. Failed/unavailable required checks retain the checkout without marking merged. On success record integration in main and mark the feature notebook there merged/retired, bound to exact identities. Mirror STATUS into its surviving feature copy; this is an explicit feature-routing exception. Main omits lifecycle fields. Use Cleanup N/A unless cleanup was explicitly authorized, then pending.

4. **Without explicit cleanup, stop lifecycle mutations here:** retain directory, registration and local branch. After applicable final gate approval, complete Reply/next Ask in main and both feature notebook copies, report retention and no pending cleanup. The retired feature's next Ask has no development carry-forward. Feature-rooted hosts use the retirement handoff below; main's host remains active.

5. **With explicit cleanup**, run the shared retirement procedure from main, using absolute paths for every command/final write. This bounded terminal sequence may retire the merging host's own checkout. Before `git branch -d feature/<name>`, require registration gone, current branch tip equal to the recorded integrated tip, and that tip an ancestor of main. Changed/reused branches stop cleanup. Failures/uncertainty retain remaining objects, record exact partial state and stop blind retries.

6. Save cleanup evidence, satisfy the final gate, then complete Reply/next Ask in main and the feature notebook preserved there. Set complete only with all observations, otherwise failed with recovery action; mirror final STATUS and closeout into any surviving feature notebook. Only incomplete authorized cleanup carries forward; a retired session cannot resume it. Feature-rooted hosts use the retirement handoff below, including the actual cleanup result. Successful cleanup needs no immediate reopen/repeated command; incomplete cleanup gives main directory/notebook for later recovery. Apply `auto-commit`/`auto-push` only to verified merge delivery after applicable gates; never deploy.

### Post-cleanup pending gate

After validated merge and authorized removal of this session's own feature checkout, later gate approval permits only pending main-side terminal delivery. Preserve startup binding; never resume development, access Trash, recreate paths or relocate the session. Before cleanup, save gate authority, exact main checkout/notebook, integrated feature tip, main merge commit and retained own main claim. Before pausing, record verified cleanup and checked pending-gate result in main. On approval, use explicit main cwd; reread its ag.json and verify recorded path/branch/integration/notebook and own claim. Missing evidence, mismatch or foreign claim stops delivery. Save final records, finish configured delivery, release own claims and display retirement handoff. Only this case overrides missing-startup/retired rejection.

### Later cleanup and partial recovery

A fresh main session can execute `merge-feature <name> and cleanup` for a retained merged feature, or finish already-authorized incomplete cleanup. Read preserved integration/authorization and inspect live identities; do not remerge or recommit a retired feature. Newly requested cleanup sets pending; prior N/A is not authority by itself. Verify already-completed steps instead of requiring/recreating absent objects. Every surviving/recreated path, registration or branch must match the recorded identity, including exact integrated tip; mismatches stop mutation. Inspect uncertainty before retries.

## `drop-feature [name]`

1. Verify startup checkout, branch, registration and main. Feature sessions may infer/drop only their own verified feature; another target requires main handoff. Main requires an explicit name. Record the request.

2. Inspect unmerged commits, tracked/untracked/ignored contents, locks and processes. Show authorized abandonment without reconfirming. Resolve unrelated owner files. Never commit or merge; preserve unrelated edits.

3. Record absolute checkout, branch, inspected tip and authorization in main’s enabled RUN or configured recovery record (routing exception). Record `Stream: dropped`, `Session: retired`, `Cleanup: pending` there and in feature STATUS; main STATUS omits lifecycle fields. Do not copy the abandoned notebook.

4. This bounded cleanup overrides startup-checkout deletion restrictions for the verified current feature only. From main, use absolute paths: recheck identity/blockers; move to Trash/Recycle Bin under the verified deletion policy below; verify recoverability/path absence; `git worktree remove <checkout>`; verify unregistration, unchanged branch tip and no other checkout; `git branch -D feature/<name>`. Verify branch deletion. Stop on failure/uncertainty; inspect before retrying. No force-removal, prune or permanent-deletion fallback.

5. Append the `Cleanup` result in main’s enabled RUN or configured recovery record and update surviving original feature STATUS: `complete` only with every cleanup check verified; otherwise `failed`, with partial state/recovery action. Retain dropped/retired. Report actual Trash/branch results, without promising Git history recovery. Close main's Reply/next Ask; carry only unfinished authorized cleanup. Never edit the Trash copy or recreate missing paths; recovery verifies completed steps and surviving identities.

6. Feature-rooted hosts use the retirement handoff below. Reject subsequent operations regardless of cleanup outcome; recovery requires a fresh main session. No directory fallback. Main-rooted hosts remain active.

## Retire one worktree

- Immediately recheck exact managed path/registration/branch, distinct from main, no lock, and outside this host's startup checkout/ancestor except authorized terminal cleanup after successful own-feature integration. Inspect all contents, including ignored files. Stop task-owned work only within existing authority and verify it stopped. Block for another coding session only with a foreign ownership claim or host metadata mapping a live session ID distinct from this conversation to the target. Cwd, process names, different PIDs and shared app-server ancestry do not establish session identity; idle shells and unmapped helpers do not block cleanup. Accept owner identity corrections and exclude this session and its helpers. If reliable session metadata is unavailable, skip process-based session detection; retain ownership and Git-lock checks. Never kill another session or clear its claim without explicit authority; age, silence and clean Git status do not establish release.

- Follow owner deletion policy: from main, use `trash <absolute-target>` or a verified platform Trash/Recycle Bin equivalent. Before alternative cleanup, prove recycle/restore and byte preservation on a task-owned disposable directory on the same volume, verify the actual target can be recycled and require refusal of permanent deletion; [Windows guidance](windows.md#reversible-cleanup) describes Windows constraints. Verify success, preserved recoverable contents and original path absent, then `git worktree remove <absolute-target>` to unregister only that missing checkout. No global prune/force/permanent-deletion fallback; unavailable or unproved reversible deletion stops cleanup. Inspect unknown results before retrying moves. Verify registration absent before branch deletion; failure leaves deletion pending. Never recreate/overwrite the path; Trash's `.git` link is no longer a live checkout after unregistration.

## Required handoff

Required invariant/backlog notices from SKILL.md accompany these handoffs before the template; other added text remains forbidden. Project-rules adoption does not authorize preparation commits, implementation or destination-session work.

Successful `new-feature`: save and display only this template, substituting verified values. `<absolute-feature-notebook>` is the verified absolute feature-notebook path; preserve existing notebook history. Except required notices above, no preface, explanation, link wrapper or closing text. This result replaces the general handoff below.

```text
1. Created `feature/<name>` from committed main

2. Exit this coding agent now.

3. Change into new working directory by running:

	 cd '<absolute-feature-checkout>'

4. Reopen the coding agent there, then open the new feature notebook and start working on the new feature:

	`<absolute-feature-notebook>`

This session still belongs to <original-session-directory>.
```

Retired feature-rooted `merge-feature` / `drop-feature`: save and display only this numbered template, substituting verified values. Item 1 states the actual operation result, merge commit/checks when applicable, and cleanup outcome: retained checkout/branch with no pending cleanup, or verified Trash path/unregistration/branch deletion, or exact partial state and next safe action. Never imply unproved success. Use `godev` for future work; incomplete authorized cleanup uses the exact recovery command in a fresh main session. Main-rooted results use item 1 only and keep the session active. A failed/unvalidated merge does not retire the feature; report the blocker and next action without an exit handoff.

```text
1. <verified merge/drop result and cleanup outcome>

2. Exit this coding agent now.

3. Change into main working directory by running:

	 cd '<absolute-main-checkout>'

4. For future work or cleanup recovery, reopen the coding agent there, open the main notebook, and send `<godev or exact recovery command>`:

	`<absolute-main-notebook>`

This session still belongs to <original-session-directory>.
```

Other handoffs: save and prominently show actual absolute paths and the exact next prompt, even when normal delivery is only a notebook receipt:

> **Exit this coding agent now.** Run `cd '<absolute-destination>'`, reopen the coding agent there, open `<absolute-destination>/<correct-notebook>`, and send `<godev or pending command>`. This session still belongs to `<original-session-directory>`; tool working directories do not relocate it. Do not continue destination work here.

End the turn. Continued messages in the old session trigger identity verification and the same handoff, not destination work. A new session verifies physical cwd, Git and notebook before recovery. No OS-level restart lock is claimed.
