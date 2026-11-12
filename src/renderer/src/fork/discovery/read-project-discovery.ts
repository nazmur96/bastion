import { joinPath } from '@/lib/path'
import { listRuntimeFiles } from '@/runtime/runtime-file-search-client'
import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { readRuntimeFileRange, statRuntimeReadTarget } from '@/runtime/runtime-file-range-client'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { readRuntimeDevopsStacks } from '../devops/runtime-devops-stacks'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { UNRESOLVED_OWNER_HOST_ID } from '../../../../shared/execution-host'
import {
  CONTRACT_FILE,
  discoveryFingerprint,
  discoverySourceWanted,
  parseServiceContract,
  sourceFacts,
  type DiscoverySnapshot,
  type ServiceContract
} from './service-knowledge'

export type ProjectDiscovery = {
  snapshot: DiscoverySnapshot
  contract: ServiceContract | null
  contractError: string | null
}
const SOURCE_LIMIT = 100
const BYTE_LIMIT = 65536

export async function readProjectDiscovery(worktreeId: string): Promise<ProjectDiscovery> {
  const hostId = startWorkspaceHost(worktreeId)
  if (hostId === UNRESOLVED_OWNER_HOST_ID) {
    throw new Error('Project execution owner is unresolved.')
  }
  const { root, guard, context } = captureProjectFileRoute(worktreeId)
  if (hostId !== 'local' && context.target.kind !== 'environment') {
    throw new Error('Discovery requires a managed runtime for this remote host.')
  }
  const stacks =
    hostId === 'local'
      ? await window.api.aiVault.inspectDevops(root)
      : await readRuntimeDevopsStacks(worktreeId)
  guard.assertCurrent()
  const files = (
    await listRuntimeFiles(context, {
      rootPath: root,
      includeIgnored: false,
      allowLegacyIncludeIgnored: true,
      maxResults: 20000
    })
  ).sort()
  guard.assertCurrent()
  const limits = [
    'Only supported configuration files are inspected. This is not a credential-leak scan, dependency binding or proof of deployed health.'
  ]
  if (files.length >= 20000) {
    limits.push('File inventory reached its 20,000-file limit.')
  }
  const candidates = files.filter(discoverySourceWanted)
  if (candidates.length > SOURCE_LIMIT) {
    limits.push('Source inspection reached its 100-file limit.')
  }
  const versions: [string, string][] = [
    [
      'inventory',
      getDiskBaselineSignature(JSON.stringify(files.filter((f) => f !== CONTRACT_FILE)))
    ]
  ]
  const facts: DiscoverySnapshot['facts'] = []
  const directories = new Map<string, ReturnType<typeof readRuntimeDirectory>>()
  const directory = (relative: string) => {
    let cached = directories.get(relative)
    if (!cached) {
      cached = readRuntimeDirectory(context, relative ? joinPath(root, relative) : root)
      directories.set(relative, cached)
    }
    return cached
  }
  const read = async (relativePath: string): Promise<string> => {
    const parts = relativePath.split('/')
    if (
      parts.some(
        (part) =>
          !part || part === '.' || part === '..' || part.includes('\\') || part.includes('\0')
      )
    ) {
      throw new Error('Unsafe source path.')
    }
    let parent = ''
    for (let i = 0; i < parts.length; i++) {
      const entry = (await directory(parent)).find((e) => e.name === parts[i])
      guard.assertCurrent()
      if (!entry || entry.isSymlink || entry.isDirectory !== i < parts.length - 1) {
        throw new Error('Source is missing, symlinked or not a regular file.')
      }
      parent = parent ? `${parent}/${parts[i]}` : parts[i]
    }
    const args = {
      ...guard.route,
      worktreeId,
      filePath: joinPath(root, relativePath),
      relativePath
    }
    const stat = await statRuntimeReadTarget(args)
    guard.assertCurrent()
    if (stat.size > BYTE_LIMIT) {
      throw new Error('Source exceeds the 64 KiB inspection limit.')
    }
    const bytes =
      stat.size === 0 ? new Uint8Array() : await readRuntimeFileRange(args, 0, stat.size)
    guard.assertCurrent()
    if (bytes.length !== stat.size) {
      throw new Error('Source changed during inspection.')
    }
    const after = await statRuntimeReadTarget(args)
    guard.assertCurrent()
    if (after.size !== stat.size || after.mtime !== stat.mtime) {
      throw new Error('Source changed during inspection.')
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  }
  for (const path of candidates.slice(0, SOURCE_LIMIT)) {
    try {
      const text = await read(path)
      const fingerprint = getDiskBaselineSignature(text)
      versions.push([path, fingerprint])
      facts.push(...sourceFacts(path, text, fingerprint))
    } catch {
      guard.assertCurrent()
      versions.push([path, 'unreadable'])
      limits.push(`Not inspected: ${path}`)
    }
  }
  for (const finding of stacks.findings) {
    facts.push({
      id: `stack:${finding.stack}`,
      kind: 'observed',
      summary: `Repository contains ${finding.stack} configuration; deployment is unverified.`,
      evidence: finding.evidence.map((path) => ({
        path,
        line: null,
        fingerprint: versions.find(([name]) => name === path)?.[1] ?? 'path-only'
      }))
    })
  }
  let contract: ServiceContract | null = null
  let contractError: string | null = null
  if ((await directory('')).some((entry) => entry.name === CONTRACT_FILE)) {
    try {
      contract = parseServiceContract(await read(CONTRACT_FILE))
    } catch (error) {
      guard.assertCurrent()
      contractError = error instanceof Error ? error.message : String(error)
    }
  }
  guard.assertCurrent()
  if (facts.length > 300) {
    limits.push('Findings display reached its 300-fact limit.')
  }
  return {
    snapshot: {
      at: new Date().toISOString(),
      root,
      hostId,
      fingerprint: discoveryFingerprint(versions),
      findings: stacks.findings,
      facts: facts.slice(0, 300),
      limits
    },
    contract,
    contractError
  }
}
