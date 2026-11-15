import { RealAwsCard } from './RealAwsCard'
import { FlociRuntimeCard } from './FlociRuntimeCard'
import { FlociResourcesCard } from './FlociResourcesCard'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { cloudConnections } from './cloud-connections-state'
import { CloudTargetForm } from './CloudTargetForm'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'

export function WorkspaceCloudPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const ownerStamp = useAppStore((s) =>
    JSON.stringify([
      s.repos,
      s.folderWorkspaces,
      s.projectGroups,
      selectKnownWorktreeById(s, worktreeId)?.hostId
    ])
  )
  const scope = `${worktreeId}:${ownerStamp}`
  // Only for "name matches this project" hints in resource lists.
  const projectLabel = useAppStore(
    (s) => selectKnownWorktreeById(s, worktreeId)?.path.split(/[\\/]/).findLast(Boolean) ?? ''
  )
  const state = useSyncExternalStore(cloudConnections.subscribe, cloudConnections.getSnapshot)
  const [editing, setEditing] = useState<CloudTarget | 'new' | null>(null)
  const [removing, setRemoving] = useState<CloudTarget | null>(null)
  useEffect(() => {
    const refresh = () => {
      void cloudConnections.load(worktreeId, scope)
    }
    const unsubscribe = window.api.cloudTargets?.onChanged(() =>
      cloudConnections.changed(worktreeId, scope)
    )
    const leave = () => cloudConnections.clear()
    window.addEventListener('bastion:workspace-transition', leave)
    refresh()
    return () => {
      unsubscribe?.()
      window.removeEventListener('bastion:workspace-transition', leave)
      cloudConnections.clear()
    }
  }, [worktreeId, scope])
  const snapshot = state.scope === scope ? state.snapshot : null
  const local = startWorkspaceHost(worktreeId) === 'local' && snapshot?.owner === 'local'
  const pending = state.pending || !snapshot
  const selected = snapshot?.targets.find((target) => target.id === snapshot.selection?.targetId)
  const runtime = state.scope === scope ? state.runtime : null
  return (
    <div className="workspace-page scrollbar-sleek" data-testid="cloud-target-connections">
      <header className="workspace-page-heading">
        <div>
          <div className="workspace-eyebrow">Cloud</div>
          <h1>Connections</h1>
          <p>
            Keep cloud targets inside this workspace. Start a private local Floci emulator, or
            verify a real AWS profile for fixed read-only checks.
          </p>
        </div>
        <Button onClick={() => setEditing('new')} disabled={pending}>
          Add target
        </Button>
      </header>
      {runtime && local && selected && (
        <FlociRuntimeCard key={selected.id} target={selected} runtime={runtime} pending={pending} />
      )}
      {runtime && local && selected && (
        <FlociResourcesCard
          key={`resources-${selected.id}`}
          projectId={worktreeId}
          target={selected}
          runtime={runtime}
          projectLabel={projectLabel}
        />
      )}
      {local && selected?.configuration.kind === 'real' && (
        <RealAwsCard
          key={selected.id}
          target={selected}
          state={state.scope === scope ? state.real : null}
          pending={pending}
          projectLabel={projectLabel}
        />
      )}
      <section className="workspace-card space-y-4">
        <p data-testid="cloud-target-owner-status" className="text-sm">
          {snapshot
            ? local
              ? 'Local runtime · cloud targets'
              : 'Cloud targets run on this computer only for now. Remote (SSH) projects are planned; nothing runs here with this computer’s credentials or engine.'
            : state.pending
              ? 'Loading target metadata…'
              : 'Cloud target metadata is unavailable.'}
        </p>
        <p className="text-xs text-muted-foreground">
          Selections apply to this project. Running work stays pinned; targeted source checks need a
          fresh review after selection changes.
        </p>
        {state.error && (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>{state.error}</p>
            <Button
              variant="outline"
              onClick={() => {
                void cloudConnections.load(worktreeId, scope)
              }}
              disabled={state.pending}
            >
              Refresh targets
            </Button>
          </div>
        )}
        {snapshot?.targets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No cloud targets in this workspace. Add a profile reference or an emulated target.
          </p>
        )}
        {snapshot?.targets.map((target) => (
          <div
            key={target.id}
            data-testid="cloud-target-row"
            data-current={snapshot.selection?.targetId === target.id && local}
            className="flex flex-wrap items-center gap-3 rounded-md border p-3 data-[current=true]:bg-accent"
          >
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-sm font-medium">{target.label}</h2>
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant="outline">
                  {target.configuration.kind === 'real'
                    ? 'Real AWS'
                    : `Emulated ${target.configuration.provider.toUpperCase()} · Floci`}
                </Badge>
                <Badge variant="secondary">Not verified</Badge>
              </div>
              <p className="mt-2 break-all text-xs text-muted-foreground">
                {target.configuration.kind === 'real'
                  ? `${target.configuration.profileName} · ${target.configuration.region}`
                  : `${target.configuration.engine ?? 'docker'} · local runtime${target.configuration.requestedPort ? ` · requested port ${target.configuration.requestedPort}` : ''}`}
              </p>
            </div>
            <Button
              variant="outline"
              disabled={pending || !local}
              onClick={() => {
                void cloudConnections.update({ selection: target.id })
              }}
            >
              {snapshot.selection?.targetId === target.id && local ? 'Selected' : 'Select target'}
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setEditing(target)}>
              Rename
            </Button>
            <Button variant="ghost" disabled={pending} onClick={() => setRemoving(target)}>
              Remove target
            </Button>
          </div>
        ))}
        {local && snapshot?.selection?.targetId && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() => {
              void cloudConnections.update({ selection: null })
            }}
          >
            Clear selection
          </Button>
        )}
      </section>
      {editing && (
        <CloudTargetForm
          target={editing === 'new' ? null : editing}
          pending={state.pending}
          onClose={() => setEditing(null)}
          onSave={(mutation) => cloudConnections.update({ mutation })}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !state.pending) {
              setRemoving(null)
            }
          }}
        >
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Remove target?</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              Remove {removing.label} from available targets and clear its selections. No cloud
              resource is changed.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" disabled={state.pending} onClick={() => setRemoving(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={state.pending}
                onClick={() => {
                  void cloudConnections
                    .update({ mutation: { kind: 'remove', id: removing.id } })
                    .then((ok) => {
                      if (ok) {
                        setRemoving(null)
                      }
                    })
                }}
              >
                Confirm removal
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
