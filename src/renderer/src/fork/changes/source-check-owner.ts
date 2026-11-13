import { joinPath } from '@/lib/path'
import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { readRuntimeFileRange, statRuntimeReadTarget } from '@/runtime/runtime-file-range-client'
import { getRuntimeEnvironmentRevision } from '@/runtime/runtime-environment-revision'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { UNRESOLVED_OWNER_HOST_ID } from '../../../../shared/execution-host'
import {
  changeSnapshotSchema,
  isChangeSourcePath,
  type ChangeScope,
  type ChangeSnapshot,
  type SourceCheckCode
} from '../../../../shared/fork-changes/change-contract'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { startWorkspaceHost } from '../workbench/start-project-actions'

/** A readable refusal instead of a raw schema error; the path is the engineer's own input. */
function assertCheckablePath(path: string): void {
  if (path.length > 512 || !isChangeSourcePath(path)) {
    throw new Error(
      `Cannot check "${path.slice(0, 120)}": use a repository-relative JSON, Terraform, YAML, TOML, Nix, Dockerfile or go.mod path. Secret-named, environment, state and generated files are excluded.`
    )
  }
}

export function captureSourceCheckOwner(projectId: string) {
  const hostId = startWorkspaceHost(projectId)
  if (hostId === UNRESOLVED_OWNER_HOST_ID) {
    throw new Error('Project execution owner is unresolved.')
  }
  const route = captureProjectFileRoute(projectId)
  if (hostId !== 'local' && route.context.target.kind !== 'environment') {
    throw new Error('Source checks require a managed runtime for this remote project.')
  }
  const scope: ChangeScope = {
    projectId,
    root: route.root,
    hostId,
    routeKey: JSON.stringify({
      route: route.guard.route,
      pairingRevision:
        route.context.target.kind === 'environment'
          ? (getRuntimeEnvironmentRevision(route.context.target.environmentId) ?? null)
          : null
    })
  }
  const assertCurrent = (): void => {
    route.guard.assertCurrent()
    if (startWorkspaceHost(projectId) !== hostId) {
      throw new Error('Project execution owner changed.')
    }
  }
  const read = async (path: string): Promise<string> => {
    assertCheckablePath(path)
    assertCurrent()
    const parts = path.split('/')
    let directory = route.root
    for (const [index, part] of parts.entries()) {
      const entries = await readRuntimeDirectory(route.context, directory)
      assertCurrent()
      const entry = entries.find((item) => item.name === part)
      if (!entry || entry.isSymlink || entry.isDirectory !== index < parts.length - 1) {
        throw new Error('Source is missing, symlinked or not a regular file.')
      }
      directory = joinPath(directory, part)
    }
    const args = {
      ...route.guard.route,
      worktreeId: projectId,
      filePath: joinPath(route.root, path),
      relativePath: path
    }
    const before = await statRuntimeReadTarget(args)
    assertCurrent()
    if (before.isDirectory || before.size > 65536) {
      throw new Error('Source check requires a regular file of at most 64 KiB.')
    }
    const bytes =
      before.size === 0 ? new Uint8Array() : await readRuntimeFileRange(args, 0, before.size)
    assertCurrent()
    const after = await statRuntimeReadTarget(args)
    assertCurrent()
    if (
      bytes.length !== before.size ||
      after.size !== before.size ||
      after.mtime !== before.mtime
    ) {
      throw new Error('Source changed during inspection.')
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  const snapshot = async (paths: string[]): Promise<ChangeSnapshot> => {
    if (!paths.length || paths.length > 20 || new Set(paths).size !== paths.length) {
      throw new Error('Choose between 1 and 20 unique source files.')
    }
    paths.forEach(assertCheckablePath)
    const files: ChangeSnapshot['files'] = []
    for (const path of [...paths].sort()) {
      files.push({ path, fingerprint: getDiskBaselineSignature(await read(path)) })
    }
    assertCurrent()
    return changeSnapshotSchema.parse({ adapter: 'source-check/v1', files })
  }
  return { scope, read, snapshot, assertCurrent, context: route.context }
}

export function checkSourceText(path: string, text: string, fingerprint: string): SourceCheckCode {
  if (getDiskBaselineSignature(text) !== fingerprint) {
    return 'changed'
  }
  if (path.endsWith('.json')) {
    try {
      JSON.parse(text)
      return 'json-valid'
    } catch {
      return 'json-invalid'
    }
  }
  return 'readable'
}
