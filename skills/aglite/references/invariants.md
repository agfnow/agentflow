# System invariants

Maintain durable product guarantees across rounds; historical designs retain local decisions. Use host instructions, no hooks/helpers.

## Discover and reconcile

- At task recovery, find established canonical invariant/contract documents; otherwise use checkout-root `<ag-dir>/sys-invariants.md`. Reuse authoritative contracts; registry relocation requires owner authority and preserved entries/links. Read the entire small registry and screen applicability before edits, even without designs or with plan-mode off. Record applicability, linked IDs and N/A reasons under Round evidence; designs/trackers reference applicable IDs, devlog links evidence only. Proposed rules are not approval.

- At first task read, retain each authoritative registry’s physical path and independent exact-byte baseline or SHA-256, or record absence. Preserve that original baseline across recovery; never substitute post-change values. Before interruption, persist needed baseline identity/bytes or a retrievable snapshot in existing recovery evidence: hashes detect differences but cannot explain them without original bytes. Before shared-record writes and at closeout, reread/compare; inspect all changed bytes, including formatting, against that baseline. Record accepted updates/diffs without replacing it. Every byte change, including formatting, requires the content-change notice below; path-only moves require relocation notices. Reconcile foreign changes with their source/authority; never overwrite or silently adopt them. Missing baseline/bytes requires disclosed proof limits and reconciliation of current content/history, never an unchanged claim. Matching hashes prove only baseline byte equality. No registry self-hash, sidecar, hook or runtime; comparison grants no write authority. Off-record/idle rules prevail.

- After authoritative-path discovery, first-time setup creates an empty registry scaffold; otherwise create only for the first accepted durable guarantee. Empty scaffolds establish no guarantees but still require the invariant notice heading, stating scaffold creation and no accepted IDs. Managed feature initialization reuses inherited shared records without setup scaffolds. Prefer one small scoped registry; split only for size, never duplicate authoritative contracts.

- On first adoption in existing projects, reconcile a bounded set of current requirements/contracts, architecture, tests/code and active designs; inspect historical `<ag-dir>/artifacts/A-NNN/design.md` as candidates, never authority. Verify current decisions, deduplicate and identify superseded rules/contradictions before promotion. Record inspected coverage/unresolved candidates in linked Round evidence. Claim no exhaustive migration; infer no requirements from code alone. Preserve historical designs.

## Promote and maintain

- After each design/revision, consider guarantees that outlive the round and constrain future changes, including subsystem guarantees. Record promotion, existing coverage or no promotion in its Invariants section; reference system IDs without copying canonical wording. Designs remain conditional under [planning](planning.md)/[configuration](configuration.md).

- Entries contain stable `SYS-INV-001` ID/name, scope/starting condition, preserved guarantee/violation, authoritative decision/source and concrete proving check/evidence link. Keep round ACs/latest check statuses in round records.

- Add/change/retire affected entries with authorized changes: during planning when contracts are decided, and before closeout/review when implementation reveals affected guarantees. New/changed guarantees need accepted task authority or an existing authoritative decision; surface missing decisions/conflicts before dependent edits. Never weaken guarantees for defects. Keep IDs for the same guarantees; retire changed meanings with reason/replacement, never reuse IDs. Git retains detailed history.

- Registry content changes follow [delivery notices](delivery.md#notebook-and-delivery); report path-only moves as relocations.

## Verify and review

- At closeout, host verification and required independent review check design-local and applicable canonical system guarantees. Record per-ID pass/fail/unproved, evidence and applicability/N/A reasons under [Round evidence](session.md#round-evidence). No design removes only design-local checks; system guarantees still apply. `skip-review` changes ordinary review, not these checks.

- Check affected/cross-cutting guarantees; reuse unchanged passing evidence. Systemic/uncertain impact needs broader checks or explicit proof limits. Missing proof stays unproved, blocking completion when required for accepted outcomes; disclose unrelated gaps without inventing repair authority. Update affected registry entries and verify alignment with accepted current contracts before delivery.
