import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addDevpodRecipe } from './devops-devpod-recipe'

const roots: string[] = []
function repo(files: Record<string, string> = { '.devcontainer/devcontainer.json': '{}' }): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-recipe-'))
  roots.push(root)
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(root, name, '..'), { recursive: true })
    writeFileSync(join(root, name), body)
  }
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    chmodSync(root, 0o755)
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform === 'win32')('addDevpodRecipe', () => {
  it('writes executable scripts and keeps existing orca.yaml content', () => {
    const root = repo({ '.devcontainer.json': '{}', 'orca.yaml': '# team\n' })
    const result = addDevpodRecipe(root)
    expect(result).toMatchObject({ ok: true })
    expect(readFileSync(join(root, 'orca.yaml'), 'utf8')).toMatch(/^# team\n[\s\S]*devpod/)
    expect(statSync(join(root, 'scripts/orca-vm/devpod-create.sh')).mode & 0o111).not.toBe(0)
    expect(
      readdirSync(join(root, 'scripts/orca-vm')).some((name) => name.endsWith('.orca-tmp'))
    ).toBe(false)
  })

  it('never writes through a symlinked orca.yaml', () => {
    const outside = repo({})
    writeFileSync(join(outside, 'canary.yaml'), 'canary\n')
    const root = repo()
    symlinkSync(join(outside, 'canary.yaml'), join(root, 'orca.yaml'))
    expect(addDevpodRecipe(root)).toMatchObject({
      ok: false,
      error: expect.stringContaining('symbolic link')
    })
    expect(readFileSync(join(outside, 'canary.yaml'), 'utf8')).toBe('canary\n')
    expect(existsSync(join(root, 'scripts'))).toBe(false)
  })

  it('never writes scripts through a symlinked directory', () => {
    const outside = repo({})
    const root = repo()
    symlinkSync(outside, join(root, 'scripts'))
    expect(addDevpodRecipe(root)).toMatchObject({ ok: false })
    expect(readdirSync(outside)).toEqual([])
    expect(existsSync(join(root, 'orca.yaml'))).toBe(false)
  })

  it('requires a real Dev Container declaration', () => {
    expect(addDevpodRecipe(repo({ 'README.md': '' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('devcontainer.json')
    })
    const outside = repo({})
    writeFileSync(join(outside, 'devcontainer.json'), '{}')
    const linked = repo({})
    symlinkSync(join(outside, 'devcontainer.json'), join(linked, '.devcontainer.json'))
    expect(addDevpodRecipe(linked)).toMatchObject({ ok: false })
  })

  it('refuses conflicting mise and devenv owners', () => {
    const root = repo({
      '.devcontainer.json': '{}',
      'devenv.nix': '',
      '.mise.toml': ''
    })
    expect(addDevpodRecipe(root)).toMatchObject({
      ok: false,
      error: expect.stringContaining('mise')
    })
    expect(existsSync(join(root, 'orca.yaml'))).toBe(false)
  })

  it('keeps an existing script untouched', () => {
    const root = repo({
      '.devcontainer.json': '{}',
      'scripts/orca-vm/devpod-create.sh': 'mine'
    })
    expect(addDevpodRecipe(root)).toMatchObject({ ok: false })
    expect(readFileSync(join(root, 'scripts/orca-vm/devpod-create.sh'), 'utf8')).toBe('mine')
  })

  it.skipIf(process.getuid?.() === 0)(
    'leaves nothing behind when orca.yaml cannot be written',
    () => {
      const root = repo({ '.devcontainer.json': '{}', 'orca.yaml': 'kept\n' })
      mkdirSync(join(root, 'scripts/orca-vm'), { recursive: true })
      chmodSync(root, 0o555)
      expect(addDevpodRecipe(root)).toMatchObject({ ok: false })
      chmodSync(root, 0o755)
      expect(readdirSync(join(root, 'scripts/orca-vm'))).toEqual([])
      expect(readFileSync(join(root, 'orca.yaml'), 'utf8')).toBe('kept\n')
    }
  )
})
