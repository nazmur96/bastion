import { z } from 'zod'
import type {
  DeliveryChain,
  DeliveryConfig,
  DeliveryLink,
  DeliveryLinkId
} from '../../../shared/fork-delivery/delivery-contract'
import { fileFingerprint, imageRepository, pinnedDigest } from './kustomize-digest'
import type { SupplyChainEvidence } from './supply-chain-evidence'

/** Each source is injected so every link can be tested, and swapped per runtime later. */
export type DeliveryDeps = {
  git: (args: string[]) => Promise<{ ok: boolean; stdout: string }>
  /** `gh api <path>` JSON, or null when the call fails. */
  githubApi: (path: string) => Promise<unknown>
  /** One file from a run artifact, or null. */
  runArtifactFile: (runId: number, artifact: string, file: string) => Promise<string | null>
  /** OCI labels of the image at that digest; null labels when the registry refused. */
  imageLabels: (
    repository: string,
    digest: string
  ) => Promise<{ labels: Record<string, string> | null; reason: string | null }>
  readProjectFile: (path: string) => Promise<string | null>
  /** kubectl with the project's kubeconfig, pinned to one context. */
  kubectl: (args: string[]) => Promise<{ ok: boolean; out: string; code: string }>
  /** Signature and SBOM evidence for the candidate digest; null when the project has no policy. */
  supplyChain?: (repository: string, digest: string) => Promise<SupplyChainEvidence | null>
}

const SHA = /^[0-9a-f]{40}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
const runsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      id: z.number(),
      head_sha: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      created_at: z.string()
    })
  )
})
const artifactSchema = z.object({
  revision: z.string().regex(SHA),
  digest: z.string().regex(DIGEST)
})
const applicationSchema = z.object({
  spec: z.object({ destination: z.object({ namespace: z.string().optional() }) }),
  status: z
    .object({
      sync: z.object({ status: z.string().optional(), revision: z.string().optional() }).optional(),
      health: z.object({ status: z.string().optional() }).optional()
    })
    .optional()
})
const podsSchema = z.object({
  items: z.array(
    z.object({
      status: z
        .object({
          containerStatuses: z
            .array(z.object({ image: z.string(), imageID: z.string() }))
            .optional()
        })
        .optional()
    })
  )
})

const short = (value: string) =>
  DIGEST.test(value) ? `${value.slice(0, 19)}…` : value.slice(0, 12)

