// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FlociRuntimeCard } from './FlociRuntimeCard'
import { FlociResourcesCard } from './FlociResourcesCard'
import { cloudTargetSchema } from '../../../../shared/fork-cloud/cloud-target-contract'
import { flociInstanceSchema } from '../../../../shared/fork-cloud/floci-contract'
import { flociProduct, type FlociProvider } from '../../../../shared/fork-cloud/floci-products'
const controls = vi.hoisted(() => ({ lifecycle: vi.fn(), refreshRuntime: vi.fn() }))
vi.mock('./cloud-connections-state', () => ({ cloudConnections: controls }))
vi.mock('../changes/change-navigation', () => ({ openCloudSourceChecks: vi.fn() }))
vi.mock('../workbench/workbench-terminals', () => ({ runInWorkbenchTerminal: vi.fn() }))
let root: Root | undefined, container: HTMLDivElement | undefined
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  vi.clearAllMocks()
})
function render(provider: FlociProvider) {
  const target = cloudTargetSchema.parse({
    id: '10000000-0000-4000-8000-000000000001',
    label: 'Provider fixture',
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
  const runtime = { instance, imageDigest: flociProduct(provider).image, receipts: [] }
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      <>
        <FlociRuntimeCard target={target} runtime={runtime} pending={false} />
        <FlociResourcesCard
          projectId="folder:fixture"
          target={target}
          runtime={runtime}
          projectLabel="fixture"
        />
      </>
    )
  )
  return container
}
describe('MC-06 running runtime card and deferred clients', () => {
  it.each(['azure', 'gcp', 'oci'] as const)(
    'shows %s ready lifecycle without advertising AWS clients or other platforms',
    (provider) => {
      const view = render(provider),
        buttons = [...view.querySelectorAll('button')]
      expect(view.textContent).toContain(flociProduct(provider).label)
      expect(view.textContent).toContain('ready')
      expect(view.textContent).toContain('Linux amd64')
      expect(view.textContent).toContain('Resource listings are not available')
      expect(view.textContent).toContain('Emulated · No charges')
      expect(buttons.find((b) => b.textContent === 'Start')?.disabled).toBe(true)
      const stop = buttons.find((b) => b.textContent === 'Stop')
      expect(stop?.disabled).toBe(false)
      expect(buttons.find((b) => b.textContent === 'Open terminal for this target')?.disabled).toBe(
        true
      )
      expect(buttons.some((b) => b.textContent === 'List resources')).toBe(false)
      act(() => stop?.click())
      expect(controls.lifecycle).toHaveBeenCalledWith('stop')
      if (provider === 'oci') {
        expect(view.textContent).toContain('OCI CLI is unavailable')
      }
    }
  )
})
