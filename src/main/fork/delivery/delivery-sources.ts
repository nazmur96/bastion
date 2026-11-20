import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { run } from '../devops/devops-inspect'
import { kubectlCurrentContext, kubectlIn } from '../devops/devops-kubectl'
import { readOwnerSource } from '../changes/owner-source-files'
import type { DeliveryDeps } from './delivery-chain'
import { projectSupplyChain } from './cosign-runner'

const tokenSchema = z.object({ token: z.string().min(1) })
const indexSchema = z.object({
  manifests: z.array(
    z.object({
      digest: z.string(),
      platform: z.object({ os: z.string(), architecture: z.string() }).optional()
    })
  )
})
const manifestSchema = z.object({ config: z.object({ digest: z.string() }) })
const configSchema = z.object({
  config: z.object({ Labels: z.record(z.string(), z.string()).nullish() }).optional()
})
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json'
].join(', ')

async function getJson(url: string, token: string, accept = ACCEPT): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: accept },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000)
  })
  if (!response.ok) {
    throw new Error(String(response.status))
  }
  const text = await response.text()
  if (text.length > 1024 * 1024) {
    throw new Error('too large')
  }
  return JSON.parse(text)
}

/**
 * OCI labels of a public GHCR image at an exact digest, using an anonymous pull token. Any
 * other registry, or a private image, is unknown: Bastion stores no registry credentials.
 */
export async function ghcrImageLabels(
  repository: string,
  digest: string
): Promise<{ labels: Record<string, string> | null; reason: string | null }> {
  if (!repository.startsWith('ghcr.io/')) {
    return { labels: null, reason: 'Only public GHCR images can be read yet' }
  }
  const path = repository.slice('ghcr.io/'.length)
  try {
    const token = tokenSchema.parse(
      await (
        await fetch(`https://ghcr.io/token?scope=repository:${path}:pull`, {
          signal: AbortSignal.timeout(10000)
        })
      ).json()
    ).token
    let manifest: unknown = await getJson(`https://ghcr.io/v2/${path}/manifests/${digest}`, token)
    const index = indexSchema.safeParse(manifest)
    if (index.success) {
      const image = index.data.manifests.find(
        (item) => item.platform?.os === 'linux' && item.platform.architecture === 'amd64'
      )
      if (!image) {
        return { labels: null, reason: 'No linux/amd64 image in the index' }
      }
      manifest = await getJson(`https://ghcr.io/v2/${path}/manifests/${image.digest}`, token)
    }
    const configDigest = manifestSchema.parse(manifest).config.digest
    const config = configSchema.parse(
      await getJson(`https://ghcr.io/v2/${path}/blobs/${configDigest}`, token, '*/*')
    )
    return { labels: config.config?.Labels ?? {}, reason: null }
  } catch (error) {
    const status = error instanceof Error ? error.message : ''
    return {
      labels: null,
      reason:
        status === '401' || status === '403'
          ? 'The registry needs credentials (private image)'
          : 'The registry did not answer'
    }
  }
}

/** Real sources for one project. GitHub via the engineer's `gh`; cluster via the project's kubectl. */
export function deliverySources(root: string, repository: string): DeliveryDeps {
  let pinned: Promise<string | null> | null = null
  const context = () => {
    pinned ??= kubectlCurrentContext(root).then((result) => result.context)
    return pinned
  }
  return {
    supplyChain: projectSupplyChain(root),
    git: async (args) => {
      const result = await run('git', args, root, 10000)
      return { ok: result.ok, stdout: result.stdout }
    },
    githubApi: async (path) => {
      const result = await run('gh', ['api', path], root, 15000)
      if (!result.ok) {
        return null
      }
      try {
        return JSON.parse(result.stdout)
      } catch {
        return null
      }
    },
    runArtifactFile: async (runId, artifact, file) => {
      const directory = await mkdtemp(join(tmpdir(), 'bastion-artifact-'))
      try {
        const result = await run(
          'gh',
          ['run', 'download', String(runId), '-R', repository, '-n', artifact, '-D', directory],
          root,
          30000
        )
        return result.ok ? (await readFile(join(directory, file), 'utf8')).slice(0, 65536) : null
      } catch {
        return null
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
    imageLabels: ghcrImageLabels,
    readProjectFile: async (path) => {
      try {
        return await readOwnerSource(root, path)
      } catch {
        return null
      }
    },
    kubectl: async (args) => {
      const name = await context()
      if (!name) {
        return { ok: false, out: '', code: 'no-context' }
      }
      const result = await kubectlIn(
        root,
        ['--context', name, ...args, '--request-timeout=10s'],
        20000
      )
      return { ok: result.ok, out: result.out, code: result.code }
    }
  }
}
