import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { isPortFree, parsePortValue, resolveDevInstancePorts } from './dev-instance-isolation.mjs'

/** A workspace must keep its renderer origin across warm handoffs and cold starts. */
export async function resolveDevWorkspacePorts({
  forwardedArgs,
  repoRoot,
  profile,
  env = process.env
}) {
  const target = env.BASTION_PROJECT_WORKSPACE_LAUNCH ?? 'home'
  const directory = join(profile.userDataPath, 'bastion-project-workspaces')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = join(directory, 'dev-renderer-ports.json')
  let saved = {}
  if (existsSync(file)) {
    if (lstatSync(file).isSymbolicLink()) {
      throw new Error('Development renderer registry cannot be redirected.')
    }
    saved = JSON.parse(readFileSync(file, 'utf8'))
    if (
      !saved ||
      typeof saved !== 'object' ||
      Array.isArray(saved) ||
      Object.values(saved).some(
        (port) => typeof port !== 'number' || parsePortValue(String(port)) === null
      )
    ) {
      throw new Error('Development renderer registry is invalid.')
    }
  }
  const previous = Object.hasOwn(saved, target) ? saved[target] : null
  if (previous !== null) {
    if (!(await isPortFree(previous))) {
      throw new Error(
        `Workspace renderer port ${previous} is busy. Close its previous dev instance and retry; its saved origin has been preserved.`
      )
    }
    env.ORCA_DEV_RENDERER_PORT = String(previous)
  }
  const ports = await resolveDevInstancePorts({
    forwardedArgs,
    env,
    instanceKey: `${env.ORCA_DEV_INSTANCE_KEY || repoRoot}:${profile.userDataPath}:${target}`
  })
  if (ports.rendererPort === null) {
    throw new Error('No renderer port is available for this workspace.')
  }
  saved[target] = ports.rendererPort
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 })
  renameSync(temporary, file)
  return ports
}
