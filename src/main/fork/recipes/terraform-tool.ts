import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { parse } from 'smol-toml'
import { runProcess } from '@orca/process-host'
import { ownerMiseDataDir } from '../cloud/real-aws-tool'

export type TerraformTool = { executable: string; version: string }
export class TerraformToolError extends Error {
  /** The underlying reason, for diagnostics only; the message stays fixed. */
  constructor(cause?: unknown) {
    super(
      'This project needs an exact Terraform pin in its own mise.toml (for example terraform = "1.16.5"), installed for this user. No host Terraform or installation is used.',
      { cause }
    )
  }
}

function pinnedVersion(root: string): string {
  const path = join(root, 'mise.toml')
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) {
    throw new TerraformToolError()
  }
  const tools = parse(readFileSync(path, 'utf8')).tools
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    throw new TerraformToolError()
  }
  const value: unknown = Reflect.get(tools, 'terraform')
  const version =
    value && typeof value === 'object' && !Array.isArray(value)
      ? Reflect.get(value, 'version')
      : value
  if (typeof version !== 'string' || !/^1\.\d+\.\d+$/.test(version)) {
    throw new TerraformToolError()
  }
  return version
}

/** The project's pinned Terraform from the owner's mise installs; never host PATH. */
export async function resolveTerraform(
  root: string,
  owner: NodeJS.ProcessEnv = process.env
): Promise<TerraformTool> {
  try {
    const version = pinnedVersion(root)
    const install = join(ownerMiseDataDir(owner), 'installs', 'terraform', version)
    const name = process.platform === 'win32' ? 'terraform.exe' : 'terraform'
    const executable = realpathSync(join(install, name))
    const inside = relative(realpathSync(install), executable)
    if (
      !inside ||
      inside.startsWith('..') ||
      isAbsolute(inside) ||
      !statSync(executable).isFile()
    ) {
      throw new TerraformToolError()
    }
    const result = await runProcess({
      program: executable,
      args: ['version', '-json'],
      cwd: root,
      env: { PATH: owner.PATH ?? '', HOME: owner.HOME ?? '', CHECKPOINT_DISABLE: '1' },
      // A cold start of the large binary can take several seconds.
      timeoutMs: 30000,
      maxOutputBytes: 16384,
      killOnOutputLimit: true
    })
    const reported: unknown = result.code === 0 ? JSON.parse(result.stdout) : null
    if (
      !reported ||
      typeof reported !== 'object' ||
      Reflect.get(reported, 'terraform_version') !== version
    ) {
      throw new TerraformToolError()
    }
    return { executable, version }
  } catch (error) {
    throw error instanceof TerraformToolError ? error : new TerraformToolError(error)
  }
}
