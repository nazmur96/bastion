import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, rmdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import {
  recipeDirectorySchema,
  type RecipeFile
} from '../../../shared/fork-recipes/object-storage-recipe'

const MAX_FILES = 20
const MAX_BYTES = 65536
/** Local Terraform working files the engineer may have created; never copied or fingerprinted. */
function isLocalWorkingFile(name: string): boolean {
  return name === '.terraform' || name.endsWith('.tfstate') || name.includes('.tfstate.')
}

export class RecipeFileError extends Error {
  constructor(readonly code: 'exists' | 'unsafe-path' | 'layout' | 'too-large' | 'invalid') {
    super(code)
  }
}

function directoryOf(path: string): string {
  const directory = path.split('/').slice(0, -1).join('/')
  if (
    !directory ||
    !recipeDirectorySchema.safeParse(directory).success ||
    !/^[A-Za-z0-9._-]+$/.test(path.split('/').at(-1) ?? '')
  ) {
    throw new RecipeFileError('invalid')
  }
  return directory
}

/**
 * Writes a recipe change. Files in `newDirectory` require that directory to be new; any other
 * file (for example an application config example) is created exclusively in an existing or
 * new directory. Never overwrites, refuses symlinked components, and on failure removes only
 * what this call created.
 */
export async function writeRecipeFiles(
  root: string,
  files: RecipeFile[],
  newDirectory = files.length ? directoryOf(files[0].path) : ''
): Promise<string[]> {
  const directories = new Set(files.map((file) => directoryOf(file.path)))
  if (!directories.has(newDirectory) || directories.size > 2) {
    throw new RecipeFileError('invalid')
  }
  const created: { kind: 'dir' | 'file'; path: string }[] = []
  const ensure = async (directory: string, mustBeNew: boolean): Promise<void> => {
    let current = root
    const parts = directory.split('/')
    for (const [index, part] of parts.entries()) {
      current = join(current, part)
      const last = index === parts.length - 1
      try {
        const entry = await lstat(current)
        if (last && mustBeNew) {
          throw new RecipeFileError('exists')
        }
        if (entry.isSymbolicLink() || !entry.isDirectory()) {
          throw new RecipeFileError('unsafe-path')
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
        await mkdir(current)
        created.push({ kind: 'dir', path: current })
      }
    }
  }
  try {
    await ensure(newDirectory, true)
    for (const directory of directories) {
      if (directory !== newDirectory) {
        await ensure(directory, false)
      }
    }
    for (const file of files) {
      if (Buffer.byteLength(file.content) > MAX_BYTES) {
        throw new RecipeFileError('too-large')
      }
      const path = join(root, file.path)
      let handle
      try {
        handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o644)
      } catch (error) {
        throw error instanceof Error && 'code' in error && error.code === 'EEXIST'
          ? new RecipeFileError('exists')
          : error
      }
      created.push({ kind: 'file', path })
      try {
        await handle.writeFile(file.content)
      } finally {
        await handle.close()
      }
    }
    return files.map((file) => file.path)
  } catch (error) {
    for (const entry of created.toReversed()) {
      await (entry.kind === 'file' ? unlink(entry.path) : rmdir(entry.path)).catch(() => {})
    }
    throw error
  }
}

/** The recipe directory's current top-level source files, as the engineer may have edited them. */
export async function readRecipeFiles(root: string, directory: string): Promise<RecipeFile[]> {
  if (!recipeDirectorySchema.safeParse(directory).success) {
    throw new RecipeFileError('invalid')
  }
  let current = root
  for (const part of directory.split('/')) {
    current = join(current, part)
    const entry = await lstat(current)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new RecipeFileError('unsafe-path')
    }
  }
  const names = (await readdir(current)).filter((name) => !isLocalWorkingFile(name)).sort()
  if (names.length === 0 || names.length > MAX_FILES) {
    throw new RecipeFileError('layout')
  }
  const files: RecipeFile[] = []
  for (const name of names) {
    const path = join(current, name)
    const entry = await lstat(path)
    if (!entry.isFile() || entry.isSymbolicLink()) {
      // Modules in subdirectories are not supported by this recipe version.
      throw new RecipeFileError('layout')
    }
    if (entry.size > MAX_BYTES) {
      throw new RecipeFileError('too-large')
    }
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      files.push({ path: `${directory}/${name}`, content: await handle.readFile('utf8') })
    } finally {
      await handle.close()
    }
  }
  return files
}
