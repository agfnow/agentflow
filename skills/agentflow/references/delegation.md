<!--
`2026-08-11` This file holds the dispatch rules for every session running the agentflow skill's base layer: delegation options, the model family guide, delegation roles and SOP, delegate confinement, the background-process watchdog, giant-task plan tracking, three-way review, and the incident-log convention. It is the authoritative delegation rulebook for the session.
-->

# Devlog shared rules — delegation, confinement, and tracking

Read this file before selecting the first executor, drafting the first delegate brief, or dispatching — whichever comes first. Every rule here governs all dispatches in the session.

## Rules passed down verbatim

The two blocks in `SKILL.md`'s "Design and scope discipline" section — KISS and scope discipline — go into every subagent brief and every external delegate brief, word for word. That section is their canonical home; do not paraphrase them.

## Delegation options

- Every dispatch may use either executor: the host's built-in subagent mechanism, or an external CLI from a different model family (`codex exec` when the host is Claude Code; `claude -p` when the host is Codex). The coordinator chooses per dispatch at its discretion, subject to Delegate confinement below and the session's $cli_provider (SKILL.md Modes): the value `off` removes the CLI routes to other model families but never weakens confinement — when no built-in route can enforce a brief's required isolation, the same-host CLI (the host's own family: `codex exec` on a Codex host, `claude -p` on a Claude host) may run that one dispatch as the isolation mechanism; when even that cannot enforce it, fail closed and ask the owner. Substitutions are recorded per the fallback rule below, and a REQUIRED cross-family review (3ways) that cannot run cross-family drops to the strongest same-family option with the swap recorded (SKILL.md Modes, cross-family fallback rule — owner decision 2026-08-16, A-041). Under `any` (the default) the external-CLI routes are available; under a family name (`codex`/`claude`) see the full-outsource bullet below.

- **Mode pass-down:** the resolved $cli_provider binds delegates, not just the coordinator's own dispatch choice. When it is `off`, every delegate brief carries one explicit constraint line — "external model CLIs (`codex`, `claude`, …) are off for this session; do not invoke them" — so a subagent with shell access does not re-open the removed route on its own initiative. A brief line is a wish, not a control (see Delegate confinement), so the coordinator also checks the delegate's report and output for signs an external CLI ran, and logs any violation as an incident.

- **Full-outsource switch:** when the session's $cli_provider (SKILL.md Modes) names a CLI family (`codex` or `claude`), the per-dispatch discretion above narrows: every task outside the coordinator's reserved duties (briefs, verification by execution, final judgment, $target_doc and reports, Git operations) goes to workers of the named family, tiers chosen per the model family guide below. Confinement and the watchdog apply unchanged.

- Prefer a model family different from the model doing the surrounding coordination or coding when the dispatch is a review or acceptance.

- Prefer `gpt-5.6-luna/max` for low-level work (coding, mechanical edits, scans) as much as possible — it is the cheapest model with excellent quality.

- If a model the coordinator selected itself is unavailable on the machine, fall back to the nearest available tier in the guide below and record the substitution in the devlog round. If the unavailable model was an owner override, ask the owner and pause the affected work instead — never substitute silently (unless owner explicitly say so).

## Model family guide

This guide is the authoritative model routing for the session. Skills that name concrete example models must stay consistent with it; this guide wins on conflict.

- **Tier labels are not CLI ids.** The `<model>/<effort>` labels below are routing tiers; every actual CLI dispatch uses the provider's full model id (`codex exec -m gpt-5.6-luna`, `claude -p --model claude-sonnet-5`) — short names return an API error (HTTP 400 on codex, 404 model_not_found on claude).

- Claude family:

	- `opus-5/high`: main coordinator/orchestrator for long-running agentic tasks spending hours.

	- `sonnet-5/high`: default worker for coding or anything.

	- `fable-5/high` or `opus-5/high`: high-level planner, architect, or reviewer, occasionally invoked by the coordinator on hard problems.

- GPT family:

	- `gpt-5.6-terra/high`: main coordinator/orchestrator for long-running agentic tasks spending hours.

	- `gpt-5.6-luna/max`: default worker for coding or anything — prioritise this option as much as possible; it is the cheapest model with excellent quality.

	- `gpt-5.6-sol/high`: high-level planner, architect, or reviewer, occasionally invoked by the coordinator on hard problems.

## Delegation

**Goal: reserve the smartest model for coordination and final judgment, never for chores** (unless truly necessary).

