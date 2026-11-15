import { flociProduct } from '../../../../shared/fork-cloud/floci-products'
import { useState } from 'react'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import { flociMessages, type FlociView } from '../../../../shared/fork-cloud/floci-contract'
import { cloudConnections } from './cloud-connections-state'
import { openCloudSourceChecks } from '../changes/change-navigation'

export function FlociRuntimeCard({
  target,
  runtime,
  pending
}: {
  target: CloudTarget
  runtime: FlociView
  pending: boolean
}): React.JSX.Element {
  const [confirmation, setConfirmation] = useState<FlociView['instance'] | null>(null)
  const product = flociProduct(
    target.configuration.kind === 'emulated' ? target.configuration.provider : 'aws'
  )
  const instance = runtime.instance
  const busy = pending || Boolean(instance.operationId)
  return (
    <section className="workspace-card space-y-3" data-testid="floci-target-runtime">
      <h2 className="text-sm font-medium">
        {target.label} · {product.label}
      </h2>
      <p className="text-sm">{instance.state === 'not-started' ? 'Not started' : instance.state}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">
        127.0.0.1:{instance.port} · {instance.engine}
      </p>
      <p className="break-all font-mono text-xs text-muted-foreground">{runtime.imageDigest}</p>
      <p className="text-xs text-muted-foreground">
        Private persistent data. Stop preserves it; Reset deletes this target’s data.
      </p>
      {target.configuration.provider !== 'aws' && (
        <p className="text-xs text-muted-foreground">
          Restricted boot proven on Linux amd64 only. Other platforms are unavailable.
        </p>
      )}
      {instance.code !== 'complete' && (
        <p role="status" className="text-sm">
          {flociMessages[instance.code]}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          title={capabilityNote('floci.start')}
          disabled={busy || instance.state === 'ready'}
          onClick={() => {
            void cloudConnections.lifecycle('start')
          }}
        >
          Start
        </Button>
        <Button
          title={capabilityNote('floci.stop')}
          variant="outline"
          disabled={busy}
          onClick={() => {
            void cloudConnections.lifecycle('stop')
          }}
        >
          Stop
        </Button>
        <Button
          title={capabilityNote('floci.reset')}
          variant="outline"
          disabled={busy}
          onClick={() => setConfirmation(instance)}
        >
          Reset data
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => {
            void cloudConnections.refreshRuntime()
          }}
        >
          Refresh instance
        </Button>
        <Button
          variant="ghost"
          disabled={busy || target.configuration.provider !== 'aws'}
          onClick={openCloudSourceChecks}
        >
          Targeted source checks
        </Button>
      </div>
      {runtime.receipts.length > 0 && (
        <ul className="space-y-1 text-xs" aria-label="Lifecycle receipts">
          {runtime.receipts.map((receipt) => (
            <li key={receipt.id}>
              {receipt.operation} · {receipt.status} · {flociMessages[receipt.code]}
            </li>
          ))}
        </ul>
      )}
      {confirmation && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              setConfirmation(null)
            }
          }}
        >
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Reset {target.label}?</DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              This will stop the instance and delete only this target’s private data before starting
              it again.
            </p>
            <p className="break-all font-mono text-xs">
              Instance {confirmation.id} · epoch {confirmation.epoch}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmation(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  void cloudConnections.lifecycle('reset', {
                    targetId: confirmation.targetId,
                    instanceId: confirmation.id,
                    epoch: confirmation.epoch
                  })
                  setConfirmation(null)
                }}
              >
                Confirm reset
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
