# aglite 9.0.0-beta.1 — everyday guide

English · [繁體中文](AG_GUIDE.zh-tw.md)

Version `9.0.0-beta.1`. The skill is named `aglite`; this is the beta name for Agentflow 9.

Give the agent a goal, examples of success and anything it must preserve. Aglite keeps your request, answer and recovery notes together so you can return to unfinished work in another session.

The [cheatsheet](CHEATSHEET.md) lists every command, advisor and setting. This guide shows how to use them in everyday work.

## Finish your first task

Load the installed `aglite` skill, then send a request such as:

```text
godev fix the broken installation link in README.md
```

The agent checks the project, does the authorized work and checks its result. Small tasks usually need only the development notebook, called the devlog; larger work may also need a design and task tracker.

On first setup, aglite adds missing guidance to root `AGENTS.md` so the owner-facing agent can load the skill automatically in later sessions. Your existing instructions stay intact. Delegated workers follow their assignment without starting another aglite workflow.

Your host must support and honor that instruction. If automatic loading does not happen, load the skill and use `godev` yourself; a missing skill is reported rather than installed silently.

A fresh folder can use aglite without Git. Before setup writes in a folder without Git, the agent asks whether you want a repository there.

If you choose Git, it creates and verifies an empty first commit before continuing, unless you explicitly forbid commits. Your existing files stay out of that commit; approving Git setup does not approve a remote or publication.

If setup fails, the agent reports the blocker and preserves the partial state for your recovery choice. After setup started without a task, it asks for your next request.

## Return to unfinished work

Open the same project and send `godev`. The agent reads the active request and linked recovery notes, then checks the live files and any running operations before continuing.

You do not need to reconstruct the previous conversation. If a required record is missing or no longer matches the work, the agent reports that gap rather than treating the old result as proved.

If there is no unfinished work, the agent asks for your next request. Idle activation does not schedule backlog work or create another round of records.

Notebook ownership prevents two cooperating agents from writing the same notebook at once. If another session owns it, ask for a handoff; age or silence alone does not let the agent clear someone else's claim.

