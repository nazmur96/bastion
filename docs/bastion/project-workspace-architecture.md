# Project workspace ownership and migration

Milestone 1 audit and milestone 2 implementation contract, 2026-11-10.

## Identity and containment

A project workspace is an application-level owner containing the complete workbench and explicitly attached repositories. Orca's existing worktree/folder workspace IDs remain unchanged inside it. Repository groups, branches and worktrees are not the new top-level owner.

```text
Application catalog (IDs, names, selected workspace only)
  → Project workspace: pinned application data/runtime namespace
      → Existing Orca profile/store
          → Repositories → branches/worktrees and folder contexts
          → Files, Git, terminals, agents, tasks, automations and browser pages
```

## Existing ownership map

| Domain                        | Existing owner / composition seam                                                        | Decision                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Repository and folder records | Store; renderer repo/worktree/folder slices; workspace-scope.ts                          | Reuse records inside each data namespace; no ID rewriting                                        |
| Persistence and migration     | main-process-ready-foundation.ts; profile-index-store.ts; profile-state-store-factory.ts | Reuse SQLite authority and existing legacy migration inside namespace                            |
| Canonical runtime root        | main-process-preflight.ts; loading-store/user-data-path.ts                               | Select project namespace before canonical path capture and locks                                 |
| IPC and runtime RPC           | register-core-handlers.ts; runtime metadata and runtime identity                         | One process/store bound to one namespace; never swap a global Store under pending requests       |
| Terminal ownership            | providers/local-pty-spawn-environment.ts; daemon/daemon-launch-paths.ts                  | Reuse per-data-root socket/history and pane ownership; normal quit detaches daemon               |
| Native agent sessions         | Structured session runtime and workspace tab records                                     | Reuse namespace-bound runtime/session state; retain provider identity distinctions               |
| Agent dashboard               | dashboard/build-dashboard-snapshot.ts                                                    | Reuse records from this namespace's repositories and sessions                                    |
| Agent history/search          | cached-session-list.ts; source discovery; session-search-service-init.ts                 | Independent index/cache plus explicit exclusion of other roots; a fresh DB alone is insufficient |
| Embedded browser              | initializeBrowserSessionsForApp; browser-client-host ID                                  | Isolate Chromium session data and profile metadata under project namespace                       |
| Tasks, labels, automations    | Store/profile state; automations runtime service                                         | Reuse existing persistence and original execution owners                                         |
| Remote execution              | ExecutionHostId, runtime environments, SSH target records                                | Connections remain namespace-owned; existing remote servers remain their own authorities         |
| Mobile/API                    | Canonical runtime metadata, device registry and E2EE keypair files                       | Separate runtime endpoint and pairing material per project namespace                             |
| Fork infrastructure artifacts | app userData / fork-argo and fork-observability                                          | Namespace selection also prevents cross-project artifact collisions                              |
| Focus and contextual hints    | Existing worktree/folder IDs plus renderer storage                                       | Reuse inside isolated renderer storage; no cross-project key rewriting                           |

An Orca profile is not sufficient by itself: several services, daemon paths and caches are rooted at canonical userData outside that profile's SQLite directory. The selected boundary therefore includes the entire application data root, not just one Store or a sidebar filter.

## Implementation decisions

1. A small SQLite catalog at the original application data root owns project-workspace identity, name and selected ID. It contains no repositories, conversations, credentials or operation payloads. SQLite transactions arbitrate concurrent catalog writers.
2. The stable `existing` entry points to the original data root. No repository is moved, renamed or grouped by inference. Existing account profiles stay intact within it.
3. New UUID-backed entries resolve to private data directories under the application catalog root. Paths are derived, never supplied by the renderer. Reject invalid IDs, unsupported catalog schema and symlink redirection.
4. Namespace selection occurs after existing dev/E2E path configuration, before canonical path capture, runtime metadata, locks, browser sessions, Store or workers. IPC keeps that process's identity pinned even if a different process changes the catalog's next-launch selection.
5. Switching validates the requested ID and source owner, checkpoints the renderer, flushes the source Store and uses normal relaunch/quit. The daemon remains owned by its original data root. Do not claim uninterrupted execution for all structured agents or automation schedulers: existing quit semantics still apply.
6. Chromium session data is explicitly scoped too. New project workspaces do not copy browser jars, remote connections, targets, pairing keys or project data.
7. History discovery must not enumerate host-global transcripts into a new project. Filter source roots/candidates to namespace-owned locations; include the special SQLite-backed scanners. Legacy history behavior remains unchanged for `existing`.
8. New local child shells and fork tooling receive unconfigured private cloud/Kubernetes context defaults rather than another workspace's inherited target. Explicit declared runtime configuration remains the route to intentional access. Never copy credential values into catalog metadata.
9. A small application-level workspace manager exposes create/select/rename for validation and use. It is not another repository/worktree creator. The full home/Leave/Incognito experience remains milestone 3.

