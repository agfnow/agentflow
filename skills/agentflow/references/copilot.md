# Copilot

Load for a Copilot host or selected Copilot native/CLI route/profile before dependent selection/planning/dispatch/review. Preserve ordinary workflow, authority, gates, records and fresh context. Copilot may serve several model families; its transport name proves none.

## Native role selection

Keep model/effort pairs in `model-family` and tiers in `pipeline-roles`. Optional `native-workers` binds planner/challenger/implementation/acceptance to catalogs and, only when needed, a verified named agent. [Worker settings](review.md#worker-settings) owns schema and precedence.

```json
{
  "native-workers": {
    "planner": { "model-family": "copilot-anthropic", "agent": "agf-planner" },
    "challenger": { "model-family": "copilot-openai", "agent": "agf-challenger" }
  },
  "model-family": {
    "copilot-anthropic": { "better": "<exact-available-model>/medium" },
    "copilot-openai": { "better": "<exact-available-model>/high" }
  }
}
```

Replace placeholders with the actual harness catalog IDs; labels do not establish provider/family. Add tiers selected by your roles. A planning advisor uses its own tier; only planning without an advisor uses threeways. The binding selects catalog/preset, not tier. Task-specific model/effort overrides precede validation; no unused catalog probe. Existing looper-routes and immutable attempts remain authoritative for looper work.

Distinguish surfaces before choosing controls:

- **VS Code Local:** inspect actual subagent controls for per-call model selection. If effort needs a named agent, verify its loaded definition, source precedence and effective overrides; a per-call model field alone cannot pin effort.

- **Copilot harness/SDK:** inspect the installed runtime, not standalone CLI capabilities. Verify per-call controls or a named custom agent, exact model/effort support and fresh context.

- **Standalone Copilot CLI:** use the separately inspected executable and the bounded CLI contract below. `code --...`, opening chat or an installed SDK package alone is no worker completion interface.

Agent-file fields vary by surface/version. VS Code documents `model` and `reasoning-effort`; Copilot runtime definitions also use `models`, `modelPolicy` and `reasoningEffort`, while saved subagent overrides use their own names. Inspect actual help/schema and loaded definitions instead of copying fields between surfaces. Auto, preference arrays, parent inheritance or a user override can select another model; none satisfies a pinned pair without evidence. [VS Code reference](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference), [runtime reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference#custom-agent-frontmatter-fields).

Prefer supported direct controls. When a preset is necessary, compare the effective loaded preset and higher-precedence user/runtime overrides with ag.json; refuse stale/conflicting or unverifiable controls. A required model policy, where supported, must still be checked against actual selection and effort behavior. Only create a scoped project agent when authorized work needs it; preserve existing user files, reject unsafe paths/collisions and generate no blanket agent suite. Settings remain authoritative; presets are derived controls, never a second settings source.

Before accepting a native route, observe a bounded fresh-context call with the exact supported pair, actual served model and effective control metadata. Test unsupported selections/refusal and relevant Auto/override/preset cases. Missing controls or incompatible explicit requirements leave that route unavailable; no invented tool arguments, silent defaults or CLI substitute for a missing native host. Missing ordinary diversity evidence is disclosed, never relabelled as diverse.

## Planning and review

For explicit/configured 3ways on Copilot, prefer reachable Claude-family and independent OpenAI-family participants for blind drafting and reciprocal debate, with the OpenAI-family participant doing final synthesis/technical decisions; use the identical reciprocal [debate procedure](review.md#3ways-compare-before-implementation), never host arbitration as consensus. Identify observed family from trustworthy served-model metadata, not catalog/agent labels or guessed vendor substrings. Call an OpenAI-family worker reached this way “OpenAI-family via Copilot”; it is not Codex CLI. Use the ordinary configured route/fallback and task-required provider/model/effort/privacy constraints.

Lifecycle: verify bindings/pairs → identical original authority/source and accepted prior contracts, withholding current-task drafts/hints → both blind drafts finished → exchange/reciprocal critique/replies → OpenAI-family synthesis and reasoned dispositions → exact-content acceptance check. Technical dissent is retained, never called consensus; missing required participants/valid blind drafts or owner-only choices leaves provisional work. Use fresh clean participants if host context is exposed; inherited custom-agent context is not independent. Simple understood low-risk planning stays with the host under the canonical complexity decision, preserving explicit requirements/configured 3ways. Worker planning routes prefer Claude-family drafting then OpenAI-family challenge/synthesis within supported route controls; the OpenAI-family synthesizer holds Codex’s final-content role under [planning routes](review.md#planning-routes), without being labelled Codex; disclose unavailable roles and any different/unknown-family fallback, never label it Codex. Reuse valid work; preserve explicit provider/independence constraints and canonical stops.

A selected configured Copilot CLI profile is reachable for ordinary planning/result review, alongside native Copilot where supported. Preserve default Codex↔Claude pairings unless a Copilot route/profile is selected. On Copilot, prefer the configured Claude-family primary and a permitted different observed reviewer/challenger family; a single transport may serve both. Rank observed family/model diversity before ordinary route/tier preference under [review](review.md#inspect-the-finished-result), preserving hard task constraints. Fresh contexts remain required; repeated/unknown ordinary family is disclosed, not a new blocker. Host synthesis/review never claims independence.

Repair and its reviewer may share the Copilot CLI provider because each launch owns a separate session/home. Codex/Claude repaired-result review may likewise use the available configured provider in separate fresh attempts, retaining checks and explicit stricter restrictions. Same Copilot labels or different catalog names establish neither independence nor diversity; verify actual separate execution and disclose served-model/family limits. Explicit required counterpart/provider/family restrictions still win. Do not change an existing saved selection to manufacture diversity.

## Standalone CLI

Register explicitly selected external profiles/looper routes with provider `copilot` and the existing model-family catalog. Example profile: `{ "id": "copilot-review", "command": ["copilot"], "priority": 1, "model-family": "copilot-openai" }`. A looper route uses `{ "kind": "cli", "provider": "copilot", "model-family": "copilot-openai" }`; `executable` optionally selects an inspected binary. Neither registration dispatches work or authorizes substitution.

Inspect installed help/auth/model eligibility before use. The adapter targets the observed standalone 1.0.101 JSONL contract; other versions require matching controls/events or stay unavailable. Pass explicit model/effort, unique new session ID, piped UTF-8 prompt and JSONL output, keeping long prompts out of Windows command-line arguments. Disable auto-update, custom instructions, built-in MCP, remote export, bash startup injection and user questions. Never reuse/resume an unknown session.

Use an attempt-private Copilot home/provider configuration and curated environment; do not inherit arbitrary hooks/plugins/MCP/provider settings. Carry only needed documented authentication/BYOK values through environment or separately approved provider configuration, without logging keys/tokens/full environment. Keep ordinary credentials/provider identities separate from instruction authority. Read-only roles expose read/search only; task/repair receive assigned edit/check scope and only authorized ordinary review. Task sessions explicitly allow the supplied skill root for required reading, without blanket directory trust. No blanket permission bypass. These tool/prompt restrictions are not OS containment; preserve timeout, descendant-stop and external-access limits.

Parse only the current outer session: correlate the submitted root user message with the final assistant's originating message, and require the expected unique session ID, one terminal success at EOF, process exit success and stopped descendants. Validate final JSON with the existing attempt-bound result schema. Ignore deltas/reasoning/subagent/intermediate text; reject malformed/stale outcomes, duplicate/missing terminals, fatal session failure, unknown association and model fallback. A root event may have parentAgentTaskId; that field alone does not identify a subagent. Tool failures can be recoverable and are not automatically fatal session failure.

Check the private persisted session start against requested model/effort and actual outer assistant model. Save nonsecret requested/accepted/observed identities and explicit unknowns with the attempt; metadata proving accepted/persisted effort does not prove effective model/provider effort. Unsupported controls must fail/refuse or remain unproved; CLI argument acceptance and elapsed time are insufficient. Exit zero/JSONL alone never proves the task complete; host verification and required review still apply.

Reuse attempt records, timeouts, descendant stop, repair budget and sole-coordinator integration. Inspect unknown external-result identities before retry. This grants no new runner, hook, editor extension, Agent Host bridge, queue schema or general provider runtime.

## Providers and proof limits

BYOK endpoint compatibility does not prove tool calling, streaming, selected effort or family identity. An isolated providers registry can override environment selections; inspect actual configuration precedence and keep credentials out of records. A localhost gateway may use remote inference. Free quotas/eligibility change; verify before promised tests. No paid/premium calls, signup, model pull or editor/user settings edit follows from selecting Copilot. [BYOK guide](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-byok-models), [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference).

For each accepted claim record actual version/surface, requested/accepted controls, observed model/family/effort or unknown, fresh-context/stopped handle and proving observation. Local CLI read-tool success proves neither editor-native dispatch, cross-family execution, effective effort nor cloud access. Keep unavailable required native/editor/model-support evidence unproved and the dependent outcome unfinished; shipped instructions or simulated handoffs are no substitute. Add no recurring probes or capability registry.
