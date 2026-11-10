// Fork: project workspace roots can exceed Unix endpoint path limits.
import { boundedSocketDirectory } from '../fork/project-workspaces/workspace-socket-directory'
import { join } from 'node:path'

/** The daemon runtime dir of a server serving this data root. */
export function daemonRuntimeDirFor(userDataPath: string): string {
  return boundedSocketDirectory(join(userDataPath, 'daemon'))
}
