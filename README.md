<h1 align="center">
  <img src="docs/bastion/logo.svg" alt="" width="72" valign="middle" /> Bastion
</h1>

<p align="center">
  <strong>A DevOps workbench with Claude built in.</strong><br/>
  From "what is this repo?" to a running cluster, GitOps, hardening and the cloud, one guided step at a time,
  with every command in a terminal you can watch and every change a file you can review.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-early%20preview-c7b8ff?style=flat" alt="Status: early preview" />
  <img src="https://img.shields.io/badge/license-MIT-a8e1ff?style=flat" alt="License: MIT" />
  <img src="https://img.shields.io/badge/Linux%20%7C%20macOS%20%7C%20Windows-f6c4ec?style=flat" alt="Platforms: Linux, macOS, Windows" />
</p>

<p align="center">
  <img src="docs/bastion/screenshot-workbench.png" alt="Bastion: the project path on the left, Claude chat in the middle, the side panel with the project's files on the right" width="960" />
</p>

## What it is

Bastion is a desktop app for working on infrastructure projects with Claude. It keeps three things in view:

- **Project path, on the left.** The steps from an unknown repo to production: _Understood → Local cluster → App
  running → GitOps → Hardened → Cloud → Shipped_. Done steps are ticked, and the next one opens in place with the one
  button that does it. Underneath, a live **system map** of what is running, with the command log of the current run.
- **Claude, in the middle.** The chat is the main tab. Files, diffs and pages Claude or you open (Argo CD, Grafana,
  the app itself) sit as tabs next to it.
- **The side panel, on the right.** _Files · Changes · Terminal · Browser · Checks_: the file tree, git and pull
  requests, your terminals, the project's pages and CI checks in one place.

<p align="center">
  <img src="docs/bastion/screenshot-map.png" alt="The full system map open as a tab, with Health, Metrics, Cost, Blast radius and Security views, and git changes in the side panel" width="960" />
</p>

## Principles

- **Local and free first.** The path starts on a local `kind` cluster and Floci for AWS; nothing is billed until a
  plan you approved says so.
- **Nothing behind your back.** Every command runs in a terminal or a run log you can read; Claude's edits are files
  you keep or undo.
- **Real infrastructure looks different.** A real cluster or AWS account turns the frame amber, shows a running cost
  meter in the top bar, and every apply or destroy asks first.
- **Your tools, your versions.** Tools come from the repo's own `mise.toml` (or its dev container), never from
  the host.

## Status

Early preview. The local path (cluster, app, GitOps, hardening, observability) works end to end on a `kind` cluster;
the cloud steps (EKS plan, apply and ship) are built and rehearsed against Floci, not yet against a real account.
Expect rough edges, and please open an issue when you hit one.

## Run it from source

Requires Node 24 and pnpm (see `packageManager` in `package.json`).

```sh
git clone https://github.com/nazmur96/bastion.git
cd bastion
pnpm install
pnpm dev
```

Installers will be attached to [Releases](https://github.com/nazmur96/bastion/releases) once the first one is cut.

## Credits

Bastion is a fork of [Orca](https://github.com/stablyai/orca) by Lovecast Inc., used under the MIT license; Orca's
original README is kept at [docs/orca-README.md](docs/orca-README.md). The workbench, terminals, editor and agent
runtime are Orca's; the DevOps path, system map, side panel and Bastion's look are this fork's.

## License

[MIT](LICENSE).
