/** Fork A1: where a workspace's commands would land. */
export type DevopsContextTone = 'local' | 'prod' | 'normal'

export type DevopsContext = {
  kube?: { context: string; namespace?: string; tone: DevopsContextTone }
  aws?: { profile: string; region?: string; tone: DevopsContextTone }
  terraform?: { workspace: string; tone: DevopsContextTone }
}

const PROD = /(^|[^a-z])(prod|production|live)([^a-z]|$)/i

export function devopsTone(name: string, local = false): DevopsContextTone {
  return local ? 'local' : PROD.test(name) ? 'prod' : 'normal'
}

function field(block: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*${key}:\\s*["']?([^"'\\n#]+?)["']?\\s*$`, 'm').exec(block)
  return match?.[1]
}

/** `current-context` and its namespace from a kubeconfig, without a YAML library. */
export function parseKubeContext(
  kubeconfig: string
): { context: string; namespace?: string } | null {
  const context = /^current-context:\s*["']?([^"'\n#]+?)["']?\s*$/m.exec(kubeconfig)?.[1]
  if (!context) {
    return null
  }
  const section = kubeconfig.split(/^contexts:\s*$/m)[1]?.split(/^[A-Za-z]/m)[0] ?? ''
  const entry = section.split(/^\s*-\s+/m).find((item) => field(item, 'name') === context)
  const namespace = entry ? field(entry, 'namespace') : undefined
  return namespace ? { context, namespace } : { context }
}

/** The region an AWS profile uses, from `~/.aws/config`. */
export function parseAwsRegion(config: string, profile: string): string | undefined {
  const header = profile === 'default' ? '[default]' : `[profile ${profile}]`
  const start = config.indexOf(header)
  if (start === -1) {
    return undefined
  }
  const body = config.slice(start + header.length).split(/^\[/m)[0]
  return /^\s*region\s*=\s*(\S+)/m.exec(body)?.[1]
}
