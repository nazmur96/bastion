import { writeFlociNetworkPolicy } from './floci-network-policy'
import { flociEngineIdentity } from './floci-engine-identity'
import { ensureFlociNetwork, ownedFlociNetwork } from './floci-network'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  FLOCI_IMAGE,
  FlociFailure,
  type FlociInstance
} from '../../../shared/fork-cloud/floci-contract'
import {
  engineCall,
  flociCreateArgs,
  inspectContainer,
  type EngineRunner,
  type EngineManifest
} from './floci-engine'
import { checkFlociInspection } from './floci-inspection'
import { privateFlociDirectory } from './floci-paths'
import { flociHealthy } from './floci-health'
import { availableFlociPort } from './floci-port'
function manifest(instance: FlociInstance): EngineManifest {
  return {
    namespaceId: instance.namespaceId,
    targetId: instance.targetId,
    id: instance.id,
    name: instance.name,
    network: instance.network,
    port: instance.port,
    dataPath: instance.dataPath
  }
}
export async function startFloci(
  instance: FlociInstance,
  run: EngineRunner,
  assertOwner: () => void,
  save: (instance: FlociInstance) => void
): Promise<void> {
  assertOwner()
  instance.engineId = await flociEngineIdentity(run, instance)
  let image = await run(['image', 'inspect', FLOCI_IMAGE])
  if (image.code !== 0) {
    await engineCall(run, ['pull', FLOCI_IMAGE])
    image = await run(['image', 'inspect', FLOCI_IMAGE])
  }
  const images = z
    .array(z.object({ Id: z.string(), RepoDigests: z.array(z.string()) }))
    .parse(JSON.parse(image.stdout))
  if (image.code !== 0 || images.length !== 1 || !images[0].RepoDigests.includes(FLOCI_IMAGE)) {
    throw new FlociFailure('image-unavailable')
  }
  instance.imageId = images[0].Id
  let existing = await inspectContainer(run, instance.containerId ?? instance.name)
  if (existing) {
    checkFlociInspection(existing, instance, instance.imageId)
  } else {
    assertOwner()
    await availableFlociPort(instance.port)
    privateFlociDirectory(dirname(instance.dataPath))
    privateFlociDirectory(instance.dataPath)
    writeFlociNetworkPolicy(instance.dataPath, instance.targetId)
    await ensureFlociNetwork(run, instance, manifest(instance))
    const id = await engineCall(run, flociCreateArgs(manifest(instance)))
    if (!/^[a-f0-9]{64}$/.test(id)) {
      throw new FlociFailure('instance-conflict')
    }
    instance.containerId = id
    save(instance)
    existing = await inspectContainer(run, id)
    checkFlociInspection(existing, instance, instance.imageId)
  }
  assertOwner()
  await engineCall(run, ['start', instance.containerId ?? instance.name])
  for (let attempt = 0; attempt < 60; attempt++) {
    assertOwner()
    const c = checkFlociInspection(
      await inspectContainer(run, instance.containerId ?? instance.name),
      instance,
      instance.imageId
    )
    if (c.running && (await flociHealthy(instance.port))) {
      instance.state = 'ready'
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new FlociFailure('not-ready')
}
export async function stopFloci(
  instance: FlociInstance,
  run: EngineRunner,
  assertOwner: () => void
): Promise<void> {
  assertOwner()
  await flociEngineIdentity(run, instance)
  const existing = await inspectContainer(run, instance.containerId ?? instance.name)
  if (existing) {
    if (!instance.imageId) {
      throw new FlociFailure('instance-conflict')
    }
    const verified = checkFlociInspection(existing, instance, instance.imageId)
    if (verified.running) {
      await engineCall(run, [
        'stop',
        ...(instance.engine === 'podman' ? ['--time', '10'] : ['--timeout', '10']),
        verified.id
      ])
    }
    assertOwner()
    await engineCall(run, ['rm', verified.id])
  }
  if (await inspectContainer(run, instance.name)) {
    throw new FlociFailure('instance-conflict')
  }
  if (await ownedFlociNetwork(run, instance)) {
    await engineCall(run, ['network', 'rm', instance.network])
  }
  instance.containerId = null
  instance.state = 'stopped'
}
