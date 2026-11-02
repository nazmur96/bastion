# DevOps / platform IDE — design

Fork: `nazmur96/orca`, branch `claude-first`. Date: 2026-11-01. Approved in chat.

## Goal

Most IDEs and agent environments are built for application developers: a local
codebase that compiles. This fork becomes the IDE for **DevOps and platform
work**, where the infrastructure is the project and the running environment is
part of the workspace. Claude stays the agent at the centre; the IDE gives it,
and the person, the infrastructure context and the safety rails that general
editors leave to extensions.

## Principles

1. **One click, or no click.** Every feature is reachable from a visible button
   or the command palette, and the right ones are _suggested_ from what the
   person is doing (see Toolbelt). Nothing needs a manual or a config file to
   start.
2. **Shareable.** It must work for someone who is not on this machine:
   - no hard dependency on NixOS, DevPod, mise or a particular cloud;
   - every tool is detected, and a missing one shows a one-line "how to get it",
     never an error;
   - safe defaults; anything that can cost money or change infrastructure is
     opt-in per action;
   - each feature can be turned off in Settings → DevOps.
3. **Tools run where the project lives.** `terraform`, `kubectl`, `aws`,
   `helm`, `infracost`… are resolved per workspace, in this order: the
   workspace's dev container or SSH host → the repo's `mise.toml` /
   `devenv.nix` / `.tool-versions` → `PATH`. The IDE never installs them on
   the host.
4. **Claude plans, people apply.** Claude may read, plan and diff freely.
   Changing, destroying or paying for infrastructure always passes a human
   approval that shows exactly what will happen.
5. **Plain processes, no new engine.** Work runs in Orca's main process and
   `orcad` service as child processes; the renderer only draws what is visible
   (virtualised lists for logs). A native helper is written only if a
   measurement shows a bottleneck.

## Targets: local sandbox or real

Every workspace points at a **local sandbox** or **real infrastructure**, and
most features behave differently on each:

|         | Local sandbox (free, safe)                         | Real (billed, careful)      |
| ------- | -------------------------------------------------- | --------------------------- |
| Cloud   | Floci (local AWS emulator)                         | the person's cloud account  |
| Cluster | vind (Kubernetes in a container)                   | EKS or another real cluster |
| Later   | vCluster (throwaway virtual cluster in a real one) |                             |

The context bar (A1) shows the target, green for local and red for prod; the
safety gate (A2) relaxes on local targets; cost (C1) only counts real ones.
People practise locally and touch real infrastructure for the final checks.

## Foundation

### F1 — Project detection and the Toolbelt

A small detector reads the workspace and reports which stacks are present,
with evidence:

| Stack                | Detected from                                                                    |
| -------------------- | -------------------------------------------------------------------------------- |
| Terraform / OpenTofu | `*.tf`, `.terraform.lock.hcl`, `*.tfvars`                                        |
| Kubernetes           | manifests with `apiVersion`+`kind`, `kustomization.yaml`                         |
| Helm                 | `Chart.yaml`                                                                     |
| Argo CD              | `Application` / `ApplicationSet` manifests                                       |
| AWS                  | Terraform `aws` provider, `~/.aws/config` profiles, `samconfig.toml`, `cdk.json` |
| Containers           | `Dockerfile`, `Containerfile`, `compose.yaml`, `.devcontainer/`                  |
| CI                   | `.github/workflows/*.yml`, `.gitlab-ci.yml`                                      |
| Secrets              | `.sops.yaml`, `*.enc.yaml`, `.env*`                                              |
| Ansible              | `ansible.cfg`, `playbook*.yml` with `hosts:`                                     |

The **Toolbelt** is a strip at the top of the workbench (and a palette group,
"DevOps: …") that shows only the actions that fit, e.g. for a Terraform repo:
`Init` · `Validate` · `Plan` · `Drift check` · `Cost`. It ranks actions by
context:

- the open file (a `.tf` file brings Terraform first, a manifest brings
  Kubernetes);
- the chat: when Claude or the person mentions a stack ("terraform plan",
  "the pod is crashing"), a suggestion chip appears under the reply, e.g.
  **▶ Run terraform plan** or **📜 Tail logs for podinfo**;
- the state: after a Plan, `Apply this plan` appears; an uncommitted manifest
  change brings `Diff against cluster`.

Each action runs in a workbench terminal (visible output, never hidden), via
the tool resolver (principle 3).

### F2 — Tool resolver

