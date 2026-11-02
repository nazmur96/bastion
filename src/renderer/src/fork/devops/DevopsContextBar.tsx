import { Cloud, Layers, Ship } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { DevopsContextTone } from '../../../../shared/fork-devops-context'
import { useDevopsContext } from './use-devops-context'

export const TONE_CLASS: Record<DevopsContextTone, string> = {
  local: 'text-status-success',
  prod: 'font-medium text-destructive',
  normal: 'text-muted-foreground'
}

export function toneTitle(tone: DevopsContextTone): string {
  return tone === 'local'
    ? translate('components.devops.context.local', 'Local sandbox: free, nothing real is touched')
    : tone === 'prod'
      ? translate('components.devops.context.prod', 'Looks like production: be careful')
      : translate('components.devops.context.normal', 'Real infrastructure')
}

function Chip({
  icon: Icon,
  label,
  tone,
  kind
}: {
  icon: typeof Cloud
  label: string
  tone: DevopsContextTone
  kind: string
}): React.JSX.Element {
  return (
    <span
      className={cn('flex max-w-48 items-center gap-1 truncate px-1 text-xs', TONE_CLASS[tone])}
      title={`${kind}: ${label}\n${toneTitle(tone)}`}
      data-devops-context={kind}
      data-tone={tone}
    >
      <Icon className="size-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  )
}

/** A1: where this workspace's kubectl, aws and terraform commands would land, always in view. */
export function DevopsContextBar({
  worktreeId,
  show,
  terraformDir,
  refreshKey
}: {
  worktreeId: string
  show: { kube: boolean; aws: boolean; terraform: boolean }
  terraformDir: string | null
  refreshKey: string
}): React.JSX.Element | null {
  const context = useDevopsContext(worktreeId, terraformDir, refreshKey)
  const { kube, aws, terraform } = context
  const chips = [
    show.kube && kube ? (
      <Chip
        key="kube"
        kind="Kubernetes"
        icon={Ship}
        tone={kube.tone}
        label={kube.namespace ? `${kube.context} / ${kube.namespace}` : kube.context}
      />
    ) : null,
    show.aws && aws ? (
      <Chip
        key="aws"
        kind="AWS"
        icon={Cloud}
        tone={aws.tone}
        label={
          aws.tone === 'local'
            ? `floci (local)${aws.region ? ` · ${aws.region}` : ''}`
            : `${aws.profile}${aws.region ? ` · ${aws.region}` : ''}`
        }
      />
    ) : null,
    show.terraform && terraform ? (
      <Chip
        key="tf"
        kind="Terraform"
        icon={Layers}
        tone={terraform.tone}
        label={terraform.workspace}
      />
    ) : null
  ].filter(Boolean)
  return chips.length > 0 ? (
    <div className="flex min-w-0 items-center" data-devops-context-bar="">
      {chips}
    </div>
  ) : null
}
