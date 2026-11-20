import { ipcRenderer } from 'electron'
import type { CloudTargetsApi } from '../../shared/fork-cloud/cloud-target-contract'

export const cloudTargetsApi: CloudTargetsApi = {
  delivery: {
    chain: (config) => ipcRenderer.invoke('bastionCloud:deliveryChain', config),
    promote: (request) => ipcRenderer.invoke('bastionCloud:deliveryPromote', request)
  },
  operations: {
    diagnose: (request) => ipcRenderer.invoke('bastionCloud:operationsDiagnose', request),
    verify: (request) => ipcRenderer.invoke('bastionCloud:operationsVerify', request),
    runs: (request) => ipcRenderer.invoke('bastionCloud:operationsRuns', request),
    certificates: (request) => ipcRenderer.invoke('bastionCloud:operationsCertificates', request),
    backups: (request) => ipcRenderer.invoke('bastionCloud:operationsBackups', request),
    runbooks: (request) => ipcRenderer.invoke('bastionCloud:runbookList', request),
    createRunbook: (request) => ipcRenderer.invoke('bastionCloud:runbookCreate', request)
  },
  recipes: {
    create: (args) => ipcRenderer.invoke('bastionCloud:recipeCreate', args),
    read: (args) => ipcRenderer.invoke('bastionCloud:recipeRead', args),
    validate: (args) => ipcRenderer.invoke('bastionCloud:recipeValidate', args),
    deliver: (args) => ipcRenderer.invoke('bastionCloud:recipeDeliver', args),
    realPrepare: (args) => ipcRenderer.invoke('bastionCloud:recipeRealPrepare', args),
    realDeliver: (args) => ipcRenderer.invoke('bastionCloud:recipeRealDeliver', args)
  },
  verifyRealTarget: (args) => ipcRenderer.invoke('bastionCloud:verifyRealTarget', args),
  acceptRealIdentity: (args) => ipcRenderer.invoke('bastionCloud:acceptRealIdentity', args),
  readRealTarget: (args) => ipcRenderer.invoke('bastionCloud:readRealTarget', args),
  prepareRealCost: (args) => ipcRenderer.invoke('bastionCloud:prepareRealCost', args),
  confirmRealCost: (args) => ipcRenderer.invoke('bastionCloud:confirmRealCost', args),
  readRealCost: (args) => ipcRenderer.invoke('bastionCloud:readRealCost', args),
  cachedRealCost: (args) => ipcRenderer.invoke('bastionCloud:cachedRealCost', args),
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
