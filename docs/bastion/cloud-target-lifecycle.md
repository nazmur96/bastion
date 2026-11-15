# Private Floci AWS targets (slice 9.2a)

Connections can reserve and explicitly Start or Stop a native local Floci AWS instance. Reset stops it, deletes only its private data folder, and starts it again after target/instance/epoch-specific confirmation. These are direct owner actions with durable receipts, not reviewed infrastructure changes. Navigation and selection never start an engine. Real AWS targets remain metadata only. Azure, GCP and OCI metadata is retained; this slice runs AWS only.

The controller builds every engine argument. It pulls only `floci/floci@sha256:5ee85db604c4aa74ac76e07ea5cc83086f37bb472bf3dbb97e34019e48efae9c`, checks the resolved image ID, and publishes exactly `127.0.0.1:<reserved port>:4566/tcp`. It gives each workspace/target a unique container, dedicated bridge, leased port and private data directory. No socket, credentials, project directories, privilege, devices, extra capabilities or host network are passed to Floci. Stop removes the admitted container/network but preserves data. There is no machine prune or automatic stop of foreign resources.

The pinned image's application is the fixed entrypoint. Its root ownership wrapper needs capabilities omitted here; the application instead runs as the owner's UID/GID and the owner creates its private data directory. Fresh inspection checks ownership labels, full container/image identity, mounts, port binding, network membership, environment, entrypoint and security policy. Readiness requires `completed.ready=true` from `GET /_floci/init` on literal loopback, following the pinned image's readiness script without its timed-success fallback. No proxies, redirects, DNS lookup, AWS SDK or credential provider are involved. The image's in-container health probe is disabled because it opens an outbound socket; Bastion performs the check externally.

A Docker internal bridge does not publish the required host port. Instead the container uses a dedicated ordinary bridge plus a scoped seccomp profile. The profile inherits the vendored, commit-pinned Apache-2.0 Moby default restrictions and removes `connect`, `sendto`, `sendmsg` and `sendmmsg` from its allow rules. A fixed `connect` denial returns ENOENT, matching the pinned image's missing-socket behavior rather than triggering Docker-client retry delays. Accepted HTTP sockets still work through read/write/writev. The profile applies only to this container; no host firewall, daemon configuration or workstation policy changes. Engines unable to enforce it fail closed. This is a constrained emulator runtime, not a sandbox against a compromised engine or another process with owner-level daemon access. Features requiring outbound clients, init hooks or child containers are unsupported in this slice.

Engine invocation uses a fresh allowlisted process environment, a private HOME/DOCKER_CONFIG and empty registry auth. Ambient cloud credentials, Docker contexts, proxies and container configuration are excluded. The renderer cannot supply argv, socket, path, environment, URL or image. Optional owner configuration at `<workspace-data>/bastion-cloud/engine-connections.json` accepts only explicit local Unix sockets or Windows named pipes; public TCP and SSH daemons are refused. Neither Docker nor rootless Podman is installed/configured by the app. Inaccessible sockets, missing Podman signature policy, unavailable image and occupied port receive fixed diagnoses without raw subprocess output or privilege escalation.

## Storage and concurrency

`bastion-cloud/targets.db` schema 2 keeps the existing catalog/selections, instance manifests and short-lived source admissions. `bastion-changes/changes.db` schema 4 adds lifecycle receipts to the existing change ledger. Private directories/files are hardened; symlinked control/data/configuration paths are refused. Credentials and source contents are not stored. Old source histories and aliases retain their identity and do not inherit today's selection.

A transactional instance gate permits one lifecycle operation or admitted source run at a time across processes. UUID receipts are replayed without another engine call. An admitted operation retains its original instance when another target is selected. Explicit lifecycle mutations increment its epoch. Refresh uses compare-and-swap observation so a delayed probe cannot overwrite a newer admission. A definitely exited owner produces interrupted evidence even if its engine is unavailable; ambiguous liveness remains busy/unknown. Stopped/unknown resources are never called absent merely because a request timed out.

Catalog and ledger are separate durable transactions. Receipt admission precedes every engine mutation; a crash between instance reservation and receipt creation starts no engine work. Source start similarly requires a committed catalog admission before the owner accepts execution. Failure across databases can leave an interrupted/pending record requiring inspection; it cannot authorize unrecorded execution. Pending source admissions expire after 30 seconds; active admissions remain held until completion or a definitely exited owner. No distributed exactly-once guarantee is claimed for an engine whose response is lost.

