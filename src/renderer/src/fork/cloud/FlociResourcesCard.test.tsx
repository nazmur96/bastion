// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { FlociResourcesCard } from './FlociResourcesCard'
import {
  cloudTargetSchema,
  type CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
import { flociInstanceSchema } from '../../../../shared/fork-cloud/floci-contract'
import { flociProduct, type FlociProvider } from '../../../../shared/fork-cloud/floci-products'
import type { FlociResourcesResult } from '../../../../shared/fork-cloud/floci-resources-contract'
vi.mock('../workbench/workbench-terminals', () => ({ runInWorkbenchTerminal: vi.fn() }))
let root: Root | undefined, container: HTMLDivElement | undefined
const list = vi.fn<NonNullable<CloudTargetsApi['listResources']>>()
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.unstubAllGlobals()
  list.mockReset()
})
function fixture(provider: FlociProvider) {
  const target = cloudTargetSchema.parse({
    id: '10000000-0000-4000-8000-000000000001',
    label: 'Fixture',
    configuration: { kind: 'emulated', provider, emulator: 'floci', runtimeId: 'local' },
    displayRevision: 0,
    configRevision: 0,
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null
  })
  const instance = flociInstanceSchema.parse({
    id: '20000000-0000-4000-8000-000000000001',
    namespaceId: 'fixture',
    targetId: target.id,
    name: 'bastion-fixture',
    network: 'bastion-fixture-net',
    port: 14888,
    dataPath: '/fixture/data',
    engine: 'docker',
    engineId: 'fixture',
    containerId: 'a'.repeat(64),
    imageId: 'sha256:fixture',
    epoch: 1,
    state: 'ready',
    code: 'complete',
    operationId: null,
    operationPid: null
  })
  return {
    projectId: 'folder:fixture',
    projectLabel: 'fixture',
    target,
    runtime: { instance, imageDigest: flociProduct(provider).image, receipts: [] }
  }
}
function mount() {
  vi.stubGlobal('api', { cloudTargets: { listResources: list } })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  return container
}
async function click(view: HTMLDivElement) {
  await act(async () => {
    ;[...view.querySelectorAll('button')].find((b) => b.textContent === 'List resources')?.click()
  })
}
it.each(['azure', 'gcp', 'oci'] as const)(
  'renders %s native IDs through the existing shared view after a list click',
  async (provider) => {
    const props = fixture(provider),
      view = mount()
    const service =
      provider === 'azure'
        ? 'azure-containers'
        : provider === 'gcp'
          ? 'gcp-topics'
          : 'oci-compartments'
    const resourceId =
      provider === 'azure'
        ? 'devstoreaccount1/containers/fixture'
        : provider === 'gcp'
          ? 'projects/bastion-emulated/topics/fixture'
          : 'ocid1.compartment.oc1..fixture'
    list.mockResolvedValue({
      ok: true,
      resources: {
        provider,
        at: 1,
        results: [
          {
            service,
            status: 'ok',
            items: [{ name: 'fixture', arn: null, resourceId }],
            truncated: false
          }
        ]
      }
    })
    act(() => root?.render(<FlociResourcesCard {...props} />))
    await click(view)
    expect(view.querySelector('[data-testid="cloud-resources-view"]')?.textContent).toContain(
      resourceId
    )
    expect(view.textContent).toContain(flociProduct(provider).label)
    expect(view.textContent).toContain('Ownership is not inferred')
    expect(view.textContent).toContain('Emulated · No charges')
    expect(view.textContent).not.toContain('arn:aws:')
    expect(list).toHaveBeenCalledWith({ projectId: props.projectId, targetId: props.target.id })
  }
)
it('discards an old pending result and error after the instance epoch changes', async () => {
  const props = fixture('gcp'),
    view = mount()
  let release: ((value: FlociResourcesResult) => void) | undefined
  list.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve
      })
  )
  act(() => root?.render(<FlociResourcesCard {...props} />))
  await click(view)
  act(() =>
    root?.render(
      <FlociResourcesCard
        {...props}
        runtime={{ ...props.runtime, instance: { ...props.runtime.instance, epoch: 2 } }}
      />
    )
  )
  await act(async () => release?.({ ok: false, code: 'owner-changed', message: 'STALE_ERROR' }))
  expect(view.textContent).not.toContain('STALE_ERROR')
  expect(
    [...view.querySelectorAll('button')].find((b) => b.textContent === 'List resources')?.disabled
  ).toBe(false)
  expect(view.querySelector('[data-testid="cloud-resources-view"]')).toBeNull()
})
