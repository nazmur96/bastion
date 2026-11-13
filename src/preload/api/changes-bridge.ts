import { ipcRenderer } from 'electron'
import type { ChangesApi } from '../../shared/fork-changes/change-contract'

export const changesApi: ChangesApi = {
  ensure: (args) => ipcRenderer.invoke('bastionChanges:ensure', args),
  command: (args) => ipcRenderer.invoke('bastionChanges:command', args)
}
