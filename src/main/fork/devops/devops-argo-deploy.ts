import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:https'
import { basename, join } from 'node:path'
import { inspectDevopsWorkspace, listFiles, run } from './devops-inspect'
import { kubectlIn } from './devops-kubectl'
import { freeLocalPort } from './devops-ports'
import {
  ARGO_UI_PORT,
  argoAppName,
  argoSources,
  httpsRepoUrl,
  type ArgoDeployPlan
} from '../../../shared/fork-devops-argo-deploy'

/** What "Deploy this repo with Argo CD" would use, read-only: remote, branch, sources, and whether Argo is there. */
export async function readArgoDeployPlan(
  workspacePath: string,
  /** The open workspace: its kubeconfig decides which cluster is checked for Argo CD. */
  clusterPath: string = workspacePath
): Promise<ArgoDeployPlan> {
  const remote = await run('git', ['remote', 'get-url', 'origin'], workspacePath)
  if (!remote.ok) {
    return {
      ok: false,
      error: 'This repo has no "origin" remote. Argo CD deploys from a pushed Git repo.'
    }
  }
  const repoURL = httpsRepoUrl(remote.stdout)
  if (!repoURL) {
    return {
      ok: false,
      error: `Argo CD cannot clone ${remote.stdout.trim()}; it needs an https or ssh Git URL.`
    }
  }
  const branch = (
    await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], workspacePath)
  ).stdout.trim()
  const ahead = await run('git', ['rev-list', '--count', '@{u}..HEAD'], workspacePath)
  const [files, inspection, crd] = await Promise.all([
    listFiles(workspacePath),
    inspectDevopsWorkspace(workspacePath),
    kubectlIn(clusterPath, [
      'get',
      'crd',
      'applications.argoproj.io',
      '-o',
      'name',
      '--request-timeout=8s'
    ])
  ])
  const manifestDirs =
    inspection.findings.find((finding) => finding.stack === 'kubernetes')?.dirs ?? []
  const sources = argoSources(files, manifestDirs)
  if (sources.length === 0) {
    return {
      ok: false,
      error: 'No Kubernetes manifests, kustomization or Helm chart found in this repo.'
    }
  }
  const argoInstalled = crd.ok && crd.out.includes('applications.argoproj.io')
  const name = argoAppName(basename(workspacePath))
  const application = argoInstalled
    ? await kubectlIn(clusterPath, [
        '-n',
        'argocd',
        'get',
        'application',
        name,
        '-o',
        'name',
        '--request-timeout=8s'
      ])
    : null
  const applicationExists = application?.ok === true && application.out.trim() !== ''
  return {
    ok: true,
    repoURL,
    branch: branch && branch !== 'HEAD' ? branch : 'HEAD',
    unpushed: ahead.ok ? Number.parseInt(ahead.stdout.trim(), 10) || 0 : null,
    sources,
    argoInstalled,
    applicationExists,
    name,
    uiPort: await freeLocalPort(ARGO_UI_PORT)
  }
}

/** The Application manifest goes to userData so the repo stays untouched; the path is shown to the person. */
export function writeArgoApplication(name: string, yaml: string): string {
  const dir = join(app.getPath('userData'), 'fork-argo')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${name}.yaml`)
  writeFileSync(file, yaml)
  return file
}

/** Whether the forwarded Argo CD UI answers yet (self-signed certificate, local only). */
export function probeArgoUi(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 2_000
      },
      (res) => {
        res.resume()
        resolve(true)
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}