export async function readDeliveryChain(
  config: DeliveryConfig,
  deps: DeliveryDeps,
  now = Date.now()
): Promise<DeliveryChain> {
  const links: DeliveryLink[] = []
  const add = (
    id: DeliveryLinkId,
    status: DeliveryLink['status'],
    detail: string,
    source: string
  ) => links.push({ id, status, detail, source })

  // 1. Revision
  let revision = config.revision
  if (!revision) {
    const head = await deps.git(['rev-parse', 'HEAD'])
    revision = head.ok && SHA.test(head.stdout.trim()) ? head.stdout.trim() : null
  }
  add(
    'revision',
    revision ? 'verified' : 'unknown',
    revision ? short(revision) : 'No commit found',
    'git'
  )

  // 2. CI: the latest run of this workflow for exactly this commit.
  let runId: number | null = null
  if (revision) {
    const raw = await deps.githubApi(
      `repos/${config.repository}/actions/workflows/${config.workflow}/runs?head_sha=${revision}&per_page=5`
    )
    const runs = runsSchema.safeParse(raw)
    if (!runs.success) {
      add('ci', 'unknown', 'GitHub did not answer', `GitHub Actions ${config.workflow}`)
    } else {
      const run = runs.data.workflow_runs
        .filter((item) => item.head_sha === revision)
        .toSorted((a, b) => b.created_at.localeCompare(a.created_at))[0]
      if (!run) {
        add('ci', 'unknown', 'No CI run for this revision', `GitHub Actions ${config.workflow}`)
      } else if (run.status !== 'completed') {
        add('ci', 'unknown', `Run ${run.id} is ${run.status}`, `GitHub Actions run ${run.id}`)
      } else if (run.conclusion === 'success') {
        runId = run.id
        add('ci', 'verified', `Run ${run.id} succeeded`, `GitHub Actions run ${run.id}`)
      } else {
        add(
          'ci',
          'mismatch',
          `Run ${run.id}: ${run.conclusion ?? 'no conclusion'}`,
          `GitHub Actions run ${run.id}`
        )
      }
    }
  } else {
    add('ci', 'unknown', 'No revision to look up', 'GitHub Actions')
  }

  // 3. Artifact: the digest that run published, for this revision.
  let digest: string | null = null
  if (runId !== null && revision) {
    const text = await deps.runArtifactFile(runId, 'image-digest', 'image.json')
    let parsed: ReturnType<typeof artifactSchema.safeParse> | null = null
    try {
      parsed = text ? artifactSchema.safeParse(JSON.parse(text)) : null
    } catch {
      parsed = null
    }
    if (!parsed?.success) {
      add('artifact', 'unknown', 'No readable image-digest artifact', `run ${runId}`)
    } else if (parsed.data.revision !== revision) {
      add('artifact', 'mismatch', `Artifact names ${short(parsed.data.revision)}`, `run ${runId}`)
    } else {
      digest = parsed.data.digest
      add('artifact', 'verified', short(parsed.data.digest), `run ${runId} artifact image-digest`)
    }
  } else {
    add('artifact', 'unknown', 'Needs a successful CI run', 'CI artifact')
  }

  // 5 (read early): the deployment config, for the image repository and pinned digest.
  const configText = await deps.readProjectFile(config.configPath)
  let repository: string | null = null
  let configDigest: string | null = null
  let configError: string | null = null
  if (configText === null) {
    configError = 'Config file not found'
  } else {
    try {
      repository = imageRepository(configText, config.imageName)
      configDigest = pinnedDigest(configText, config.imageName)
    } catch (error) {
      configError = error instanceof Error ? error.message : 'Config not readable'
    }
  }

  // 4. Registry: the image at that digest names this revision.
  if (digest && repository && revision) {
    const result = await deps.imageLabels(repository, digest)
    const label = result.labels?.['org.opencontainers.image.revision']
    if (!result.labels) {
      add('registry', 'unknown', result.reason ?? 'Registry did not answer', repository)
    } else if (label === revision) {
      add(
        'registry',
        'verified',
        `revision label ${short(label)}`,
        `${repository}@${short(digest)}`
      )
    } else {
      add(
        'registry',
        'mismatch',
        label ? `label names ${short(label)}` : 'No revision label',
        repository
      )
    }
  } else {
    add(
      'registry',
      'unknown',
      repository ? 'Needs the artifact digest' : 'No image repository in config',
      'registry'
    )
  }

  // 4b. Opt-in supply chain: signature and SBOM for the exact candidate digest.
  let requireSignature = false
  if (deps.supplyChain && digest && repository) {
    const evidence = await deps.supplyChain(repository, digest)
    if (evidence) {
      requireSignature = evidence.requireSignature
      const source = `${repository}@${short(digest)}`
      add('signature', evidence.signature.status, evidence.signature.detail, source)
      add('sbom', evidence.sbom.status, evidence.sbom.detail, source)
    }
  }

  // 5. Config: the digest the controller will deploy.
  if (configError) {
    add('config', 'unknown', configError, config.configPath)
  } else if (!configDigest) {
    add('config', 'unknown', 'No digest pinned for this image', config.configPath)
  } else if (digest && configDigest === digest) {
    add('config', 'verified', `pins ${short(configDigest)}`, config.configPath)
  } else {
    add('config', digest ? 'mismatch' : 'unknown', `pins ${short(configDigest)}`, config.configPath)
  }

  // 6. Controller and 7. running pods.
  const app = await deps.kubectl([
    '-n',
    config.applicationNamespace,
    'get',
    'applications.argoproj.io',
    config.application,
    '-o',
    'json'
  ])
  let destination: string | null = null
  if (!app.ok) {
    add(
      'controller',
      'unknown',
      `Argo CD Application unreadable (${app.code})`,
      `Argo CD ${config.application}`
    )
  } else {
    let parsedApp: ReturnType<typeof applicationSchema.safeParse> | null = null
    try {
      parsedApp = applicationSchema.safeParse(JSON.parse(app.out))
    } catch {
      parsedApp = null
    }
    if (!parsedApp?.success) {
      add('controller', 'unknown', 'Unexpected Application shape', `Argo CD ${config.application}`)
    } else {
      destination = parsedApp.data.spec.destination.namespace ?? null
      const sync = parsedApp.data.status?.sync?.status ?? 'Unknown'
      const health = parsedApp.data.status?.health?.status ?? 'Unknown'
      const synced = parsedApp.data.status?.sync?.revision ?? ''
      add(
        'controller',
        sync === 'Synced' && health === 'Healthy'
          ? 'verified'
          : sync === 'Unknown'
            ? 'unknown'
            : 'mismatch',
        `${sync} · ${health}${SHA.test(synced) ? ` · deploy ${short(synced)}` : ''}`,
        `Argo CD ${config.application}`
      )
    }
  }
  if (!destination || !repository) {
    add('running', 'unknown', 'No destination namespace or image repository', 'cluster')
  } else {
    const pods = await deps.kubectl(['-n', destination, 'get', 'pods', '-o', 'json'])
    let running: string[] = []
    try {
      const parsedPods = podsSchema.safeParse(JSON.parse(pods.out))
      running = parsedPods.success
        ? parsedPods.data.items.flatMap((pod) =>
            (pod.status?.containerStatuses ?? [])
              // Pulled by digest, containerd reports `image` as a local ID; `imageID` names the repository.
              .filter((container) =>
                [
                  container.imageID.split('@')[0],
                  container.image.split('@')[0].split(':')[0]
                ].includes(repository)
              )
              .map((container) => container.imageID.split('@').at(-1) ?? '')
              .filter((value) => DIGEST.test(value))
          )
        : []
    } catch {
      running = []
    }
    const unique = [...new Set(running)]
    if (!pods.ok || unique.length === 0) {
      add(
        'running',
        'unknown',
        pods.ok ? 'No running pods for this image' : `Pods unreadable (${pods.code})`,
        `namespace ${destination}`
      )
    } else if (digest && unique.length === 1 && unique[0] === digest) {
      add(
        'running',
        'verified',
        `${running.length} container(s) on ${short(digest)}`,
        `namespace ${destination}`
      )
    } else {
      add(
        'running',
        digest ? 'mismatch' : 'unknown',
        `running ${unique.map(short).join(', ')}`,
        `namespace ${destination}`
      )
    }
  }

  // A required signature gates promotion; SBOM evidence stays advisory.
  const gates = ['ci', 'artifact', 'registry', ...(requireSignature ? ['signature'] : [])]
  const blocking = links.find((link) => gates.includes(link.id) && link.status !== 'verified')
  return {
    revision,
    digest,
    links,
    promotable: !blocking && digest !== null,
    blockedBy: blocking?.id ?? null,
    configDigest,
    configFingerprint: configText === null ? null : fileFingerprint(configText),
    readAt: now
  }
}
