# Floci 9.0 captured fixtures

Captured 2026-11-13 from Floci CLI **0.4.0**. The temporary root mise pin used
for the spike was removed during 9.1 review: this app uses flake.nix.
These are observations, not mock claims or guarantees of full emulator API coverage.
Every command capture records argv, exit status, stdout, stderr and timestamp where
retained. Credential-shaped JSON values were redacted in memory **before writing**,
including dummy AWS keys and Azure's connection string. Some harmless fields with
secret-shaped names are conservatively redacted too. No credential files are fixtures.

`image-digests.json` records exact server images actually resolved from the CLI's
mutable default `latest` tags. Pin those digests with `--image` when reproducing;
pinning the CLI alone does not pin emulator behavior.

- `{aws,az,gcp,oci}-{status,env,services}.json`: ready-state JSON captures.
- `*-start.json`: actual lifecycle results; rootless Podman failed; rootful succeeded.
- `aws-list-*.json`: unsigned local API listing results for five AWS services.
- `isolation-*.json`: one local bucket created on Alpha, visible there and absent on
  simultaneous Beta, then deleted. Port inspection proves separate published ports.
- `aws-session-expired.json`: actual initial CLI credential-provider refusal,
  transcribed from terminal output after the temporary error file was reused for
  successful renewal. It is **not** a service-side STS ExpiredToken response.
- `cleanup.json`: inventory and owned-container removal results, captured at the end.

## Reproducing the spike

This is an explicitly provisioned Linux reference harness, not product setup.
The opt-in tests require `floci` on PATH and skip when it is unavailable. Supply it
from an existing dev shell or a managed project's pinned environment; the tests never
install it. This app's tooling owner is `flake.nix`, with no root mise.toml.
The historical captures used a disposable toolbox and container-local binaries;
the current test runner invokes the available CLI directly, without assuming that
old toolbox, root process or filesystem layout exists.

Using the pinned image digests, run Floci from the chosen environment using its authorized Docker-compatible socket
and the recorded `--container` and `--port`:
AWS Alpha 14566, AWS Beta 24566, Azure 14577, GCP 14588, OCI 14599.
Start and wait for readiness before captures; `--detach` alone does not prove readiness.
The CLI defaults bind published ports on all interfaces; isolate the test machine
appropriately. Loopback-only exposure must be solved before product lifecycle work.
Do not treat these fixed test ports/names or root tooling process as product defaults.

```sh
ORCA_BACKGROUND_LAUNCH=1 ORCA_FLOCI_SPIKE=1 \
  ORCA_FLOCI_SPIKE_CAPTURE_DIR=tests/e2e/fixtures/floci-spike \
  npx playwright test --config tests/playwright.config.ts \
  --project=electron-headless cloud-targets-spike.spec.ts --workers=1
```

Optional `ORCA_FLOCI_SPIKE_PODMAN=1` checks a separately provisioned rootful Podman
instance named `bastion-step9-podman-rootful` on port 34566, through its explicit
`ORCA_FLOCI_SPIKE_PODMAN_SOCKET` environment value. Socket access must already be authorized; the harness
neither reconfigures the workstation nor escalates the desktop app.

AWS CLI 2.40.0 runs in disposable official containers with **no credential mount**,
`--no-sign-request` and hardcoded local endpoints for emulator checks. Only the local
S3 isolation bucket is created/deleted. Real AWS probes are a different opt-in spec,
`cloud-targets-aws-spike.spec.ts`, requiring engineer-renewed CLI login and explicit
`ORCA_AWS_SPIKE`, `ORCA_AWS_SPIKE_PROFILE`, `ORCA_AWS_SPIKE_ACCOUNT` and optional region.
Its private capture directory is set with `ORCA_AWS_SPIKE_CAPTURE_DIR`; never point it
at committed public fixtures. It mounts existing auth read-only and makes only STS
and Budgets read calls; subscriber addresses and credential values are not captured.

Always remove every container provisioned for the spike, including failed/created
AWS CLI containers with label `bastion.validation=step9-spike-aws`, and the tooling
container. Rootful and rootless Podman have different inventories from Docker; inspect
and clean each through its own socket before removing the toolbox. Never prune a daemon
or stop containers belonging to other projects. This suite does not provision or own
an application's normal dev environment.
