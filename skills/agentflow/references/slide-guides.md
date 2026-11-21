# Slide guides

Use only when the user explicitly requests `slide-guides`.

## Start with the source

- Identify audience, presenter, delivery format, canonical report and latest owner-approved visual reference. For outline-only work, deliver the report for discussion. Build slides when requested. Use draft headings as candidate pages. Reorder for narrative flow and split dense material.

- Make the report sufficient to regenerate variants. For each slide, record its takeaway, exact projected copy, speaking points, visual grouping, reveal content and forward transition if any. Supply copyable demo material where needed. Keep one running example when it helps connect the sequence.

- Treat approved wording, punctuation, order, line breaks and category relationships as content. Apply corrections to the report and generated candidate together, including titles, notes, presentation behavior and visual placement. Compare both before delivery. Save evaluation candidates in the requested round artifact location and preserve the adopted deck pending selection.

- Follow requested planning roles and [review routes](review.md) when applicable. One outline used `3ways` with Claude Opus leading the draft and Codex reviewing. That role choice belongs to its brief. Use `Impeccable` skill for HTML slide design and critique when available. For an editable PowerPoint or Google Slides deliverable, use the host’s presentation-authoring tools.

## Compose for projection

Use a bright, clear, minimal style with a smooth visual flow, large images, sparse text and generous whitespace. Avoid generic AI-generated styling. Lead with the point and omit decorative taglines. Give each slide one readable visual argument and leave room for the presenter to elaborate. Omit decorative subtitles, badges and unrequested audience prompts. Reuse a suitable page from an expressly approved reference. Respect exclusions of older decks.

Choose structure by meaning. Show sequence on a timeline, parallel categories in clearly labeled columns, and each status on its own line. Keep correspondence visible across related columns. Enlarging an undifferentiated block leaves its structure ambiguous. Use large meaningful diagrams or imagery. Use animation or multimedia only to explain a change and respect reduced motion.

## Interactive HTML

- Keep the core argument readable with disclosures closed. Let the presenter click individual examples, answers or detail. Put a global reveal toggle (e.g. “Expand examples and answers”) and a notes toggle (“Speaker notes”) in the quiet bottom navigation. Group Previous, current / total and Next together (e.g. `Previous · 6 / 9 · Next`). Use subdued contrast or translucent chrome while retaining readable text, visible focus and clear pressed/disabled states.

- Right arrow or Space advances. Left arrow or Shift+Space goes back. Buttons use the same navigation logic. From a slide with a forward cue, first advance shows the cue over the current slide at the same page count, second advance enters the next slide. Back from the cue dismisses it. Back from a slide goes directly to the preceding slide. Stop at both ends. Paint an opaque cue surface above content, including notes and decorations, leaving navigation usable.

- M expands all click-to-reveal examples and answers across the deck and toggles them closed again. Keep its state consistent after individual clicks. N toggles the current slide’s notes alongside it. Write notes for an audience who may read them on the shared screen. Use bold key terms, short headings, indented supporting points and distinct commands. Allow independent vertical scrolling and generous text (the original correction requested 1.5× the previous note size).

## Inline review for HTML slides and websites

Keep the reviewer hidden during presentation. Expose a discreet button and a documented shortcut (C in the original deck). When active, offer an arrow to point at any visible content element and a rectangle to drag over a region. Open and focus a Markdown comment field immediately after either selection. Link each saved comment to its mark and slide or page. Support reopening, editing, deleting one mark and comment together, and clearing every mark and comment in the current document.

Reuse the same annotation component across decks and sites. Scope disposable localStorage data per document, distinguish pages or slides with stable identifiers, and restore marks against their targets after reload, scrolling and resizing. Treat comment text as untrusted. Keep ordinary site/slide controls usable outside review mode and suppress deck shortcuts while editing text. Review comments supply feedback for authoring. Accepted changes go back into the canonical report.

## Rehearse the delivered artifact

Open HTML candidates at presentation size in a browser using [browser testing](browser-testing.md). Inspect each slide at screen-share dimensions with notes closed and open. Exercise mouse and keyboard, including mixed individual/global reveals, both directions through a transition, first/last slides, notes overflow, focus visibility and cue occlusion. Verify each annotation tool against an actual target, edit and reload a comment, resize, delete one, then clear the rest. Compare audience-visible content, hierarchy and interactions with the source report and latest corrections. For other formats, inspect the rendered slides and their native notes.

## Original brief in English

Use these brief fragments to interpret the defaults above. Keep project-specific copy in the deck’s report.

- Outline scope — Discuss structure, outline and detailed wording before building slides. Many details may still change.

- Presentation intent — Leave room for the presenter to fill in details orally. Use animation sparingly and purposefully.

- Forward cue — Overlay the transition text on the current slide. Advance again to enter the next slide. Going back skips the cue.

- Readable notes — Use a clear hierarchy so the presenter can quickly grasp the main points and their context.

- Durable source and disposable comments — The report is the single source of truth for generating multiple decks. Every comment must remain editable and individually deletable.
