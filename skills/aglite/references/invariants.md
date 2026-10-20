# System invariants

Keep durable product guarantees current across rounds; historical designs retain local decisions. Use host instructions only, no hooks/helpers.

## Discover and reconcile

- At task recovery, find the project's established canonical invariant/contract document; otherwise use `<ag-dir>/sys-invariants.md` at the checkout root. Reuse authoritative contracts; relocating an existing registry requires owner authority and preservation of entries/links. Read the entire small registry and screen applicability before edits, including tasks without designs or with skip-plan on. Record applicability, linked IDs and N/A reasons under Round evidence; designs/trackers reference applicable IDs, and the devlog only links the evidence. Never infer approval from a proposed rule.

- At the first task read, retain each authoritative registry's physical path and independent exact-byte baseline or SHA-256; record absence if missing. Preserve that original baseline across recovery, not a fresh value substituted after changes. Persist needed baseline identity/bytes or a retrievable snapshot reference in existing recovery evidence before interruption; a hash detects inequality but cannot explain a diff without the original bytes. Before shared-record writes and at closeout, reread and compare; inspect any changed bytes, including formatting, against that baseline. Record accepted updates/diffs without replacing the original baseline; any byte change, including formatting, requires the content-change notice below; a path-only move requires the relocation notice. Reconcile foreign changes with their source/authority; never overwrite or silently adopt them. Missing baseline/bytes means disclose the proof limit and reconcile current content/history, never claim unchanged. Matching hashes prove only byte equality to that baseline. No self-hash in the registry, new sidecar, hook or runtime; comparison grants no write authority. Off-record/idle rules still apply.

- First-time setup creates an empty registry scaffold after authoritative-path discovery; otherwise create it only for the first accepted durable guarantee. An empty scaffold establishes no guarantees; its creation still gets the invariant notice heading, stating no accepted IDs and scaffold creation. Managed feature initialization reuses inherited shared records without creating setup scaffolds. Reuse existing authoritative contracts rather than duplicate them; one small registry with scoped entries is the default, splitting only when size warrants it.

- On first adoption in an existing project, reconcile a bounded set of current requirements/contracts, architecture, tests/code and active designs; inspect historical `artifacts/A-NNN/design.md` under configured ag-dir as candidates, not authority. Verify current decisions, consolidate duplicates and identify superseded rules/contradictions before promotion. Record inspected coverage and unresolved candidates under that round’s linked Round evidence; do not claim exhaustive migration or infer requirements from code alone. Preserve historical designs.

## Promote and maintain

- After writing/revising each design, consider which guarantees outlive the round and constrain future changes, including subsystem guarantees. Record promotion, existing coverage or no promotion in its Invariants section; reference applicable system IDs without copying canonical wording. Designs remain conditional under SKILL.md/configuration.

- Each entry uses a stable `SYS-INV-001` ID and name, scope/starting condition, preserved guarantee/violation, authoritative decision/source and concrete proving check or evidence link. Keep round ACs and latest check statuses in round records, not the registry.

- Add/change/retire affected entries with the authorized change, during planning when the contract is decided and before closeout/review when implementation reveals affected guarantees. New or changed guarantees require accepted task authority or an existing authoritative decision; surface missing decisions and conflicts before dependent edits. Never weaken a guarantee to accommodate a defect. Keep an ID for the same guarantee; retire it with reason/replacement when its meaning changes and never reuse it. Git retains detailed history.

- For any registry content change, follow SKILL.md’s delivery notice rule; path-only moves are reported as relocations.

## Verify and review

- At closeout, host verification and required independent review check both design-local and applicable canonical system guarantees. Record per-ID pass/fail/unproved with evidence under [Round evidence](../SKILL.md#round-evidence); retain applicability/N/A reasons. No design means no design-local checks, not exemption from system guarantees; the skip-review command changes ordinary review, not these checks.

- Check affected and cross-cutting guarantees; reuse unchanged passing evidence. Systemic or uncertain impact requires broader checks or an explicit proof limit. Missing proof stays unproved and blocks completion when required for an accepted outcome; unrelated gaps are disclosed without inventing repair authority. Update the registry when needed and verify it matches accepted current contracts before delivery.