`resolveTool(workspace, name)` returns how to run a tool in this workspace
(`devpod ssh … --`, `mise exec --`, plain path) or a "missing" result with a
hint. Shared by every feature.

### F3 — Dev container per workspace

A DevPod VM recipe plugin for Orca's **Per-Workspace Environment**
(Settings → Experimental → Cloud VM): `create` runs `devpod up` on a checkout
of the workspace's commit and answers with the `<id>.devpod` SSH target and
`/workspaces/<id>`; `destroy` deletes it. Shipped as a plugin, so anyone with
DevPod can install it. Upstash Box (existing community plugin, free tier) is the
documented cloud option. The fork reports the upstream version it is based on,
so such plugins are not refused.

### F4 — Local sandbox

One-click Toolbelt actions **Start local AWS** (Floci) and **Start local
cluster** (vind): start the container on Docker/Podman, then inject its
settings (`floci env` endpoints, the vind kubeconfig context) into the
workspace's terminals and Claude's commands. Stop/sleep/wake/delete from the
same menu. Floci's dashboard opens in the browser pane. Before relying on
Floci for a task, check its coverage of the services involved (EKS, IAM).

### F5 — Inner-loop tools

When the Toolbelt sees a `Tiltfile`, `skaffold.yaml` or `okteto.yml`, it
offers up/down actions and opens the tool's web UI in the browser pane. Kept
light: Tilt is in maintenance mode.

## Phase A — Safety (no cloud needed)

### A1 — Context bar

Always visible in the status bar: kube context / namespace, AWS profile ·
account · region, Terraform workspace, active SSH/dev-container host. A context
whose name matches `prod|production|live` (configurable) turns red. Click to
switch (context picker, `aws sso`/`aws login` hint). Claude's prompts include
the current context.

### A2 — Infra safety gate for Claude

The PreToolUse hook (already used for edit review) classifies every Bash
command Claude runs:

| Class   | Examples                                                                    | Default                                      |
| ------- | --------------------------------------------------------------------------- | -------------------------------------------- |
| read    | `kubectl get/describe/logs`, `terraform show`, `aws … describe-*`           | allowed                                      |
| plan    | `terraform plan`, `kubectl diff`, `helm template`, `argocd app diff`        | allowed                                      |
| change  | `kubectl apply/scale/rollout`, `helm upgrade`, `terraform apply <planfile>` | approval card                                |
| destroy | `terraform destroy`, `kubectl delete`, `aws … delete-*`                     | approval card, typed confirm on red contexts |
| billed  | `aws … run-instances/create-*`, `terraform apply` with creates              | approval card with cost when known           |

Card shows the command, the context (from A1), and for Terraform the plan
summary (`+3 ~1 −0`). `terraform apply` without a reviewed plan file is
refused with a hint to plan first. Rules are editable in Settings → DevOps;
the classifier is a pure, tested table.

### A3 — Terraform plan viewer

`Plan` (Toolbelt) runs `terraform plan -out` and `terraform show -json`, then
opens a tab: resources grouped by module with create/update/replace/delete
badges and attribute diffs, plus **Explain with Claude** (risk notes) and a
human-only **Apply this plan**.

### A4 — Secret masking

Values of likely secrets (`*_TOKEN`, `*_KEY`, `password`, Secret `data:`,
`.env`, `*.tfvars` sensitive vars) render masked in the editor until hovered or
toggled; masked values are removed from the editor context sent to Claude.
SOPS-encrypted files show a 🔒 badge.

## Phase B — Live state

- **B1 Kubernetes view = Radar:** instead of building a panel, open Radar
  (open source, runs against the kubeconfig, nothing installed in the
  cluster) in the browser pane beside the chat, and give Claude Radar's MCP
  server, so the person and Claude see the same topology, logs, timeline and
  Helm history. Headlamp is the fallback.
- **B2 Drift:** `terraform plan -refresh-only`, `kubectl diff`, `argocd app
  diff`, summarised in a panel and as gutter marks on drifted manifests.
