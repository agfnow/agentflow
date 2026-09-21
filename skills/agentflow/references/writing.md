# Writing styles protocol

## Scope

- Apply by default to all human-readable prose and Markdown, including devlogs, trackers, designs, reports, guides, slides, specifications, operational logs, prompts, and skills. Where required, preserve an established stricter format, including report sections and numbered answers.

## Concise list style

- Keep the body list-based: one result, incident, reason, decision, evidence item, or next action per bullet; connected sentences may explain the same idea. Clarity and completeness outrank brevity.

- Lead with the concrete result or action. Bold only short scan cues, never whole sentences. Number ordered steps, with necessary detail in nested bullets.

- Use everyday words (用口語、說人話). **NO COMPRESSED TECHNICAL TERMS OR EXPRESSIONS**, even to meet a length limit. Say what happened, what it means for the user, and what happens next. Explain each unavoidable technical term once, before use, without substituting another unfamiliar term. Include filenames and internal details only when readers need them.

- Separate adjacent list items, including nested and numbered ones, with exactly one empty line, except in machine-serialized data, code, tables, exact quotations, and formats whose contract requires adjacent lines.

## Opening and reader action

- Make the opening understandable on its own, without task IDs or linked files: the outcome, why it matters, any material problem or limitation, and any needed action or decision. Lead with a warning or decision when it changes the reader's next step; say no immediate action is needed only when that would otherwise be unclear.

- Avoid activity lists, miniature reports, and repeating the same result. Group supporting detail around the reader's questions.

## Evidence and status

- Keep essential evidence beside its conclusion; put formulas, hashes, raw paths, process and scope accounting, repair history, and other lengthy technical detail after it or in links.

- Distinguish tests running, requested behavior working, and task completion; separate earlier from current results. State uncertainty plainly. When shortening, keep material failures and limitations.

- In findings and closing limits, separate trigger, impact, evidence, and action when distinct. Preserve exact verdict fields, severity, IDs, uncertainty, literal patch blocks, and final `Self-check:` boundaries.

- Before delivery, check the opening against these rules and confirm the reader could explain the conclusion and next step in their own words. This check and all presentation choices are advisory, never automated completion gates, and never replace required content, evidence, or established formats.

## Research reports

- Write for an intelligent reader with no background in statistics, mathematics, or quantitative finance. Tie the opening to the owner's goal and recommend a next step.

- For each important result, say what was tested, what it was compared with, what the number counts, and what conclusion it does and doesn't support. Give counts before percentages ("18 mistaken selections out of 500 trials"); add one concrete example when it helps. Never assign a probability the method doesn't justify.

- Separate software failures, missing information, weak experiments, and evidence that a trading idea doesn't work. Say whether the user can continue, on what assumptions, what must be repaired, and how we'll know the repair worked.

- Use connected prose where bullets would fragment the explanation.

- In progress reports, state separately whether the software is built, whether experiments have run, what continues automatically after this turn, and what is waiting. Give calendar dates in the owner's timezone.

## Document-specific formats

- `show-diff`: follow SKILL.md's reasoned unified-diff format; standalone-report opening and supporting-section rules don't apply to the diff.

- Agentflow devlogs: follow `references/closeout.md` for exact Reply structure and apply this style within Ask/RUN/WIP/Reply. A `[FINAL REPORT]` section is a devlog answer, not a standalone report.

- Standalone reports and guides, plus worker reports and specifications even outside default scope: write for a human reader. After required identity and revision lines, open with a TL;DR, BLUF, or summary of two to four short bullets: result or decision, material risks or missing evidence, and next action or owner choice. Scale to the report; don't invent issues or actions to fill slots. Fit it within the stage's allowed headings; a short bold label needs no extra heading.

- Requirements refreshes: leave the append-only question history unchanged; put the current overview only in the single replaceable `# Final requirements summary`.

## Editing writing instructions

- Before editing, record the exact requested improvement and the format obligations to preserve in the current task record. Check every deletion against its replacement and the owner's authorization; leave unrelated rules intact.