# Direct Floci lifecycle proof

Build the test daemon image with Docker; nothing is installed on the host:

```sh
docker build -t bastion-floci-proof-engine:local -f tests/e2e/fixtures/floci/Dockerfile.engine tests/e2e/fixtures/floci
ORCA_BACKGROUND_LAUNCH=1 ORCA_E2E_FLOCI_ENGINE=1 npx playwright test --config tests/playwright.config.ts --project=electron-headless tests/e2e/cloud-targets-floci-engine.spec.ts --workers=1
```

The outer container is a privileged disposable Docker daemon in its own network and cgroup namespaces. It has no host socket, host network or credential mounts, and exposes no TCP daemon API. Privilege belongs only to this test daemon. The production Floci containers use no capabilities, no privilege, a read-only root, a private data bind, a container-scoped outbound syscall policy and an explicit loopback publish. The image application is the fixed entrypoint; the image's root-only ownership wrapper requires capabilities that this provider intentionally omits.

The driver bundles the production controller/catalog/ledger. It checks simultaneous workspace instances, actual engine inspect, an ECONNREFUSED non-loopback connection, denied container-originated connections, isolated S3 fixtures, Stop/Start persistence, target-specific Reset, UUID receipt replay and cleanup. It uses only local HTTP; no real AWS SDK, credentials or endpoints are involved. The daemon's cgroup nesting is initialized by upstream dind; the driver moves itself into its init cgroup before creating child containers. Test hooks never configure the workstation.

The runner removes its uniquely named daemon and anonymous volumes in `finally`; the driver first stops every emulator and checks that the inner inventory is empty. A test failure still removes the whole disposable daemon. Output includes actual inspect and fixed proof markers. Set `ORCA_E2E_FLOCI_ENGINE_IMAGE` to an explicitly built alternative test-daemon image if needed. This does not change the pinned product emulator image.

Linux Docker is the live proof. Rootless Podman signature-policy refusal has a captured regression test; successful native Podman, Docker Desktop and Windows/macOS lifecycle are not claimed. The source-only managed-SSH regression remains separate. Deferred 9.2b contracts stay in `tests/e2e/planned/`; they are not counted as 9.2a passes.

Run this spec from a shell where the host `docker` CLI works. A dev shell that substitutes its own C library (for example a Nix FHS environment) can make the host `docker` fail with a symbol lookup error before the proof starts; the spec itself does not launch Electron, so an ordinary shell with Node and the repository's dependencies is enough.

### Azure/GCP/OCI lifecycle (9.6a)

Using the same already-built disposable engine image:

```sh
ORCA_BACKGROUND_LAUNCH=1 ORCA_E2E_FLOCI_ENGINE=1 npx playwright test --config tests/playwright.config.ts --project=electron-headless tests/e2e/cloud-targets-floci-multicloud-engine.spec.ts --workers=1
```

The daemon fixture is looked up locally and started by immutable image ID. The inner
production controller pulls only reviewed product index digests for linux/amd64.
It exercises two namespaces per provider, direct Start/Stop/Reset, actual inspection,
readiness and receipt replay. The data-retention sentinel proves directory lifecycle,
not emulated resource listings (9.6b). The driver runs non-root with access only to the
existing disposable-daemon socket group; nothing changes host groups or policy.
The outer test daemon remains privileged as described above, while product containers
retain readonly root, no capabilities, no-new-privileges, non-root UID, outbound-blocking
seccomp and single loopback publication. Cleanup uses recorded IDs, not global prune.
