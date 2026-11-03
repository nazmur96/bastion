import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { MISE_FILES, findDevopsStacks, listFiles, resolveTool, run } from './devops-inspect'
import { kubectlIn } from './devops-kubectl'
import { readDevopsContext } from './devops-context'
import { argoSources, type ArgoSource } from '../../../shared/fork-devops-argo-deploy'
import { projectAppName } from '../../../shared/fork-devops-project'
import {
  imageTargets,
  localClusterOf,
  type LocalDeployPlan
} from '../../../shared/fork-devops-local-deploy'

const RENDER_FILES = 200
const RENDER_BYTES = 512 * 1024

/** The manifests as the cluster would get them: kustomize build, helm template, or the plain files. */
async function render(
  clusterPath: string,
  root: string,
  source: ArgoSource
): Promise<string | null> {
  const dir = join(root, source.path)
  if (source.kind === 'kustomize') {
    const built = await kubectlIn(clusterPath, ['kustomize', dir], 30_000)
    return built.ok ? built.out : null
  }
  if (source.kind === 'helm') {
    const usesMise = MISE_FILES.some((name) => existsSync(join(clusterPath, name)))
    const helm = await resolveTool(clusterPath, 'helm', usesMise)
    if (!helm.available) {
      return null
    }
    const args = ['template', 'preview', dir]
    const out =
      helm.runner === 'mise'
        ? await run('mise', ['exec', '--', 'helm', ...args], clusterPath, 30_000)
        : await run('helm', args, clusterPath, 30_000)
    return out.ok ? out.stdout : null
  }
  const files = (await listFiles(root))
    .filter(
      (file) =>
        (file === source.path || file.startsWith(`${source.path}/`) || source.path === '.') &&
        /\.ya?ml$/i.test(file)
    )
    .slice(0, RENDER_FILES)
  return files
    .map((file) => {
      const full = join(root, file)
      try {
        return statSync(full).size <= RENDER_BYTES ? readFileSync(full, 'utf8') : ''
      } catch {
        return ''
      }
    })
    .join('\n---\n')
}

/** Read-only: what "Run on the local cluster" would build, load, apply and retarget. */
export async function readLocalDeployPlan(input: {
  appPath: string
  manifestsPath: string
  clusterPath: string
}): Promise<LocalDeployPlan> {
  const { appPath, manifestsPath, clusterPath } = input
  const appFiles = await listFiles(appPath)
  const dockerfile = appFiles
    .filter((file) => /(^|\/)(Dockerfile|Containerfile)$/.test(file))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0]
  if (!dockerfile) {
    return {
      ok: false,
      error: 'No Dockerfile or Containerfile in the app repo, so there is no image to build.'
    }
  }
  const docker = await resolveTool(appPath, 'docker', false)
  const podman = docker.available ? null : await resolveTool(appPath, 'podman', false)
  if (!docker.available && !podman?.available) {
    return { ok: false, error: 'Neither docker nor podman is available to build the image.' }
  }
  const context = await readDevopsContext(clusterPath, null)
  const cluster = context.kube ? localClusterOf(context.kube.context) : null
  if (!cluster) {
    return {
      ok: false,
      error: `Point kubectl at a kind or k3d cluster first (current: ${context.kube?.context ?? 'none'}).`
    }
  }
  const manifestFiles = manifestsPath === appPath ? appFiles : await listFiles(manifestsPath)
  const findings = await findDevopsStacks(manifestsPath)
  const source = argoSources(
    manifestFiles,
    findings.find((finding) => finding.stack === 'kubernetes')?.dirs ?? []
  )[0]
  if (!source) {
    return { ok: false, error: 'No Kubernetes manifests, kustomization or Helm chart to deploy.' }
  }
  const rendered = await render(clusterPath, manifestsPath, source)
  if (rendered === null) {
    return { ok: false, error: `Could not render ${source.path} (${source.kind}).` }
  }
  const appName = projectAppName(basename(appPath))
  const targets = imageTargets(rendered, appName)
  if (targets.length === 0) {
    return {
      ok: false,
      error: `No workload in ${source.path} runs an image named "${appName}", so it is unclear which one to replace with the local build.`
    }
  }
  const dockerfilePath = join(appPath, dockerfile)
  return {
    ok: true,
    image: `${appName}:dev`,
    dockerfile,
    runtime: docker.available ? 'docker' : 'podman',
    cluster,
    source,
    manifestsPath,
    namespace: targets.find((target) => target.namespace)?.namespace ?? appName,
    targets,
    paths: {
      dockerContext: dirname(dockerfilePath),
      dockerfile: dockerfilePath,
      source: join(manifestsPath, source.path),
      archive: join(tmpdir(), `orca-fork-${appName}-dev.tar`)
    }
  }
}
