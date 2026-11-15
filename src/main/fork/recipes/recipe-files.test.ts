import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRecipeFiles, writeRecipeFiles } from './recipe-files'

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'recipe-files-'))
  roots.push(path)
  return path
}
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
const files = [
  { path: 'infra/orders/main.tf', content: 'resource "x" "y" {}\n' },
  { path: 'infra/orders/versions.tf', content: 'terraform {}\n' }
]

describe('recipe files', () => {
  it('creates a new directory and its files, then reads them back without working files', async () => {
    const r = root()
    expect(await writeRecipeFiles(r, files)).toEqual(files.map((file) => file.path))
    mkdirSync(join(r, 'infra/orders/.terraform'))
    writeFileSync(join(r, 'infra/orders/terraform.tfstate'), '{}')
    expect(await readRecipeFiles(r, 'infra/orders')).toEqual(files)
  })
  it('never overwrites an existing directory', async () => {
    const r = root()
    mkdirSync(join(r, 'infra/orders'), { recursive: true })
    writeFileSync(join(r, 'infra/orders/main.tf'), 'KEEP')
    await expect(writeRecipeFiles(r, files)).rejects.toThrow('exists')
    expect(readFileSync(join(r, 'infra/orders/main.tf'), 'utf8')).toBe('KEEP')
  })
  it.skipIf(process.platform === 'win32')('refuses a symlinked parent', async () => {
    const r = root()
    const outside = root()
    symlinkSync(outside, join(r, 'infra'))
    await expect(writeRecipeFiles(r, files)).rejects.toThrow('unsafe-path')
    expect(existsSync(join(outside, 'orders'))).toBe(false)
  })
  it('removes only what it created when a later file fails', async () => {
    const r = root()
    mkdirSync(join(r, 'infra'))
    writeFileSync(join(r, 'infra/keep.txt'), 'KEEP')
    const tooLarge = [...files, { path: 'infra/orders/big.tf', content: 'x'.repeat(70000) }]
    await expect(writeRecipeFiles(r, tooLarge)).rejects.toThrow('too-large')
    expect(existsSync(join(r, 'infra/orders'))).toBe(false)
    expect(readFileSync(join(r, 'infra/keep.txt'), 'utf8')).toBe('KEEP')
  })
  it('refuses paths outside one recipe directory', async () => {
    const r = root()
    await expect(
      writeRecipeFiles(r, [...files, { path: 'other/main.tf', content: '' }])
    ).rejects.toThrow('invalid')
    await expect(writeRecipeFiles(r, [{ path: '../escape/main.tf', content: '' }])).rejects.toThrow(
      'invalid'
    )
  })
  it('refuses nested module directories when reading', async () => {
    const r = root()
    await writeRecipeFiles(r, files)
    mkdirSync(join(r, 'infra/orders/modules'))
    await expect(readRecipeFiles(r, 'infra/orders')).rejects.toThrow('layout')
  })
})