## Reviewed source binding

Cloud's Targeted source checks opens the existing Step 8 change workflow. Its snapshots record namespace, project/root/owner runtime and routing stamp, selected target, monotonic selection generation, configuration revision, policy fingerprint and instance identity/epoch. The main process re-resolves the owner and compares these values on preparation, review and start. An A→B→A selection invalidates the old review with zero new attempts; notifications are not required for correctness. Target rename does not change the binding. The owner claims the exact committed run/snapshot admission before producing its source receipt. The current adapter checks saved source only and makes no cloud request.

Ordinary source checks remain explicitly targetless, including managed SSH. Remote/unresolved projects never fall back to this machine's cloud state or engine. Older clients lacking new cloud bridge methods get a readable refusal; server-side targetless source execution does not depend on the cloud authority.

## Proof and limits

The disposable-engine harness and its build instructions are in `tests/e2e/fixtures/floci/README.md`. It bundles the production controller/catalog/ledger and proves separate instances, actual inspect, refused non-loopback access, denied container-originated connections, isolated S3 data, Stop/Start persistence, Reset, receipt replay and removal of every inner container. Its privileged outer daemon is test infrastructure only and is removed with its volumes in finally.

Focused tests cover migration, bindings, stale admission, concurrent writers, interrupted evidence, delayed refresh, argument/inspection substitution, private environment and symlink refusals. Electron acceptance uses hidden CDP/native-coordinate clicks with hit/drag checks; screenshots are captured on an isolated display. Linux Docker is the live-supported proof. Successful rootless Podman, Desktop engines, packaged, Windows/macOS and mobile checks are not claimed.

Slice 9.2b remains separate: sealed terminal/agent contexts, five read-only resource listers, legacy sandbox migration/fold-in and dead readiness removal. Deferred red contracts remain opt-in under `tests/e2e/planned/` and are not counted as 9.2a passes. Earlier milestone open items remain open. Nothing in this slice accesses real AWS or performs Terraform apply/destroy.

## Slice 9.6a: Azure, GCP and OCI lifecycle

The existing FlociController now uses shared product descriptors for the three pinned
images in STEP-9-PLAN.md J1. Each descriptor fixes its port, persistence prefix,
readiness predicate, service switches and unavailable client capabilities. There is
one engine/instance/receipt path, not separate provider lifecycle stores. Existing
operation IDs and policy entries are unchanged.

Restricted boot was proved first, before product implementation, on a disposable
Docker engine with linux/amd64 images: non-root UID, readonly root, cap-drop ALL,
no-new-privileges, the existing outbound-blocking seccomp policy, one private data
mount and one literal loopback publish. No restriction was relaxed. Azure requires
`/ready` status UP; GCP/OCI require their product init route's completed.ready=true.
Only Blob, GCS/PubSub and OCI Identity/Object Storage are enabled respectively;
sidecar services, Azure UI, TLS extra listeners and DNS container fallback are off.
Image/root filesystem defaults and service switches are checked during inspection.
Non-AWS startup requires a Linux amd64 owner/engine/image; arm64 and other platforms
are unavailable. Linux Docker is the live proof; successful Podman remains unproven.

Start/Stop/Reset retain the existing admission, target/instance/epoch confirmation,
receipt replay and recovery behavior. The live production driver verifies two
namespaces per provider, actual inspect, fresh readiness, Stop/Start retention and
scoped Reset. Retention uses a private-directory sentinel; it is not a claim of
provider-resource persistence or listing correctness. Proof scripts use the existing
9.2 disposable-daemon image; the non-root driver receives only that daemon's existing
socket group. Emulator restrictions remain unchanged. The daemon and every inner
container are removed by recorded IDs.

9.6b remains separate. Non-AWS client-environment/listing calls refuse in main before
AWS readiness, transport or configuration can run. The existing resources section
shows those limits. The terminal button stays visible and disabled with its product
reason, including OCI's unreviewed signing-key requirement. No dummy key is generated
or persisted. A per-instance disposable OCI signing key is only a possible separately
reviewed follow-up. Non-AWS target-bound source execution is also unavailable; existing
AWS and targetless source workflows remain separate.
