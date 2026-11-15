import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CHANNEL_OPERATIONS,
  OPERATION_CAPABILITIES,
  capabilityNote,
  type OperationCapability
} from './operation-capabilities'

const entries = Object.entries(OPERATION_CAPABILITIES).map(
  ([id, capability]): [string, OperationCapability] => [id, capability]
)
function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory()
      ? sources(path)
      : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)
        ? [readFileSync(path, 'utf8')]
        : []
  })
}

describe('one policy entry per cloud operation', () => {
  it('has no provider write: Step 9 cloud access is read-only', () => {
    expect(
      entries.filter(([, c]) => c.egress === 'provider' && c.effect === 'local-lifecycle')
    ).toEqual([])
    expect(new Set(entries.map(([, c]) => c.effect))).not.toContain('provider-write')
  })
  it('requires a one-use grant for every paid read, and only paid reads use one', () => {
    for (const [id, capability] of entries) {
      expect(capability.effect === 'paid-read', id).toBe(capability.consent === 'one-use-grant')
    }
  })
  it('never lets a real-provider read skip the identity anchor except identity checks themselves', () => {
    const unanchored = entries
      .filter(([, c]) => c.target === 'selected-real' && c.egress === 'provider')
      .filter(([, c]) => c.consent === 'none')
      .map(([id]) => id)
    expect(unanchored).toEqual(['aws.verify'])
  })
  it('covers every bastionCloud channel the app registers, and nothing else', () => {
    const root = join(__dirname, '..', '..')
    const used = new Set(
      [...sources(join(root, 'main')), ...sources(join(root, 'preload'))].flatMap((text) =>
        [...text.matchAll(/bastionCloud:([A-Za-z]+)/g)].map((match) => `bastionCloud:${match[1]}`)
      )
    )
    // The change notification is an event, not an operation.
    used.delete('bastionCloud:changed')
    expect([...used].sort()).toEqual(Object.keys(CHANNEL_OPERATIONS).sort())
    const mapped = new Set(Object.values(CHANNEL_OPERATIONS).flat())
    expect([...mapped].sort()).toEqual(entries.map(([id]) => id).sort())
  })
  it('labels effects consistently for the UI', () => {
    expect(capabilityNote('aws.cost.read')).toBe(
      'Paid read · AWS may charge per request · AWS · needs a one-use confirmation'
    )
    expect(capabilityNote('aws.resources')).toBe('Free read · AWS · needs a verified identity')
    expect(capabilityNote('floci.start')).toBe('Local emulator · no charges · this computer')
    for (const id of ['floci.runtime', 'floci.environment', 'floci.resources'] as const) {
      expect(OPERATION_CAPABILITIES[id].egress).toBe('loopback')
      expect(OPERATION_CAPABILITIES[id].target).toBe('selected-emulated')
    }
  })
})
