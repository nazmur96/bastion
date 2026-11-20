import { useLayoutEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import type { WorkloadDiagnosis } from '../../../../shared/fork-delivery/operations-contract'
import { diagnosisAgentDraft } from '../../../../shared/fork-delivery/diagnosis-agent-draft'
import { AssistanceDraftDialog } from '../editor-context/AssistanceDraftDialog'
import { showWorkspaceEditor } from '../workspace-desktop/WorkspaceQuickActions'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { ownerOperation } from './operations-owner-client'

const short = (value: string | null) =>
  value ? (value.startsWith('sha256:') ? `${value.slice(0, 19)}…` : value.slice(0, 12)) : 'unknown'

/** Fork: Step 12 read-only workload diagnosis for the Delivery page's application. */
export function DeliveryDiagnosisSection({
  config,
  hostId,
  diagnosis,
  onDiagnosis
}: {
  config: DeliveryConfig | null
  hostId: ExecutionHostId
  diagnosis: WorkloadDiagnosis | null
  onDiagnosis: (diagnosis: WorkloadDiagnosis | null) => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useLayoutEffect(() => () => pending.current?.abort(), [])
  const isCurrent = (): boolean =>
    !!config &&
    useAppStore.getState().activeWorktreeId === config.projectId &&
    startWorkspaceHost(config.projectId) === hostId
  const diagnose = async (logs: boolean): Promise<void> => {
    if (!config) {
      return
    }
    pending.current?.abort()
    const read = new AbortController()
    pending.current = read
    setDraftOpen(false)
    onDiagnosis(null)
    setBusy(true)
    setError(null)
    try {
      const request = { ...config, logs }
      const result = await ownerOperation(
        config.projectId,
        logs ? 'operations.logs' : 'operations.diagnose',
        request,
        async () => window.api.cloudTargets?.operations?.diagnose(request)
      )
      if (read.signal.aborted || !isCurrent()) {
        return
      }
      if (result?.ok) {
        onDiagnosis(result.diagnosis)
      } else {
        setError(result?.message ?? 'Diagnosis is unavailable in this client.')
      }
    } finally {
      if (!read.signal.aborted) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-diagnosis">
      <div>
        <h2 className="text-sm font-medium">Diagnose the workload</h2>
        <p className="text-xs text-muted-foreground">
          Rollout, container state, warning events and, only if you ask, the current and previous
          log tail (last 100 lines, secrets masked). Read-only.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !config}
          title={capabilityNote('operations.diagnose')}
          onClick={() => void diagnose(false)}
        >
          {busy ? 'Reading…' : 'Diagnose'}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !config}
          title={capabilityNote('operations.logs')}
          onClick={() => void diagnose(true)}
        >
          Diagnose with logs
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {diagnosis && (
        <div className="space-y-3 text-sm" data-testid="diagnosis-result">
          <Button variant="outline" size="sm" onClick={() => setDraftOpen(true)}>
            {translate('deliveryDiagnosis.askAgent', 'Ask an agent…')}
          </Button>
          <p className="text-xs text-muted-foreground">
            Namespace {diagnosis.namespace ?? 'unknown'} · read{' '}
            {new Date(diagnosis.readAt).toLocaleTimeString(getIntlLocale())}
          </p>
          {diagnosis.unknown.length > 0 && (
            <ul className="text-xs" data-testid="diagnosis-unknown">
              {diagnosis.unknown.map((item) => (
                <li key={item}>Unknown · {item}</li>
              ))}
            </ul>
          )}
          {diagnosis.rollouts.map((rollout) => (
            <p key={rollout.name}>
              <Badge variant={rollout.status === 'complete' ? 'secondary' : 'outline'}>
                {rollout.status}
              </Badge>{' '}
              Rollout {rollout.name}: {rollout.updated}/{rollout.desired} updated,{' '}
              {rollout.available} available, {rollout.total} {rollout.total === 1 ? 'pod' : 'pods'}
              {rollout.total > rollout.desired ? ' (old pods still serving)' : ''}
            </p>
          ))}
          <ul className="space-y-1" aria-label="Containers">
            {diagnosis.containers.map((item) => (
              <li key={`${item.pod}/${item.container}`} className="font-mono text-xs break-all">
                {item.ready ? 'ready' : 'not ready'} · {item.pod}/{item.container} · {item.state} ·{' '}
                {item.restarts} restarts
                {item.lastExit
                  ? ` · last exit ${item.lastExit.code} ${item.lastExit.reason}`
                  : ''}{' '}
                · {short(item.digest)} → revision {short(item.revision)} ({item.revisionSource})
              </li>
            ))}
          </ul>
          {diagnosis.events.length > 0 && (
            <ul className="space-y-1 text-xs" aria-label="Warning events">
              {diagnosis.events.map((event) => (
                <li key={`${event.object}:${event.reason}:${event.last}`}>
                  {event.reason} ×{event.count} · {event.object} · {event.message}
                </li>
              ))}
            </ul>
          )}
          {diagnosis.logs.map((log) => (
            <div key={`${log.pod}/${log.container}:${log.previous}`}>
              <p className="text-xs font-medium">
                {log.previous ? 'Previous' : 'Current'} log · {log.pod}/{log.container}
                {log.truncated ? ' · last lines only' : ''}
                {log.redactions ? ` · ${log.redactions} value(s) masked` : ''}
              </p>
              <pre className="scrollbar-sleek max-h-48 overflow-auto rounded-md bg-muted p-2 text-xs whitespace-pre-wrap">
                {log.text || '(empty)'}
              </pre>
            </div>
          ))}
        </div>
      )}
      {draftOpen && config && diagnosis && (
        <AssistanceDraftDialog
          worktreeId={config.projectId}
          hostId={hostId}
          draft={diagnosisAgentDraft(diagnosis)}
          title={translate('deliveryDiagnosis.draftTitle', 'Ask an agent about this diagnosis')}
          note={translate(
            'deliveryDiagnosis.draftNote',
            'Review the redacted evidence before sharing. Adding the draft leaves it unsent.'
          )}
          isCurrent={isCurrent}
          onClose={() => setDraftOpen(false)}
          onDraftAdded={showWorkspaceEditor}
        />
      )}
    </section>
  )
}
