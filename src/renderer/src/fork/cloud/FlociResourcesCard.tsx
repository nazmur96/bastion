import { flociProduct } from '../../../../shared/fork-cloud/floci-products'
import { useEffect, useRef, useState } from 'react'
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
export function FlociResourcesCard(
  props: React.ComponentProps<typeof FlociResourcesBody>
): React.JSX.Element {
  const { projectId, target, runtime } = props
  const scope = JSON.stringify([projectId, target.id, target.configRevision, runtime.instance])
  return <FlociResourcesBody key={scope} {...props} />
}
function FlociResourcesBody({
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
  const product = flociProduct(
    target.configuration.kind === 'emulated' ? target.configuration.provider : 'aws'
  )
  const ready = runtime.instance.state === 'ready'
  const [listing, setListing] = useState<FlociResources | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const resources = ready ? listing : null
  const generation = useRef({ value: 0 })
  useEffect(() => {
    const current = generation.current
    return () => {
      current.value++
    }
  }, [])
  const ref = { projectId, targetId: target.id }
  const list = async (): Promise<void> => {
    const request = generation.current.value
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.listResources?.(ref)
      if (request !== generation.current.value) {
        return
      }
      if (result?.ok) {
        setListing(result.resources)
      } else {
        setError(result?.message ?? 'Resources could not be listed.')
      }
    } catch {
      if (request === generation.current.value) {
        setError('Resources could not be listed.')
      }
    } finally {
      if (request === generation.current.value) {
        setBusy(false)
      }
    }
  }
  const openTerminal = async (): Promise<void> => {
    const request = generation.current.value
    try {
      const result = await window.api.cloudTargets?.targetEnv?.(ref)
      if (request !== generation.current.value) {
        return
      }
      if (!result?.ok) {
        toast.error(result?.message ?? 'The target is not running.')
        return
      }
      runInWorkbenchTerminal(projectId, 'echo Floci target ready', result.env)
    } catch {
      if (request === generation.current.value) {
        toast.error('The target environment could not be opened.')
      }
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="floci-target-resources">
      <h2 className="text-sm font-medium">Resources · read-only</h2>
      {product.resourcesUnavailableReason ? (
        <p className="text-sm text-muted-foreground">{product.resourcesUnavailableReason}</p>
      ) : !ready ? (
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
            title={product.terminalUnavailableReason ?? capabilityNote('floci.environment')}
            variant="outline"
            disabled={busy || Boolean(product.terminalUnavailableReason)}
            onClick={() => void openTerminal()}
          >
            Open terminal for this target
          </Button>
        </div>
      )}
      {product.terminalUnavailableReason && (
        <div className="space-y-1 text-sm text-muted-foreground">
          {!ready && (
            <Button variant="outline" disabled title={product.terminalUnavailableReason}>
              Open terminal for this target
            </Button>
          )}
          <p>{product.terminalUnavailableReason}</p>
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
          Emulated · No charges. This local emulator is not a real cloud account, so there is no
          bill and no billing request.
        </p>
      </div>
    </section>
  )
}
