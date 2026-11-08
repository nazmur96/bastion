import { createElement } from 'react'
import type { LucideProps } from 'lucide-react'
// Fork: app settings use Bastion's mark; cloud account naming stays Orca.
import logo from '../../../../../resources/icon-source/bastion.svg'
import { cn } from '@/lib/utils'

export function OrcaLogoSettingsIcon({ className }: LucideProps): React.JSX.Element {
  return createElement('img', {
    src: logo,
    alt: '',
    'aria-hidden': true,
    className: cn('object-contain', className)
  })
}
