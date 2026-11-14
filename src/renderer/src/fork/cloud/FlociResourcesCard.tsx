import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getIntlLocale } from '@/i18n/i18n'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import type { FlociView } from '../../../../shared/fork-cloud/floci-contract'
import {
  FLOCI_RESOURCE_LABELS,
  FLOCI_SERVICE_STATUS_MESSAGES,
  type FlociResources
} from '../../../../shared/fork-cloud/floci-resources-contract'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'

/** Read-only listing of the selected emulator, plus a terminal pinned to it. Nothing is created. */
export function FlociResourcesCard({
  projectId,
  target,
  runtime
}: {
  projectId: string
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
          <Button variant="outline" disabled={busy} onClick={() => void list()}>
            {busy ? 'Listing…' : 'List resources'}
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void openTerminal()}>
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
        <ul className="space-y-2 text-sm" aria-label="Listed resources">
          {resources.results.map((result) => (
            <li key={result.service}>
              <div className="font-medium">{FLOCI_RESOURCE_LABELS[result.service]}</div>
              {result.status !== 'ok' && (
                <p className="text-xs text-muted-foreground">
                  {FLOCI_SERVICE_STATUS_MESSAGES[result.status]}
                </p>
              )}
              {result.status === 'ok' && result.items.length === 0 ? (
                <p className="text-xs text-muted-foreground">None listed.</p>
              ) : (
                <ul className="font-mono text-xs break-all">
                  {result.items.map((item) => (
                    <li key={item.arn ?? item.name}>{item.name}</li>
                  ))}
                </ul>
              )}
              {result.truncated && (
                <p className="text-xs text-muted-foreground">
                  More may exist beyond the listing limits.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {resources && (
        <p className="text-xs text-muted-foreground">
          Listed {new Date(resources.at).toLocaleTimeString(getIntlLocale())} from the local
          emulator. Ownership is not inferred.
        </p>
      )}
    </section>
  )
}
