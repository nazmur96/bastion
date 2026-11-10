import { app } from 'electron'
import {
  configureDevUserDataPath,
  configureOrcaUserDataPathEnv
} from '../../startup/configure-process'
import { configureProjectWorkspace } from './workspace-context'

export function configureProjectWorkspaceStartup(isDev: boolean, isServeMode: boolean): void {
  configureDevUserDataPath(isDev)
  if (!isServeMode) {
    configureProjectWorkspace(app.getPath('userData'), (name, path) => app.setPath(name, path))
  }
  configureOrcaUserDataPathEnv()
}
