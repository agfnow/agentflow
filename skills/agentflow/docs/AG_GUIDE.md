# Agentflow — the plain-language user guide

This page explains how to use agentflow in everyday words, with examples. It assumes you have never used it before. The rulebook for the AI lives in `SKILL.md`; you never need to read that file to use the system.

## Key Terms

	- protocol: the `devlog` protocol which initialize default devlog.md and keep updating it.

	- pipeline: the `agentflow` SDD pipeline with 9 standard SDLC steps (requirements, spec, acceptance...), applied strategically.

## The one idea behind everything

- **You and the AI talk through a notebook file, not through the terminal.** The file is called `devlog.md` and it sits in your project folder.

- You write your request into the notebook. The AI does the work, then writes its answer into the same notebook, right under your request. Everything both of you ever said stays on the page.

- Why a file instead of the terminal: the terminal forgets, the file remembers. Every decision, question, and result is saved in Git, so you can read back the whole history any time, from any computer.

## Getting started — one word

1. Open your project folder in the terminal and start the AI (for example, run `claude`).

2. Type the single word `godev` and press enter.

3. **First time in a project:** the AI creates `devlog.md` for you. At the top of the file it prints a settings line that looks like this:

	```
	Settings: target_doc=devlog.md, lang=English, auto_reply=off, ask_names=off, cli_provider=any, runlog=on
	```

	It also leaves an empty "Ask" section at the bottom of the file. That empty section is where you type your next request.

	And it asks you one small question: "what short code name should this project carry?" — see the nickname section just below.

	**If your folder is not yet under Git** (Git is the save-history system that keeps every version of your files, so nothing is ever lost), the AI asks one more question: "set it up for you?" The suggested answer is yes — with Git in place, every round of work is safely saved, and the AI can recover the full story even after a crash. It never sets Git up without asking you first.

4. **Every time after that:** `godev` just means "look at the notebook and continue". The AI reads the file, finds your newest request or unanswered question, and gets to work.

## Give the project a nickname — so you always know which notebook you are in

- **The problem this solves:** when you work in several projects at once, every notebook is a file named `devlog.md`, and they all look alike. It is easy to open the wrong one and type a request into the wrong project.

- **The first time the notebook is created, the AI asks you one question:** what short code name should this project carry? It suggests the project folder's name as the default, so answering "yes" is enough.

- **Your answer is saved at the top of the notebook, in the STATUS section, forever.** It looks like this — a short code name, plus a one-line description in any language you like:

	```
	Project: aglite — the agentflow skill and its user guides
	```

- **Change it any time** by saying so in a request, in plain words. There is no special syntax to learn.

## Renaming the notebook — even in the middle of a project

- **The problem this solves:** the nickname above helps once the file is open, but your editor's tab list still shows five files all named `devlog.md`. If you want the filename itself to say which project it is, rename the notebook.

- **How to rename it:** write one line anywhere in a request — `target_doc: ag.devlog.md` — with the new name you want. That is the whole procedure. The AI renames the file in a way that keeps its full history attached, renames the archive file to match, and confirms "old name → new name" in its answer.

- **Recommended name shape: your project code in front, the word `devlog` kept in.** For example `ag.devlog.md` or `shop.devlog.md`. Your editor tabs become instantly tellable apart, and anyone glancing at the folder still recognizes the file as a notebook.

- **What about new sessions that go looking for `devlog.md`?** The AI leaves a one-line forwarding card at the old address, like the note a post office keeps for a moved house: `Moved to: ag.devlog.md — write your asks there.` A fresh session finds the card, follows it, and continues in the real notebook. It will never create a second empty notebook next to your renamed one.

- **If someone accidentally writes a request into the card,** it still gets answered — the AI carries the text into the real notebook and notes the mix-up. No request is ever lost.

- **Old pages that mention the old name stay as they are.** They are history, and history is never rewritten. The notebook's STATUS section gains one line recording the rename, like `Renamed: devlog.md → ag.devlog.md (2026-08-14)`.

