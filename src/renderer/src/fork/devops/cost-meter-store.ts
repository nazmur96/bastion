import { useEffect, useState } from 'react'

/** Fork C1: what billed infrastructure this repo applied, and when, so cost is visible until destroyed. */
export type CostMeter = { startedAt: number; monthly: number | null }

const KEY = 'orca-fork.costMeter.v1'
const listeners = new Set<() => void>()

function readAll(): Record<string, CostMeter> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (parsed === null || typeof parsed !== 'object') {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([repo, value]): [string, CostMeter][] => {
        const startedAt: unknown =
          value && typeof value === 'object' ? Reflect.get(value, 'startedAt') : null
        const monthly: unknown =
          value && typeof value === 'object' ? Reflect.get(value, 'monthly') : null
        return typeof startedAt === 'number'
          ? [[repo, { startedAt, monthly: typeof monthly === 'number' ? monthly : null }]]
          : []
      })
    )
  } catch {
    return {}
  }
}

function writeAll(all: Record<string, CostMeter>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage off: the meter lasts until reload; the cluster itself is still listed by its outputs.
  }
  listeners.forEach((listener) => listener())
}

/** Every repo with billed infrastructure applied and not yet destroyed. */
export function activeCostMeters(): [string, CostMeter][] {
  return Object.entries(readAll())
}

export function startCostMeter(repo: string, monthly: number | null): void {
  const all = readAll()
  // An apply on top of running infrastructure keeps the original start time.
  writeAll({ ...all, [repo]: { startedAt: all[repo]?.startedAt ?? Date.now(), monthly } })
}

export function stopCostMeter(repo: string): void {
  const all = readAll()
  delete all[repo]
  writeAll(all)
}

/** Re-renders every 30 s so elapsed time and spend keep moving. */
export function useCostMeter(
  repo: string | undefined
): (CostMeter & { hours: number; spent: number | null }) | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const listener = (): void => setNow(Date.now())
    listeners.add(listener)
    const timer = window.setInterval(listener, 30_000)
    return () => {
      listeners.delete(listener)
      window.clearInterval(timer)
    }
  }, [])
  const meter = repo ? readAll()[repo] : undefined
  if (!meter) {
    return null
  }
  const hours = Math.max(0, now - meter.startedAt) / 3_600_000
  return { ...meter, hours, spent: meter.monthly === null ? null : (meter.monthly / 730) * hours }
}
