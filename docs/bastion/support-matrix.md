# Bastion support matrix

What the first release supports, where it runs, and what it does not do yet. "Supported"
means proven end to end on that platform. Anything not listed as supported is planned, not
promised.

## Platforms

| Platform             | Status            | Notes                                                                |
| -------------------- | ----------------- | -------------------------------------------------------------------- |
| Linux x64 (AppImage) | **Supported**     | Built and smoke-tested. `.deb`/`.rpm` packages are not produced yet. |
| Linux arm64          | Not yet validated | Builds are configured but untested.                                  |
| macOS                | Not yet validated | Needs a macOS build runner.                                          |
| Windows              | Not yet validated | Needs a Windows build runner.                                        |

## Where a project runs

| Owner                                  | Status                                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| This computer                          | **Supported**                         | All features below.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| SSH host with a managed Bastion server | **Partly supported**                  | Files, terminals, source checks and changes, delivery evidence, workload diagnosis and journey checks run on the host with its own tools and credentials. Cloud targets (Floci, real AWS) and source writes from the Delivery page (promote, runbooks) are refused with an explicit message: use the editor and Source Control there. Installing the managed server from a packaged build needs the full multi-platform server template (not in the first Linux build). |
| Docker SSH dev environment             | **Supported** for files and terminals |                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Features

| Area              | Shipped                                                                                                                                                                                                                                                                                | Not yet                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Workspaces**    | Independent project workspaces, application Home, Leave/resume, Incognito tasks, Archive                                                                                                                                                                                               |                                                                                                               |
| **Discovery**     | Source evidence (Kubernetes, containers, Terraform, CI), unknown operational questions, reviewed service contracts                                                                                                                                                                     | Broader parsers                                                                                               |
| **Changes**       | Reviewed source checks and new-file changes executed on the owner, with receipts                                                                                                                                                                                                       |                                                                                                               |
| **Cloud targets** | Floci emulators (AWS, Azure, GCP, OCI) with lifecycle and read-only listings; real AWS identity verify/accept, resources, budgets, opt-in one-use Cost Explorer reads                                                                                                                  | Real Azure/GCP; cloud targets on remote owners                                                                |
| **Recipes**       | Bucket, bucket binding, secret reference, PostgreSQL, container registry, workload role, generated as ordinary Terraform; validation with the project's pinned Terraform; apply/destroy on Floci; **apply/destroy on real AWS** with a plan preview, one-use confirmation and receipts | Docker-backed services on Floci (RDS, ECR, EKS…) are validate-only locally; real-AWS changes on remote owners |
| **Delivery**      | Evidence chain from revision → CI → artifact → registry → deployment config → Argo CD → running pods; guarded digest promotion and rollback                                                                                                                                            | ECS/Fargate and Flux adapters; private registries                                                             |
| **Operations**    | Workload diagnosis (rollout, containers, events, bounded redacted logs, image → commit); journey checks with append-only history; repository-owned runbooks and recorded recovery drills                                                                                               | Metrics/traces connectors, backup and certificate evidence, recurring tasks                                   |
| **Language**      | English. Bastion's own pages are English-only; inherited upstream screens are translated                                                                                                                                                                                               | Translations of Bastion's pages                                                                               |

## Safety model and its limits

- **Unknown is never healthy.** A source that cannot be read (denied, unreachable, expired
  sign-in, missing tool) is shown as unknown with its reason, never as empty or passing.
- **Your tools, your versions.** Tools come from the project's own `mise.toml`; there is no host
  fallback.
- **Real AWS changes:**
  - **Preconditions:** they need a verified and accepted identity and re-check it before
    running.
  - **Plan and confirmation:** each one shows the Terraform plan, and confirming applies
    exactly that saved plan, once.
  - **State:** Terraform state stays in the recipe directory (ignored by Git), so plain
    Terraform can always inspect or destroy what Bastion created.
  - **Limits:** they do not undo data loss, and the confirmation is not a spending cap.
- **Rollback** is the same reviewed digest pin with an earlier revision. It does not undo data
  or schema changes or external side effects, and the controller's sync policy decides when it
  takes effect.
- **Credentials** are never stored by Bastion. Real AWS uses your profile's own sign-in;
  Bastion reads no keys.

## Known issues

- The workspace navigation scrolls at small window heights.
- Some low-level error and log messages from the background process still use the upstream
  name; visible product text says Bastion. The `orca` CLI command, `~/.orca` paths and `ORCA_*`
  variables keep their names so existing setups keep working.
