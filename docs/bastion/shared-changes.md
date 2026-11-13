# Shared changes — Step 8, first slice

The current adapter checks **saved repository source**. It does not run Terraform,
deploy, commit, push, reconcile infrastructure or verify a deployed service.
Step 8 remains in progress.

## Owning record

`Changes & runs`, Discovery's **Open project change**, and the editor's
**File capabilities → Open project change** use one namespace-local ledger.
The initial intent is one source-check change per project/root/owner route.
An entrance may seed the initial file selection; it never replaces an existing
prepared selection. There is no separate copy of desired source configuration.

The main process selects storage from the active project-workspace context,
not a renderer-provided directory. Home and Incognito cannot open this ledger.
Git worktrees and attached folder projects retain their existing identities.
The ledger uses the existing SQLite adapter, transactions, private storage and
database-file hardening. Its version is checked before changes are written.
Optimistic record revisions reject concurrent stale writers.

Source preparation, review, individual execution attempts, per-file results and
post-run source verification are separate records. Reviews and attempts retain
their snapshots. Retrying appends an attempt; it cannot overwrite a failure.
The current limits preserve history rather than pruning old evidence silently.

## Source-check contract

The source-check adapter:

1. Captures the project's existing file route and execution owner. Unresolved
   owners and unmanaged remote routes fail closed. Managed remote files use the
   owning runtime's existing file transport. No local tool/cloud inspection is
   involved.
2. Reads 1–20 explicitly selected supported files, at most 64 KiB each, rejecting
   secret-named paths, state, traversal, excluded generated directories and
   symlink entries. These use the same directory/stat/range-read guards as
   discovery, not a new security sandbox against a hostile concurrent filesystem.
3. Prepares path/fingerprint metadata; source text is transient. The owning editor
   remains responsible for file changes. Unsaved buffers are excluded explicitly.
4. Re-reads selected source at review and run boundaries. A different root,
   owner route, runtime pairing revision, selected file or saved content requires
   preparation/review again. Existing operation-generation guards reject late
   results after disconnect, re-pair or owner changes.
5. Runs JSON syntax checks and UTF-8 readability checks for other supported
   formats. Readability does **not** mean valid HCL/YAML/TOML, a Terraform plan or
   valid infrastructure. No shell, provider API or external CLI is invoked.
6. Stops at the first failure, preserves preceding results and shows remaining
   files as not run. Verification separately re-reads the pinned source and
   reports unchanged, changed or unavailable. An unchanged failed JSON document
   remains a failed source check.

Runs keep the captured project and file owner even when another project or view
becomes active. The controller continues outside the page component. A renderer
reload/crash/window close interrupts its unfinished attempts. On process restart,
unfinished attempts are marked interrupted rather than assumed successful.
These short source checks are not a durable remote job scheduler.

The IPC surface stores bounded typed metadata and fixed result codes, not raw
source, diagnostic messages, credentials, arbitrary commands, Terraform state or
binary plans. This ledger records renderer-produced source checks; it is **not**
an authorization capability for future infrastructure execution. Future execution
adapters must resolve their own authoritative owner and review preconditions.

## Work still required for Step 8

- Add explicit independently addressable change intents and reviewed adapter
  configuration for generated/infrastructure changes, using this lifecycle.
- Connect a generated-source proposal to existing atomic write preconditions and
  prove edits/symlink conflicts preserve the human's source. This slice writes no
  source and does not claim to have completed generation conflict handling.
- Add an owner-run execution adapter with durable background completion, output
  bounds/redaction and real verification, preserving interrupted/partial evidence.
- Route the existing infrastructure step runner and later Cloud/recipe/agent
  actions through the reviewed owner workflow. Existing infrastructure commands
  have not been silently converted to reviewed runs by adding this page.
- Bind real account/region/cluster identities in the later target milestones;
  the current target is explicitly source-only.
- Packaged, Windows, macOS and mobile validation remain open.

Plugin reuse is recorded in the planning repository's `PLUGIN-REUSE-AUDIT.md`.
No plugin installation or host tool installation is needed for this slice.
