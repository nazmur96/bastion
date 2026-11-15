import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  execInTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { clickCloudControl } from './helpers/cloud-target-click'

test('selected terminal output becomes a redacted, unsent agent draft', async ({ orcaPage }) => {
  test.skip(process.platform === 'win32', 'The fixture prints with POSIX printf')
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  // Bastion's workspace shows its desktop first; open a terminal the way an engineer does.
  await orcaPage.evaluate(() => {
    const button = [...document.querySelectorAll<HTMLElement>('button')].find(
      (candidate) => candidate.offsetParent && candidate.textContent?.trim() === 'Terminal'
    )
    if (!button) {
      throw new Error('Terminal button not found')
    }
    button.click()
  })
  await expect(orcaPage.locator('.xterm:visible').first()).toBeAttached({ timeout: 30000 })
  await waitForActiveTerminalManager(orcaPage, 30000)
  const ptyId = await waitForActivePanePtyId(orcaPage)
  await execInTerminal(
    orcaPage,
    ptyId,
    "printf 'deploy step failed: exit 1\\nAWS_SECRET_ACCESS_KEY=PLANTED_E2E_SECRET\\n'"
  )
  await waitForTerminalOutput(orcaPage, 'deploy step failed')
  // The hidden test window rejects coordinate clicks; fire the event the pane's menu listens for.
  const openMenu = async (): Promise<void> => {
    const terminal = orcaPage.locator('.xterm:visible').first()
    const box = await terminal.boundingBox()
    await terminal.dispatchEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      // Ctrl+right-click opens the menu even when right-click is set to paste.
      ctrlKey: true,
      clientX: (box?.x ?? 0) + (box?.width ?? 0) / 2,
      clientY: (box?.y ?? 0) + (box?.height ?? 0) / 2
    })
  }
  await openMenu()
  await clickCloudControl(orcaPage.getByRole('menuitem').filter({ hasText: 'Select All' }))
  await openMenu()
  await clickCloudControl(
    orcaPage.getByRole('menuitem', { name: 'Ask agent about selection', exact: true })
  )

  const dialog = orcaPage.getByTestId('terminal-ask-agent')
  await expect(dialog).toBeVisible()
  const draft = dialog.getByLabel('Unsent draft')
  await expect(draft).toHaveValue(/deploy step failed: exit 1/)
  await expect(draft).toHaveValue(/\[redacted\]/)
  await expect(draft).not.toHaveValue(/PLANTED_E2E_SECRET/)
  await expect(draft).toHaveValue(/Do not run commands/)
  // No agent chat is open in this fixture, so the only destination is copy.
  await expect(dialog.getByRole('combobox', { name: 'Draft destination' })).toContainText(
    'Copy for any agent'
  )
  await clickCloudControl(dialog.getByRole('button', { name: 'Cancel', exact: true }))
  await expect(dialog).toBeHidden()
})
