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

## Slice 9.2b — sealed context, read-only resources and the retired sandbox

**Local AWS is one workspace target, not a machine-wide emulator.** The old sandbox ran a single default Floci container for the whole machine and handed its endpoints to any terminal, step run, Terraform plan or Claude chat whose folder sat under a recorded path. That path is removed. Older stored endpoints and credentials are dropped on first read (cluster state is kept), the old shared AWS config file is deleted, and path-only AWS start/stop requests are refused with a pointer to Cloud. The dead cloud-readiness module is deleted; its compatibility IPC keeps returning a fixed unavailable response.

**Environment comes only from main.** For a selected emulated target whose instance is ready and answers its readiness check on its own loopback port, main builds an environment that reaches that endpoint and nothing else: the documented emulator test credentials, the emulated region, a private bare `[default]` config file (so real profiles, SSO caches and `credential_process` are never read), metadata disabled, loopback added to `NO_PROXY`, and empty values for ambient session tokens, web-identity and container-credential variables so an inherited real session cannot pair with the emulator. Step runs and Terraform plan/output requests carry a target reference; main resolves it, and a malformed, stopped or unresolvable target refuses the command instead of falling through to the engineer's real configuration. Renderer-supplied `AWS_*` variables are ignored for step runs. Terminal commands from the infrastructure views refuse while a selected target is not running. **Open terminal for this target** creates a new terminal pinned to the running instance; existing terminals keep their environment. Agent chats no longer receive emulator settings implicitly; explicitly targeted agent launches are not implemented yet. Environment routing is not filesystem isolation.

**Resources (read-only).** Five fixed operations — Resource Groups Tagging `GetResources`, S3 `ListBuckets`, DynamoDB `ListTables`, SQS `ListQueues`, Lambda `ListFunctions` — are built in main and sent unsigned to the admitted loopback port. Results are projected to name and ARN; tag values, object contents, queue messages and function configuration are dropped. Limits: three pages and 500 items per service, 5 s per request, 30 s overall, two services at a time, 1 MiB per response, repeated pagination tokens stop. Each service reports its own status (listed, refused, unsupported, unreadable, too large, timed out, failed), so one failure never hides another; a stopped target says "Start this target to list resources" and never shows an empty list. A listing that outlives its instance or selection is discarded. Ownership is not inferred and nothing can be created.

**Validation.** Unit tests cover the environment builder and authority, the listers (projection, paging, limits, per-service failures, no caller-built requests), the legacy store migration and the fail-closed step run. UI e2e covers the stopped-target resource card and main-side refusals. The live disposable-engine proof now runs the production listers against the pinned emulator: all five returned listed, the created S3 bucket appeared, and the other workspace's emulator did not show it. Not live-tested: an AWS CLI run inside a pinned terminal against a running target.

## Slice 9.3a — real AWS read-only access

A selected native-local project can explicitly verify its own named AWS profile, accept the observed account/role expectation, and read bounded resource metadata or budget-alert evidence. Real targets display **Real AWS**, the selected profile/region, expected versus last observed identity, and a timestamp. Credential expiration is unknown; a saved observation is never current authorization. Cost Explorer is disabled, with a charge notice and disabled action. No real-target terminal, agent, Terraform or arbitrary step-run environment is supplied.

The AWS CLI comes only from a static exact v2 pin in that project's regular root `mise.toml`. Only the `aws-cli` registry backend is supported (an `aqua:` or other AWS CLI backend is unavailable). String pins and tables containing only `version` and inert `symlink_bins` are supported. The resolver computes the owner's mise data directory (`MISE_DATA_DIR`, then `XDG_DATA_HOME/mise`, then the platform default), locates `installs/aws-cli/<version>/`, keeps executable symlinks inside that installation, fingerprints the executable and checks its version. It never invokes mise, searches host PATH for AWS, evaluates project `[env]` or installs/repairs a tool. A different/experimental installation layout is unavailable rather than a reason to guess. Compatible v2 pins begin at 2.32; version and actual live proof are recorded separately rather than claiming all versions/platforms tested.

Main resolves registered worktree/folder ownership before reading a pin or starting a process. Home, Incognito, child frames, foreign IDs and remote/unresolved owners refuse. The real CLI environment is newly built for the selected profile and region using owner HOME and normal engineer-managed AWS provider files. No credential/config/cache bytes are read or copied by Bastion; the CLI's existing provider handles authentication and any standard refresh. Inherited credentials, project environment and emulator endpoint/config values are excluded. Owner-process HTTP/HTTPS proxy and NO_PROXY variables (both cases) and AWS_CA_BUNDLE pass through as reviewed network settings. Configured custom endpoints are ignored, IMDS is off, TLS verification stays on, prompts/pager are disabled, and no automatic login or credential export runs.

Every read batch checks STS at admission and again before publication; service pages classify errors without an STS call per page. Exact configured IAM role expectations are checked using projected IAM GetRole ARN/RoleId against STS identity; a session ARN is not treated as proof of an IAM role path. When no role path can be verified, the UI says that accepting stores an account anchor only. Acceptance is one-use and short-lived, re-verifies the observation, and updates existing expectedAccountId/expectedRoleArn through the normal catalog mutation with a config revision increment. A selection round trip, owner/config/tool change or identity mismatch rejects stale results. No catalog/ledger migration, real binding or auth epoch was introduced.

