# agentflow

A file-logged way of working for AI coding agents (Claude Code, Codex, and compatible hosts).

- **What it does:** the agent converses with you through a plain text record file (`devlog.md`) instead of the terminal. Every ask, answer, decision, and commit lands in the file, so the whole project history is auditable and any dead session recovers from the record.

- **Two layers:** a base conversation protocol (rounds, STATUS, Git discipline, delegation rules) for any task, and an on-demand development pipeline (requirements → specification → implementation → acceptance) that loads only when a wish changes product behavior.

## Install

- **As a skill (Claude Code, Codex, and other hosts):**

	```
	npx skills add agfnow/agentflow
	```

- **As a Claude Code plugin (auto-updates on new releases):**

	```
	/plugin marketplace add agfnow/agentflow
	```

## Use

- Type `godev` (or `/devlog`) in a session to activate the protocol; type `ag` to force the full development pipeline on a wish.

- The full user guide ships with the skill: see `skills/agentflow/docs/AG_GUIDE.md` (English) and `skills/agentflow/docs/AG_GUIDE.zh-tw.md` (繁體中文), including which AI models are strong enough to run it.

## Which models can run it

- Measured recommendations live in the guides above. Short version: run the master on a frontier tier (Claude `fable-5`/`opus-5`, or GPT `gpt-5.6-sol` at high effort); `sonnet-5` and `gpt-5.6-luna` (max effort) are the tested floors.
