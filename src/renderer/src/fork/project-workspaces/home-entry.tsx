import '../../assets/main.css'
import '../theme/claude-accent.css'
import '../theme/bastion.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ApplicationHome } from './ApplicationHome'
import { ProjectWorkspaceTransition } from './ProjectWorkspaceTransition'
import { WindowControls } from '../../app-shell/WindowControls'
import {
  hasCustomTitleBar,
  MAC_TRAFFIC_LIGHTS_WIDTH,
  WINDOW_CONTROLS_WIDTH
} from '../../app-shell/app-window-chrome'
import {
  applyCachedPluginAppTheme,
  applyDocumentTheme,
  readCachedPluginAppTheme
} from '../../lib/document-theme'
import { i18n, loadRendererUiLanguage } from '../../i18n/i18n'
import { dispatchWindowCloseRequest } from '../../components/window-close-request-coordinator'

export async function renderApplicationHome(): Promise<void> {
  const settings = await window.api.settings.get()
  const cached = readCachedPluginAppTheme()
  applyDocumentTheme(settings.theme ?? 'dark', { disableTransitions: false })
  if (cached) {
    applyCachedPluginAppTheme(cached)
  }
  await i18n.changeLanguage(await loadRendererUiLanguage(settings.uiLanguage ?? 'system'))
  // Home skips the workbench, so it must answer close and quit itself or the window cannot close.
  window.api.ui.onWindowCloseRequested(dispatchWindowCloseRequest)
  const root = document.getElementById('root')
  if (!root) {
    throw new Error('Application home root is unavailable.')
  }
  document.documentElement.style.setProperty('--window-controls-width', WINDOW_CONTROLS_WIDTH)
  document.documentElement.style.setProperty('--mac-traffic-lights-width', MAC_TRAFFIC_LIGHTS_WIDTH)
  createRoot(root).render(
    <StrictMode>
      <ApplicationHome />
      <ProjectWorkspaceTransition />
      {hasCustomTitleBar && <WindowControls />}
    </StrictMode>
  )
}
