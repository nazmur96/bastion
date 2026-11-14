import {
  performRealCloudAction,
  sameRealSelection,
  type RealCloudState,
  type RealCloudAction
} from './real-cloud-actions'
import { createBrowserUuid } from '@/lib/browser-uuid'
import type { FlociView, FlociAction } from '../../../../shared/fork-cloud/floci-contract'
import type {
  CloudConnectionsSnapshot,
  CloudMutation,
  CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
export type ConnectionsState = {
  scope: string
  snapshot: CloudConnectionsSnapshot | null
  pending: boolean
  runtime?: FlociView | null
  real?: RealCloudState | null
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
  async load(projectId: string, scope: string, refresh = false): Promise<void> {
    const epoch = ++this.epoch
    const previous = this.state
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
      const selected = result.snapshot.targets.find(
        (target) => target.id === result.snapshot.selection?.targetId
      )
      const runtime =
        result.snapshot.owner === 'local' &&
        selected?.configuration.kind === 'emulated' &&
        selected.configuration.provider === 'aws'
          ? await this.api()?.readRuntime?.({ projectId, targetId: selected.id, refresh })
          : undefined
      if (epoch !== this.epoch) {
        return
      }
      this.publish({
        scope,
        snapshot: result.snapshot,
        runtime: runtime?.ok ? runtime.runtime : null,
        real: same && sameRealSelection(previous.snapshot, result.snapshot) ? previous.real : null,
        pending: false,
        error: runtime && !runtime.ok ? runtime.message : null
      })
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
  async refreshRuntime(): Promise<void> {
    const { snapshot, scope } = this.state
    if (snapshot) {
      await this.load(snapshot.projectId, scope, true)
    }
  }
  async lifecycle(
    operation: FlociAction['operation'],
    confirmation?: FlociAction['confirmation']
  ): Promise<void> {
    const { snapshot, scope, runtime } = this.state
    if (!snapshot || !runtime || this.state.pending) {
      return
    }
    this.writing = true
    const epoch = ++this.epoch
    this.publish({ ...this.state, pending: true, error: null })
    try {
      const result = await this.api()?.runLifecycle?.({
        projectId: snapshot.projectId,
        targetId: runtime.instance.targetId,
        requestId: createBrowserUuid(),
        operation,
        ...(confirmation ? { confirmation } : {})
      })
      if (epoch !== this.epoch) {
        return
      }
      this.publish({
        ...this.state,
        pending: false,
        runtime: result?.ok ? result.runtime : runtime,
        error: result && !result.ok ? result.message : null
      })
    } catch {
      if (epoch === this.epoch) {
        this.publish({
          ...this.state,
          pending: false,
          error: 'Lifecycle request could not be confirmed. Refresh this instance before retrying.'
        })
      }
    } finally {
      this.writing = false
      if (this.dirty && this.state.scope === scope) {
        this.dirty = false
        void this.load(snapshot.projectId, scope)
      }
    }
  }
  async realAction(operation: RealCloudAction): Promise<void> {
    const { snapshot, scope, real } = this.state,
      api = this.api()
    if (!snapshot || !api || this.state.pending) {
      return
    }
    const epoch = ++this.epoch
    this.writing = true
    this.dirty = false
    this.publish({ ...this.state, pending: true })
    try {
      const result = await performRealCloudAction(api, snapshot, real, operation)
      if (epoch !== this.epoch) {
        return
      }
      this.publish({ ...this.state, snapshot: result.snapshot, real: result.real, pending: false })
    } catch {
      if (epoch === this.epoch) {
        this.publish({
          ...this.state,
          pending: false,
          real: { identity: null, error: 'Real AWS context could not be confirmed. Verify again.' }
        })
      }
    } finally {
      this.writing = false
      if (this.dirty && this.state.scope === scope) {
        this.dirty = false
        void this.load(snapshot.projectId, scope)
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
        this.dirty = false
        await this.load(snapshot.projectId, scope)
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
