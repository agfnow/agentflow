# Defensive security scan

Read-only examination of named changed files and affected trust/data boundaries. Trace relevant control/data flow for concrete authorization/ownership failures, injection, credential/private-data exposure, unsafe file/dependency handling or data loss. Inspect only implicated risks; name any newly implicated surface for host scope reconciliation before expanding.

Each finding requires exact location, plausible trigger, impact, checked evidence and a scoped correction recommendation. Separate examined boundaries, checked-clean evidence and unexamined/unavailable proof; unavailable tools or refusal are not a clean scan. Do not repair, dispatch follow-ups or grant permission. The host resolves concrete in-scope defects under existing authority; new behavior or unrelated hardening remains a proposal. Security evidence supports, and does not replace, final acceptance.

## Select checks by affected risk

- **SAST:** Inspect source/data flow with existing approved language/framework tooling. Trace untrusted input to SQL queries and other injection sinks; check parameter binding and safe handling of dynamic identifiers. A scanner count alone proves no safety.

- **Dependencies/secrets:** Treat vulnerable-dependency analysis and secret detection as separate checks; select only implicated coverage. Keep credentials redacted and record unavailable coverage.

- **Runtime:** Recommend targeted dynamic checks when source analysis cannot prove behavior. The host runs them only within existing authority; scanning live services, external sends or uploading source needs applicable authorization. No installation, repair or changed scanner configuration by this read-only advisor.

- **Financial/customer requirements:** Prioritize affected authorization/tenant boundaries, input-to-query paths, sensitive logs, secrets and transaction integrity. Required tools/blocking severities come from project rules or accepted contracts; do not invent gates or claim compliance.

## Reproducible evidence

- For host-run tools, specify and inspect the evidence: exact source revision plus patch/hash, tool/version, ruleset/version/config, literal command and scanned scope/exclusions, exit status and result artifact. Prefer local analysis; source uploads require owner authority.

- Separate confirmed findings, suspected findings and false positives with evidence/reasons; retain required unresolved findings. Explain tool failures and unexamined paths. Never treat an empty/failed scan as clean or suppress a finding to pass acceptance.

- Combine tool output with boundary review and relevant authorized runtime proof. [OWASP guidance](https://community.owasp.org/Source_Code_Analysis_Tools) describes static analysis coverage and false-positive/access-control limits; no generic scan proves financial compliance.
