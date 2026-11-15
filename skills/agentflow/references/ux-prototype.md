# UX prototypes

Build a disposable interaction model, a matching UX report and opt-in review guidance so people can inspect the proposed product before engineering. This reference owns Agentflow's prototype method; project briefs own task scope, accepted product contracts own behavior, and reports own version-specific findings/decisions. Keep one home per rule.

## Entry and authority

- Read for authorized prototype planning, creation or revision, including the prototype stage of [spec-out](spec-out.md). A specification request alone authorizes no executable prototype. Recover accepted scope, stage, sources, answers and gates; do not restart intake or ask settled questions.

- Produce the authorized fidelity/stage only. Do not infer production implementation, service access, publication, external messaging, account creation, paid tools, deletion or advancement beyond authorized specification/prototype stages from a prototype request. Follow ordinary Agentflow planning, records, review and delivery; this procedure adds no runtime, worker sequence or approval gate.

- Use applicable frontend/design skills; honor required full reads, otherwise retrieve relevant sections without truncation or redundant unchanged rereads. Keep disposable lo-fi within its task/fidelity brief, omitting brand/world tournaments, hi-fi comps and permanent design-system records unless requested. Read [browser testing](browser-testing.md) before browser-tool selection. Render human text in the configured locale. Never claim a drawing, screenshot or source file is an inspected interactive prototype.

## Establish the brief

- Recover actors, tasks, starting conditions, expected results, exclusions, target devices/viewports/locales, accepted rules, decision owners and questions to resolve. Inspect maintained UI, components/tokens/assets, Storybook and design files at identified revisions; distinguish intent, observed behavior, assumptions and open choices. Retrieve repository facts yourself; ask only material missing decisions/access.

- Give tasks, screens, scenarios and findings stable IDs, e.g. TASK-01, SCREEN-02, SCENE-03, UX-01. Map each task to its starting fixture, actions, expected transitions, failure/recovery, entry/reset and relevant contract. Report, prototype and tour share those IDs and the same revision; record coverage as interactive, annotated-only or uncovered.

- Recommend fidelity by unresolved questions; the owner confirms scope under the next rule: lo-fi for IA/layout/operation order; hi-fi for hierarchy, density, copy, components and interaction feel. State visual, content and interaction fidelity separately. Existing frontend may justify recommending direct hi-fi; no frontend means select representative visual directions without building a design system first.

- Before executable work, confirm with the owner whether a prototype is needed, which fidelity/type(s), and the intended depth: representative journeys/screens, critical states and comparison scope. Explain a recommended minimum and its tradeoffs; do not assume both lo-fi and hi-fi or an exhaustive product. Ask only unresolved choices, reuse valid scope authorization, and honor explicit delegation after explaining consequences. Save the decision in the same contract and owner answers in the devlog.

- Start with one bounded representative, operable journey; expand only for unresolved questions within authorized scope. Compare materially different hypotheses, stated before independent variants, using identical tasks, starting fixtures, content volume and viewport; normally a few representative screens suffice. Resolve major structure/consequence questions, then deepen one chosen direction. Neither a fixed candidate count nor clearing all UX questions is required; return to affected structure if later testing reveals a problem.

## Isolate all executable prototypes

- Use synthetic fixtures and simulated outcomes only, for both lo-fi and hi-fi. Run from a separate directory/sandbox, entry, configuration and local origin; do not add production routes, startup or deployment integration. Load no production environment, secrets, authentication cookies, business services or personal/product data.

- Keep interaction state in memory. Refresh/reset restores a known fixture. No database, localStorage, IndexedDB, product-file writes, real downloads, Trash/system commands or background scheduling. Persisted mock state needs a separately accepted change of scope. Source fixtures, report and design files are deliverables, not persisted interaction state.

- Serve HTML/JS/CSS/fonts/images/fixtures locally; no remote images, fonts, analytics or reporting. Inspect imports and reuse only display-safe dependencies; inject mocks or replace side-effecting components. If retaining a request interface, intercept locally and fail closed on unhandled requests, never fall through to real services. Identify necessary local development-tool connections separately.

- Simulated save/delete/favorite/play changes only mock state. Keep a visible demo indicator; explain relevant unsupported actions. The directory must be removable without affecting real data, but disposability grants no deletion authority or promise that prototype code will become production code. Retain decisions independently of disposable implementation.

## Build the interaction

- Default to local browser HTML/CSS/JS for interactive lo-fi and hi-fi; editable drawings may supplement structural alternatives. State the choice and reason before building; combine only for distinct accepted questions. Choose the simplest suitable tool; verify current version compatibility, export/reopen support and license before adoption. Do not require cloud accounts, keys or multiple SDKs for work that local files can satisfy.

- Interactive lo-fi uses a simplified browser UI with realistic labels, content density, full viewport structure and meaningful state changes. Editable Excalidraw/tldraw/Figma layouts may supplement alternatives; a canvas alone does not provide an Excalidraw-style editor. ASCII layouts/wireflows, static exports and canvas arrows do not satisfy interactive delivery. For drawings retain editable source plus matching rendered preview, reopen both and inspect readability/cropping/overlap.

- Hi-fi reuses maintained components, tokens, fonts/assets and relevant stories when safely isolated; otherwise establish only the small visual vocabulary needed for this scope. Use local representative images when judging recognition, cropping or selection; geometry placeholders cannot prove these experiences. Stories alone do not form a journey: connect pages through shared mock state. Do not introduce Storybook, a UI migration, full design system or fake backend without demonstrated need.

