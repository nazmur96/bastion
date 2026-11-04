import { ArrowLeft, Command, Compass, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export type InfraHomeView = 'path' | 'tools'

/** Project path title, or Back from Tools & settings; the command deck either way. */
export function InfraHomeHeader({
  view,
  setView,
  openDeck
}: {
  view: InfraHomeView
  setView: (view: InfraHomeView) => void
  openDeck: () => void
}): React.JSX.Element {
  return (
    <header className="mb-3 flex items-center gap-2">
      {view === 'tools' ? (
        <Button type="button" variant="ghost" size="xs" onClick={() => setView('path')}>
          <ArrowLeft aria-hidden />
          {translate('components.devops.home.back', 'Project path')}
        </Button>
      ) : (
        <h1 className="flex items-center gap-2 text-sm font-semibold">
          <Compass className="size-4 text-primary" aria-hidden />
          {translate('components.devops.home.path', 'Project path')}
        </h1>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={translate('components.devops.deck.open', 'Command deck (press :)')}
          onClick={openDeck}
        >
          <Command aria-hidden />
          {translate('components.devops.deck.button', 'Commands')}
          <kbd className="text-muted-foreground">:</kbd>
        </Button>
        {view === 'path' ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            title={translate(
              'components.devops.home.toolsHint',
              'Every Infra card: deploy, harden, cloud, observe, playground'
            )}
            onClick={() => setView('tools')}
          >
            <Settings2 aria-hidden />
            {translate('components.devops.home.tools', 'Tools & settings')}
          </Button>
        ) : null}
      </div>
    </header>
  )
}