- **B3 CI panel:** GitHub Actions runs for the branch, failed step logs,
  **Fix with Claude** (reuses Orca's broken-checks fixer).

## Phase C — Cost and process

- **C1 Cost:** Infracost (if present) shows `+$/mo` beside changed resources
  and in the plan viewer; a session meter of resources created this session
  and an **End of session** teardown checklist.
- **C2 Runbooks:** Markdown runbooks with runnable blocks; after an incident
  Claude drafts an RCA (`docs/rca/`).
- **C3 Project tracker:** optional checklist panel driven by a repo file (e.g.
  a DevSecOps template's phases and "Prove it" drills).
- **C4 Policy checks:** checkov / trivy / kube-linter findings as diagnostics.

## Build order

1. F1 Toolbelt + F2 tool resolver (done)
2. F4 Local sandbox (Floci, vind): every later feature is then built and
   tested for free
3. A1 Context bar (local vs real)
4. A2 Safety gate (relaxed on local targets)
5. B1 Radar embed + MCP for Claude
6. A3 Plan viewer, A4 Secret masking
7. F3 DevPod recipe, F5 inner-loop tools, B2 Drift, B3 CI, Phase C

## Later

Infrastructure graph view; container layer inspector.

## Out of scope

Running tools on the host for the person; auto-applying anything; storing
cloud credentials (the IDE uses the person's existing CLI logins).

## Testing

Each feature has unit tests for its pure parts (detector, classifier, plan
JSON parsing, secret patterns) and a "Prove it" check in the running app on a
real repo (Podinfo platform repo) without creating billed resources.

## Whole-product build order (2026-11-02, from the full-product mockup)

Mockup: `.superpowers/brainstorm/223626-1793614571/content/full-product.html`.
Problems first, design second: the Launchpad answers "give me a cluster / demo /
VM", the map is where you land afterwards.

1. **Launchpad** — done (`379674924`): `src/shared/fork-devops-launchpad.ts`
   catalog + `InfraLaunchpad.tsx` on the Infra home; tool status via
   `aiVault:checkLaunchpadTools`. Real tiles are plan / dry-run only.
2. **Launchpad v2** — partly done (`768d8b682`): goal box drafts the ask for
   Claude; Online Boutique demo. Still open: "what do you want to do?" box that hands the goal to
   Claude; multi-node kind config; Online Boutique demo; Upstash Box tile;
   Talos-on-Proxmox tile; per-tile progress instead of a bare terminal.
3. **Running-locally rail** — done (`768d8b682`): list of what the Launchpad started (clusters,
   VMs, Floci) with stop / delete, so nothing is left running.
4. **System map** — v1 done (`c0a970267`, `b9e04aa2c`): one read-only
   `kubectl get -o json` (+ Secret names only) → four lanes, health, blast
   radius, inspector with Logs / Describe / Ask Claude. Open: Source and Drift
   tabs (map node → manifest in the repo), Radar topology as a richer feed,
   Environments view (C).
5. **Lenses and command deck** — done: health, blast radius and security
   lenses (`562327bdc`), Source tab (`c065f322c`), `:` deck (`34b50c561`);
   running list probes each local cluster's API. Open: cost lens (needs a
   price source), Drift tab, demos should also require the cluster's API to
   answer (today they only check the context is local).
6. **Release flight**, **Time machine**, **Incident mode** — later.

### Progress 2026-11-02 (evening)

Done: demos gated on a cluster that answers (`f1041923e`), A4 secret masking
(`d2bd9c53c`), A3 plan viewer (`6411fea80`), B2 drift — refresh-only and
`kubectl diff` (`d167a89eb`), B3 pipeline card over Orca's checks panel
(`977e6e457`), C1 End session (`7d4825504`), C4 scan tiles + 3-node kind
(`ba3452ebe`).

Open: cost (Infracost in the plan viewer, needs a free API key), Environments
view, Radar topology as map feed, Upstash Box / Talos tiles, per-step
Launchpad progress, C2 runbooks, C3 tracker, F3 DevPod recipe, Release flight /
Time machine / Incident mode. A4 limit: Claude's own Read tool still sees raw
files; masking covers what the editor sends.

## Project path (2026-11-02) — supersedes "tool tiles" as the Infra home's centre

People start from a project ("the team gave me this app"), not from a tool.
The Infra home reads the workspace, works out how far the project has got,
and offers the next step as one click. Generic tool tiles and demos move to a
folded **Playground** section.

### Repo layouts — both are first-class

- **One repo:** app code, manifests/chart, Terraform and GitOps config together.
- **Split repos:** sibling folders under one parent, e.g. `<project>/app`,
  `<project>/<app>-gitops`, `<project>/platform`. The IDE finds siblings by
  looking at the parent folder (git repos whose names share the app's name or
  contain `gitops` / `platform` / `infra`, or that reference the app's repo URL)
  and shows them as one project. The person can confirm or correct the
  grouping; the choice is stored per project, never guessed silently.
- Each stage below reads "the project", whichever repo holds the part it needs
  (manifests from the app or gitops repo, Terraform from platform).

### Stages

| Stage              | One click does                                                                                                                                                                                       | Tools                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 0 Understand       | Claude summarises the app: what it is, what it needs (DB, cache, env, ports), what is missing (probes, limits, chart)                                                                                | detection, Claude                      |
| 1 Run it           | build the image and run it, or open the dev container                                                                                                                                                | docker/podman, DevPod                  |
| 2 Local cluster    | cluster named after the project; **this app's** image built and loaded; **its** manifests/chart deployed; appears on the map                                                                         | kind/k3d/vind, helm/kustomize          |
| 3 GitOps           | **Deploy this repo with Argo CD**: reuse or install Argo CD (never overwrite an existing one), create an Application for the repo/branch/path, sync, wait for Synced/Healthy, open the UI on the app | Argo CD                                |
| 4 Harden           | scan findings as problems on the files; Fix with Claude makes a reviewable branch                                                                                                                    | Trivy, Checkov, kube-linter            |
| 5 Cloud infra      | the EKS sequence below                                                                                                                                                                               | Terraform, Infracost                   |
| 6 Ship             | image to the registry via CI; Argo CD on the cloud cluster syncs the app                                                                                                                             | CI, ECR, Argo CD                       |
| 7 Day 2 + teardown | monitoring for this app's namespace, drift, incidents; End session with destroy                                                                                                                      | Prometheus/Grafana, drift, plan viewer |

GitOps limits the UI states plainly: Argo deploys **pushed** commits only (warn
on unpushed work); private repos need a read credential (added only after
asking); resources first applied by hand are adopted on sync (said before
syncing); stages 2–3 target local clusters only.

### EKS (stage 5) — a guided sequence, every billed step approved

1. **Who and where:** detect the keyless login (SSO / federated profile, never
   access keys), show account and region, "Who am I"; check a budget alert
   exists and offer to create one.
2. **Infrastructure code:** use the project's Terraform if it has some;
   otherwise **Scaffold platform**: Claude writes VPC + EKS + node group from
   pinned community modules, with remote state, into `platform/` or a new
   sibling repo, on a branch, nothing applied.
3. **Rehearse** what Floci emulates (state bucket, IAM, registry flows) for free.
   EKS itself is not assumed to be emulated.
4. **Plan → cost → policy → approve:** plan viewer, Infracost (monthly and
   hourly), Checkov/Trivy on the Terraform, then a two-click approve showing
   account, region and cost. Claude can explain, never apply (A2 gate).
5. **After apply:** kube context added; context bar shows real/prod; the map
   and Radar switch to the new cluster; a cost meter runs ("2h 10m, ≈ $0.65").
6. **Bootstrap:** stage 3 on the cloud cluster, gated.
7. **Teardown:** End session lists billed resources this session created;
   Destroy goes through plan → approve; closing the app with billed resources
   still up asks first.

### Every tool, project-aware

| Tool                          | Generic (Playground) | Project-aware (path)                                     |
| ----------------------------- | -------------------- | -------------------------------------------------------- |
| kind / k3d / vind             | empty cluster        | project cluster with this app deployed                   |
| Floci                         | local AWS            | this project's Terraform planned and applied against it  |
| Argo CD                       | — (removed)          | Deploy this repo                                         |
| Monitoring                    | stack install        | plus dashboards/alerts for the app's namespace           |
| Trivy / Checkov / kube-linter | terminal output      | problems on files + Fix with Claude                      |
| DevPod                        | `devpod up`          | the repo's devcontainer, scaffolded by Claude if missing |
| Multipass                     | blank VM             | VM for the repo's Ansible / install scripts              |
| eksctl / kops dry runs        | removed              | replaced by the EKS sequence                             |

### UI

Top of the Infra home: a stepper (`✓ Understood · ✓ Runs locally · ● Local
cluster · ○ GitOps · ○ Hardened · ○ Cloud · ○ Shipped`) with the next step as
the primary button; the system map beneath; Playground and raw tools folded
below.

### Build order for this section

1. Replace the Argo CD tile with **Deploy this repo**, with its fixes: detect
   and reuse an existing Argo CD, stop on first failure, read the admin
   password without `base64` (Windows), open the UI in a browser tab.
   Re-check every remaining tile for the same faults and test each one live on
   a throwaway cluster.
2. Project detection, including sibling repos (both layouts).
3. Stage 2 (this app on a local cluster).
4. The stepper.
5. The EKS sequence (stage 5), then 6 and 7.