## Do I have to type `godev` for every message?

- **No. You type it once per session.** A session is one run of the AI program in your terminal. After the first `godev`, the notebook protocol stays on for the whole session — everything you say next is handled under it and recorded in `devlog.md`.

- **You do type it again when you start a new session** — a new terminal window, a restart, or after you clear the conversation. It is one word, and it also means "pick up exactly where we left off", so nothing is lost between sessions.

- After the first `godev`, you can talk in two ways, and both work:

	- **Type directly in the terminal.** The AI does the work and records the request and the answer in the notebook.

	- **Write into the notebook itself.** Open `devlog.md`, type your request into the empty Ask section at the bottom, save, then type `godev` or `continue` in the terminal to tell the AI "I wrote something — go read it".

## How a conversation round looks

- Your request gets a number, like `A-007`. The AI's answer appears right under it, marked with the same number. One request plus one answer is called a round.

- When the AI needs your decision, it never interrupts you mid-work. It collects all its questions at the end of its answer, and under each question it writes a suggested answer and an empty line like this:

	```
	- ans:
	```

- You type your answer after `ans:`, save the file, and type `godev`. The AI reads your answers and continues. If you agree with the suggestion, answering just "yes" is enough.

## The settings — what they are, how to see them, how to change them

There are six settings. You never have to touch them; the defaults work. But they are always visible and always one line away from changing.

- **See them:** the settings line sits at the top of `devlog.md`, in the STATUS section, and it is refreshed after every round. Or type the single word `settings` — the AI writes a card into the notebook listing every setting, its current value, what it does in one sentence, and the exact line to type to change it.

- **Change one:** write a line like `auto_reply: on` anywhere in your request. The AI confirms the change in its answer, in the shape "old → new".

- **What each one means:**

	- **`target_doc`** — which file is the notebook. Default: `devlog.md` in the project root. You rarely change this by hand; the team feature below manages it for you.

	- **`lang`** — the language the AI writes in (answers, documents, commit messages). It is detected from your computer's system language the first time. Change it with a line like `lang: 繁體中文`.

	- **`auto_reply`** — may the AI answer its own routine questions and keep working without waiting for you? `off` (the default) means every question waits for you. `on` means it picks the suggested answer and keeps going — useful when you leave it working overnight. Four things always stop and wait for you no matter what: decisions only the owner can make, anything that cannot be undone, anything that would leave your machine through a new channel, and anything over the agreed spending limit.

	- **`ask_names`** — should each request heading show who wrote it? `off` (the default) shows just the number, like `# → Ask / A-018`. `on` adds the asker's name, like `# → Ask / A-018 (John)` — useful when several people write into one shared notebook. The AI uses the name you state in the request; if you state none, it uses your Git name, and as a last resort your computer login name.

	- **`cli_provider`** — the one switch for "who does the work." It has four values:

		- **`any`** (the default) — the AI decides job by job who does each piece of work, and it may hire outside AI programs already installed on your machine (like `codex`) as extra workers. This is the normal, everyday behavior.

		- **`off`** — built-in workers only, on any machine. The AI still decides job by job what to hand off, but it never starts a program from ANOTHER company. One narrow exception keeps safety intact: when a job truly needs an isolated worker and no built-in worker can be isolated well enough, the AI may use the SAME company's own command-line program (for example `codex exec` when you launched Codex) purely as the isolation cage for that one job — it never reaches outside your one subscription. If even that cannot give the needed isolation, the AI stops and asks you instead of doing it unsafely.

		- **`codex`** or **`claude`** — the full-outsourcing setting. The AI you launched only manages: it writes the work orders, checks every result with its own hands, and writes the notebook and reports — and every piece of actual labor (code, documents, research) goes to cheaper workers from that one named family. Use it when you want a strong model supervising while a cheaper family does all the labor. Only truly tiny edits stay with the manager, and it says so in its answer each time.

		- **One safety detail worth knowing:** some checks prefer a second AI from a DIFFERENT company to double-check the first (a "cross-family" review). Most people hold only one subscription, so when your setting leaves no different-company worker available — that is `off`, or a family name that is the same company as the AI you launched — the review still runs: it goes to the strongest model of your own company, started fresh with an empty memory so it cannot share the first AI's blind spots, and it is never the same AI that did the work it is checking. The swap is always written into the notebook round, never done quietly.

	- **`runlog`** — should the AI keep a second, machine-readable event log during full development jobs? `on` (the default) means it writes `runlog.md`, a detailed record of every worker it hired, every check result, and every automatic answer — useful for auditing exactly what happened. `off` means it skips that file; your normal notebook (`devlog.md`) is still the full human record either way. This setting only matters during full development jobs; for plain questions and small chores no such log is ever made. You can also write `runlog: false` for off and `runlog: true` for on.

