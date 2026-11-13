import { z } from 'zod'
import type { ChangeScope } from './change-contract'

export function sameChangeTarget(a: ChangeScope, b: ChangeScope): boolean {
  if (a.projectId !== b.projectId || a.root !== b.root || a.hostId !== b.hostId) {
    return false
  }
  if (a.routeKey === b.routeKey) {
    return true
  }
  const route = z.object({
    route: z.object({
      target: z.object({ kind: z.string(), environmentId: z.string().optional() }),
      expectedExecutionHostId: z.string().optional(),
      expectedSshTargetId: z.string().optional()
    }),
    pairingRevision: z.number().nullable()
  })
  try {
    return (
      JSON.stringify(route.parse(JSON.parse(a.routeKey))) ===
      JSON.stringify(route.parse(JSON.parse(b.routeKey)))
    )
  } catch {
    return false
  }
}
