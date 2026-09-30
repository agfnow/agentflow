# Agentflow v8.4.1

**English** · [繁體中文](README.zh-tw.md)

Give your AI assistant a project notebook, so tomorrow’s conversation can pick up today’s work.

Agentflow has verified integrations for **Codex and Claude Code** and a portable core for any host that provides file and command tools plus enough state retention for capture and closeout. It keeps your requests, decisions, progress, and results in a readable file. You can use it to improve a document, fix a bug, or carry a larger project across several sessions.

- **Start simply:** Type `godev`, then describe the task in your own words.

- **Find the result:** Open the notebook named in the assistant’s closing message, usually `.agentflow/devlog.md`.

- **Get help quickly:** Ask your agent, “How do I use the Agentflow skill for this task?” It can explain the controls using your actual project.

## Install

You need Node.js 18 or newer and a host with file and command tools. Codex and Claude provide verified hooks; a generic host uses an explicit safe ID, optional known family, and manual capture/closeout because hooks are not available. Git is needed for version history, feature workspaces, and some installation methods. Ordinary notebook work can use a folder that is not a Git repository.

Run this in a terminal and choose your assistant and installation scope:

```sh
npx skills add agfnow/agentflow
```

For the Claude Code plugin route, add the marketplace in Claude Code:

```text
/plugin marketplace add agfnow/agentflow
```

Then install the `agentflow` plugin from that marketplace. Plugin updates follow your [Claude Code marketplace update settings](https://code.claude.com/docs/en/discover-plugins#configure-auto-updates). Start a new assistant session after installation or updates.

## Choose the main model

For Codex, we recommend **`gpt-6.1-sol/medium` as the most stable coordinator choice in their use**: model `gpt-6.1-sol`, reasoning effort `medium`. The coordinator is the assistant you talk to; it organizes the task and checks the result. This recommendation does not change your model settings automatically. [Official model reference](https://developers.openai.com/api/docs/models/gpt-6.1-sol).

## Keep it updated

If you installed through `npx skills add`, periodically run:

```sh
npx skills update agentflow
```

The [Skills CLI](https://github.com/vercel-labs/skills#skills-update) takes the installed skill name for updates. `agfnow/agentflow` is the installation source, so `npx skills update agfnow/agentflow` is not the current name-based update syntax. Add `-g` for global installs, or run from the project with `-p` for project installs.

We recommend a weekly **crontab** job on macOS or Linux if you want automatic updates. Ask your agent to set it up for your installation. The [guide](skills/agentflow/docs/AG_GUIDE.md#keep-the-skill-up-to-date) includes a Monday-morning example, explicit paths, and logging.

## Try it

Send this to your assistant:

```text
godev
Rewrite the welcome page for someone visiting for the first time.
Keep the existing links. Let me review the result before uploading it.
```

Small tasks can stay simple. `fast-lane` keeps one task with the main assistant and skips separate review while retaining necessary checks and self-review. `cross-check` requests a separate review of finished work; `review-policy: prefer-independent` permits a clearly labelled host review only after separate-review unavailability, while `require-independent` stays strict. `ag` requests the full development process when the project’s `allow-ag` setting permits it.

The notebook keeps the conversation, so a fresh session can resume an unfinished request with `godev`. With Git, Agentflow normally commits completed work and pushes when a remote exists; tell it when you want local work only.

## Shared notebooks

`notebook-ownership: on|off` is optional and defaults to `off`, including when omitted. On gives one session control of an active notebook round; off allows sessions to mix messages, decisions and replies. Both modes retain file locks, safe paths, current-round checks, unchanged snapshots and stream routing. Off preserves existing ownership records. Use `notebook-ownership: on` when a notebook may be shared. Turning it back on may require explicit recovery of a retained record; no noticeable startup speed gain has been proven.

## Check installation

Ask your agent to run `agf setup`, or run it in a terminal if the shortcut is available. `agf setup --fix` can add missing shortcuts after backing up shell settings. An unavailable optional worker does not mean installation failed. Follow any restart notice after project hooks are installed.

<details>

<summary>If the agf shortcut is missing</summary>

For a global installation at one of these locations, run the matching setup file. For another installation location, ask your agent to locate its installed skill first.

```sh
node "$HOME/.codex/skills/agentflow/scripts/setup.js"
```

```sh
node "$HOME/.claude/skills/agentflow/scripts/setup.js"
```

</details>

## Windows and contributor tests

- Installation does not require running the regression suite. Contributors can find the test commands in the [script reference](skills/agentflow/scripts/README.md).

- Portable core tests are verified on native Windows with Node.js 24. Tests requiring Unix terminals or process controls are explicitly skipped. The background looper is not supported on native Windows.

## Read next

- [Everyday user guide](skills/agentflow/docs/AG_GUIDE.md), with the YouTube introduction.

- [繁體中文使用指南](skills/agentflow/docs/AG_GUIDE.zh-tw.md).

- [Changelog](docs/CHANGELOG.md), newest version first.

- [Script reference](skills/agentflow/scripts/README.md), for technical setup and recovery.

Project settings live in `ag.json`, using the version-8 configuration format. Type `settings` to inspect them. Existing v7 files migrate conservatively when opened. `allowed-worker` is an unordered permission list of external, internal, and host routes; its order has no execution meaning. `cli-provider` filters only external profiles. Model profiles live under `external-workers`, and advisor choices under `pipeline-roles`.
