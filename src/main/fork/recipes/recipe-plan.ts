import { z } from 'zod'
import type { RecipePlanSummary } from '../../../shared/fork-recipes/recipe-contract'

const MAX_RESOURCES = 50
const planSchema = z.object({
  resource_changes: z
    .array(
      z.object({
        address: z.string().max(512),
        change: z.object({ actions: z.array(z.string()) })
      })
    )
    .optional()
})

/** What a saved plan does, from `terraform show -json`; no attribute values are kept. */
export function summarizePlan(json: string): RecipePlanSummary | null {
  let parsed
  try {
    parsed = planSchema.safeParse(JSON.parse(json))
  } catch {
    return null
  }
  if (!parsed.success) {
    return null
  }
  const summary: RecipePlanSummary = {
    add: 0,
    change: 0,
    replace: 0,
    destroy: 0,
    resources: [],
    truncated: false
  }
  for (const resource of parsed.data.resource_changes ?? []) {
    const actions = resource.change.actions
    const action =
      actions.includes('create') && actions.includes('delete')
        ? 'replace'
        : actions.includes('create')
          ? 'create'
          : actions.includes('delete')
            ? 'delete'
            : actions.includes('update')
              ? 'update'
              : null
    if (!action) {
      continue
    }
    summary[
      action === 'create'
        ? 'add'
        : action === 'update'
          ? 'change'
          : action === 'replace'
            ? 'replace'
            : 'destroy'
    ]++
    if (summary.resources.length < MAX_RESOURCES) {
      summary.resources.push({ address: resource.address, action })
    } else {
      summary.truncated = true
    }
  }
  return summary
}