## Going `all_in` — asking for the full ceremony on one job

- **The problem this solves:** for small jobs the AI is allowed to take shortcuts — skip optional review steps, shrink the paperwork — so you are not paying for ceremony a one-line fix does not need. But sometimes a job LOOKS small and is actually important, and you want every check to run and every document to be written, no shortcuts at all.

- **How to ask for it:** put the word `all_in` (with the underscore) anywhere in your request. For example: "go `all_in` on this job: add a delete button to the invoice page." The underscore is what makes it a command — the ordinary English words "all in" do nothing, so normal sentences can never trigger it by accident.

- **What the word guarantees, exactly:** the full development process runs; the AI may not propose or take any shortcut route; every optional checking step runs (the risk explorer, the technical experiment, the security scan, the lessons write-up); and no required step is allowed to shrink — each one runs at full depth and leaves its full document behind.

- **It covers that one request only.** The next request goes back to normal, where the AI sizes the effort to the job. There is no setting to turn off afterwards.

## Working alone on one thing at a time — nothing special to do

- Just write what you want in the notebook. For example:

	```
	+ Please build a small tool that reverses a string, with tests.
	```

- The AI plans, builds, tests, and reports — all in the notebook. When the piece of work is finished, its conversation pages are moved into that feature's own folder, and the main notebook stays short and readable.

## Working on features in parallel, or in a team — the notebook splits by itself

Here is the whole feature in one sentence: **when several pieces of work happen at once, each piece gets its own private notebook in its own folder, and the main `devlog.md` becomes a table of contents pointing at all of them.**

You never create folders and never learn any path rules. Here is what it looks like in practice.

- **Example story:** you and a teammate share one project. You are building a login page on your own Git branch; the teammate is building a search box on theirs.

- **Step 1 — you say what you want, in plain words.** In the main notebook (or the terminal) you write something like:

	```
	+ I'm starting the login page on this branch. Open a separate devlog for it — my teammate is working on search at the same time.
	```

	Any wording works. There is no magic phrase to memorize. And even if you say nothing, the AI notices the signs of parallel work on its own (for example, you are on a feature branch, or another piece of work is already active) and offers: "want a separate notebook for this?" — you just answer yes or no.

- **Step 2 — the AI builds everything.** It creates a folder for the feature, puts a fresh `devlog.md` inside it, copies your request into that new notebook word for word, and leaves one line in the main notebook that says where the new notebook lives. You watch this happen; you do nothing.

- **Step 3 — you keep talking exactly as before.** On your branch, you just type `godev`. The AI checks which branch you are on and opens the right notebook by itself. You never remember the path. If it genuinely cannot tell which piece of work you mean — say, two pieces of work live on the same branch — it asks you one question instead of guessing.

- **Wrote in the wrong file by mistake? It does not matter.** The AI answers wherever you wrote, and points out the mix-up. No request is ever lost because it was typed in the wrong place.

- **Merge day — there is nothing to do.** Your notebook and your teammate's notebook live in different folders, so Git merges them side by side with no conflict. After the merge, the AI refreshes the table of contents in the main notebook so it lists both finished pieces of work.

- **For teams that always work this way:** one line in the main notebook's STATUS section — `streams: always` — tells the AI "every piece of work gets its own notebook from now on, don't ask each time". Set once, applies forever.

