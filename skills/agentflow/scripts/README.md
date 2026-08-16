# Agentflow scripts — the outside-the-model referee

These files check that a devlog round told the truth. They are **not** part of the skill the model reads. They run in the host program (Claude Code or Codex) after a round is written, so the model cannot skip them or edit their verdict.

## The two pieces

- **`round-linter.js`** — a small, plain-JavaScript, no-AI checker. Give it a `devlog.md` and a set of host-known facts, and it grades the last round's honesty: is the timestamp the real time, was the terminal kept to one line, did a "pushed" claim really happen, were any Ask ids invented, do the STATUS settings match. It grades the **record**, never the hired worker's code (running the tests does that). It has no dependency on any particular host.

- **`stop-hook.js`** — the wiring that lets a host CLI run the linter for you. Register it as a `Stop` hook and the host runs it every time the model ends a turn. It reads the real clock and the real git-push state, hands them to the linter, and if the round lied it exits with the block code (2) so the host makes the model write a correcting round.

## Which hosts work

- **Claude Code** — full support. Registered in `settings.json` under `hooks.Stop`.

- **Codex** — full support, with one manual step. Codex's hooks use the same contract as Claude Code's (JSON on stdin with `cwd`, exit 2 blocks with stderr fed back to the model, a `stop_hook_active` loop guard), so the very same `stop-hook.js` serves both. Registered in `.codex/hooks.json`. **Trust gate:** codex refuses to run a command hook until the human reviews and trusts it once — run `/hooks` inside codex after installing. Trust is tied to the script's hash, so a skill update that changes `stop-hook.js` needs a re-trust. Project-level `.codex/` config also loads only in a codex-trusted project, and very old codex versions (before roughly v0.114) shipped hooks off or not at all.

- **Anything else (opencode, future clients)** — the scripts are host-agnostic Node.js with zero dependencies. Any client that can run a command after a turn and pass `{"cwd": ..., "stop_hook_active": ...}` on stdin can reuse `stop-hook.js` unchanged; any client at all can call `round-linter.js` directly with a `--context` facts file.

## Turn it on

    node install-hook.js --project     # this repo, both hosts
    node install-hook.js --global      # machine-wide, both hosts

By default the installer registers the hook for **both** hosts:

- claude → `./.claude/settings.json` (project) or `~/.claude/settings.json` (global)

- codex → `./.codex/hooks.json` (project) or `~/.codex/hooks.json` (global)

Writing a config for a host that never runs in the repo is harmless — each CLI reads only its own file, and the hook no-ops when a session has no `devlog.md`.

- **Codex only:** after installing, run `/hooks` once inside codex to trust the hook — codex does not run untrusted command hooks. Claude Code needs no such step.

Options:

    --host claude|codex|all   touch only one host's config (default: all)
    --off                     remove the hook again
    --quiet                   print nothing (for scripted use)

The installer backs up each config file first (`.agentflow-backup`) and never adds a duplicate.

- **Start with `--project`.** A `--global` hook runs on *every* session of that CLI on this machine. It stays quiet on sessions that have no `devlog.md`, but project scope is the safe default — and project scope is what the skill itself maintains.

## What the live hook checks today

The always-on hook enforces only the facts it can read safely on every turn:

- **Timestamps are sane** — a round stamped in the future or long in the past is blocked.

- **A "pushed" claim is true** — if the round says it pushed, the push must really have landed. Rounds that do not claim a push are never touched by this check.

The other linter checks (one-line terminal, invented Ask ids, pipeline artifacts, STATUS settings) need facts the hook cannot supply without false-blocking ordinary chat turns, so the hook leaves them off for now. They still work in the manual form below. Deepening the hook to supply them safely is future work.

## Run the linter by hand

    node round-linter.js <devlog-path> --context <facts.json>

`facts.json` may set any of: `terminal_output`, `now_ms`, `push` (`{remote_exists, exit_code}`), `owner_ask_ids`, `pipeline` (`{artifact_dir, require}`), `expected_settings`. Missing facts are reported as "skip", never a false "pass". This manual form is how any future host or audit script (for example the planned portal) runs the full six-check battery against a saved round.

## Safety

The hook **fails open**: any bug inside it exits 0 and lets your turn end. It only ever *blocks* on a fact the linter confirmed dishonest.

## Tests

    node --test round-linter.test.js
    node --test install-hook.test.js
