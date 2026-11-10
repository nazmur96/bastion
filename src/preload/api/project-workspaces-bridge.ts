import { ipcRenderer } from 'electron'
import type {
  ProjectWorkspacesApi,
  ProjectWorkspaceSwitchResult
} from '../../shared/fork-project-workspaces'
import { prepareAndInvokeAppRestart } from '../renderer-restart-wiring'
import { awaitBeforeUnloadCheckpoint } from '../preload-runtime-support'

export const projectWorkspacesApi: ProjectWorkspacesApi = {
  ready: () => ipcRenderer.invoke('bastionWorkspaces:ready'),
  list: () => ipcRenderer.invoke('bastionWorkspaces:list'),
  create: (args) => ipcRenderer.invoke('bastionWorkspaces:create', args),
  rename: (args) => ipcRenderer.invoke('bastionWorkspaces:rename', args),
  switch: (args) => {
    window.dispatchEvent(new CustomEvent('bastion:workspace-transition', { detail: args.toId }))
    return prepareAndInvokeAppRestart<ProjectWorkspaceSwitchResult>(
      window,
      () => ipcRenderer.invoke('bastionWorkspaces:switch', args),
      awaitBeforeUnloadCheckpoint,
      (result) => result.status === 'relaunching'
    )
      .then((result) => {
        if (result.status !== 'relaunching') {
          window.dispatchEvent(new Event('bastion:workspace-transition-aborted'))
        }
        return result
      })
      .catch((error) => {
        window.dispatchEvent(new Event('bastion:workspace-transition-aborted'))
        throw error
      })
  }
}
