import { ipcRenderer } from 'electron'
import type {
  ProjectWorkspacesApi,
  ProjectWorkspaceSwitchResult
} from '../../shared/fork-project-workspaces'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const projectWorkspacesApi: ProjectWorkspacesApi = {
  list: () => ipcRenderer.invoke('bastionWorkspaces:list'),
  create: (args) => ipcRenderer.invoke('bastionWorkspaces:create', args),
  rename: (args) => ipcRenderer.invoke('bastionWorkspaces:rename', args),
  switch: (args) =>
    prepareAndInvokeAppRestart<ProjectWorkspaceSwitchResult>(
      window,
      () => ipcRenderer.invoke('bastionWorkspaces:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    )
}