- **Prioritise delegating actual code writing, bug fixing, and test running** to a model cheaper than the coordinator itself, through either executor per the delegation options above. Prefer `gpt-5.6-luna/max` for this low-level work (from a Claude host that means `codex exec -m gpt-5.6-luna` — always the full model name; short names return HTTP 400); the other family's worker tier (for example `sonnet-5/high` via `claude -p`) is the cross-family alternative.

- **Route by blast radius, not difficulty:** contracts, plans, and high-risk reviews go to the strongest model; well-specified transformations against frozen contracts go to cheap models. Cheap implementation output that an independent acceptance review already covers needs no extra review; for other cheap output, prefer a decorrelated adversarial review when the blast radius warrants it.

- **Top rule for external CLI delegation:** the delegate persists its response in a markdown artifact for you to read (remove or archive afterward if no longer needed). Never let it return an oversized inline payload, which might be truncated or corrupted.

**Roles (never blur them):**

- **Coordinator** (the strongest model in the session) writes the briefs, verifies everything by execution on the real machine, makes final judgments, and writes the devlog. The coordinator never skips its own verification — verification IS the judgment.

- **Implementer** — a cheaper worker chosen per the delegation options, preferring `gpt-5.6-luna/max` — writes code and long docs against a frozen brief, in a sandbox or background shell, and files a report artifact. It can rebut the coordinator with corrections; the two must reconcile until agreement.

**SOP, in order:**

1. Coordinator freezes a written brief before any implementation: the contract, the exact scope, acceptance checks, and what must not change. Small briefs — contract plus the needed view only, never the whole project context.

2. Implementer builds against the brief and files a report artifact. Its "done" is a claim, not a fact.

3. Coordinator verifies by execution: full test suite on the real machine, live probes of the actual behavior, and — for every bug fix — the reversed-fix check (put the old code back, keep the new tests, confirm exactly those tests fail, restore, confirm green).

4. For blast-radius work, buy a decorrelated review: a second independent model assesses blind, before seeing the coordinator's conclusion, using a high-level reviewer tier from a different model family (see the model family guide above). When no different-family worker is available (SKILL.md Modes, cross-family fallback rule), use the strongest same-family reviewer in a clean context — never the agent that produced the work — and record the swap. Blind agreement is strong evidence; recorded disagreement becomes an experiment, not a coin flip.

5. Every bug fix carries its regression test in the same commit. Every claim in a report is checked against the file or run it cites before being believed.

6. All human questions are batched at the end of a devlog round, each with a suggested default. Commit per milestone and **PUSH** immediately, so a dead session costs nothing.

## Delegate confinement — a control, never a prompt

**A rule a delegate can ignore is not a rule, it is a wish.** Written bans ("do not touch `devlog.md`") sat in briefs for days and were violated anyway — one reviewer overwrote the STATUS block, then re-injected itself after the repair. Take the ability away instead of asking for restraint. Mandatory in every mode.

- **Two shapes, chosen by whether the delegate must WRITE — for any executor:**

	1. **Read-only review — the default:** an environment kept read-only by a mechanism outside the model — the operating system's sandbox where the executor offers one, otherwise the CLI harness's tool restriction. The refusal then comes from the platform, not from the model choosing to behave. Prefer the OS-enforced shape when more than one executor is available.

	2. **Anything that must write — including a reviewer that must run the tests:** a disposable working root (a throwaway clone, or a git worktree) with the real checkout outside its writable area; merge what you want afterward. A worktree shares Git metadata with the main checkout, so inspect status, diffs, and refs before accepting its work.

- **Codex CLI shape (OS-enforced):** read-only is `codex exec -m gpt-5.6-luna -c model_reasoning_effort=max -s read-only --ephemeral -o <findings-file> "<prompt>" < /dev/null`. Swap the model/effort only when the brief demands a stronger reviewer. `--ephemeral` leaves no session files behind; `-o` writes the findings outside the sandbox, so they come back however tight the cage; `< /dev/null` closes the keyboard channel (a delegate waiting on the keyboard hangs forever at zero CPU). The writable shape adds `-C <worktree>` under the ordinary `-s workspace-write`.

- **Claude CLI shape (harness-enforced):** read-only is `claude -p --model <model> --effort <effort> --permission-mode plan --tools Read --no-session-persistence "<prompt>" < /dev/null > <findings-file> 2> <error-file>`. `--tools Read` removes every built-in tool except file reading from the run, so write and shell tools do not exist for the delegate; the Claude CLI enforces this, not the operating system — one notch weaker than the Codex cage, so prefer the Codex shape for untrusted review when both CLIs are installed. The writable shape runs in a disposable clone or worktree per shape 2. Check the CLI's help before relying on a flag after an upgrade — flag names change.

