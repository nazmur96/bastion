import { execFile } from 'node:child_process'
import { existsSync, openSync, readSync, closeSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  detectDevopsStacks,
  devopsHeadWanted,
  type DevopsStackFinding
} from '../../../shared/fork-devops-stacks'
import type { DevopsInspection, DevopsToolStatus } from '../../../shared/fork-devops-inspection'
import { DEVOPS_ACTIONS } from '../../../shared/fork-devops-actions'

// Only the catalog's CLIs are probed: they reach a shell, so they never come from the renderer.
const CATALOG_TOOLS = [...new Set(DEVOPS_ACTIONS.map((action) => action.tool))]

const FILE_LIMIT = 20_000
const HEAD_LIMIT = 400
const HEAD_BYTES = 4096
const TOOL_TIMEOUT_MS = 8_000

/** stdout on success; on failure stdout and stderr together, so callers can show why. */
export function run(
  command: string,
  args: readonly string[],
  cwd: string,
  timeout = TOOL_TIMEOUT_MS
): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      { cwd, timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          stdout: error ? `${String(stdout)}${String(stderr)}` : String(stdout)
        })
    )
  })
}

const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  '.terraform',
  'vendor',
  'dist',
  'build',
  '.venv'
])

/** Folder workspaces have no git index; walk them with the usual heavy directories left out. */
function walkFiles(root: string): string[] {
  const files: string[] = []
  const pending = ['']
  while (pending.length > 0 && files.length < FILE_LIMIT) {
    const dir = pending.pop() ?? ''
    let entries
    try {
      entries = readdirSync(join(root, dir), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) {
          pending.push(path)
        }
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  return files.slice(0, FILE_LIMIT)
}

/** Tracked and untracked-but-not-ignored files, so build output and vendored trees stay out. */
export async function listFiles(workspacePath: string): Promise<string[]> {
  const listed = await run(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    workspacePath
  )
  return listed.ok
    ? listed.stdout.split('\n').filter(Boolean).slice(0, FILE_LIMIT)
    : walkFiles(workspacePath)
}

function readHead(path: string): string | null {
  let fd: number | null = null
  try {
    fd = openSync(path, 'r')
    const buffer = Buffer.alloc(HEAD_BYTES)
    const read = readSync(fd, buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, read).toString('utf8')
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

export const MISE_FILES = ['mise.toml', '.mise.toml', '.tool-versions']

/** Principle 3: the repo's mise environment first, then PATH; never an install on the host. */
export async function resolveTool(
  workspacePath: string,
  tool: string,
  usesMise: boolean
): Promise<DevopsToolStatus> {
  if (usesMise) {
    const viaMise = await run('mise', ['which', tool], workspacePath)
    if (viaMise.ok && viaMise.stdout.trim()) {
      return { tool, available: true, runner: 'mise', prefix: 'mise exec -- ' }
    }
  }
  const onPath =
    process.platform === 'win32'
      ? await run('where', [tool], workspacePath)
      : await run('sh', ['-c', `command -v ${tool}`], workspacePath)
  if (onPath.ok && onPath.stdout.trim()) {
    return { tool, available: true, runner: 'path', prefix: '' }
  }
  return {
    tool,
    available: false,
    hint: usesMise
      ? `Add it to this repo's mise.toml (mise use ${tool}), or open the workspace in its dev container.`
      : `Install ${tool}, or open the workspace in an environment that has it.`
  }
}

/** Stacks only, no tool lookups: cheap enough to run over sibling repos. */
export async function findDevopsStacks(workspacePath: string): Promise<DevopsStackFinding[]> {
  const files = await listFiles(workspacePath)
  let headsRead = 0
  return detectDevopsStacks(files, (path) => {
    if (!devopsHeadWanted(path) || headsRead >= HEAD_LIMIT) {
      return null
    }
    headsRead += 1
    return readHead(join(workspacePath, path))
  })
}

export async function inspectDevopsWorkspace(workspacePath: string): Promise<DevopsInspection> {
  const findings = await findDevopsStacks(workspacePath)
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const wanted = CATALOG_TOOLS.filter((tool) =>
    DEVOPS_ACTIONS.some(
      (action) => action.tool === tool && findings.some((f) => f.stack === action.stack)
    )
  )
  const statuses = await Promise.all(
    wanted.map((tool) => resolveTool(workspacePath, tool, usesMise))
  )
  return {
    findings,
    environment: usesMise ? 'mise' : 'path',
    shell: process.platform === 'win32' ? 'windows' : 'posix',
    tools: Object.fromEntries(statuses.map((status) => [status.tool, status]))
  }
}
