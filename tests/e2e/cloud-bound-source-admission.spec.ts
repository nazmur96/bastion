import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test.use({
  orcaAppExtraArgs: process.env.ORCA_E2E_ISOLATED_X11 === '1' ? ['--ozone-platform=x11'] : []
})
test('CT-05 main admission refuses a stale cloud review, then runs a fresh owner-bound source check', async ({
  orcaPage,
  seededRepoPath
}) => {
  writeFileSync(join(seededRepoPath, 'fixture.json'), '{}\n')
  await orcaPage.evaluate(async () => {
    const api = window.api.cloudTargets,
      projectId = window.__store?.getState().activeWorktreeId
    if (!api || !projectId) {
      throw new Error('Fixture missing')
    }
    for (const label of ['A', 'B']) {
      const current = await api.read(projectId)
      if (!current.ok) {
        throw new Error(current.message)
      }
      const created = await api.update({
        projectId,
        revision: current.snapshot.revision,
        mutation: {
          kind: 'add',
          label,
          configuration: {
            kind: 'emulated',
            provider: 'aws',
            emulator: 'floci',
            runtimeId: 'local'
          }
        }
      })
      if (!created.ok) {
        throw new Error(created.message)
      }
    }
    const current = await api.read(projectId)
    if (!current.ok) {
      throw new Error(current.message)
    }
    const a = current.snapshot.targets.find((target) => target.label === 'A')
    if (!a) {
      throw new Error('A missing')
    }
    const result = await api.update({
      projectId,
      revision: current.snapshot.revision,
      selection: a.id
    })
    if (!result.ok) {
      throw new Error(result.message)
    }
  })
  await openBastionPage(orcaPage, 'Cloud')
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Targeted source checks', exact: true })
  )
  await orcaPage
    .getByLabel('Repository-relative files, one per line', { exact: true })
    .fill('fixture.json')
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Prepare saved files', exact: true })
  )
  await expect(orcaPage.getByLabel('Reviewed cloud target')).toContainText('Floci AWS target')
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Record source-check review', exact: true })
  )
  await expect(
    orcaPage.getByRole('button', { name: 'Run source checks', exact: true })
  ).toBeEnabled()
  const refusal = await orcaPage.evaluate(async () => {
    const api = window.api.cloudTargets,
      changes = window.api.changes,
      projectId = window.__store?.getState().activeWorktreeId
    if (!api || !changes || !projectId) {
      throw new Error('Fixture missing')
    }
    const record = (await changes.list({ projectId })).find(
      (record) => record.intent?.targetMode === 'selected-cloud'
    )
    const review = record?.reviews.at(-1)
    if (!record || !review) {
      throw new Error('Review missing')
    }
    const current = await api.read(projectId)
    if (!current.ok) {
      throw new Error(current.message)
    }
    const a = current.snapshot.selection?.targetId,
      b = current.snapshot.targets.find((target) => target.id !== a)?.id
    if (!a || !b) {
      throw new Error('Targets missing')
    }
    for (const selection of [b, a]) {
      const state = await api.read(projectId)
      if (!state.ok) {
        throw new Error(state.message)
      }
      const changed = await api.update({ projectId, revision: state.snapshot.revision, selection })
      if (!changed.ok) {
        throw new Error(changed.message)
      }
    }
    let message = ''
    try {
      await changes.command({
        id: record.id,
        revision: record.revision,
        command: {
          kind: 'start',
          reviewId: review.id,
          snapshot: review.snapshot,
          execution: { runtimeId: review.snapshot.ownerRuntimeId ?? '' }
        }
      })
    } catch (error) {
      message = String(error)
    }
    const after = (await changes.list({ projectId })).find((item) => item.id === record.id)
    return { message, runs: after?.runs.length, invalidated: after?.invalidated }
  })
  expect(refusal).toMatchObject({ runs: 0, invalidated: true })
  expect(refusal.message).toContain('Cloud target changed')
  await openBastionPage(orcaPage, 'Cloud')
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Targeted source checks', exact: true })
  )
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Prepare saved files', exact: true })
  )
  await clickCloudControl(
    orcaPage.getByRole('button', { name: 'Record source-check review', exact: true })
  )
  await clickCloudControl(orcaPage.getByRole('button', { name: 'Run source checks', exact: true }))
  await expect
    .poll(
      async () =>
        orcaPage.evaluate(async () => {
          const projectId = window.__store?.getState().activeWorktreeId
          if (!projectId) {
            return null
          }
          const records = await window.api.changes?.list({ projectId })
          const run = records
            ?.find((record) => record.intent?.targetMode === 'selected-cloud')
            ?.runs.at(-1)
          return run
            ? {
                status: run.status,
                verification: run.verification?.code,
                bound: run.snapshot.cloudBinding?.kind
              }
            : null
        }),
      { timeout: 30000 }
    )
    .toEqual({ status: 'passed', verification: 'unchanged', bound: 'emulated-aws' })
})
