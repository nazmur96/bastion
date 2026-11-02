import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Radar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { InfraCard } from './InfraHomeCards'

/** B1: the live cluster view (Radar), which Claude chats here can read through its MCP server. */
export function InfraClusterCard({
  worktreeId,
  usesMise
}: {
  worktreeId: string
  usesMise: boolean
}): React.JSX.Element {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    if (path) {
      void window.api.aiVault.readDevopsRadar(path).then((result) => {
        setUrl(result.ok ? (result.url ?? null) : null)
      })
    }
  }, [path])
  const open = (): void => {
    if (!path || busy) {
      return
    }
    setBusy(true)
    const pending = toast.loading(
      translate('components.devops.radar.starting', 'Starting the cluster view (Radar)…')
    )
    void window.api.aiVault
      .runDevopsRadar({ workspacePath: path, action: 'start' })
      .then((result) => {
        if (result.ok && result.url) {
          toast.dismiss(pending)
          setUrl(result.url)
          openInWorkbenchBrowser(worktreeId, result.url, 'Radar')
        } else {
          setMissing(!result.ok && /mise use|Install Radar/.test(result.error))
          toast.error(result.ok ? 'Radar did not report its address.' : result.error, {
            id: pending,
            duration: 12_000
          })
        }
      })
      .finally(() => setBusy(false))
  }
  const stop = (): void => {
    if (path) {
      void window.api.aiVault
        .runDevopsRadar({ workspacePath: path, action: 'stop' })
        .then(() => setUrl(null))
    }
  }
  return (
    <InfraCard
      title={translate('components.devops.radar.title', 'Cluster')}
      hint={translate(
        'components.devops.radar.hint',
        'Live topology, health, events and Helm history from Radar. New Claude chats here can read it too (read-only).'
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {url ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => openInWorkbenchBrowser(worktreeId, url, 'Radar')}
            >
              <Radar aria-hidden />
              {translate('components.devops.radar.show', 'Show cluster view')}
            </Button>
            <Button type="button" variant="outline" size="xs" onClick={stop}>
              {translate('components.devops.radar.stop', 'Stop')}
            </Button>
            <span className="text-xs text-status-success">
              {translate('components.devops.radar.claude', 'Claude can see this cluster')}
            </span>
          </>
        ) : (
          <Button type="button" variant="outline" size="xs" disabled={busy} onClick={open}>
            <Radar aria-hidden />
            {translate('components.devops.radar.open', 'Open cluster view')}
          </Button>
        )}
        {missing && usesMise ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => runInWorkbenchTerminal(worktreeId, 'mise use github:skyhook-io/radar')}
          >
            {translate('components.devops.home.pin', 'Add to mise.toml')}
          </Button>
        ) : null}
      </div>
    </InfraCard>
  )
}
