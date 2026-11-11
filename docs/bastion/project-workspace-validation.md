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

## Stable development origins and populated isolation — November 11

The populated proof found that warm development navigation picked whichever renderer port was free. Because localStorage is origin-scoped, revisiting a namespace at a different port missed its saved layout data. The dev runner now saves a renderer port per workspace and Home under the owning profile. A busy saved port refuses the launch rather than silently changing origin. A focused test covers namespace separation, reuse across new runner instances and collision refusal without overwriting the registry.

Two disposable workspaces each contained separate app/infra Git repos, a shell, a Markdown file tab, a browser tab, distinct font settings, localStorage markers and persistent test cookies. The fresh second workspace had no first-workspace repos, storage or cookie. After the origin fix, revisiting Retail restored only its two repos, file/browser/terminal session records, font 15 and Retail storage/cookie; Platform independently retained font 17 and its own records. No real repos, credentials or paid agents were used. Evidence is private under `.handoff/foundation-2026-11-11/`. These checks do not prove every agent provider, task scheduler, remote host or OS sandbox boundary.

## Incognito and Archive — November 11

Home now offers standalone Terminal, Browser, Agent (Claude/Codex) and New file tasks. Each task uses an ordinary isolated namespace with a private scratch folder. Incognito metadata is stored alongside the workspace catalog in schema version 3; task rows are excluded from ordinary Home cards. Closing through Archive and leave or app quit records the task for Archive. Reopen restores its namespace and existing tabs; task setup preserves existing scratch files. File names use the existing language detector; no tools or extensions are installed automatically.

Incognito suppresses automatic Claude panels, infrastructure chrome and terminal docking so the chosen tool owns the main area. Explicit archive controls pass the drag-region check. The UI states that this is project-context separation, not a sandbox; local tools retain host access. External agent authentication and host-global configuration remain separate from the scoped integration stores.

Permanent deletion requires an inline confirmation. The backend requires Home, rejects normal workspace IDs and live task owners, fences task reopening during deletion, refuses live or unverifiable terminal-daemon records and removes only task-owned storage/socket directories. Symlinks inside that storage are unlinked without traversing their targets. The task’s own quit path shuts down its daemon instead of preserving a warm background shell; regular project workspaces retain their existing behavior. Native proof reopened an older terminal task and verified its prior daemon PID was no longer alive after Archive and leave.

Local CDP proofs covered a full-width scratch `.tf` editor, reopening externally saved task contents from Archive, confirmed deletion through the UI, a full-width standalone shell and an about:blank browser. Synthetic two-project isolation records remain separate. Eleven focused catalog/IPC tests and eleven focus/handoff/origin regression tests passed, along with Node, web and CLI typechecks and changed-code quality. Agent choices use the existing launch funnel, but live paid-agent conversations were not launched for this proof. Packaged macOS/Windows, remote tasks and every scheduler/agent-provider path are not yet proved. Closing the last internal tab does not by itself archive the task; use Archive and leave or close its application window.

Cold restart was subsequently repeated with the stable-origin runner: both Retail and Platform retained their respective two repos, restored file/terminal/browser session records, font settings, localStorage markers and persistent cookies. Assertions against the saved cold snapshots passed for both owners.

## Claude fixes independently rechecked — November 11

The current tree passed 61 focused tests across 21 files, with two platform-specific skips, all three typechecks (Node, web, CLI), and the changed-code quality gate. Three template-string lint findings in the newly added packaged-launch test were corrected, and that test was rerun. The existing AppImage was checked against all 262 matching built main-process JavaScript files before packaged validation.

A disposable AppImage profile on NixOS completed Home → Packaged Alpha → Leave menu → Home. The workspace process exited and the destination Home process stayed alive afterward; its own Close button also exited successfully. No installed app was driven.

The visible dev app completed Home → Alpha → Home → Beta → Home → Alpha → Home with separate synthetic folder repos and settings/storage markers. Alpha restored its own marker and font setting. A new Incognito `.py` task held the chosen editor; clicking its final Close tab button returned to Home, recorded an archived task and excluded it from ordinary workspace cards. Archive displayed the readable file name. Two additional Home/Alpha/Home loops checked native window state.

A preliminary monitor counted clients across different workspaces, so its apparent overlap was not evidence of a tiling split. Repeated sampling at 25 ms with mapped/hidden flags found zero same-workspace overlap samples. This is sampled evidence, not a mathematical guarantee of zero milliseconds. Screenshots, current-tree logs and proof results remain private under `.handoff/codex-crosscheck-1111/`. No push. Packaged Windows/macOS, other compositors, FUSE-mounted AppImage launch and paid-agent conversations remain outside this proof.

The commit hook additionally found file-length limits that the changed-code gate did not report. Usage-path initialization and the dev child-shutdown block were extracted without changing their order or behavior. All three typechecks, the complete 61-test focused suite (two skips) and the quality gate were rerun after those extractions; a fresh visible dev startup and runner shutdown were smoke-tested. The packaged GUI proof above preceded these behavior-preserving extractions.
