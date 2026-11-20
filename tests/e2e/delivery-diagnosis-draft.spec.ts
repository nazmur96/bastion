import path from 'node:path'
import { buildFakeAgentCommandOverride } from './helpers/fake-agent-command-override'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'
import { expect } from './helpers/orca-app'
import { createChatOnHost, SUPPORTED, test } from './helpers/structured-claude-stub'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// The live fixture supplies a disposable kubeconfig and a kubectl next to it.
const kubeconfig = process.env.BASTION_E2E_DIAGNOSIS_KUBECONFIG
const proof = kubeconfig ? 'Fixture startup failed' : 'Argo CD Application'
test.use({
  orcaAppExtraEnv: {
    KUBECONFIG: kubeconfig || '',
    ...(kubeconfig && {
      PATH: [path.dirname(kubeconfig), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(
        path.delimiter
      )
    })
  }
})

test('Delivery previews a diagnosis and appends it only to the chosen unsent composer', async ({
  orcaPage,
  claudeStub
}) => {
  test.skip(!SUPPORTED, 'The Claude fixture uses a POSIX shell')
  test.setTimeout(90_000)
  await waitForSessionReady(orcaPage)
  const worktreeId = await waitForActiveWorktree(orcaPage)
  await orcaPage.evaluate(async (command) => {
    await window.__store?.getState().updateSettings({
      experimentalNativeChat: true,
      agentCmdOverrides: { claude: command }
    })
  }, buildFakeAgentCommandOverride(claudeStub.command))
  const sessionId = await createChatOnHost(orcaPage, worktreeId)
  await expect
    .poll(() =>
      orcaPage.evaluate(
        ({ worktreeId, sessionId }) =>
          window.__store
            ?.getState()
            .unifiedTabsByWorktree[worktreeId]?.some((tab) => tab.entityId === sessionId),
        { worktreeId, sessionId }
      )
    )
    .toBe(true)
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')
  const diagnosis = page.getByTestId('delivery-diagnosis')
  const ask = diagnosis.getByRole('button', { name: 'Ask an agent…' })
  const dialog = orcaPage.getByRole('dialog', { name: 'Ask an agent about this diagnosis' })
  const read = diagnosis.getByRole('button', {
    name: kubeconfig ? 'Diagnose with logs' : 'Diagnose',
    exact: true
  })
  await expect(ask).toBeHidden()
  await clickCloudControl(read)
  await expect(diagnosis.getByTestId('diagnosis-result')).toBeVisible({ timeout: 60_000 })
  await clickCloudControl(ask)
  const draft = dialog.getByLabel('Unsent draft')
  await expect(draft).toHaveValue(new RegExp(proof))
  if (kubeconfig) {
    await expect(draft).toHaveValue(/Rollout example-app/)
    await expect(draft).toHaveValue(/[1-9]\d* restarts/)
    await expect(draft).not.toHaveValue(/planted-live-secret/)
  }
  await clickCloudControl(dialog.getByRole('button', { name: 'Cancel', exact: true }))
  await page.getByLabel('Argo CD application').fill('different-app')
  await expect(ask).toBeHidden()
  await page.getByLabel('Argo CD application').fill('example-app')
  await expect(ask).toBeHidden()
  await clickCloudControl(read)
  await clickCloudControl(ask)
  await clickCloudControl(dialog.getByRole('button', { name: 'Add to chat draft' }))
  const chat = orcaPage.locator('[data-native-chat-root="true"]')
  await expect(chat.getByRole('textbox')).toContainText(proof)
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
  await expect(chat.getByText('Stub reply.')).toHaveCount(0)
})
