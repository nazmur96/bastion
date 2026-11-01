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

- **B1 Kubernetes panel:** resources of the current context, events, log tail
  (virtualised), restart/rollout actions through the gate. A failing pod links
  to the manifest that created it (labels/annotations ↔ files).
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

## Later

Infrastructure graph view; container layer inspector.

## Out of scope

Running tools on the host for the person; auto-applying anything; storing
cloud credentials (the IDE uses the person's existing CLI logins).

## Testing

Each feature has unit tests for its pure parts (detector, classifier, plan
JSON parsing, secret patterns) and a "Prove it" check in the running app on a
real repo (Podinfo platform repo) without creating billed resources.
