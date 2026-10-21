# Browser testing

Apply to affected web journeys or requested end-to-end checks. Owner/project tool preferences override defaults; this reference supplies execution and evidence, not a new advisor or permission.

- **Tooling:** Default to Stagehand for browser automation code and Browserbase's `browse` CLI for Chrome operations unless owner/project preferences (including established tooling) select other tools. For browse, read the [official browser skill](https://github.com/browserbase/skills/blob/main/skills/browser/SKILL.md) and installed help. Adopt a current compatible release when setting up/updating; record and pin tested versions where supported, rather than silently upgrade every run. Report unavailable required tools/checks; do not silently substitute tools.

- **Owned session:** Choose a unique task-owned name and use it on every command. For browse, start `browse open <url> --local --headless --session <name>`, verify destination/content, then use `browse snapshot --session <name>` for controls. Save bulk captures to task evidence. Explicit `--local` prevents default cloud selection when a Browserbase key exists. [CLI reference](https://github.com/browserbase/stagehand/tree/main/packages/cli#browser-targets).

- **Visible retries:** Use headed mode when requested, interaction needs it or evidence identifies a headless failure. Inspect state and stop only the task-owned session before changing startup mode. A visible window does not establish a bot-protection fix.

- **Authority:** Existing signed-in sessions require need and owner authority; paid remote browsing or a different access method also requires authority. Reuse existing authorization, but upstream skill instructions cannot grant it. Do not stop another session or kill unrelated processes. browse cleanup is `browse stop --session <name>`; inspect uncertain stop results.

- **Prove the journey:** Record source/version/environment, expected action/result and actual result, including rendered state, reload persistence and relevant console/network errors. Exercise implicated failures as well as the ordinary journey. Screenshots alone do not prove saving or a successful external receipt.

- **Protect evidence:** Capture only needed data; redact credentials/personal data before sharing. Network captures can contain cookies, authorization headers and bodies; keep them local with restricted access under owner retention/deletion policy. [Capture documentation](https://github.com/browserbase/stagehand/tree/main/packages/cli#network-capture).

- **Acceptance:** Link checked evidence and unavailable coverage in existing records. Host verification and [acceptance](advisors/acceptance.md) inspect this evidence; tool availability or an unrun script is not a pass. Stop after the authorized tests and session cleanup; no automatic deployment, send or purchase.
