# Windows host guidance

Use on Windows or an explicit portability task. Adapt commands to the installed shell; preserve workflow guarantees. Documentation is not native execution proof.

- **Inspect first:** Verify CLI/Git versions, login availability without exposing credentials, shell, physical checkout/branch/worktrees and permissions. Never assume a macOS setup transfers.

- **Arguments/stdin:** Use literal argument arrays and UTF-8 input files/streams for external review; Bash heredocs require Git Bash, not PowerShell. Owner text stays data. Inspect installed help for exact controls; do not silently change provider/model/effort.

- **File ownership/writes:** Use exclusive creation, e.g. Node `wx` or .NET `FileMode.CreateNew`, not an existence check followed by overwrite. Read bytes; check unchanged source, write an adjacent temporary file and atomically replace only where supported. Sharing/ACL/rename failures stop that write; never clear foreign claims or weaken concurrency checks. [Microsoft FileMode](https://learn.microsoft.com/en-us/dotnet/api/system.io.filemode) documents CreateNew.

- **Path identity:** Resolve physical paths, drive/case aliases, junctions and short-name aliases before comparison. Reject escapes, collisions, reserved device names and unsupported paths; do not silently rename a configured notebook. Keep repository links/Git ignore patterns with `/`; receipts use observed physical paths and only the verified home-prefix abbreviation.

- **History/clock:** Preserve UTF-8 and original line-ending bytes; do not use PowerShell text rewrites or Git autocrlf conversions on history. Inspect actual culture/locale and clock/timezone; normalize locale tags under configuration, not from input language.

## Reversible cleanup

- Follow owner deletion policy and [feature retirement](features.md#retire-one-worktree). Use `trash` or a verified platform Trash/Recycle Bin equivalent; permanent deletion is never a fallback.

- Before an alternative touches a checkout, prove it on a task-owned disposable directory on the same volume: explicitly recycle, locate the recoverable item, restore it and compare bytes. Record tool/API, volume and restoration evidence. If access, recoverability or identity is uncertain, leave the checkout/registration/branch intact and report the blocker.

- A small probe is insufficient: verify the actual target's volume/location, enabled bin and capacity for its contents, and require the selected operation to refuse permanent deletion if recycling is unavailable. Inspect its documented flags/failure behavior; reject permanent-delete warnings, automatic confirmations and uncertain guarantees before movement. [Microsoft shell flags](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags) distinguish recycling, destruction warnings and automatic confirmation; a recycle request alone does not prove this refusal contract.

- A Windows API candidate is `Microsoft.VisualBasic.FileIO.FileSystem.DeleteDirectory` with explicit `RecycleOption.SendToRecycleBin` and cancellation treated as failure. Its default is permanent deletion; recycle/UI parameters are unsupported in noninteractive applications such as services. The candidate is not approved until the refusal/recovery contract above is proved. [Microsoft API documentation](https://learn.microsoft.com/en-us/dotnet/api/microsoft.visualbasic.fileio.filesystem.deletedirectory?view=net-10.0).

- After authorized movement, verify the original path is absent **and** its contents are recoverable before unregistration/branch deletion. Ordinary marker removal follows owner policy too. Never edit the recycled checkout or claim native success from path absence.
