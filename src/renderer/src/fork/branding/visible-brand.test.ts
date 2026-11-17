import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Fork: the product is Bastion. Functional names stay lowercase (`orca` CLI, orca.yaml,
// ~/.orca, ORCA_* variables) and never match these word-boundary patterns.
const UPSTREAM_BRAND = /\bOrca\b|\bORCA\b/
const LOCALES = join(__dirname, '..', '..', 'i18n', 'locales')

function leaks(value: unknown, path: string[] = []): string[] {
  if (typeof value === 'string') {
    return UPSTREAM_BRAND.test(value) ? [path.join('.')] : []
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => leaks(child, [...path, key]))
  }
  return []
}

describe('visible brand', () => {
  it('shows Bastion, not the upstream name, in every locale catalog', () => {
    const files = readdirSync(LOCALES).filter((name) => name.endsWith('.json'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const catalog: unknown = JSON.parse(readFileSync(join(LOCALES, file), 'utf8'))
      expect(leaks(catalog), file).toEqual([])
    }
    const runtime: unknown = JSON.parse(
      readFileSync(join(LOCALES, '..', 'en-runtime-required.json'), 'utf8')
    )
    expect(leaks(runtime), 'en-runtime-required.json').toEqual([])
  })
})