## Do I need a new branch or a worktree to start a feature?

Short answer: **usually no.** A branch, a worktree, and a separate notebook are three separate tools, and each one is optional. Here is what each one is, and when it starts to be worth having.

- **Working alone, one feature at a time — just write the wish.** Stay where you are, write the request in the notebook, done. No branch, no worktree, no separate notebook. When the feature finishes, its conversation pages archive into the feature's own folder by themselves.

- **A branch** is a parallel line of history inside the same project. Work on it stays out of everyone's way until you merge it back, and you can abandon it cheaply if the feature dies. You want one when the work is experimental, long-running, or happening at the same time as someone else's work.

- **A separate notebook (a "stream devlog")** keeps one feature's conversation in its own file. You want it exactly when two conversations would otherwise mix in one file — the parallel-work case. Saying "new branch + separate devlog" in the notebook is enough; the AI builds both and you never type a path.

- **A worktree** is a second physical folder on your disk showing a different branch of the same project. Without one, switching branches swaps the files in your one folder back and forth; with one, both branches sit on disk at once, in two folders. It is genuinely useful in exactly two cases: you want to keep working in your main folder while an AI worker builds the feature in the other folder at the same time, or you switch between the two pieces of work so often that the constant file-swapping hurts. Otherwise it is extra weight — one more folder to remember, and it is easy to type a command in the wrong one. Also worth knowing: the AI already gives its hired coder workers their own throwaway worktrees as a safety cage, automatically — you get that benefit without asking for anything.

- **The rule of thumb:** solo and sequential → just write the wish. Parallel with anyone — a person or a background AI worker — → say "new branch + separate devlog". Add "worktree" only when you want both folders on disk at the same time.

## Which AI models can run agentflow — measured, not guessed

- These recommendations come from a live eval battery (2026-08-16): each model actually ran agentflow jobs and was graded by a strong judge from the other model family, and every failure was audited by hand. On every model tested, all the SAFETY behaviors held (refusing hostile instructions planted in files, hard stops, honest failure reporting); what separates models is record hygiene — mostly the one-line terminal rule.

- **On a Claude subscription:** use the strongest frontier tier (`fable-5`/`opus`-class at high effort) as the session master — it ran the full pipeline clean. The cheap floor is `sonnet-5` (medium effort is fine): it works, and the two rule reminders it used to need (the one-line terminal rule and the old→new settings confirmation) are now built into the skill text itself — in a 2026-08-16 re-test with the updated skill, `sonnet-5` at medium effort passed all the basic jobs clean with no extra setup. Do not use `haiku`-class models as the master: in testing one silently replaced the notebook rename with a new file, which destroys the history chain.

- **On a Codex subscription:** use `gpt-5.6-sol` at high effort as the session master — it passed everything clean. The cheap floor is `gpt-5.6-luna` at MAX effort (not medium — at medium it stopped offering the version-control setup question). Older `gpt-5.4`/`gpt-5.5` at high effort mostly work too, with the same terminal-line caveat. One honest luna caveat from the 2026-08-16 re-test: even with the strengthened skill text, luna sometimes still prints a summary line to the terminal and sometimes stamps a wrong model name instead of `metadata unavailable` — if you run luna as the master, turn on the skill's Stop-hook (it rejects a multi-line terminal from outside the model, so the habit cannot slip through).

- **Local models through ollama:** the plumbing works, but small models (≤9GB class) ignored the protocol entirely in testing — they answer like a chat assistant and never keep the notebook. Wait for tool-trained 20B+ local models before trying this for real work.

## If you remember only four things

- Type `godev` once per session; write requests in `devlog.md` or the terminal, whichever you like.

- Answer questions on their `- ans:` lines; a plain "yes" takes the suggestion.

- Type `settings` to see the six switches; change one with a line like `auto_reply: on`.

- For a new feature worked on in parallel with anyone, say "new branch + separate devlog"; solo sequential work needs nothing special.
