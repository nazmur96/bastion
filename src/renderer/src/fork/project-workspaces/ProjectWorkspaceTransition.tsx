import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LoaderCircle } from 'lucide-react'
import { translate } from '@/i18n/i18n'

const NO_DRAG: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

export function ProjectWorkspaceLoading({ home = false }: { home?: boolean }): React.JSX.Element {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-3 bg-background text-foreground"
      role="status"
      aria-live="polite"
      style={NO_DRAG}
    >
      <LoaderCircle
        className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
        aria-hidden
      />
      <p className="text-sm font-medium">
        {home
          ? translate('components.projectWorkspaces.returningHome', 'Returning to your workspaces…')
          : translate('components.projectWorkspaces.opening', 'Opening your workspace…')}
      </p>
      <p className="text-xs text-muted-foreground">
        {translate('components.projectWorkspaces.preparing', 'Preparing your saved environment')}
      </p>
    </div>
  )
}

export function ProjectWorkspaceTransition(): React.JSX.Element | null {
  const [target, setTarget] = useState<string | null>(null)
  useEffect(() => {
    const begin = (event: Event): void => {
      setTarget(
        event instanceof CustomEvent && typeof event.detail === 'string' ? event.detail : ''
      )
    }
    const abort = (): void => setTarget(null)
    window.addEventListener('bastion:workspace-transition', begin)
    window.addEventListener('bastion:workspace-transition-aborted', abort)
    return () => {
      window.removeEventListener('bastion:workspace-transition', begin)
      window.removeEventListener('bastion:workspace-transition-aborted', abort)
    }
  }, [])
  return target === null
    ? null
    : createPortal(
        <div className="fixed inset-0 z-50" style={NO_DRAG} data-workspace-transition="">
          <style>{'[data-retained-group]{visibility:hidden}'}</style>
          <ProjectWorkspaceLoading home={target === 'home'} />
        </div>,
        document.body
      )
}