- Use stable entity IDs across views and one shared state/action model. Actions update lists, counts, details and metadata consistently; a toast without the required state change is insufficient. Provide deterministic scenarios and reset instead of random failures; put scenario controls outside normal product flows. Mark resets/jumps that replace current mock data. Every control presented as operative must yield an explainable result; label unmodeled entries explicitly instead of leaving silent no-ops.

- Within authorized depth, cover task-relevant success, loading, empty, missing/long content, validation, error, partial success and unknown-result states; mark omitted states uncovered rather than expanding scope. Define retry/cancel, selection/batch scope, duplicate handling, confirmation/undo, unsaved drafts and navigation/back where relevant.

- Partial replacement retries preserve completed results and retry only unresolved items; unresolved operations remain visible and block conflicting new play/resume. Restore focus after rerenders and removal, using a logical fallback when the originating control disappears.

- Specify which query/filter/selection/scroll/draft state survives closing details, navigation/back, refresh and scenario reset; implement and check the accepted behavior. Persistent unresolved issues remain discoverable after transient notices disappear. Annotate unavailable/concurrent/external changes without building an unnecessary engine or promising unobservable success.

- Inspect IA/names, primary/secondary/destructive action hierarchy, discoverability, content/units/dates/locales, density/cropping, scroll and narrow/zoomed layouts. Use semantic controls, accessible names, visible keyboard focus, keyboard-only core tasks, relevant announcements, non-color cues, contrast and reduced motion. Distinguish designed accessibility intent from actual browser observations and full conformance.

## UX report and review tour

- Maintain one concise report for each reviewable revision, initially review guidance, then updated with observations/decisions without duplicating a growing all-revision narrative; link earlier reports for history. Open with a plain-language overview, key decisions/questions and material limits; give purpose-based reading links for longer reports. Include revision/source references, start/reset instructions, fidelity, scope, simulation boundary and unmodeled behavior.

- Prioritize a small set of consequential review questions with recommendations/reasons. Link tasks/scenarios/screens directly where supported; otherwise give exact navigation/reset steps. Map relevant UX checks to coverage, preserving explicit N/A reasons without copying a textbook checklist.

- Each finding has ID, affected task, expected/observed difference, impact/severity, suggested repair, decision owner or unassigned, disposition and next check. Separate agent hypotheses, human design review, actual user observations and accepted decisions. Never invent participants, completion rates, consensus or sign-off. Keep new owner answer fields only in the host devlog; the report links question IDs.

- Provide free trial and opt-in design-review modes. Free trial gives goals/context without solution cues; record help if requested. Review mode exposes task cards, rationale, alternatives, scenario switches and findings, with links back to the report. A bounded first slice may use lightweight task cards; build a step-targeting tour only when useful. A review explanation is demonstration tooling, not automatically product onboarding.

- When provided, tour steps bind stable control targets, required scenario/state and report IDs. Allow previous/next, task jump, exit and restart; required actions advance only when expected mock-state predicates hold, never from event names alone. If completion removes its target, retain the completed step until Next. Reposition on scroll/resize; unfinished steps with missing targets recover to the task list. Do not cover required controls. Make controls keyboard accessible; modal tours manage focus entry/trap/Escape/return, nonmodal notes never trap focus. Tour completion proves exposure, not unaided task success.

## Verify, iterate and hand off

- Before claiming safe trial, inspect entry/start command, imports, configuration, requests and write paths; exercise core tasks while checking browser traffic and persistence. Fix escapes or mark isolation unproved and withhold the safe-trial claim. A demo label proves no isolation.

- Verify browser locators and reset fixtures before exercising journeys; distinguish harness failures from observed UI defects, and rerun interrupted checks before claiming coverage. Agent-run checks cover deterministic task transitions, cross-view consistency, relevant failure/retry/back/reset, representative/narrow viewports, long content/zoom, keyboard/focus and tour on/off/recovery. Actually render and inspect visual output. Record checks not run and their consequences; code inspection alone proves no visual or browser behavior. Use ordinary result review, not a duplicate review workflow.

- Let PM decide scope/rules/tradeoffs, designers inspect interaction/hierarchy/visuals, engineering confirm observable states/feasibility, and appropriate users attempt unaided tasks; one person may fill multiple roles. Agent automation prepares artifacts, checks and proposed fixes, never substitutes for accountable human choices or user research. Fix task blockers and misunderstood consequences before polish; rerun affected tasks on the same starting fixtures.

- Agent delivery is review-ready when scoped core tasks and key failure states are reproducible, isolation is checked, report/tour match, free trial works independently, and blockers/unproved coverage are explicit. Human acceptance applies only to the identified revision/scenarios; without actual trial, never claim user-validated. Unselected direction or unresolved decisions remain pending rather than invented acceptance.

- Supply a directly openable entry or a verified simple local start command; PM/designers must not assemble components or navigate developer stories to complete tasks. Preserve reproducible sources/start/reset instructions, necessary representative screens, adopted/rejected choices, findings, remaining owners and engineering checks. Hand off artifact/report revisions for [Art integration](spec-out.md#write-and-reconcile). Reconcile accepted interaction changes into the existing specification under its decision/gate rules; never silently override product requirements. Prototype readiness proves no real API, persistence, performance, concurrency, platform integration, production accessibility or deployment readiness. Stop at the authorized stage; retain the next safe action in the existing tracker.
