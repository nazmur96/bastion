import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTerraform } from './terraform-tool'

const dirs: string[] = []
function dir(): string {
  const path = mkdtempSync(join(tmpdir(), 'tf-tool-'))
  dirs.push(path)
  return path
}
afterEach(() => {
  for (const path of dirs.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function fakeInstall(data: string, version: string, reports = version): string {
  const install = join(data, 'installs', 'terraform', version)
  mkdirSync(install, { recursive: true })
  const path = join(install, 'terraform')
  writeFileSync(
    path,
    `#!${process.execPath}\nconsole.log(JSON.stringify({terraform_version:${JSON.stringify(reports)}}))\n`
  )
  chmodSync(path, 0o755)
  return path
}

describe.skipIf(process.platform === 'win32')('project-pinned Terraform', () => {
  it('uses the exact pinned install, in string or table form', async () => {
    const root = dir(),
      data = dir()
    const executable = fakeInstall(data, '1.16.5')
    writeFileSync(join(root, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n')
    expect(await resolveTerraform(root, { MISE_DATA_DIR: data, PATH: '' })).toEqual({
      executable,
      version: '1.16.5'
    })
    writeFileSync(join(root, 'mise.toml'), '[tools]\nterraform = { version = "1.16.5" }\n')
    expect((await resolveTerraform(root, { MISE_DATA_DIR: data, PATH: '' })).version).toBe('1.16.5')
  })
  it.each([
    ['no pin', '[tools]\nnode = "22"\n'],
    ['latest', '[tools]\nterraform = "latest"\n'],
    ['range', '[tools]\nterraform = "1.16"\n']
  ])('refuses %s without looking at host PATH', async (_label, toml) => {
    const root = dir(),
      data = dir()
    fakeInstall(data, '1.16.5')
    writeFileSync(join(root, 'mise.toml'), toml)
    await expect(resolveTerraform(root, { MISE_DATA_DIR: data, PATH: '/usr/bin' })).rejects.toThrow(
      'exact Terraform pin'
    )
  })
  it('refuses a missing install or a binary reporting another version', async () => {
    const root = dir(),
      data = dir()
    writeFileSync(join(root, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n')
    await expect(resolveTerraform(root, { MISE_DATA_DIR: data })).rejects.toThrow()
    fakeInstall(data, '1.16.5', '1.9.0')
    await expect(resolveTerraform(root, { MISE_DATA_DIR: data })).rejects.toThrow()
  })
})
