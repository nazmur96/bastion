# Cloud provider adapter contract — real Azure and real GCP

Design only, prepared for slice 9.6 review. Neither provider is implemented, verified
or enabled by this document. The real-target catalog continues to accept AWS only.
Emulated Azure/GCP and real Azure/GCP are different adapter kinds and authority domains.
Real OCI is outside this contract. STEP-9-PLAN.md Part J owns emulator scope.

## Common ownership and operation boundary

Extend the current CloudWorkspaceProvider, typed operation allowlists, shared Cloud
state/view and ChangeLedger evidence. Reuse their mechanics; do not route Azure/GCP
through an AWS account/role model or add a second connection/credential store.

An owner-resolved request contains namespace/project/target IDs, selection generation,
configuration revision, registration/runtime stamp, tool/config fingerprints and an
operation UUID. Paths, executable, endpoints, scope selectors and query shape are built
in main. Renderer data never authorizes a credential directory, tenant/project, URL,
command, header or environment. Home, Incognito, remote/unresolved owners and mixed-version
owners without the adapter refuse before desktop files, tools or authentication are used.
Remote support is a separate owner method and proof, not a local fallback.

Proposed conceptual adapter responsibilities (not new callable APIs today):

1. Resolve declared owner tool/client and registered provider configuration reference.
2. Verify selected scope and record bounded identity observations with explicit assurance.
3. Propose/accept identity expectations through normal revisioned target metadata.
4. Build an admitted fixed read operation and run it under that owner/provider context.
5. Re-verify at admission and publication; return projected evidence or a fixed refusal.
6. Record bounded UUID/context/result evidence through the existing real-read ledger.

Project-pinned tools must already be installed. Reuse/generalize static managed-tool
resolution after defining and testing each backend's actual layout/version contract;
never assume the AWS installation layout applies to az or gcloud. No mise evaluation,
installer, extension/component auto-install, update, shell eval or host-PATH fallback.
The application's flake remains its own tool owner.

## Identity and scope are provider-specific

| Field                           | Azure design                                                                                                                           | GCP design                                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Durable target identifiers      | cloud environment enum, tenant UUID, subscription UUID, registered configuration reference, optional principal expectation             | project ID, expected immutable project number, registered CLI configuration/account reference; optional explicit impersonation target only in a later reviewed extension |
| Region/location                 | resource-specific location, not part of subscription identity                                                                          | explicit regional/zone scope per operation; project is global                                                                                                            |
| Session observation             | provider-reported principal reference/type, tenant/subscription observation, checkedAt, expiresAt if safely known, assurance per field | provider-reported principal reference/type, project ID/number/state, checkedAt, expiresAt if safely known, assurance per field                                           |
| Initial fixed verification read | subscription GET for the exact selected subscription                                                                                   | project GET/describe for the exact selected project                                                                                                                      |
| Unknown/denied                  | do not infer tenant/principal from a display name or an expired CLI cache                                                              | project access proves project visibility, not organization ownership, arbitrary resource permission or the cryptographic identity of the caller                          |

The catalog configuration names the requested scope; it is not proof of authentication.
`az account show` and `gcloud auth list` are local/provider-reported metadata, not fresh
server authorization. A verification must perform the fixed authenticated provider
read using that selected context. Compare the returned subscription/project identity
with the requested/accepted expectation. For Azure require matching tenant evidence
where the response supplies it; absent or contradictory tenant assurance stays unknown
and blocks accepting a supposedly verified tenant anchor. GCP project number is the
stable anchor; reject project-number mismatch, deleted/suspended scope or denied access.

Model principal evidence as `{reference, source, assurance}` with assurance distinguishing
provider-reported metadata, server-confirmed evidence and unknown. Do not label a
principal server-verified merely because project/subscription GET succeeds. A stronger
principal-proof mechanism needs its own primary-source design and tests; Bastion must
not export/parse access tokens to manufacture that proof. No universal STS equivalent
is assumed. Accept expectations only to the assurance actually established.

## Real provider environment versus sealed emulation

Real adapters use the engineer's **explicitly selected, owner-managed** CLI/session
provider. Bastion stores configuration references and identity expectations, never
passwords, private keys, access/refresh tokens, client secrets or login-cache bytes.
The external provider may read/refresh its own session; Bastion does not copy, enumerate
or inspect those credential/cache files. No automatic login, account switching command,
new service account, key generation or token-printing operation is allowed.