See [start and recovery](../references/session.md#activate-and-recover) and [notebook ownership](../references/session.md#notebook-ownership) for exact rules.

## Find your answer and records

The completed answer normally goes into the devlog's **Reply**, rather than chat. The default chat receipt looks like this:

```text
→ Updated: A-001 | .agentflow/example.devlog.md
  (/path/to/example)
```

Open the named notebook to read the answer and saved questions. To receive full answers in chat, ask to set `inline-reply: on`, or explicitly request a particular answer in chat or the terminal.

Required notices, blockers and actual feature handoffs can still appear in chat with `inline-reply: off`. A request about future output or the words “show me” alone do not change the answer destination.

New projects normally keep their notebook at `.agentflow/<short-dirname>.devlog.md`. The name comes from the checkout folder; existing names and history are preserved.

The notebook holds your **Ask**, the saved **Reply**, and **STATUS** with a **Current** link for unfinished work. You can write a request in the next Ask and activate it, or answer saved questions in chat or their `ans:` fields.

Designs and trackers live under the configured record directory when needed. A tracker shows the goal, task progress and a **Recovery** section with the next safe action.

Task labels are `TODO`, `DOING`, `BLOCKED` and `DONE`. Work awaiting checks, review or delivery remains `DOING`; `DONE` means completion has been proved.

Useful check results and debugging evidence are linked separately, normally from `.agentflow/.tmp/`. Despite that directory's name, linked evidence is durable: do not delete it merely because it looks temporary.

The devlog keeps the answer, important limits and recovery pointers; it does not repeat technical check logs. See [round evidence](../references/session.md#round-evidence) for other notebooks, custom destinations and exact retention rules.

Older completed rounds can move into one adjacent archive when the notebook grows beyond 750 lines, or when you request it. Unresolved work and the latest completed round stay available; renaming a notebook also includes its archive.

Future ideas may appear in `backlog.md` as proposed or deferred work. A backlog entry is a reminder, not permission to implement it; ask for a backlog review and choose what to do next.

## Steer current work or save a later batch

Ordinary follow-up messages correct or extend the current task. State the change directly, including any constraint that should replace an earlier one.

To save work for later, begin a separate message with:

```text
append-rounds Update the installation examples
```

One message creates one later batch, even if it contains several tasks. `append-tasks` means exactly the same thing; neither command adds work to a looper queue.

The agent finishes the current answer, approval gates and authorized delivery before starting the next batch in its own Ask/Reply round. Use `godev` to resume pending batches after an interruption; they do not wake a stopped host.

Send feature creation, merge or drop commands separately. A batch containing one of those commands is neither staged nor executed; resend the remaining ordinary work without it.

See [batch rules](../references/batches.md#append-rounds) for cancellation, ordering and recovery.

## Keep one exchange off the record

Include an unquoted `nolog:`, `noop:`, `off:` or `skip:` in your message to keep that exchange out of workflow records, including later summaries.

These markers still allow the requested work to execute. In particular, `noop:` does not mean “do nothing.” Your next unmarked message records normally.

An off-record append request is neither saved for later nor executed. Resend it without the marker if you want a later batch.

Quoted examples do not activate these markers or other task modes. See [routing rules](../SKILL.md#route-before-records).

## Choose the help your task needs

Use `fast-lane <task>` for direct work by the host. For that task, it skips advisors, ordinary delegation, new design/tracker creation, ordinary separate review and routine progress entries.

The agent still captures your request, checks and reviews its result, keeps recovery usable and delivers the authorized work. Explicit plans or reviews, configured approval gates and feature requirements still apply.

Use `skip-review <task>` when you want the host to review its own work while keeping the ordinary planning and execution steps. It waives ordinary separate review for that task, including the normal risk-boundary requirement.

Both modes follow one identified task through follow-ups and resume, then expire at completion. They change no project settings; a bare command needs clear unfinished work.

`skip-review` replaces earlier review requests for that work. A review explicitly requested in the same message or later still applies.

Use `grill-me <topic>` for an interview before committing to a direction. The agent first inspects context, then asks connected questions about the outcome, assumptions and strongest relevant challenge.

The interview includes at least one round for you to confirm or correct its understanding. It authorizes discussion, not implementation, and can be requested even during fast-lane work.

Use `advisors: requirements, explore` to request focused advice. Advisors answer named questions; selecting them does not authorize their proposed changes or require a separate worker for every role.

The [cheatsheet's advisor list](CHEATSHEET.md#commands--alphabetical) helps you choose a role. [Advisor guidance](../references/ag.md) explains how the agent limits and stops an investigation.

For a feature in unfamiliar existing code, `browfield <task>` selects an eight-step path from discovery through verification and preservation. It helps uncover existing rules and protect behavior before changes; it does not replace aglite's approvals, records or review.

Simply working in an existing repository does not select that path. See the [brownfield procedure](../references/browfield.md) when you need it.

## Plan and review in proportion to the work

Say “plan first and wait” when you want to approve the approach before implementation. Say “plan and implement” when both are authorized, subject to any unresolved material decision or configured gate.

Ordinary planning starts with the required outcome and accepted scope, then looks for the simplest adequate approach. You supply goals, constraints and examples; the agent derives technical paths and checks from the project and asks about material unknowns.

By default, plans are created when useful. The `plan-mode` setting can require a design and tracker before task edits, or prevent new designs while still allowing needed trackers.

Creating a plan and choosing who writes it are separate decisions. `plan-order` controls an already-needed plan; it does not create another planning stage.

Use `3ways <request>` for Claude to write the main plan and Codex to challenge concrete defects. The host keeps the main plan unless the challenge proves a high-confidence problem; this command does not approve implementation.

The other planning routes use an external CLI, a fresh native agent or the host directly. If a route is unavailable, the host reports the permitted fallback honestly; explicit provider, model, effort or independence constraints still apply.

Changed code, operational prompts, product artifacts and implementation-ready contracts normally receive result review after host checks. Ordinary questions and illustrative examples receive host review.

`review-order` selects the ordinary review route. Where separate review is required, the agent prefers a different model family from the known principal planner when supported; repeated or unknown family has a disclosed limit.

A fallback cannot satisfy a requirement for independence if it is not independent. Missing required checks remain unproved even if a reviewer likes the result.

`gate-design` adds approval before implementing a design. `gate-tracker` adds approval of checked results before final delivery when a tracker exists.

An empty answer or elapsed time never supplies approval. See the [settings reference](CHEATSHEET.md#agjson--switches--alphabetical), [planning rules](../references/planning.md) and [review rules](../references/review.md).

## Work on a separate feature

Send `new-feature <name>` to prepare a branch and Git worktree, a separate checkout where you can work without changing main's files. The usual paths are `feature/<name>` and `.wts/ft-<name>`.

Follow the returned numbered handoff. In Codex or Claude Code, it includes `/cd <feature-checkout>` followed by `godev`, plus the actual feature-notebook path to open; other hosts reopen at that location.

Running shell `cd` alone does not move the host session. Creating the feature also does not authorize unspecified implementation.

Send `merge-feature <name>` when the feature is ready to verify and integrate. The branch and checkout remain unless you explicitly add “and cleanup.”

Send `drop-feature <name>` to abandon it. The agent first inspects local work, then moves the checkout to verified Trash or Recycle Bin and deletes its branch; permanent deletion is not a fallback.

You may drop from inside the feature checkout, omitting the name when unambiguous. Follow the resulting main-checkout handoff for future work; partial failures include their exact recovery action.

Creation and merge use feature records; drop reports in chat. All three avoid main's root notebook and claim.

Main's unrelated edits remain protected. Real Git conflicts and target-feature ownership still matter.

A merged or dropped feature is retired. For cleanup limits, handoff templates and recovery, see [feature rules](../references/features.md).

## Run prepared groups with the optional looper

Use looper when you want a prepared work list divided into groups and executed in isolated worktrees. Ordinary tasks do not require it.

Give the host outcomes, examples and things to preserve. `prepare-tasks <request>` saves a linked queue, the original request and group plans, then stops for you to inspect them.

`run-tasks` starts or resumes that linked queue. `run-tasks <run-root>` selects another prepared queue, and `handle-tasks <request>` combines preparation and execution.

Configure looper routes before running; the bundled routes are empty. Routes choose the transport, provider and model catalog, while model choices remain in the shared model settings.

When choosing task routes, prefer an external CLI. An explicit native choice is retained; native dispatch needs the live host and does not silently switch providers when the host closes.

Groups run in separate worktrees. Tasks within a group run sequentially in fresh sessions; groups with dependencies wait for their earlier groups to be checked and integrated.

Ready groups enter one integration lane in arrival order. Questions pause only their group, so answer through the host while independent groups continue.

Queue progress and actual attempt choices are saved. Resume preserves unfinished work and reconciles previous writers before starting replacements; changed or missing preparation input blocks execution rather than changing the job silently.

Group notebooks stay in `.aglite-records/` and are excluded from product integration. Run records and worktrees remain after completion; preserve ignored records before any separately authorized cleanup.

Looper does not grant later cleanup, push or release authority. See the [looper contract](../references/looper.md), [retained files](../references/looper.md#retained-files) and [complete CLI/settings reference](CHEATSHEET.md#looper-cli--alphabetical).

## Change configuration deliberately

Project configuration lives at `<checkout>/<ag-dir>/ag.json`; `.agentflow` is the usual record directory. Ask the agent to change named settings, or edit the file deliberately.

The [cheatsheet](CHEATSHEET.md#agjson--switches--alphabetical) owns the complete settings list, accepted values and defaults. [Configuration rules](../references/configuration.md#discovery-and-validation) own discovery, validation and language behavior.

Use `use-lang` to choose the language of new agent-written chat and documents, including human template labels and receipts. An explicit target-language request overrides it; the language you happen to type does not.

Original input, history, machine syntax and established artifact languages stay intact. Changing the language setting does not translate your project's past.

Use `saving-mode: on` for minimum sufficient prose and fewer optional records. Requested detail, comprehension, required checks, approval gates and usable recovery still take priority; it does not change models or routes.

Check Git delivery settings before relying on automatic commits or pushes. `auto-commit` and `auto-push` are separate controls; ask for both to be `off` if you want neither.

Verified task changes and your own edits are committed separately. These settings do not authorize deployment, publication, external messages or unrelated changes.

Model settings select models and effort for already-chosen work; they launch nothing by themselves. Selected settings must be supported rather than silently replaced.

For Copilot, use the [Copilot guide](../references/copilot.md) to distinguish native editor controls from CLI capabilities. A successful CLI run does not prove native editor support.

### Migration and installation

When the host encounters a recognized Agentflow 8 project, it loads the separate migration procedure. Safe mappings run automatically; old approval policies, ownership conflicts or unsupported restrictions wait for your decision.

The host updates the project configuration and current STATUS, and removes only confirmed old project hook or startup units. It keeps your conversation history, foreign settings and a recoverable private backup.

Known aglite schemas 9, 10 and 11 also upgrade to schema 12. For example, `skip-wip: off` keeps its meaning as `omit-wip: off`; it does not become the missing-key default.

Review the saved migration result and restart the host when old integrations were loaded. Existing v8 queues or active streams need a handoff before their runtime is retired; they are not new looper queues.

See [legacy migration (legacy-migration.md, line 1)](../references/legacy-migration.md) for supported mappings and recovery, and [configuration upkeep (upkeep.md, line 5)](../references/upkeep.md#automatic-migration) for later formats. Replacing an installed skill still needs your explicit permission.

Install using the public [package README](https://github.com/agfnow/aglite#install). Choose one installation route per host and open a new session afterward; follow that route's update instructions when updating.

Release checks consult the Agentflow stable feed when due. Agentflow 8.x is not an upgrade from this Agentflow 9 beta, and discovering an update does not authorize replacement or publication.

See [release checks](../references/configuration.md#session-release-check) for timing and [upkeep](../references/upkeep.md) for replacement boundaries.

## Know what still needs proof

Aglite relies on the host following its instructions. Installed files and valid paths alone do not prove automatic discovery, unattended operation or support on every host.

The optional looper has its own runtime requirements. For Windows work, follow [Windows guidance](../references/windows.md); successful tests on another platform do not prove native Windows execution.

For browser journeys, the agent checks actual behavior under [browser testing rules](../references/browser-testing.md). Your project's tool preferences override the bundled browser defaults.

Accepted behavior changes also update affected maintained documentation and translations. Ask for `advisors: product-docs` when you need focused help with a documentation map, handover or substantial drift gap; the advice does not authorize publication.

System invariants are accepted guarantees the project must preserve. Changes to their registry produce a dedicated notice in both the saved answer and chat, even with short chat receipts; a path-only move produces a relocation notice.

For exact authority, start with the [skill](../SKILL.md), [shared project rules](../references/project-rules.md), [invariant policy](../references/invariants.md) and [delivery rules](../references/delivery.md). The [cheatsheet](CHEATSHEET.md) provides the complete command, advisor and setting lookup without turning this guide into a second contract.
