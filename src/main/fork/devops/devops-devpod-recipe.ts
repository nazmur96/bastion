import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
  type Stats
} from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEVPOD_RECIPE_DIR,
  DEVPOD_RECIPE_SCRIPTS,
  withDevpodRecipe
} from '../../../shared/fork-devops-devpod-recipe'

type RecipeResult = { ok: true; files: string[] } | { ok: false; error: string }

class RecipeRefusal extends Error {}

function entry(path: string): Stats | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

// A symlink anywhere on a written path could redirect the write outside the repository.
function requireRealEntry(root: string, relative: string, kind: 'file' | 'directory'): boolean {
  const stats = entry(join(root, relative))
  if (!stats) {
    return false
  }
  if (stats.isSymbolicLink()) {
    throw new RecipeRefusal(`${relative} is a symbolic link; nothing was changed.`)
  }
  if (kind === 'file' ? !stats.isFile() : !stats.isDirectory()) {
    throw new RecipeRefusal(`${relative} is not a regular ${kind}; nothing was changed.`)
  }
  return true
}

function hasDevcontainer(root: string): boolean {
  if (requireRealEntry(root, '.devcontainer.json', 'file')) {
    return true
  }
  return (
    requireRealEntry(root, '.devcontainer', 'directory') &&
    requireRealEntry(root, '.devcontainer/devcontainer.json', 'file')
  )
}

function readWithoutFollowing(path: string): string {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    return readFileSync(fd, 'utf8')
  } finally {
    closeSync(fd)
  }
}

function checkRecipeTarget(root: string): string {
  if (!hasDevcontainer(root)) {
    throw new RecipeRefusal('Add a devcontainer.json before preparing the DevPod recipe.')
  }
  if (
    entry(join(root, 'devenv.nix')) &&
    ['mise.toml', '.mise.toml'].some((name) => entry(join(root, name)))
  ) {
    throw new RecipeRefusal(
      'Both mise and devenv configuration are present. Choose one tool-version owner first.'
    )
  }
  const segments = DEVPOD_RECIPE_DIR.split('/')
  segments.forEach((_, index) =>
    requireRealEntry(root, segments.slice(0, index + 1).join('/'), 'directory')
  )
  const clash = Object.keys(DEVPOD_RECIPE_SCRIPTS).find((name) =>
    entry(join(root, DEVPOD_RECIPE_DIR, name))
  )
  if (clash) {
    throw new RecipeRefusal(`${DEVPOD_RECIPE_DIR}/${clash} already exists; nothing was changed.`)
  }
  const current = requireRealEntry(root, 'orca.yaml', 'file')
    ? readWithoutFollowing(join(root, 'orca.yaml'))
    : ''
  const next = withDevpodRecipe(current)
  if (next === null) {
    throw new RecipeRefusal('orca.yaml already has a "devpod" environment recipe.')
  }
  return next
}

/**
 * Adds the DevPod environment recipe to the repo. Refuses symlinked targets, a missing Dev
 * Container declaration and conflicting tool owners; either every file lands or none does.
 */
export function addDevpodRecipe(workspacePath: string): RecipeResult {
  const createdDirs: string[] = []
  const staged: { temp: string; target: string; relative: string }[] = []
  const placed: string[] = []
  try {
    const root = realpathSync(workspacePath)
    const orcaYaml = checkRecipeTarget(root)
    const yamlMode = entry(join(root, 'orca.yaml'))?.mode ?? 0o644
    let dir = root
    for (const segment of DEVPOD_RECIPE_DIR.split('/')) {
      dir = join(dir, segment)
      if (!entry(dir)) {
        mkdirSync(dir, { mode: 0o755 })
        createdDirs.push(dir)
      }
    }
    const stage = (relative: string, body: string, mode: number): void => {
      const target = join(root, relative)
      const temp = join(dirname(target), `.${randomUUID()}.orca-tmp`)
      writeFileSync(temp, body, { flag: 'wx', mode })
      staged.push({ temp, target, relative })
    }
    for (const [name, body] of Object.entries(DEVPOD_RECIPE_SCRIPTS)) {
      stage(`${DEVPOD_RECIPE_DIR}/${name}`, body, 0o755)
    }
    stage('orca.yaml', orcaYaml, yamlMode & 0o777)
    // orca.yaml is staged last, so a failed run never leaves a recipe pointing at missing scripts.
    for (const file of staged) {
      renameSync(file.temp, file.target)
      placed.push(file.target)
    }
    return { ok: true, files: staged.map((file) => file.relative) }
  } catch (error) {
    for (const file of staged) {
      rmSync(file.temp, { force: true })
    }
    for (const target of placed.filter((path) => !path.endsWith('orca.yaml'))) {
      rmSync(target, { force: true })
    }
    for (const dir of createdDirs.toReversed()) {
      try {
        rmdirSync(dir)
      } catch {
        // Left in place if something else wrote into it meanwhile.
      }
    }
    return {
      ok: false,
      error:
        error instanceof RecipeRefusal
          ? error.message
          : `Could not prepare the DevPod recipe: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
