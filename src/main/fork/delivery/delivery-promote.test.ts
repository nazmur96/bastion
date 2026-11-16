import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fileFingerprint } from './kustomize-digest'
import { promoteDigest } from './delivery-promote'

const A = `sha256:${'a'.repeat(64)}`
const B = `sha256:${'b'.repeat(64)}`
const text = `# deploy\nimages:\n  - name: app\n    newName: ghcr.io/example/app\n    digest: ${A}\n`
const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'promote-'))
  roots.push(path)
  mkdirSync(join(path, 'deploy'))
  writeFileSync(join(path, 'deploy/kustomization.yaml'), text, { mode: 0o640 })
  return path
}
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
const request = (r: string, fingerprint = fileFingerprint(text)) => ({
  root: r,
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  digest: B,
  reviewedFingerprint: fingerprint
})

describe('promote a digest', () => {
  it('replaces only the pinned digest, atomically, keeping the file mode', async () => {
    const r = root()
    expect(await promoteDigest(request(r))).toEqual({ from: A, to: B })
    expect(readFileSync(join(r, 'deploy/kustomization.yaml'), 'utf8')).toBe(text.replace(A, B))
    if (process.platform !== 'win32') {
      expect(statSync(join(r, 'deploy/kustomization.yaml')).mode & 0o777).toBe(0o640)
    }
  })
  it('refuses a file that changed since it was reviewed', async () => {
    const r = root()
    await expect(promoteDigest(request(r, fileFingerprint('other')))).rejects.toThrow('changed')
    expect(readFileSync(join(r, 'deploy/kustomization.yaml'), 'utf8')).toBe(text)
  })
  it.skipIf(process.platform === 'win32')('refuses a symlinked config', async () => {
    const r = root()
    const outside = join(r, 'outside.yaml')
    writeFileSync(outside, text)
    rmSync(join(r, 'deploy/kustomization.yaml'))
    symlinkSync(outside, join(r, 'deploy/kustomization.yaml'))
    await expect(promoteDigest(request(r))).rejects.toThrow('unsafe-path')
    expect(readFileSync(outside, 'utf8')).toBe(text)
  })
})
