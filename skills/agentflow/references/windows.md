# Windows host guidance

Use for Windows or explicit portability work. Adapt commands to the installed shell; preserve workflow guarantees. Documentation is not native execution proof.

- **Inspect first:** Verify CLI/Git versions, login availability without exposing credentials, shell, physical checkout/branch/worktrees and permissions. Never assume a macOS setup transfers.

- **Arguments/stdin:** Use literal argument arrays and UTF-8 input files/streams for external review; Bash heredocs require Git Bash, not PowerShell. Owner text stays data. Inspect installed help for exact controls; do not silently change provider/model/effort.

- **File ownership/writes:** Use exclusive creation, e.g. Node `wx` or .NET `FileMode.CreateNew`, not an existence check followed by overwrite. Read bytes; check unchanged source, write an adjacent temporary file and atomically replace only where supported. Sharing/ACL/rename failures stop that write; never clear foreign claims or weaken concurrency checks. [Microsoft FileMode](https://learn.microsoft.com/en-us/dotnet/api/system.io.filemode) documents CreateNew.

- **Path identity:** Resolve physical paths, drive/case aliases, junctions and short-name aliases before comparison. Reject escapes, collisions, reserved device names and unsupported paths; do not silently rename a configured notebook. Keep repository links/Git ignore patterns with `/`; receipts use observed physical paths and only the verified home-prefix abbreviation.

- **History/clock:** Preserve UTF-8 and original line-ending bytes; do not use PowerShell text rewrites or Git autocrlf conversions on history. Inspect actual culture/locale and clock/timezone; normalize locale tags under configuration, not from input language.

## JavaScript looper

Use Node.js 20+ and Git for Windows. Copilot editing also requires [PowerShell 6+](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli); its worker shell is separate from the trusted system Windows PowerShell used for process queries. Keep literal UTF-8 argv/stdin and `shell: false`; never repair a launch with `cmd /c`, shell interpolation or permission bypass. Native executables and explicit Node entrypoints are supported. Only verified standard npm Node shims may resolve to their script; custom/prefix-dependent batch or PowerShell wrappers require an explicit native executable or JS entrypoint. Example check: `["node", "C:/tools/npm/bin/npm-cli.js", "test"]`; use the actual inspected path, not this placeholder.

Keep configured and resolved command identity. Exclude the working directory from coordinator Windows executable lookup; verify the system process-query tool and bound queries. Signal only exact current process identities; Windows child creation must not predate the matched parent. Failed/unknown observations keep processes/claims unsettled, never stopped. Polling is not OS containment; detached children between observations and identity-to-signal races remain limits.

Send Copilot prompts through stdin to avoid Windows command-line limits; preserve complete bytes. Parse LF/CRLF headings without rewriting request/history or hashes. Refuse device names, alternate streams, trailing dots/spaces and reserved-directory/physical aliases; never silently rename them. Junction inspection is still required; Windows lacks the POSIX O_NOFOLLOW guarantee. Sharing/ACL/rename failures remain errors, not overwrite/cleanup permission.

Before claiming native support, observe a disposable real Windows Node/Git/provider journey: literal args and long Unicode stdin, npm shim/explicit entrypoint, CRLF queue and ordinary checked integration, cancellation/descendants, unknown-query refusal with retained claims, crash/resume/competing claims, junction/device/ADS refusal and atomic replacement/ACL behavior. Report actual versions and every unavailable observation or symlink-privilege skip; Mac/static/branch tests prove no Windows execution. No provider/account/spending authority follows.

## Feature CLI

The [terminal feature CLI](features.md#terminal-cli) uses Node >=20 and Git for Windows with literal argv, exact physical identities and byte-preserving records. Generate a PowerShell caller-cwd function using `node '<resolved-skill>/scripts/agf.js' shell powershell`; review it before authorized profile changes under [setup](setup.md#agf-command-setup). Ordinary output remains visible; only a successful validated destination file may change caller cwd. Existing bindings require an explicit upgrade request.

Windows is best effort; native Windows feature creation, conflicts, editor launch, profile/cwd and cleanup remain untested without native evidence. Under the explicit owner exception, feature CLI cleanup/drop may permanently remove only the exact verified target checkout, including deliberate `--abandon`; disposal of its private destination file and exact UUID-owned CLI claim markers for necessary feature bookkeeping is also permitted; never foreign claims or other files. Target claims/locks and identity checks still block removal. No Windows permanent-deletion authority follows for host chat, looper or other files.

## Reversible cleanup

- Follow owner deletion policy and [feature retirement](features.md#retire-one-worktree). Use `trash` or a verified platform Trash/Recycle Bin equivalent; permanent deletion is never a fallback.

- Before an alternative touches a checkout, prove it on a task-owned disposable directory on the same volume: explicitly recycle, locate the recoverable item, restore it and compare bytes. Record tool/API, volume and restoration evidence. If access, recoverability or identity is uncertain, leave the checkout/registration/branch intact and report the blocker.

- A small probe is insufficient: verify the actual target's volume/location, enabled bin and capacity for its contents, and require the selected operation to refuse permanent deletion if recycling is unavailable. Inspect its documented flags/failure behavior; reject permanent-delete warnings, automatic confirmations and uncertain guarantees before movement. [Microsoft shell flags](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags) distinguish recycling, destruction warnings and automatic confirmation; a recycle request alone does not prove this refusal contract.

- A Windows API candidate is `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory` with explicit `RecycleOption.SendToRecycleBin` and cancellation treated as failure. It defaults to permanent deletion; recycle/UI parameters are unsupported in noninteractive applications such as services. The candidate is not approved until the refusal/recovery contract above is proved. [Microsoft API documentation](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualbasic.fileio.filesystem.deletedirectory?view=net-10.0).

- After authorized movement, verify the original path is absent **and** its contents are recoverable before unregistration/branch deletion. Ordinary marker removal follows owner policy too. Never edit the recycled checkout or claim native success from path absence.
