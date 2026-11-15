import { describe, expect, it } from 'vitest'
import { normalizeResourceListing, ownershipHint } from './cloud-resource-view'
import { costTotal } from './cloud-cost-view'

describe('9.4 one resources view for emulated and real listings', () => {
  it('maps both kinds to the same shape, keeping each failing service visible as unknown', () => {
    const floci = normalizeResourceListing(
      'emulated',
      {
        at: 1,
        results: [
          {
            service: 's3',
            status: 'ok',
            items: [{ name: 'shop-assets', arn: null }],
            truncated: false
          },
          { service: 'sqs', status: 'unimplemented', items: [], truncated: false },
          { service: 'lambda', status: 'ok', items: [], truncated: false }
        ]
      },
      'shop'
    )
    const real = normalizeResourceListing(
      'real',
      {
        at: 2,
        results: [
          { service: 's3', status: 'ok', items: [{ name: 'logs', arn: null }], truncated: true },
          { service: 'dynamodb', status: 'denied', items: [], truncated: false }
        ]
      },
      'shop'
    )
    expect(floci.services.map((s) => [s.service, s.state])).toEqual([
      ['s3', 'listed'],
      ['sqs', 'unknown'],
      ['lambda', 'empty']
    ])
    expect(floci.services[1].message).toMatch(/emulator does not support/)
    expect(real.services[1]).toMatchObject({ state: 'unknown', items: [] })
    expect(real.services[1].message).toMatch(/denied/i)
    // A denied or truncated service never reads as an empty account.
    expect(real.services[0]).toMatchObject({ state: 'listed', truncated: true })
    expect(Object.keys(floci).sort()).toEqual(Object.keys(real).sort())
    expect(floci).toMatchObject({
      kind: 'emulated',
      observedAt: 1,
      limits: { pages: 3, items: 500 }
    })
    expect(real).toMatchObject({ kind: 'real', observedAt: 2 })
    expect(floci.services[0].items[0]).toMatchObject({ name: 'shop-assets', hint: true })
    expect(real.services[0].items[0]).toMatchObject({ name: 'logs', hint: false })
  })
  it('only offers a name hint for a meaningful project name, case-insensitively', () => {
    expect(ownershipHint('Shop-Orders-Queue', 'shop')).toBe(true)
    expect(ownershipHint('orders', 'shop')).toBe(false)
    expect(ownershipHint('abc-table', 'ab')).toBe(false)
    expect(ownershipHint('my_app_bucket', 'My App')).toBe(true)
    expect(ownershipHint('anything', '')).toBe(false)
  })
})

describe('9.5 cost totals never present estimates as actual', () => {
  const row = (amount: string, estimated: boolean, unit = 'USD') => ({
    start: '2026-11-01',
    end: '2026-11-02',
    amount,
    unit,
    estimated
  })
  it('labels a total with any estimated day as estimated and sums decimal strings exactly', () => {
    expect(costTotal([row('0.1', false), row('0.2', true)])).toEqual({
      label: 'Estimated total',
      amount: '0.30',
      unit: 'USD'
    })
    expect(costTotal([row('1.005', false), row('2.0049999999', false)])).toEqual({
      label: 'Total',
      amount: '3.01',
      unit: 'USD'
    })
  })
  it('shows no total for mixed units or no rows', () => {
    expect(costTotal([row('1', false, 'USD'), row('1', false, 'EUR')])).toBeNull()
    expect(costTotal([])).toBeNull()
  })
})