## Boundaries and compatibility

This is application-state/process ownership, not an OS-account or filesystem sandbox. Explicitly opening the same external folder in two project workspaces is deliberate sharing; the application does not duplicate the folder or claim independent disk contents. Host user identity and external services remain external owners.

Local desktop is the first management surface. Web/mobile clients do not receive a new global catalog API by accident; they connect to an explicitly paired workspace runtime. Existing remote folder/worktree protocols stay unchanged. Reusing a shared remote server does not create a new remote data namespace: dedicated remote placement/namespace support and capability negotiation are milestone 5 work. Do not claim remote tenant isolation from this desktop boundary.

Appearance/provider capabilities may eventually be shared through explicit application settings. For the first foundation, new namespaces use normal defaults; no existing profile settings or tokens are copied. Authentication is not project content and must be handled deliberately by later provider integrations.

## Implementation tasks and proofs

- Catalog: transactional create/list/rename/select; unique IDs/names; invalid/corrupt/newer schema refusal; two writers preserve both records.
- Startup: preserve legacy root; derive isolated root; persist selection; Chromium and runtime paths differ; reject path traversal/symlinks; test dev and explicit runtime behavior.
- Switching: validate before flush; do not change selected ID on failed flush; fence stale source requests; reuse renderer restart checkpoints; keep old process owner pinned until exit.
- State isolation: persist two independently attached repo sets, files/tabs, agents, tasks/labels, browser records and automation data using actual Store/database paths. Restart/reopen both and verify no cross-read.
- Runtime isolation: distinct endpoint/socket/history/pairing roots; original pane/process ownership survives view changes; cloud context defaults do not silently inherit.
- History: foreign fixtures excluded in listing/index discovery, owned fixtures included, legacy behavior unchanged.
- UI: create empty namespaces, switch/reopen, restore current content; no nested workspace action in repository flows; screenshot real renderer and check drag hit areas.

These proofs, supported-surface limits and commits are recorded in the implementation log. Milestone completion must follow results rather than the presence of a picker.

## Local desktop proof checkpoint

The local Linux desktop foundation is implemented with namespace-owned data and relaunch switching. Focused proofs use disposable Retail/Platform repositories and synthetic transcripts; they do not contact cloud providers or launch paid agents.

Confirmed: fresh workspace empty; two repository sets remain independent; Retail's unsaved editor draft, terminal tabs, browser page and renderer storage restore across workspace switches and a cold dev-app restart. The real scanner returns no global host sessions in an isolated workspace. Direct/cached transcript reads enforce ownership; the foreign-title regression is checked in. SQLite fixtures also distinguish task labels/status and automation records using colliding inner IDs.

The CLI resolver now lives in the CLI runtime graph and uses Node's SQLite reader, so rebuilding Electron output cannot delete its imported module. Daemon spawn requests carry both private tool defaults and inherited credential removals. Explicit declared environment overrides remain intentional configuration.

The development launcher resolves/publishes available ports again after a workspace switch: surviving terminal daemons can retain the previous development debugging descriptor. This mechanism is specific to development; packaged switches retain Electron's normal relaunch path. Current verification covers Linux desktop; native Windows/macOS launches and shared remote-runtime isolation remain unverified. This checkpoint does not claim OS sandboxing, uninterrupted structured agents/automation schedulers while the desktop quits, cloud-provider integrations, or a completed Home/Leave/Incognito experience.

Private screenshots and machine-readable proof results are under `.handoff/steps-1-2/`; validation summary is `docs/bastion/project-workspace-validation.md`.
