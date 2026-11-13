# Workspace cloud target metadata (slice 9.1)

Cloud → Connections records target metadata in the active project workspace. Add,
rename, select, clear and remove a real AWS profile reference or a Floci emulator
reference. A label identifies a UUID-backed entry, not a cloud account. Every entry
says **Not verified**. No credentials, profile files, tools or providers are read;
saving/selecting never signs in, starts an emulator, changes a terminal/agent or
executes a cloud operation. Legacy automatic Cloud readiness is gated off.

The catalog is workspace-wide; selection belongs to a registered project (git
worktree or folder). Home, Incognito, foreign UUIDs, untrusted frames, unknown
metadata and stale writes are refused in main. Remote/unresolved owners are
unavailable; no desktop credential/tool/file fallback runs for them. Managed remote
source checks remain available through their existing owner transport, independently
of this feature. Web/mobile clients without this desktop bridge report unavailable.

Main owns `<namespace dataRoot>/bastion-cloud/targets.db` using the existing SQLite
wrapper, transactions and file hardener. Its directory is private, and symlinks,
non-regular storage entries and unknown newer schemas are refused. The trusted
namespace ancestor assumption is unchanged; this is not a hostile-filesystem sandbox.
Windows relies on the existing private userData ACL rather than POSIX mode bits.

Schema 1 has targets, selections and meta/revision tables. Target records contain
bounded identifiers/configuration only: profile name and region for real AWS;
provider, Floci version, local runtime and optional requested port for emulation.
No arbitrary endpoint, persistence path, environment map, token or credential field
is accepted. Main derives namespace and project ownership, never from renderer roots.
Target UUIDs survive rename. Removal tombstones metadata and clears its selections;
there is a conservative cap of 200 stored target records, including tombstones.

Optimistic catalog revisions reject concurrent stale writers. Selection generations
increase on explicit selection changes/clear/removal; A→clear→A cannot restore an
old generation. Read/focus/timer events do not advance revisions. Owner/root changes
make an old selection unavailable. Renderer views share one revisioned state owner,
subscribe before loading and discard superseded project/owner/namespace responses.
Metadata is not browser-persisted. New provider observation is not implied by reload.

Step 8 cloud binding/migration and CT-05 are explicitly **deferred to 9.2**. Selecting
a target in 9.1 does not invalidate existing source-check reviews or authorize cloud
runs. 9.2 must bind/revalidate targets before the first cloud-bound action. It also
must pin tested emulator images, handle Podman policy failures honestly, validate
endpoints and prove loopback-only exposure and least-privilege socket access. 9.3
must re-verify short-lived identity at use and distinguish CLI session expiry from
service-side ExpiredToken. Nothing here claims those later behaviors.

Focused tests cover storage/IPC authority, privacy markers, concurrent revisions,
folder/worktree owner routing and shared-state races. CDP acceptance uses disposable
project workspaces and checked, uncovered click targets; no native focus or real
cloud is required. Managed-SSH source regression uses the existing disposable Docker
SSH harness. Linux development proof does not imply packaged/macOS/Windows proof.

The app uses `flake.nix`, not a root mise.toml. Floci pins belong in managed project
environments. Historical spike tests are opt-in, require Floci on PATH and skip when
it is missing; they never install tools.
