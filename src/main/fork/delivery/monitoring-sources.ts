import { MONITORING_CONFIG_PATH } from '../../../shared/fork-delivery/monitoring-contract'
import { readOwnerSource } from '../changes/owner-source-files'
import type { DeliveryDeps } from './delivery-chain'
import type { MonitoringDeps } from './monitoring-evidence'
import { fetchMonitoring } from './monitoring-transport'

/** Real monitoring sources for one project: its committed config, its kubectl, the owner's env. */
export function monitoringSources(root: string, kubectl: DeliveryDeps['kubectl']): MonitoringDeps {
  return {
    kubectl,
    http: fetchMonitoring,
    env: process.env,
    readConfig: async () => {
      try {
        return await readOwnerSource(root, MONITORING_CONFIG_PATH)
      } catch (error) {
        // No file: nothing attached. Any other read failure is reported as invalid.
        return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? null : ''
      }
    }
  }
}
