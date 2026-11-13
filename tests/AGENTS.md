# Automated App Launches

- Set `ORCA_BACKGROUND_LAUNCH=1` for all tests and agent-launched apps. Use
  [`orca-app.ts`](e2e/helpers/orca-app.ts) / [`orca-restart.ts`](e2e/helpers/orca-restart.ts);
  raw `electron.launch()` calls must pass the env explicitly.
- Keep windows hidden and drive renderers through Playwright CDP. Never reveal windows,
  steal focus, or activate the app on the user's desktop. `@headful` is for tests requiring
  real pixels; it does not authorize foreground activation. Never set `ORCA_E2E_FOREGROUND=1`
  on the desktop.
- Run native-focus and visible-window tests only on an isolated display or CI.
- Rebuild modified launch-policy code before launching; stale wrappers are unsafe.
- Only the [terminal perf](e2e/terminal-perf-presentation.ts) and
  [native IBus](e2e/terminal-native-ibus-window.ts) fixtures, and the guarded
  [native browser image-focus test](e2e/browser-image-link-focus.spec.ts), may explicitly present windows
  on their isolated hosted-CI Xvfb displays. Preserve their guards and keep
  `ORCA_BACKGROUND_LAUNCH=1`; do not generalize these exceptions to other fixtures or
  production launch policy. Background terminal panes stay hidden.
- The browser image-focus test also permits an isolated Docker Xvfb display, with
  `ORCA_E2E_BROWSER_NATIVE_XVFB=1`; desktop runs must skip it.

# Bastion Project Workspaces

- Bastion opens application Home on a cold launch, and Home loads no workbench or
  `window.__store`. The `orca-app` fixture therefore seeds a project workspace and launches
  straight into it (`bastionWorkspace`, default `'E2E workspace'`). Use
  `test.use({ bastionWorkspace: null })` only for specs about Home itself.
- Helpers live in [`bastion-workspace.ts`](e2e/helpers/bastion-workspace.ts): `openBastionPage`
  navigates the workspace desktop, `activeBastionWorkspace` reports the active workspace.
  Reuse the existing Docker SSH host fixtures for remote projects rather than new ones.
- `window.__store` exists only in the e2e build; run without `SKIP_BUILD=1` after changing
  renderer code, or the store will be missing.
- Inherited upstream specs that drive Orca's original workbench UI (for example the Add
  project dialog) may need updating for Bastion's workspace desktop.
- Open issue: in local runs, three or more concurrent Bastion launches never exposed
  `window.__store` (serial and two-way runs passed). Prefer `--workers=1`, as CI does,
  until the cause is found.
