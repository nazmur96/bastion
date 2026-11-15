import type { RealAwsCostData } from './real-aws-contract'

const SCALE = 12
/** Exact decimal string to an integer count of 10^-12 units. */
function toUnits(amount: string): bigint {
  const negative = amount.startsWith('-'),
    [whole, fraction = ''] = amount.replace('-', '').split('.')
  const units =
    BigInt(whole || '0') * 10n ** BigInt(SCALE) +
    BigInt(fraction.padEnd(SCALE, '0').slice(0, SCALE) || '0')
  return negative ? -units : units
}
function toCents(units: bigint): string {
  const step = 10n ** BigInt(SCALE - 2),
    negative = units < 0n,
    magnitude = negative ? -units : units
  // Half up, away from zero.
  const cents = (magnitude + step / 2n) / step
  const text = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
  return negative && cents > 0n ? `-${text}` : text
}
/**
 * The period total. Any estimated day makes the total an estimate; mixed units have no total.
 * Summed exactly from AWS's decimal strings, then shown at two decimals.
 */
export function costTotal(
  rows: RealAwsCostData['results']
): { label: 'Total' | 'Estimated total'; amount: string; unit: string } | null {
  const units = new Set(rows.map((row) => row.unit))
  if (rows.length === 0 || units.size !== 1) {
    return null
  }
  const sum = rows.reduce((total, row) => total + toUnits(row.amount), 0n)
  return {
    label: rows.some((row) => row.estimated) ? 'Estimated total' : 'Total',
    amount: toCents(sum),
    unit: rows[0].unit
  }
}