- **Azure:** use the registered owner configuration and explicit subscription on every
  supported operation. Allowlisted cloud environment determines trusted ARM/authority
  endpoints; renderer/project custom-cloud settings cannot redirect them. Do not
  inherit emulator connection strings, dummy credentials, `AZURE_STORAGE_KEY`, SAS,
  arbitrary tenant/client-secret/federated-token/MSI variables, endpoint overrides or
  unrelated project environment. Do not run `az account set` to mutate shared defaults.
- **GCP:** use the registered owner gcloud configuration and explicit account/project.
  gcloud CLI credentials and application-default credentials are distinct; never silently
  switch between them. Clear emulator hosts, API endpoint overrides, disabled-auth flags,
  access-token-file/raw-token overrides, service-account key-file and impersonation
  settings unless a future explicitly supported identity mode authorizes them. Do not
  run `gcloud config set`, `auth activate-service-account` or `application-default login`.
- Both use a fresh allowlist with owner proxy/CA settings where supported, TLS validation,
  trusted provider endpoints, no prompt/pager/HTTP debug logging and bounded process
  output. Never copy the sealed emulator HOME/config into a real adapter, or engineer
  credentials into an emulated one. SDK support needs an explicitly selected provider
  adapter; a generic default credential chain is not equivalent to the CLI session.

No private profile/account/tenant/project values are product defaults or test fixtures.
Public documentation examples and synthetic test IDs are not credential configuration.

## Read contract, freshness, receipts and presentation

Each fixed operation declares method/service, exact scope derivation, safe projected
response, page/item/byte/time limits and whether it is ordinary, sensitive or chargeable.
Initial verification and metadata listing are read-only; no resource creation,
subscription/project change, API enablement, billing query or secret content access.
An arbitrary `az rest` URL, gcloud command or SDK method is not an allowlist.

Admission compares owner/runtime/tool/selection/config plus fresh scope/identity evidence.
Publication repeats the relevant verification; a changed account, tenant, subscription,
project, endpoint policy, owner or tool discards the result. A→B→A cannot revive a request.
Classify expired/revoked session, insufficient permission, missing scope, unsupported
cloud/version, throttled, timeout and unavailable distinctly without raw provider errors.
Unknown expiry remains unknown, never a perpetual connected badge.

Use existing receipt UUID/context dedup and interrupted/unknown recovery. Persist only
operation IDs, fingerprints, timestamps, fixed status/count/truncation and identity
references needed for accountability, with the same storage bounds/privacy rules.
No provider payload, credentials, raw stderr, pagination tokens or grants. Older schema/
owner capability mismatch refuses; plan any future migration separately and preserve
AWS/emulator history. No catalog or ledger migration is introduced by this design.

Reuse CloudResourcesView, provider-native resource IDs and provider-specific scope
labels. Show **Real Azure** / **Real GCP** prominently, separate observed evidence from
expected identity and emulation. Listing visibility and name hints never adopt ownership.
Billing is unavailable until a provider-specific charge/consent design is reviewed;
AWS Cost Explorer approval does not authorize Azure/GCP costs.

## Required proof before any implementation is called supported

Controlled tools/provider clients must prove: fixed argv/endpoint/scope, no auto-install
or credential export; configured identity versus actual access; principal-assurance
limits; tenant/subscription and project-number mismatch; expired/denied/partial results;
request dedup; cache/reload/timer zero-call defaults; A→B→A; source/tool/runtime changes;
private storage; two workspaces and remote no-local-fallback. Live identity/listing proof
requires a separately authorized disposable project and engineer-owned runtime context.
Real Azure/GCP are **designed, not implemented or claimed** in 9.6.

Primary references consulted:

- [Azure CLI account metadata](https://learn.microsoft.com/en-us/cli/azure/account)
- [Azure subscription GET API and returned scope](https://learn.microsoft.com/en-us/rest/api/resources/subscriptions/get?view=rest-resources-2022-12-01)
- [Azure CLI configuration isolation](https://learn.microsoft.com/en-us/cli/azure/azure-cli-configuration)
- [Google project GET and required permission](https://cloud.google.com/resource-manager/reference/rest/v3/projects/get)
- [gcloud project describe](https://cloud.google.com/sdk/gcloud/reference/projects/describe)
- [gcloud authentication versus client-library authentication](https://cloud.google.com/docs/authentication/gcloud)
- [gcloud configurations and endpoint/auth properties](https://cloud.google.com/sdk/gcloud/reference/topic/configurations)
