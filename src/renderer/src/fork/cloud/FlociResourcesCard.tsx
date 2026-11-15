import { useState } from 'react'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import type { FlociView } from '../../../../shared/fork-cloud/floci-contract'
import type { FlociResources } from '../../../../shared/fork-cloud/floci-resources-contract'
import { normalizeResourceListing } from '../../../../shared/fork-cloud/cloud-resource-view'
import { CloudResourcesView } from './CloudResourcesView'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'

/** Read-only listing of the selected emulator, plus a terminal pinned to it. Nothing is created. */
export function FlociResourcesCard({
  projectId,
  target,
  runtime,
  projectLabel
}: {
  projectId: string
  /** Used only for name hints; ownership is never inferred. */
  projectLabel: string
  target: CloudTarget
  runtime: FlociView
}): React.JSX.Element {
  const ready = runtime.instance.state === 'ready'
  const scope = `${target.id}:${runtime.instance.id}:${runtime.instance.epoch}`
  const [listing, setListing] = useState<{ scope: string; resources: FlociResources } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A listing from another instance or epoch is never shown as current.
  const resources = ready && listing?.scope === scope ? listing.resources : null
  const ref = { projectId, targetId: target.id }
  const list = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.listResources?.(ref)
      if (result?.ok) {
        setListing({ scope, resources: result.resources })
      } else {
        setError(result?.message ?? 'Resources could not be listed.')
      }
    } finally {
      setBusy(false)
    }
  }
  const openTerminal = async (): Promise<void> => {
    const result = await window.api.cloudTargets?.targetEnv?.(ref)
    if (!result?.ok) {
      toast.error(result?.message ?? 'The target is not running.')
      return
    }
    // The new terminal is pinned to this instance; existing terminals keep their environment.
    runInWorkbenchTerminal(projectId, 'echo Floci target ready', result.env)
  }
  return (
    <section className="workspace-card space-y-3" data-testid="floci-target-resources">
      <h2 className="text-sm font-medium">Resources · read-only</h2>
      {!ready ? (
        <p className="text-sm text-muted-foreground">Start this target to list resources.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            title={capabilityNote('floci.resources')}
            variant="outline"
            disabled={busy}
            onClick={() => void list()}
          >
            {busy ? 'Listing…' : 'List resources'}
          </Button>
          <Button
            title={capabilityNote('floci.environment')}
            variant="outline"
            disabled={busy}
            onClick={() => void openTerminal()}
          >
            Open terminal for this target
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {resources && (
        <CloudResourcesView
          listing={normalizeResourceListing('emulated', resources, projectLabel)}
        />
      )}
      <div className="space-y-1 border-t border-border pt-3 text-xs" data-testid="floci-costs">
        <h3 className="text-sm font-medium">Costs</h3>
        <p>
          Emulated · No charges. This local emulator is not an AWS account, so there is no bill and
          no billing request.
        </p>
      </div>
    </section>
  )
}