- **Built-in subagents:** use the host's own isolation (a read-only tool restriction, or a disposable working root) when the host can enforce it; when it cannot, route untrusted or write-heavy delegate work through the external shapes above. A built-in subagent that must write gets a disposable working root (the host's worktree mechanism) whenever the host offers one — "git can recover it", a small blast radius, or a coordinator diff review is not confinement. — incident 2026-08-14: two e2e coordinators rationalized coding and scanning delegates directly in the real checkout on exactly those grounds.

- **A delegate that writes only its own report is read-only work:** keep the checkout read-only and deliver the report through the executor's outside-sandbox channel (Codex `-o`) or coordinator capture; never grant workspace-write on the real checkout just so a reviewer can drop its report file inside the repo.

- **`--add-dir` widens READING, not writing** — incident 2026-08-03: measured directly, correcting an earlier wrong rule. Under `-s read-only` a delegate handed such a folder and told to write one file answered `EPERM` and left it empty; three reviews in one night silently fell back to reading source because of this. Its one real use: under `-s workspace-write`, naming a parent folder the delegate legitimately needs outside its checkout. **Never loosen the sandbox instead.**

- **A sandbox changes the behaviour of the program under test, and no flag fixes that.** The process table is unreadable under both `-s read-only` and `-s workspace-write`, so tests touching real operating-system behaviour fail for every delegate whatever flags you use (measured on the origin project: roughly 120 tests). **A delegate's test numbers are therefore never evidence — the coordinator runs the suite personally, every time.** Five delegates in one night reported failures that were entirely their own cage; all five trees were green when the coordinator ran them. Route accordingly: reviews and mechanical transformation to a confined `codex exec`; **pilots and anything exercising real operating-system behaviour need an unsandboxed runner.**

- **A delegate is finished only when its process is gone.** A complete-looking artifact is not completion — one review kept writing long after its findings file looked done.

- **Never `--dangerously-bypass-approvals-and-sandbox` for a review.** It defeats everything above. If a task appears to need it, that is the human's decision, not yours.

## Background-process watchdog — never wait on a hung delegate

- **MUST — a non-interactive session never ends a turn to wait.** In a print/headless session (for example `claude -p`, an SDK run, or any host that does not re-invoke on notifications), returning from the turn ends the session and no notification can wake it. Treat the session as non-interactive from the FIRST of these signals, and permanently for the rest of it: (1) the launcher or owner says so in any prompt; (2) the owner is declared away and the ask arrived as a single scripted message; (3) a background wait ever returns "stopped / no completion record" while the delegate process is confirmed alive — that wake pattern is session teardown, not delegate failure. A session that cannot rule out being non-interactive treats itself as non-interactive before ending any turn with work pending. Do not return while a delegate is pending, and do not re-arm a cross-turn wait: run the delegate synchronously, or poll its actual process to completion inside the same turn under the stated deadline, and split the dispatch when that bounded execution cannot fit. Track the delegate process itself — completion of a launcher, shell wrapper (`nohup … &`), or notification setup is never delegate completion. Before any turn ends in such a session, commit verified completed work first. — incident 2026-08-14: five headless e2e sessions died mid-pipeline "waiting" on backgrounded advisors; three consecutive resumes re-armed the same wait and died again (a livelock), and one death left a green, fully verified implementation uncommitted.

- **MUST — no wait without a deadline, ever.** Never end a turn whose only wake signal is one background task's completion notification. A hung task fires nothing — incident 2026-08-01: a hung test suite fired no completion signal and cost ~10 silent hours. Whenever anything is still running in the background at turn end, ALSO arm an independent fallback wake (a heartbeat loop, or any timer the harness offers) that fires within 20–30 minutes at most, scaled to the task's normal duration (a ~1-minute test suite gets a ~5-minute fallback, not 30). When the fallback fires and the task is not done, treat it as a suspected hang: check the three signals below, kill-and-diagnose if static, and write a devlog checkpoint either way.

- **Always close the keyboard channel:** append `< /dev/null` to any CLI that might read stdin (`codex exec` does). A backgrounded process waiting for keyboard input hangs forever with zero CPU.

- **Never pipe a long-running command through `tail`/`head`/`grep` at launch** — that hides all interim output until the command ends, making a hang invisible. Let output stream to the task's output file; filter when reading, not when writing.

- **Arm a watchdog immediately after launch.** Within 2–3 minutes, verify the delegate is really working; then re-check every ~10 minutes, on three signals:

	1. Output file growing? (`wc -c` now vs. before)

	2. Process consuming CPU? (`ps -o pid,time,%cpu -p <pid>` — cumulative TIME under ~2 seconds after 10 minutes of wall clock means hung, not thinking)

	3. Working tree or expected artifact changing? (for implementers: `git status --short`)

