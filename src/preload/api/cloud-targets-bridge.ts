import { ipcRenderer } from 'electron'
import type { CloudTargetsApi } from '../../shared/fork-cloud/cloud-target-contract'

export const cloudTargetsApi: CloudTargetsApi = {
  readRuntime: (args) => ipcRenderer.invoke('bastionCloud:readRuntime', args),
  runLifecycle: (args) => ipcRenderer.invoke('bastionCloud:runLifecycle', args),
  targetEnv: (args) => ipcRenderer.invoke('bastionCloud:targetEnv', args),
  listResources: (args) => ipcRenderer.invoke('bastionCloud:listResources', args),
  captureBinding: (projectId) => ipcRenderer.invoke('bastionCloud:captureBinding', { projectId }),
  read: (projectId) => ipcRenderer.invoke('bastionCloud:read', { projectId }),
  update: (request) => ipcRenderer.invoke('bastionCloud:update', request),
  onChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('bastionCloud:changed', listener)
    return () => ipcRenderer.removeListener('bastionCloud:changed', listener)
  }
}
