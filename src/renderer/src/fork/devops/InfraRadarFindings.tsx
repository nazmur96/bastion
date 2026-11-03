import { useEffect, useState } from 'react'
import { MessageSquare, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import type { RadarFindings } from '../../../../shared/fork-devops-radar-feed'

/** What Radar itself sees wrong in the cluster, beside the map; Claude can take it from there. */
export function InfraRadarFindings({
  worktreeId,
  workspacePath,
  context
}: {
  worktreeId: string
  workspacePath: string
  context: string
}): React.JSX.Element {
  const [findings, setFindings] = useState<RadarFindings | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let current = true
    void window.api.aiVault.radarFindings(workspacePath).then((next) => {
      if (current) {
        setFindings(next)
      }
    })
    return () => {
      current = false
    }
  }, [workspacePath, round])
  const load = (): void => {
    setFindings(null)
    setRound((value) => value + 1)
  }
  return (
    <InfraCard
      id="infra-path-radar"
      className="mb-4"
      title={translate('components.devops.radarFeed.title', 'Radar findings · {{context}}', {
        context
      })}
      hint={translate(
        'components.devops.radarFeed.hint',
        'Radar’s own read-only view of what is wrong in the cluster.'
      )}
    >
      {!findings ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.radarFeed.reading', 'Asking Radar…')}
        </p>
      ) : !findings.ok ? (
        <p className="text-xs text-muted-foreground">{findings.error}</p>
      ) : (
        <pre className="scrollbar-sleek max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1.5 font-mono text-[11px]">
          {findings.text.trim() ||
            translate('components.devops.radarFeed.clean', 'Radar found nothing wrong.')}
        </pre>
      )}
      <div className="mt-2 flex gap-2">
        {findings?.ok && findings.text.trim() ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              draftForClaude(
                worktreeId,
                `Radar (${findings.tool}) reports these issues in ${context}. Explain the likely cause of each, worst first, and what to change in the repo to fix it. Read-only unless I approve a change.\n\n${findings.text.slice(0, 6000)}`
              )
            }
          >
            <MessageSquare aria-hidden />
            {translate('components.devops.radarFeed.ask', 'Diagnose with Claude')}
          </Button>
        ) : null}
        <Button type="button" size="xs" variant="ghost" onClick={load}>
          <RefreshCw aria-hidden />
          {translate('components.devops.radarFeed.refresh', 'Refresh')}
        </Button>
      </div>
    </InfraCard>
  )
}
