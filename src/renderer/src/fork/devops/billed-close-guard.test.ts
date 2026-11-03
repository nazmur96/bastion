import { beforeEach, describe, expect, it, vi } from 'vitest'

const warning = vi.fn()
vi.mock('sonner', () => ({ toast: { warning } }))
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, values: Record<string, string> = {}) =>
    fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => values[name] ?? '')
}))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => store.set(key, value)
})

describe('billed close guard', () => {
  beforeEach(() => {
    vi.resetModules()
    warning.mockClear()
    store.clear()
  })

  it('never blocks when nothing billed is running', async () => {
    const { interceptCloseForBilledInfra } = await import('./billed-close-guard')
    expect(interceptCloseForBilledInfra(() => {})).toBe(false)
    expect(warning).not.toHaveBeenCalled()
  })

  it('warns once with the hourly cost, then lets a second close through', async () => {
    store.set(
      'orca-fork.costMeter.v1',
      JSON.stringify({ '/work/platform': { startedAt: 1, monthly: 219 } })
    )
    const { interceptCloseForBilledInfra } = await import('./billed-close-guard')
    const proceed = vi.fn()
    expect(interceptCloseForBilledInfra(proceed)).toBe(true)
    expect(warning).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(warning.mock.calls[0])).toContain('platform')
    expect(JSON.stringify(warning.mock.calls[0])).toContain('0.30/hour')
    expect(interceptCloseForBilledInfra(proceed)).toBe(false)
  })
})
