import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useProjectWorkspaces } from './use-project-workspaces'
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

export function IncognitoTaskBar(): React.JSX.Element | null {
  const { snapshot } = useProjectWorkspaces()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!snapshot?.activeTask) {
    return null
  }
  return (
    <div
      className="flex h-10 shrink-0 items-center gap-3 border-b px-3"
      style={{ ...NO_DRAG, paddingRight: 'calc(8px + var(--window-controls-width, 0px))' }}
    >
      <span className="text-xs text-muted-foreground">
        {translate('components.incognito.open', 'Incognito')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void window.api.projectWorkspaces
            ?.switch({ fromId: snapshot.activeId, toId: 'home' })
            .catch((cause: unknown) => {
              setBusy(false)
              setError(String(cause))
            })
        }}
      >
        {translate('components.incognito.close', 'Archive and leave')}
      </Button>
      {error && (
        <span role="alert" className="truncate text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
