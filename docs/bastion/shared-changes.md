# Shared change workflow — Step 8 foundation

Supported adapters check saved source and create new source files through the
project's owner, locally or through a managed runtime. They do not run shell
commands, Terraform, cloud APIs, Git commits, pushes or reconciliation. Provider
execution follows the target/binding milestones. Source checks do not prove
Terraform validity or deployed health.

## Identity and review

The namespace-local ledger owns intent, preparation, review and attempt history.
A record is identified by project ID and intent ID inside its top-level workspace.
Separately selectable check changes and file proposals use the same lifecycle.
Discovery, editor File capabilities, Cloud/Recipes links and agent-assistance
navigation enter that workflow. Navigation alone never executes it.

Root, host, transport route and pairing revision are context, not record identity.
Every validation, review and attempt retains its captured context. Re-pairing
preserves history and invalidates review. Returning to an earlier context cannot
revive review; preparing again requires explicit review even if bytes match.
The reviewed adapter configuration includes the owner runtime ID, so a runtime
restart also invalidates execution preflight.

Schema version 3 transactionally merges version-1 records previously split by
pairing revision, preserving evidence, historical contexts and old IDs as aliases.
Unsupported schemas are refused. The main process chooses storage from its active
workspace context, never a renderer-provided directory. Home and Incognito are
refused. Existing SQLite adapters, private directories, database hardening and
optimistic revisions are reused. History limits preserve evidence and still allow
started attempts to settle.

## Owner execution

The client ledger owns review/history; the runtime owns durable execution receipts.
This is not another desired-state store. The owner resolves the registered
worktree/folder, checks expected root/host and refuses SSH routes it cannot serve.
Remote work never falls back to the desktop filesystem.

Each run UUID is admitted once. A repeated identical request returns its receipt;
substituting another project, runtime or snapshot is refused. Per-file results are
checkpointed in private owner storage. Original targets remain pinned through view
and project switches. Renderer reloads leave owner work alone, and the page
retrieves its receipts afterward. Reconnect can recover evidence from the same
stable target; re-pairing cannot redirect an old run to another machine.

Recovery marks an unfinished owner receipt interrupted when its job is absent from
this process or its owning process is proven exited. Otherwise completion remains
unknown. Partial checkpoints survive. Retries append attempts; settled evidence
cannot be rolled back. Renderer-produced step/finish results are refused for owner
runs. Late authoritative terminal receipts can resolve an interrupted client view.

Concurrency and receipt counts are bounded. Output consists of fixed result codes,
paths and fingerprints: no source, parser messages, credentials, state, binary
plans or arbitrary commands are stored. This source RPC is not authorization for
future billed infrastructure; those adapters need authoritative target admission.

## Source checks

The user explicitly selects 1–20 saved supported files, at most 64 KiB each.
Secret-named, environment/state and excluded generated files, traversal and symlink
entries are refused. Unsaved buffers are visibly excluded. Saved bytes and runtime
identity are re-read before review/run and fingerprints checked by the owner.
JSON receives syntax checks; other formats receive UTF-8 readability checks.
Failure stops later files, which remain marked not run. Source verification is
separate: unchanged, changed or unavailable. Unchanged invalid JSON still fails.

## Guarded source proposals

Discovery reuses the existing all-unknown service-contract generator. Existing
contracts still open in the ordinary editor and are never regenerated. New file
change supports a source filename at the project root. Nested-output generation
and replacement are deliberately unsupported by this create-only adapter.

Proposal text lives in bounded renderer memory scoped to project and destination.
Reopening a template preserves edited text. Reload requires reopening a template
or pasting text again; the ledger stores its fingerprint, not a hidden copy.
Preparation and review create no file. Editing disables creation until preparation
and review are repeated. Existing destinations invalidate review and are preserved.

Explicit Create source file sends the reviewed bytes through the owner route.
The owner stages a private regular file and publishes it using an exclusive hard
link in the same directory. Existing files, directories and dangling symlinks,
including destinations introduced after preflight, cause conflicts without
replacement. Temporary names are removed after the attempt; a hard crash can leave
a private staging file for inspection. Filesystems without hard-link support fail
closed. As with existing file operations, this assumes a trusted workspace, not a
hostile actor concurrently replacing ancestor directories. Generated files remain
ordinary source for editor and Git review.

## Proof and remaining support scope

Linux dev proofs use disposable local folders and a managed Docker SSH runtime.
Evidence is private in .handoff/step8-complete-1113/. Tests cover migrations and
aliases, re-pair invalidation, pinned contexts, monotonic receipts, admission and
recovery, partial failures, competing creations, edited/symlink destinations,
proposal guards and project-scoped drafts/navigation. Live proof covers reload
recovery, contract generation, remote-only creation and disconnected-owner refusal.

Existing direct Orca infrastructure commands remain manual tools outside these
source adapters; they are not relabeled as reviewed cloud executions. Cloud target
bindings, provider plans, multi-file infrastructure recipes, CI/GitOps execution
and deployed verification belong to Steps 9–12 and must extend this lifecycle.
Packaged, Windows/macOS and mobile checks remain explicit support work. Plugin
reuse is recorded in the planning repository's PLUGIN-REUSE-AUDIT.md; no plugin or
host tool was installed.

## Crosscheck — November 13 (Claude)

Independent crosscheck of 7abf84d4a7. Live dev proof on a disposable profile (workspace 5): `.env`, a secret-named JSON file, a traversal path and a symlink were refused; a three-file run failed at invalid JSON with the remaining files shown as not run, and a retry preserved both attempts with verification; a saved edit after review blocked the run and invalidated the review; Discovery and File capabilities reopened the same record with the prepared selection kept; a managed Docker SSH project kept the same record across disconnect/reconnect and a killed-and-restarted managed server; a reload during a running remote check left that attempt "Interrupted; completion unknown"; review and run controls received native clicks.

Fixed: path refusals surfaced a serialized schema error (`[{"code":"custom",…}]`) instead of an explanation; they now give a readable reason. The renderer-lifecycle hook read Electron's deprecated positional `did-start-navigation` arguments; it now uses the event details (`isMainFrame`, `isSameDocument`), re-verified live after a main-process rebuild.

Design note: the record identity includes the runtime pairing revision, so a genuine re-pair opens a new record; earlier records remain stored but are not listed. A reconnect or managed-server restart did not change it in practice.

## Completion crosscheck — November 13 (Claude)

Crosscheck of cde69f9a1e. Change identity is now project plus intent, so history follows a project across re-pairs and a changed context invalidates the review in place; version 1 ledgers migrate by merging records. Create-only publication links a fully written temporary file into place, so an existing file or a dangling symlink at the destination is a conflict and nothing is written through it; no temporary file remains.

Fixed: the temporary file was opened with mode 0600 and the published file is a hard link to it, so every created source file was readable by its owner only (for example, unreadable to a non-root process in a container built from the repository). It is now created with the umask-derived mode like any editor-created file. A real-filesystem regression test covers it, and a live dev run created `service.json` through Changes & runs as 0644 while a proposal for an existing `human.json` was refused at preparation with the file unchanged. 47 focused tests, Node/web/CLI typechecks and the changed-code gate (base 15a81ddb858a) pass. Remote proposal creation was not re-run by Claude after the fix; it uses the same writer.
