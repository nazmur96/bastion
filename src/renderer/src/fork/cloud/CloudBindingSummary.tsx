import type { CloudBinding } from '../../../../shared/fork-cloud/cloud-binding'
export function CloudBindingSummary({
  binding
}: {
  binding: CloudBinding | undefined
}): React.JSX.Element | null {
  if (binding?.kind !== 'emulated-aws') {
    return null
  }
  return (
    <div
      className="space-y-1 border-t border-border py-2 text-xs"
      aria-label="Reviewed cloud target"
    >
      <p className="break-all">
        Floci AWS target {binding.targetId} · selection {binding.selectionGeneration}
      </p>
      <p className="break-all font-mono">
        127.0.0.1:{binding.instance.port} · instance {binding.instance.id} · epoch{' '}
        {binding.instance.epoch}
      </p>
      <p className="break-all font-mono text-muted-foreground">{binding.instance.imageDigest}</p>
      <p>
        Source checks only. This records the target context and makes no cloud request. Changing
        selection or restarting the instance requires another review.
      </p>
    </div>
  )
}
