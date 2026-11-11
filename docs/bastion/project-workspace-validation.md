# Project workspace foundation validation

2026-11-10. Scope: milestones 1–2, local Linux desktop.

## Results

- Ownership audit and migration contract written; existing app data stays at its original root.
- 46 focused tests pass across 11 files, including catalog concurrency, startup identity, CLI source pinning, two SQLite stores, history exclusion/direct-read regression, scanner worker propagation and daemon spawn environment assembly.
- Node, renderer and CLI typechecks pass.
- Changed-code quality gate passes against upstream/main.
- Real UI switches repeatedly between Retail store and Platform engineering. Platform starts with no repos/files/terminals; adding a Platform repo does not appear in Retail.
- Retail restores two repositories, an unsaved editor draft, terminal tabs and a browser page. The same draft, browser record and renderer storage survive stopping and restarting pnpm dev.
- Renderer storage markers stay independent. Session cookies are not treated as durable across process quit; the product does not promise session cookies survive restart.
- The real isolated scanner lists zero host-global sessions; search starts disabled with no indexed files. No search indexing of user history was enabled for proof.
- Live daemon-backed shell has workspace-unconfigured AWS profile, namespace-local KUBECONFIG, no inherited AWS access key, and the originating workspace's runtime source identity.
- Task labels/status and automation separation are proved using persisted fixtures, not real external task services or scheduled execution.

## Repairs discovered by the proofs

1. Scanner child environment lost the workspace root: passed explicitly through its safe allowlist.
2. Direct title reads and resumable/cached transcript reads bypassed the first parser guard: added checks before stat/read/cache reuse.
3. Dev restart reused a debugging port held by a surviving daemon: resolve and publish available development ports for each new child.
4. Electron rebuild removed the CLI resolver module under out/main: moved the resolver into the CLI runtime graph.
5. Daemon-backed terminals missed private context defaults: carry defaults and deletions through the common spawn request boundary.

## Evidence and limits

Private evidence: `.handoff/steps-1-2/`, including final-tests.log, final-typechecks.log, final-quality.log, platform-empty-proof.json, platform-after-draft.json, retail-draft-restored.json, cold-restart-proof.json and terminal-final-environment.json. Screenshots include platform-final.png, retail-restored-draft.png and cold-restart-retail.png.

The checked-in regression uses only synthetic temporary transcripts. No real AWS operation, Terraform execution, agent inference or user project modification was performed.

This is application-state isolation. Shared external filesystem paths are intentionally shared when explicitly opened twice. Runtime connections are scoped records, but a shared remote server remains an external owner. Native Windows/macOS UI, remote namespace placement and mobile end-to-end pairing are not validated by this local proof. Those require later supported-runtime validation; do not interpret this as an OS security sandbox.

Home, explicit Leave and Incognito remain milestone 3. Native agent/automation continuity while switching is bounded by existing quit behavior. Cloud authentication, resource recipes, provider-neutral assistance and connected delivery remain later roadmap work.

Final CLI ownership proof: while Platform is selected, an ordinary CLI lists only platform-tools. A still-running Retail terminal retains its original runtime identity; its CLI returns runtime_unavailable after the Retail desktop runtime exits, rather than silently targeting Platform. Returning to Retail restores its terminal surfaces. This refusal is an explicit continuity limitation of the initial relaunch design.

## Application home (first milestone 3 slice)

A cold launch now opens application home in its own empty namespace (`bastion-project-workspaces/home`), outside every project workspace. Home lists workspace cards, creates and renames workspaces, and opens one by relaunching into it. Inside a workspace, the titlebar menu offers Leave workspace and switching; creation is refused outside home. Catalog schema 2 adds the home launch state and a summary each workspace records about itself (repository count, last opened); home never reads another namespace's data. The CLI routes to the home namespace while home is open.

Validated in the real dev app: cold start → home; open Retail (two repositories, draft, terminals restored) → Leave → home shows Retail's recorded count; create Payments → opens empty; stop and cold start from Payments → home. A forced stop skips the quit hook, so that workspace's count stays unrecorded until a normal quit or switch.

Not yet built: Incognito tasks and Archive. Orca's existing empty-state copy still calls worktrees "workspaces" and shows the ORCA name.

## Integration credential storage checkpoint

Bitbucket, Jira, Linear, MiniMax cookies and the shared MiniMax/OpenCode Go API-key file store now resolve their storage beneath the owning namespace's `integration-credentials` directory. Existing projects retains the original legacy directory. New workspaces do not automatically copy these saved sign-ins.

A real temporary-filesystem test saves synthetic credentials in legacy storage and workspace A, verifies workspace B starts without them, writes and reopens B, deletes B, then reopens A and legacy storage to prove their values remain intact. Modules are reloaded between contexts to model the separate application processes, including their caches. The test exercises the actual provider read/write/delete paths and the generic API-key store; the secret-storage backend is a deterministic test double, so this is storage-boundary proof rather than OS keyring cryptography validation. All temporary roots and credentials are synthetic.

Focused affected-store suite: 52 tests across five files passed. Main-process typecheck passed. The unfinished window-handoff test was preserved privately under `.handoff/pending-workspace-transition/` until its implementation exists; no transition implementation was removed. Smooth transitions, Incognito tasks and Archive remain pending. This checkpoint covers the named integration stores, not every external agent's host-managed credentials or OS-level isolation.

## Visible workspace transitions — November 10

The source window now stays open with a progress screen until the destination renderer acknowledges readiness in its own namespace. Leave targets application Home. Development navigation reuses compiled main/preload output instead of rebuilding them on every switch. A failed destination retains the source and restores catalog selection; cancelled late arrivals cannot recreate their handoff.

Controlled Playwright/CDP checks used a separate empty temporary profile: Home → workspace took 8,482 ms; workspace → Home took 8,281 ms. Native window sampling never observed zero visible dev windows. The earlier leave baseline was 16,040 ms. These are single development measurements, not packaged performance guarantees. Eight seconds remains slow; cold startup has not been independently improved or proven by this checkpoint. Screenshots and timing records are private under `.handoff/workspace-transition/lab-*`.

Focused handshake/IPC/dev-request tests and Node/web typechecks cover the implementation. Native packaged macOS/Windows transitions and failure recovery remain unverified. Application-state namespace boundaries remain in place; this is not an OS sandbox.

## Home startup split — November 11

Desktop entry resolves its pinned owner before loading the renderer. Home loads only its own UI, theme, language and window controls; the full IDE, terminals and session hydration load only inside a project workspace. Workspace hydration now stops StrictMode’s cancelled pass after fetching settings. Arrival acknowledgement runs after mount with a timer fallback because fully occluded windows may not receive animation frames.

One development startup trace reached Home window visibility in 2,440 ms versus 5,032 ms in the earlier trace. End-to-end Leave measurements varied from 5,944 to 8,839 ms under load; opening a workspace still measured 9,333 ms in a direct API measurement. Do not describe the eight-second switching delay as solved. An earlier screenshot-based measurement was distorted by occluded-window capture waits.

Web typecheck and the changed-code quality gate passed. Generated CLI output was rebuilt to include schema-v2 support. Packaged startup performance remains unmeasured.