Only fixed identity/role, five resource-list and three budget-read operations are admitted. Service arguments and queries are main-built, with provider-derived selectors serialized as literal JSON rather than options or file indirection. Resource output is projected to names/ARNs; tags, Lambda environment, payloads, subscriber addresses and raw errors are not returned or stored. Limits: three resource pages and 500 items per service, two services concurrently, bounded process output and deadlines, repeated-token stop, and a 60-second batch deadline. Budget evidence is capped at 20 candidates and 20 calls, with separate present/absent/unknown and incomplete states. A budget is not a spending cap. An independent denial does not hide other resources; an authentication failure aborts the batch.

The known CLI session-expired diagnostic with exit 255 is distinguished from service ExpiredToken. Generic 255 is a general CLI failure, not evidence of expiry. All diagnostics use fixed messages without helper stderr, login URLs or response bodies. Project/profile/helper trust and the lack of an atomic credential snapshot across separate CLI processes remain explicit limits. Observations, results and pending confirmations are memory-only in this slice. Reconnect/reload requires another verification; identities are not converted into a real execution environment.

Controlled tests use an installed fake CLI, a shadow host AWS executable, injected process traps, expiry fixtures, actual catalog updates, and native-coordinate hidden UI checks. The opt-in live test uses a disposable registered project and an already installed owner CLI. Its isolated app HOME remains isolated; only the explicit live fixture links `.aws` for the CLI to use the engineer-managed provider, without copying or reading credential/cache bytes in the harness. No normal test creates that link. The link and pin are removed before app/fixture cleanup. Its operation log contains fixed operation IDs, result counts/status and tool version, never personal profile/account/region/resource values. Profile and region are runtime inputs, with no product defaults.

9.3b retains Cost Explorer and durable read receipts. 9.7 retains real execution bindings/auth generations and the catalog migration. Remote real-AWS owners, packaged/macOS/Windows and exhaustive credential-provider coverage remain separate proofs. Nothing here enables a cloud write or creates a billed resource.

Validation for 9.3a: 83 focused unit tests across 16 suites, 13 serial UI acceptance cases, a separate isolated-display screenshot case, all three typechecks, max-lines ratchet and the changed-code quality gate (base 15a81ddb858a) passed. The authorized opt-in production-adapter proof used already installed AWS CLI 2.38.1: all five resource operations succeeded and account-wide budget alert evidence was present. An omitted empty SQS array is normalized in the fixed CLI projection. No Cost Explorer call, cloud write, host install or container startup was performed. The reviewed screenshot uses synthetic profile, account and resource values.

## Slice 9.3b — Cost Explorer consent and durable read receipts

Cost Explorer stays off until the engineer asks for it. **Fetch Cost Explorer data** is available only after the target's identity is verified and accepted. It opens a confirmation for that target showing the account, profile, principal and the fixed query: DAILY `UnblendedCost` filtered to the verified linked account, the current UTC month to date (end exclusive), sent to the commercial billing endpoint `us-east-1`. The confirmation also warns that AWS may charge for the request. Cancelling sends nothing. On the first day of a UTC month there is no complete day to ask for, so nothing is offered.

Confirming turns the main-held challenge into a one-use grant. The grant lasts 60 seconds and is bound to the window, project, target, selection, configuration revision, owner, tool, verified identity, query and request UUID. The read then:

1. records a durable receipt,
2. checks identity with a fresh STS call,
3. makes exactly one Cost Explorer request (no retries, no automatic next page),
4. checks identity again before showing anything.

A continuation token is shown only as "more data exists". Fetching another page needs another confirmation. Results are cached in main-process memory for one hour, with their observation time and the Estimated flag. Reload, focus, timers, resource refreshes and cache misses never request billing. Refreshing always needs a new confirmation.

Explicit resource, budget and Cost Explorer reads write a receipt to the namespace's change ledger (schema 4→5, additive, transactional). A receipt holds only fixed codes, counts, truncation flags and fingerprints of admitted metadata. It never holds payloads, names, amounts, tokens, grants or credentials.

- **Duplicate request UUID:** a second read with the same UUID returns the existing evidence and never starts a second attempt.
- **Lost result:** if a paid read's result is lost after launch (timeout, crash or owner change), it is recorded as **unknown**, never as success, and is never replayed. At startup the owner marks reads left running by an earlier process as unknown.
- **Limits:** history is capped at 10,000 receipts; at the cap new reads are refused while existing receipts stay readable and running reads can still finish.

The opt-in live proof keeps the paid read behind its own flag (`ORCA_AWS_REAL_COST_PROOF=1`), on top of the read-only proof flag. Its log records the row count, units and status, but no amounts.

## Slices 9.4 and 9.5 — one resources view, and costs

Emulated and real AWS listings now share one view (`CloudResourcesView`), built from a pure normalizer, `normalizeResourceListing`. The view shows:

- the kind (local emulator or real AWS) and the observation time;
- the listing limits: up to 3 pages and 500 items per service;
- for real AWS, that S3 buckets are global while other lists use the target region.

Each service is `listed`, `empty` or `unknown`. A denied, unsupported or failed listing is unknown, carries its own message, and never hides the other services. A truncated list says that more may exist.

An item whose name contains the project's folder name gets a "name matches this project · hint" badge. That badge is a hint only: no tags are read, ownership is never inferred, and nothing is adopted.

Costs:

- **Budget alerts on real targets:** always visible, even before any read ("not checked · a free read"). Reading them stays an explicit action.
- **Floci targets:** they say "Emulated · No charges". Emulated targets have no billing request at all.
- **Cost Explorer results:** they appear under "Observed cost data (not an invoice)".
  - The period total is summed exactly from AWS's decimal strings, then shown at two decimals.
  - If any day is Estimated, the total reads "Estimated total". Otherwise it reads "Total".
  - With mixed units, no total is shown.
