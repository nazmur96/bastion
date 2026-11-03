import { SECRET_MASK } from './fork-secret-mask'

/** Fork A3: a `terraform show -json` plan, reduced to what a reviewer reads. */
export type PlanAction = 'create' | 'update' | 'replace' | 'delete' | 'read'

export type PlanAttributeChange = { path: string; before: string; after: string }

export type PlanResourceChange = {
  address: string
  module: string
  type: string
  action: PlanAction
  changes: PlanAttributeChange[]
}

export type TerraformPlanSummary = {
  resources: PlanResourceChange[]
  counts: Record<PlanAction, number>
  /** Output values that change, by name. */
  outputs: string[]
  /** Changes made outside Terraform since the last apply (`resource_drift`). */
  drift: PlanResourceChange[]
}

/** A gate that did not run says why: the tool is missing, or it failed. */
export type PlanGate<T> = { ok: true; value: T } | { ok: false; reason: string }

export type PlanGates = {
  /** Infracost: estimated monthly cost of the planned infrastructure, USD. */
  cost: PlanGate<number>
  /** Checkov on the plan JSON. */
  policy: PlanGate<{ passed: number; failed: number }>
}

export type TerraformPlanResult =
  | {
      ok: true
      dir: string
      planFile: string
      summary: TerraformPlanSummary
      gates: PlanGates | null
    }
  | { ok: false; error: string }

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function actionOf(actions: unknown[]): PlanAction | null {
  const set = new Set(actions.filter((item): item is string => typeof item === 'string'))
  if (set.has('delete') && set.has('create')) {
    return 'replace'
  }
  for (const action of ['create', 'update', 'delete', 'read'] as const) {
    if (set.has(action)) {
      return action
    }
  }
  return null
}

function show(value: unknown): string {
  if (value === undefined) {
    return '(none)'
  }
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Leaf-level differences; sensitive leaves (per Terraform's own *_sensitive maps) are masked. */
function diff(
  before: unknown,
  after: unknown,
  sensitive: unknown,
  unknown: unknown,
  path: string,
  out: PlanAttributeChange[]
): void {
  if (sensitive === true) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      out.push({ path, before: SECRET_MASK, after: SECRET_MASK })
    }
    return
  }
  if (unknown === true) {
    out.push({ path, before: show(before), after: '(known after apply)' })
    return
  }
  if (isObj(before) || isObj(after)) {
    const left = isObj(before) ? before : {}
    const right = isObj(after) ? after : {}
    const mask = isObj(sensitive) ? sensitive : {}
    const pending = isObj(unknown) ? unknown : {}
    for (const key of new Set([
      ...Object.keys(left),
      ...Object.keys(right),
      ...Object.keys(pending)
    ])) {
      diff(left[key], right[key], mask[key], pending[key], path ? `${path}.${key}` : key, out)
    }
    return
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    out.push({ path, before: show(before), after: show(after) })
  }
}

export function summarizeTerraformPlan(json: string): TerraformPlanSummary {
  const counts: Record<PlanAction, number> = {
    create: 0,
    update: 0,
    replace: 0,
    delete: 0,
    read: 0
  }
  let plan: unknown
  try {
    plan = JSON.parse(json)
  } catch {
    return { resources: [], counts, outputs: [], drift: [] }
  }
  const root = isObj(plan) ? plan : {}
  const toChange =
    (count: boolean) =>
    (entry: unknown): PlanResourceChange[] => {
      if (!isObj(entry) || !isObj(entry.change)) {
        return []
      }
      const action = actionOf(asList(entry.change.actions))
      if (!action) {
        return []
      }
      if (count) {
        counts[action] += 1
      }
      const changes: PlanAttributeChange[] = []
      if (action === 'update' || action === 'replace') {
        diff(
          entry.change.before,
          entry.change.after,
          // A leaf is sensitive if either side says so.
          mergeSensitive(entry.change.before_sensitive, entry.change.after_sensitive),
          entry.change.after_unknown,
          '',
          changes
        )
      }
      return [
        {
          address: typeof entry.address === 'string' ? entry.address : '?',
          module: typeof entry.module_address === 'string' ? entry.module_address : 'root',
          type: typeof entry.type === 'string' ? entry.type : '?',
          action,
          changes
        }
      ]
    }
  const resources = asList(root.resource_changes).flatMap(toChange(true))
  const drift = asList(root.resource_drift).flatMap(toChange(false))
  const outputs = isObj(root.output_changes)
    ? Object.entries(root.output_changes)
        .filter(([, change]) => isObj(change) && actionOf(asList(change.actions)) !== null)
        .map(([name]) => name)
    : []
  return { resources, counts, outputs, drift }
}

function mergeSensitive(left: unknown, right: unknown): unknown {
  if (left === true || right === true) {
    return true
  }
  if (isObj(left) || isObj(right)) {
    const a = isObj(left) ? left : {}
    const b = isObj(right) ? right : {}
    return Object.fromEntries(
      [...new Set([...Object.keys(a), ...Object.keys(b)])].map((key) => [
        key,
        mergeSensitive(a[key], b[key])
      ])
    )
  }
  return false
}

/** Plain text for Claude: every change, sensitive values already masked. */
export function planAsText(summary: TerraformPlanSummary): string {
  const lines = summary.resources.map((resource) => {
    const details = resource.changes
      .slice(0, 20)
      .map((change) => `    ${change.path}: ${change.before} → ${change.after}`)
    return [`${resource.action.toUpperCase()} ${resource.address}`, ...details].join('\n')
  })
  const { create, update, replace, delete: destroy } = summary.counts
  return [
    `Plan: ${create} to add, ${update} to change, ${replace} to replace, ${destroy} to destroy.`,
    ...lines
  ].join('\n')
}

export function parseInfracostMonthly(stdout: string): number | null {
  try {
    const value: unknown = JSON.parse(stdout)
    const total: unknown = isObj(value) ? value.totalMonthlyCost : null
    const parsed =
      typeof total === 'string' || typeof total === 'number' ? Number(total) : Number.NaN
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** Checkov prints one report object, or a list when several frameworks ran. */
export function parseCheckovSummary(stdout: string): { passed: number; failed: number } | null {
  try {
    const value: unknown = JSON.parse(stdout)
    const reports = Array.isArray(value) ? value : [value]
    let passed = 0
    let failed = 0
    let seen = false
    for (const report of reports) {
      const summary = isObj(report) && isObj(report.summary) ? report.summary : null
      if (summary && typeof summary.passed === 'number' && typeof summary.failed === 'number') {
        passed += summary.passed
        failed += summary.failed
        seen = true
      }
    }
    return seen ? { passed, failed } : null
  } catch {
    return null
  }
}
