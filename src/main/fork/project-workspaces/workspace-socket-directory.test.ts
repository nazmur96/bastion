import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boundedSocketDirectory } from './workspace-socket-directory'

// A macOS per-user temporary directory: /var/folders/<2>/<28>/T/ is ~49 bytes on its own.
const MACOS_TMP = '/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T'
const deepRoot = `/Users/someone/Library/Application Support/Bastion/workspaces/${'a'.repeat(36)}`
const made: string[] = []
afterEach(() => {
  for (const path of made.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function shortRoot(): string {
  const root = mkdtempSync('/tmp/bsd-')
  made.push(root)
  return root
}

describe('workspace socket directory', () => {
  it('keeps a short directory and every Windows directory as they are', () => {
    expect(boundedSocketDirectory('/tmp/ws', 'darwin')).toBe('/tmp/ws')
    expect(boundedSocketDirectory(deepRoot, 'win32')).toBe(deepRoot)
  })
  it('uses the next short root when the temporary directory is too long, as on macOS', () => {
    const root = shortRoot()
    const path = boundedSocketDirectory(deepRoot, 'darwin', [MACOS_TMP, root])
    expect(path.startsWith(`${root}/bastion-`)).toBe(true)
    expect(Buffer.byteLength(path)).toBeLessThanOrEqual(70)
    expect(statSync(path).mode & 0o777).toBe(0o700)
    // The same workspace always maps to the same private directory.
    expect(boundedSocketDirectory(deepRoot, 'darwin', [MACOS_TMP, root])).toBe(path)
  })
  it('fails closed when every root is too long or the directory is a planted symlink', () => {
    expect(() => boundedSocketDirectory(deepRoot, 'darwin', [MACOS_TMP])).toThrow(
      'Temporary directory is too long for workspace sockets.'
    )
    const root = shortRoot()
    const target = join(root, 'elsewhere')
    mkdirSync(target)
    const planted = boundedSocketDirectory(deepRoot, 'darwin', [root])
    rmSync(planted, { recursive: true })
    symlinkSync(target, planted)
    expect(() => boundedSocketDirectory(deepRoot, 'darwin', [root])).toThrow('not privately owned')
  })
})
