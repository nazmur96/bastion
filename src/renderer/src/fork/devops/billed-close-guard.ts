import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { activeCostMeters } from './cost-meter-store'

let warnedAt = 0
const SECOND_CLOSE_MS = 60_000

/**
 * Closing the app while applied cloud infrastructure still bills: say so once, with the
 * running cost, and let the person quit anyway or keep it open to tear it down. A second
 * close within a minute goes through, so the app can never be held hostage.
 */
export function interceptCloseForBilledInfra(proceed: () => void): boolean {
  const running = activeCostMeters()
  if (running.length === 0 || Date.now() - warnedAt < SECOND_CLOSE_MS) {
    return false
  }
  warnedAt = Date.now()
  const repos = running.map(([repo]) => repo.split(/[\\/]/).findLast(Boolean) ?? repo).join(', ')
  const hourly = running.reduce((sum, [, meter]) => sum + (meter.monthly ?? 0) / 730, 0)
  toast.warning(
    translate('components.devops.closeGuard.title', 'Cloud infrastructure is still running'),
    {
      description: translate(
        'components.devops.closeGuard.body',
        '{{repos}} applied and not destroyed{{cost}}. It keeps billing after Orca closes.',
        { repos, cost: hourly > 0 ? ` (≈ $${hourly.toFixed(2)}/hour)` : '' }
      ),
      duration: SECOND_CLOSE_MS,
      action: {
        label: translate('components.devops.closeGuard.quit', 'Quit anyway'),
        onClick: proceed
      },
      cancel: {
        label: translate('components.devops.closeGuard.keep', 'Keep it open'),
        onClick: () => {}
      }
    }
  )
  return true
}
