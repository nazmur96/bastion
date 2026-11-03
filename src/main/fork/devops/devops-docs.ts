import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { listFiles } from './devops-inspect'
import {
  TRACKER_FILES,
  isRunbookPath,
  parseRunbook,
  parseTracker,
  setTrackerItem,
  type RepoDocs
} from '../../../shared/fork-devops-docs'

const DOC_BYTES = 256 * 1024
const MAX_RUNBOOKS = 30

function readSmall(path: string): string | null {
  try {
    return statSync(path).size <= DOC_BYTES ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/** The repo's runbooks and its tracker, read-only. */
export async function readRepoDocs(workspacePath: string): Promise<RepoDocs> {
  const runbooks = (await listFiles(workspacePath))
    .filter(isRunbookPath)
    .slice(0, MAX_RUNBOOKS)
    .flatMap((file) => {
      const text = readSmall(join(workspacePath, file))
      return text === null ? [] : [parseRunbook(file, text)]
    })
  const trackerFile = TRACKER_FILES.find((file) => existsSync(join(workspacePath, file))) ?? null
  const trackerText = trackerFile ? readSmall(join(workspacePath, trackerFile)) : null
  return {
    runbooks,
    tracker:
      trackerFile && trackerText !== null
        ? { file: trackerFile, items: parseTracker(trackerText) }
        : null
  }
}

/** Ticks or unticks one checkbox in the tracker file; any other file or line is refused. */
export function setRepoTrackerItem(
  workspacePath: string,
  file: string,
  line: number,
  checked: boolean
): boolean {
  if (!TRACKER_FILES.includes(file)) {
    return false
  }
  const path = join(workspacePath, file)
  const text = readSmall(path)
  const next = text === null ? null : setTrackerItem(text, line, checked)
  if (next === null) {
    return false
  }
  writeFileSync(path, next)
  return true
}