- **Declare hung when ALL THREE are static across two consecutive checks** (roughly 10–15 minutes total). Then, in order: read the FIRST lines of its output (the hang cause is usually printed there — a stdin prompt, an auth prompt, a network retry), kill the process, fix the invocation based on the diagnosis, and relaunch. Never wait longer "just in case" — a healthy high-effort model shows CPU and output within minutes.

- **Set an explicit deadline per delegation** (default: 60 minutes for an implementation pass, 30 for a review). On deadline: kill, salvage whatever partial artifact exists, and either relaunch with a narrower brief or split the work.

- **Log every hang, kill, and relaunch** to the devlog with cause and fix — a silent retry hides an operational defect.

## Giant-task plan tracking — four layers, always

**When a task is big enough to have phases (a multi-phase plan, a large refactor, anything spanning hours), track it in ALL four layers — never rely on session memory:**

- **Layer 1 — the frozen plan:** before any implementation, write the plan as one artifact file (`artifacts/<ask-id>-<name>-brief.md`) containing the contract, the phases, what must not change, and a deliverables checklist. Review it (adversarially if blast-radius), then freeze it — the contract text is immutable after approval; only its deliverables checklist may be updated, ticked at the moment each phase is verified, not at the end. The plan document must never say "unstarted" about finished work.

- **Layer 2 — the progress trail:** after every verified milestone or incident, append a `## [WIP-NNN] Checkpoint — <YYYY-MM-DD HH:MM> (during round A-NNN)` block (per SKILL.md's checkpoint shape) to the devlog with what happened and the commit hash.

- **Layer 3 — the recovery trail:** one git commit per verified milestone, pushed immediately, with a state-naming message. A fresh session must be able to reconstruct the arc from `git log` + STATUS alone.

- **Layer 4 — the in-session task list:** keep the harness todo list current, but treat it as ephemeral — it dies with the session, so it is never the only layer.

- **Order discipline:** commit the implementer's tree BEFORE running any reversed-fix or destructive verification step; never use a whole-file git restore while uncommitted delegated work is in the tree.

## Three-way review, or "3ways" (brain_1 + brain_2 + human)

**Core rule:** use the two most capable models from different model families (the high-level reviewer tiers in the model family guide above) to review each other's plans and debate over multiple rounds until agreement — then dispatch a cheaper model for the actual implementation per the Delegation rules.

- **Trigger — use the full three-way when ANY of these is true:** the user says `3ways` or similar; you are making big plans with great blast radius and are not sure the content is right; the work touches multiple subsystems, or a wrong contract would cascade into many later changes.

- **Human** holds all authority: asks the initial request, monitors the debate, makes final decisions.

- **brain_1** (the strongest model controlling the session) either writes the initial plan for brain_2 to review, or — better — asks brain_2 to write its own plan blind. It then debates brain_2 over multiple rounds until agreement, and writes the final plan. When stuck, escalate to the human, then continue.

- **brain_2** (a different family, e.g. `codex exec` with `gpt-5.6-sol/high`; when no different family is available, the strongest same-family model in a clean context per SKILL.md's cross-family fallback rule, with the swap recorded) reviews adversarially or plans independently, writing its output to an artifact markdown file — never a big inline payload. Apply Delegate confinement to brain_2 like any other delegate.

## Incident-log convention — pin evidence to hard rules

**Every new or materially changed hard rule (MUST / NEVER) born from a real failure carries the incident that created it: one dated line, inline, next to the rule.** A rule with a cited incident never gets "simplified away" by a later cleanup pass, because the cost of the rule's absence is recorded right beside it.

- **Format:** `— incident YYYY-MM-DD: <what happened, one sentence>`. Canonical examples in this file: the 2026-08-01 hung test suite (watchdog section) and the 2026-08-03 `--add-dir` measurement (confinement section). Grep `— incident` to list every evidence-backed rule.

- **When adding a new hard rule created by a real failure, add its incident line in the same edit.** A rule born from reasoning alone carries no marker: its text must state everything the reader needs on its own, and its origin lives in the devlog history.

- **When editing or removing any hard rule, read its incident line first** and confirm the change cannot reopen that failure. A rule whose incident line you cannot explain is a rule you are not yet allowed to change.

- **Incident lines are append-only facts:** correct them only when a new measurement supersedes the old one, and then say so in the line itself.

- Scope: this skill, every other skill, and every brief that states hard constraints. Pass the convention down to delegates that author rule documents.
