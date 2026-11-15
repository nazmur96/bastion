import type { CloudTargetCatalog } from './cloud-target-catalog'
import type { FlociController } from './floci-controller'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import { flociHealthy } from './floci-health'
export async function admitFlociRead(
  catalog: CloudTargetCatalog,
  controller: FlociController,
  namespaceId: string,
  targetId: string,
  assertAdmission: () => void,
  getRuntime: () => string | undefined,
  isClosed: () => boolean
) {
  if (isClosed()) {
    throw new FlociFailure('owner-changed')
  }
  assertAdmission()
  const target = catalog.snapshot().targets.find((t) => t.id === targetId)
  if (target?.configuration.kind !== 'emulated') {
    throw new FlociFailure('invalid')
  }
  const provider = target.configuration.provider,
    configRevision = target.configRevision,
    runtimeId = getRuntime()
  if (provider !== 'aws' && !runtimeId) {
    throw new FlociFailure('owner-changed')
  }
  const checkOwner = () => {
    if (isClosed()) {
      throw new FlociFailure('owner-changed')
    }
    assertAdmission()
    const current = catalog.snapshot().targets.find((t) => t.id === targetId)
    if (
      isClosed() ||
      getRuntime() !== runtimeId ||
      current?.configRevision !== configRevision ||
      current.configuration.kind !== 'emulated' ||
      current.configuration.provider !== provider
    ) {
      throw new FlociFailure('owner-changed')
    }
  }
  checkOwner()
  const instance =
    provider === 'aws'
      ? await controller.ensure(targetId)
      : (await controller.refresh(targetId)).instance
  checkOwner()
  if (
    instance.namespaceId !== namespaceId ||
    instance.targetId !== targetId ||
    instance.operationId ||
    instance.state !== 'ready' ||
    (provider === 'aws' && !(await flociHealthy(instance.port)))
  ) {
    throw new FlociFailure('not-ready')
  }
  const fingerprint = JSON.stringify(instance)
  const assertSameInstance = () => {
    checkOwner()
    if (JSON.stringify(catalog.instances.get(targetId)) !== fingerprint) {
      throw new FlociFailure('owner-changed')
    }
  }
  assertSameInstance()
  const finish = async () => {
    assertSameInstance()
    if (provider !== 'aws') {
      const observed = (await controller.refresh(targetId)).instance
      if (JSON.stringify(observed) !== fingerprint) {
        throw new FlociFailure('owner-changed')
      }
    }
    assertSameInstance()
  }
  return { instance, provider, assertSameInstance, finish }
}
