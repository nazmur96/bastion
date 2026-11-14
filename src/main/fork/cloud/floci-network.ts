import { z } from 'zod'
import type { FlociInstance } from '../../../shared/fork-cloud/floci-contract'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import {
  engineCall,
  flociLabels,
  classifyEngineFailure,
  type EngineRunner,
  type EngineManifest
} from './floci-engine'
export async function ownedFlociNetwork(
  run: EngineRunner,
  instance: FlociInstance
): Promise<boolean> {
  const output = await run(['network', 'inspect', instance.network])
  if (output.code !== 0 && /no such network|network .* not found/i.test(output.stderr)) {
    return false
  }
  if (output.code !== 0 || output.timedOut || output.outputTruncated) {
    throw new FlociFailure(classifyEngineFailure(output.stderr).code)
  }
  const rows = z
    .array(z.object({ Internal: z.boolean(), Labels: z.record(z.string(), z.string()).nullable() }))
    .parse(JSON.parse(output.stdout))
  if (
    rows.length !== 1 ||
    rows[0].Internal ||
    rows[0].Labels?.['bastion.instance'] !== instance.id ||
    rows[0].Labels?.['bastion.workspace'] !== instance.namespaceId ||
    rows[0].Labels?.['bastion.target'] !== instance.targetId
  ) {
    throw new FlociFailure('instance-conflict')
  }
  return true
}
export async function ensureFlociNetwork(
  run: EngineRunner,
  instance: FlociInstance,
  manifest: EngineManifest
): Promise<void> {
  if (!(await ownedFlociNetwork(run, instance))) {
    await engineCall(run, ['network', 'create', ...flociLabels(manifest), instance.network])
  }
}
