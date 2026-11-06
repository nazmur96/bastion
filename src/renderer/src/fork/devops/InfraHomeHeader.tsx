import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { InfraView } from './infra-home-store'

/** Title of the view the Project path opened in the middle, with its close button. */
export function InfraViewHeader({
  view,
  onClose
}: {
  view: InfraView
  onClose: () => void
}): React.JSX.Element {
  return (
    <header className="mb-3 flex items-center gap-2">
      <h1 className="text-sm font-semibold">
        {view === 'map'
          ? translate('components.devops.home.fullMap', 'System map')
          : translate('components.devops.home.tools', 'Tools & settings')}
      </h1>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="ml-auto"
        aria-label={translate('components.devops.home.closeView', 'Close')}
        onClick={onClose}
      >
        <X aria-hidden />
      </Button>
    </header>
  )
}
