import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { WorkspaceCatalog } from '../../../src/main/fork/project-workspaces/workspace-catalog'
import { PROJECT_WORKSPACE_SWITCH } from '../../../src/main/fork/project-workspaces/workspace-context'
import { getE2ECompletedOnboardingProfile } from './e2e-completed-onboarding-profile'

export type SeededBastionWorkspace = { id: string; dataRoot: string; launchArg: string }

/**
 * Bastion opens application Home on a cold launch, and Home loads no workbench. Seed an
 * isolated project workspace in the profile's catalog and launch straight into it.
 */
export function seedBastionWorkspace(userDataDir: string, name: string): SeededBastionWorkspace {
  const catalog = new WorkspaceCatalog(userDataDir)
  try {
    const workspace = catalog.create(name)
    const dataRoot = catalog.dataRoot(workspace.id)
    mkdirSync(dataRoot, { recursive: true })
    // The workspace keeps its own userData, so onboarding must be completed there too.
    writeFileSync(
      path.join(dataRoot, 'orca-data.json'),
      `${JSON.stringify(getE2ECompletedOnboardingProfile(), null, 2)}\n`
    )
    return { id: workspace.id, dataRoot, launchArg: `${PROJECT_WORKSPACE_SWITCH}${workspace.id}` }
  } finally {
    catalog.close()
  }
}

/** Launch arguments for the e2e app: a seeded workspace, or none to open application Home. */
export function bastionLaunchArgs(userDataDir: string, workspace: string | null): string[] {
  return workspace === null ? [] : [seedBastionWorkspace(userDataDir, workspace).launchArg]
}

/** Opens a page of the workspace desktop by its navigation label (for example "Changes"). */
export async function openBastionPage(page: Page, label: string): Promise<void> {
  await page.evaluate((text) => {
    const item = [...document.querySelectorAll<HTMLElement>('.workspace-nav-item')].find(
      (candidate) => candidate.offsetParent && candidate.textContent?.includes(text)
    )
    if (!item) {
      throw new Error(`Workspace page not found: ${text}`)
    }
    item.click()
  }, label)
}

/** The active project workspace as the app reports it; Home reports no workspace. */
export async function activeBastionWorkspace(
  page: Page
): Promise<{ activeId: string; name: string | null }> {
  return page.evaluate(async () => {
    const list = await window.api.projectWorkspaces?.list()
    const active = list?.workspaces.find((workspace) => workspace.id === list.activeId)
    return { activeId: list?.activeId ?? 'unknown', name: active?.name ?? null }
  })
}
