import type {
  CloudConnectionsSnapshot,
  CloudMutation,
  CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
export type ConnectionsState = {
  scope: string
  snapshot: CloudConnectionsSnapshot | null
  pending: boolean
  error: string | null
}
export class CloudConnectionsState {
  private state: ConnectionsState = { scope: '', snapshot: null, pending: false, error: null }
  private listeners = new Set<() => void>()
  private epoch = 0
  private writing = false
  private dirty = false
  constructor(private readonly api: () => CloudTargetsApi | undefined) {}
  getSnapshot = (): ConnectionsState => this.state
  subscribe = (callback: () => void): (() => void) => {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }
  private publish(state: ConnectionsState): void {
    this.state = state
    for (const listener of this.listeners) {
      listener()
    }
  }
  clear(): void {
    this.epoch++
    this.publish({ scope: '', snapshot: null, pending: false, error: null })
  }
  changed(projectId: string, scope: string): void {
    if (this.writing) {
      this.dirty = true
      return
    }
    void this.load(projectId, scope)
  }
  async load(projectId: string, scope: string): Promise<void> {
    const epoch = ++this.epoch
    const same = this.state.scope === scope
    this.publish({ scope, snapshot: same ? this.state.snapshot : null, pending: true, error: null })
    try {
      const result = await this.api()?.read(projectId)
      if (epoch !== this.epoch) {
        return
      }
      if (!result?.ok) {
        this.publish({
          ...this.state,
          snapshot: null,
          pending: false,
          error: result?.message ?? 'Cloud targets are unavailable in this client.'
        })
        return
      }
      this.publish({ scope, snapshot: result.snapshot, pending: false, error: null })
    } catch {
      if (epoch === this.epoch) {
        this.publish({
          ...this.state,
          snapshot: null,
          pending: false,
          error: 'Cloud targets could not be loaded.'
        })
      }
    }
  }
  async update(
    command: { mutation: CloudMutation } | { selection: string | null }
  ): Promise<boolean> {
    const { snapshot, scope } = this.state
    if (!snapshot || this.state.pending) {
      return false
    }
    const epoch = ++this.epoch
    this.writing = true
    this.publish({ ...this.state, pending: true, error: null })
    try {
      const result = await this.api()?.update({
        projectId: snapshot.projectId,
        revision: snapshot.revision,
        ...command
      })
      if (epoch !== this.epoch) {
        return false
      }
      if (result?.ok) {
        this.publish({ scope, snapshot: result.snapshot, pending: false, error: null })
        return true
      }
      const error = result?.message ?? 'Cloud targets could not be updated.'
      await this.load(snapshot.projectId, scope)
      if (this.state.scope === scope) {
        this.publish({ ...this.state, error })
      }
    } catch {
      if (epoch === this.epoch) {
        this.publish({
          ...this.state,
          pending: false,
          error: 'Cloud targets could not be updated.'
        })
      }
    } finally {
      this.writing = false
      if (this.dirty && this.state.scope === scope) {
        this.dirty = false
        void this.load(snapshot.projectId, scope)
      }
    }
    return false
  }
}
export const cloudConnections = new CloudConnectionsState(() => window.api.cloudTargets)
