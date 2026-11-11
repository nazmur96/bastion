import { PROJECT_WORKSPACE_HOME_ID } from '../../../../shared/fork-project-workspaces'

async function startDesktop(): Promise<void> {
  const api = window.api?.projectWorkspaces
  const snapshot = api ? await api.list() : null
  if (snapshot?.activeId === PROJECT_WORKSPACE_HOME_ID) {
    const { renderApplicationHome } = await import('./home-entry')
    await renderApplicationHome()
  } else {
    await import('../../main')
  }
}

void startDesktop().catch((error: unknown) => {
  console.error('[desktop] Startup failed', error)
  // Keep the existing recovery boundary available if the lightweight entry fails.
  void import('../../main')
})
