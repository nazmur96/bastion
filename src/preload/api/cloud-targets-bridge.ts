import { ipcRenderer } from 'electron'
import type { CloudTargetsApi } from '../../shared/fork-cloud/cloud-target-contract'

export const cloudTargetsApi: CloudTargetsApi = {
  read: (projectId) => ipcRenderer.invoke('bastionCloud:read', { projectId }),
  update: (request) => ipcRenderer.invoke('bastionCloud:update', request),
  onChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('bastionCloud:changed', listener)
    return () => ipcRenderer.removeListener('bastionCloud:changed', listener)
  }
}
