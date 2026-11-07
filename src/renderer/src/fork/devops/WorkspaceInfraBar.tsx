import { PanelLeft, PanelRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isSidePanelCollapsed, toggleSidePanel } from '../workbench/terminal-dock'
import { togglePathColumn, usePathColumnCollapsed } from './path-column-store'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { OPEN_DECK_EVENT } from './InfraCommandDeck'
import { useProjectCostMeter } from './cost-meter-store'
import { useDevopsProject } from './use-devops-project'
import { useDevopsContext } from './use-devops-context'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import type { DevopsContextTone } from '../../../../shared/fork-devops-context'

type AppRegion = React.CSSProperties & { WebkitAppRegion: 'drag' | 'no-drag' }
/** Part of the bar is window chrome: its empty stretch drags the window, its buttons do not. */
const DRAG: AppRegion = { WebkitAppRegion: 'drag' }
const NO_DRAG: AppRegion = { WebkitAppRegion: 'no-drag' }

function elapsed(hours: number): string {
  const minutes = Math.floor(hours * 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function toneClass(tone: DevopsContextTone): string {
  return tone === 'local' ? 'local' : tone === 'prod' ? 'prod' : 'real'
}

/** The prototype's top bar: project, where kubectl and aws land, and what real cloud costs. */
function Bar({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  const worktree = useAppStore((state) => selectKnownWorktreeById(state, worktreeId))
  const findings = inspection?.findings ?? []
  const terraformDir = findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
  const context = useDevopsContext(worktreeId, terraformDir, JSON.stringify(sandbox.state))
  const project = useDevopsProject(worktreeId)
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const pathCollapsed = usePathColumnCollapsed()
  const sideCollapsed = useAppStore(() => isSidePanelCollapsed(worktreeId))
  const meter = useProjectCostMeter([
    ...(worktree ? [worktree.path] : []),
    ...(project?.members.map((member) => member.repo.path) ?? [])
  ])
  if (!worktree) {
    return null
  }
  const { kube, aws } = context
  const real = (kube !== undefined && kube.tone !== 'local') || meter !== null
  const name = worktree.path.split(/[\\/]/).findLast(Boolean) ?? ''
  return (
    <>
      <div
        className="bx-bar"
        data-workspace-infra-bar=""
        style={{
          // The window's own controls float over the top-left while the sidebar is closed.
          paddingLeft: sidebarOpen ? 12 : 'calc(12px + var(--collapsed-sidebar-header-width))',
          // Orca's right sidebar is never drawn in a workspace: the window controls float here.
          paddingRight: 'calc(16px + var(--window-controls-width, 0px))'
        }}
      >
        <b>{name}</b>
        <span
          className={cn('bx-chip', kube && toneClass(kube.tone))}
          title={translate('components.devops.bar.kubeHint', 'Where kubectl commands land')}
        >
          {kube
            ? `☸ ${kube.namespace ? `${kube.context} / ${kube.namespace}` : kube.context}`
            : translate('components.devops.bar.noCluster', '☸ no cluster')}
        </span>
        <span
          className={cn('bx-chip', aws && toneClass(aws.tone))}
          title={translate(
            'components.devops.bar.awsHint',
            'Where aws and terraform commands land'
          )}
        >
          {aws
            ? `☁ ${aws.tone === 'local' ? 'floci (local)' : aws.profile}${aws.region ? ` · ${aws.region}` : ''}`
            : translate('components.devops.bar.noAws', '☁ aws: not signed in')}
        </span>
        {meter ? (
          <span
            className="bx-meter"
            title={translate(
              'components.devops.bar.meterHint',
              'Billed cloud infrastructure is running. End the session from the Project path to destroy it.'
            )}
            data-cost-meter=""
          >
            {translate('components.devops.bar.meter', '● EKS {{time}} · {{cost}}', {
              time: elapsed(meter.hours),
              cost: meter.spent === null ? '$?' : `$${meter.spent.toFixed(2)}`
            })}
          </span>
        ) : null}
        {/* Only this empty stretch drags the window: Electron lets a drag region swallow clicks
            on any control it overlaps that is not its descendant, like the floating titlebar. */}
        <span className="flex-1 self-stretch" style={DRAG} aria-hidden />
        <button
          type="button"
          className="bx-icon-btn"
          style={NO_DRAG}
          aria-pressed={!pathCollapsed}
          aria-label={translate('components.devops.bar.togglePath', 'Show or hide Project path')}
          title={translate('components.devops.bar.togglePath', 'Show or hide Project path')}
          onClick={togglePathColumn}
        >
          <PanelLeft aria-hidden />
        </button>
        <button
          type="button"
          className="bx-icon-btn"
          style={NO_DRAG}
          aria-pressed={!sideCollapsed}
          aria-label={translate('components.devops.bar.toggleSide', 'Show or hide the side panel')}
          title={translate('components.devops.bar.toggleSide', 'Show or hide the side panel')}
          onClick={() => toggleSidePanel(worktreeId)}
        >
          <PanelRight aria-hidden />
        </button>
        <button
          type="button"
          className="hover:text-[var(--bx-text)]"
          style={NO_DRAG}
          onClick={() => window.dispatchEvent(new Event(OPEN_DECK_EVENT))}
        >
          {translate('components.devops.bar.commands', '⌘ : commands')}
        </button>
      </div>
      {real ? <div className="bx-real-frame" aria-hidden data-real-frame="" /> : null}
    </>
  )
}

export function WorkspaceInfraBar(): React.JSX.Element | null {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  return worktreeId ? <Bar key={worktreeId} worktreeId={worktreeId} /> : null
}
