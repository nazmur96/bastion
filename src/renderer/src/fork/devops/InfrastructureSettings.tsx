import { Boxes } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { SettingsSection } from '@/components/settings/SettingsSection'
import type { SettingsRenderContext } from '@/components/settings/settings-render-context'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { activeCostMeters } from './cost-meter-store'
import { setInfraView } from './infra-home-store'
import { togglePathColumn, usePathColumnCollapsed } from './path-column-store'
import { useDevopsContext } from './use-devops-context'
import { isSidePanelCollapsed, toggleSidePanel } from '../workbench/terminal-dock'

/** Settings › Infrastructure: where this workspace's commands land, what is billed, the panels. */
export function buildInfrastructureSettingsSections(): SettingsNavSection[] {
  return [
    {
      id: 'infrastructure',
      title: translate('components.settings.infrastructure.title', 'Infrastructure'),
      description: translate(
        'components.settings.infrastructure.description',
        'Clusters, cloud accounts and the Project path for the open workspace.'
      ),
      icon: Boxes,
      searchEntries: [],
      group: 'infrastructure'
    }
  ]
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-foreground">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      {children}
    </div>
  )
}

function InfrastructurePane({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const context = useDevopsContext(worktreeId, null, '')
  const pathCollapsed = usePathColumnCollapsed()
  const sideCollapsed = useAppStore(() => isSidePanelCollapsed(worktreeId))
  const meters = activeCostMeters()
  const backToApp = (): void => useAppStore.getState().closeSettingsPage()
  return (
    <div className="divide-y divide-border">
      <Row
        label={translate('components.settings.infrastructure.kube', 'Kubernetes')}
        hint={translate(
          'components.settings.infrastructure.kubeHint',
          'Where kubectl commands land'
        )}
      >
        <span className="text-sm text-muted-foreground">
          {context.kube?.context ??
            translate('components.settings.infrastructure.none', 'Not connected')}
        </span>
      </Row>
      <Row
        label={translate('components.settings.infrastructure.aws', 'AWS')}
        hint={translate(
          'components.settings.infrastructure.awsHint',
          'Profile and region for aws and terraform'
        )}
      >
        <span className="text-sm text-muted-foreground">
          {context.aws
            ? `${context.aws.profile}${context.aws.region ? ` · ${context.aws.region}` : ''}`
            : translate('components.settings.infrastructure.none', 'Not connected')}
        </span>
      </Row>
      <Row
        label={translate('components.settings.infrastructure.billed', 'Billed infrastructure')}
        hint={translate(
          'components.settings.infrastructure.billedHint',
          'Applied and not yet destroyed; ended from the Project path'
        )}
      >
        <span className="text-sm text-muted-foreground">
          {meters.length === 0
            ? translate('components.settings.infrastructure.nothingBilled', 'Nothing running')
            : translate('components.settings.infrastructure.billedCount', '{{count}} running', {
                count: meters.length
              })}
        </span>
      </Row>
      <Row
        label={translate('components.settings.infrastructure.tools', 'Tools & settings')}
        hint={translate(
          'components.settings.infrastructure.toolsHint',
          'Every Infra card: deploy, harden, cloud, observe'
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setInfraView(worktreeId, 'tools')
            backToApp()
          }}
        >
          {translate('components.settings.infrastructure.open', 'Open')}
        </Button>
      </Row>
      <Row
        label={translate('components.settings.infrastructure.path', 'Project path column')}
        hint={translate(
          'components.settings.infrastructure.pathHint',
          'Steps and system map on the left'
        )}
      >
        <Button type="button" variant="outline" size="sm" onClick={togglePathColumn}>
          {pathCollapsed
            ? translate('components.settings.infrastructure.show', 'Show')
            : translate('components.settings.infrastructure.hide', 'Hide')}
        </Button>
      </Row>
      <Row
        label={translate('components.settings.infrastructure.side', 'Side panel')}
        hint={translate(
          'components.settings.infrastructure.sideHint',
          'Files, changes, terminal, browser and checks on the right'
        )}
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => toggleSidePanel(worktreeId)}
        >
          {sideCollapsed
            ? translate('components.settings.infrastructure.show', 'Show')
            : translate('components.settings.infrastructure.hide', 'Hide')}
        </Button>
      </Row>
    </div>
  )
}

export function renderInfrastructureSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element | null {
  const { navigation, view } = context
  const worktreeId = useAppStore.getState().activeWorktreeId
  return (
    <SettingsSection
      id="infrastructure"
      title={translate('components.settings.infrastructure.title', 'Infrastructure')}
      description={translate(
        'components.settings.infrastructure.description',
        'Clusters, cloud accounts and the Project path for the open workspace.'
      )}
      searchEntries={navigation.getSectionSearchEntries('infrastructure')}
    >
      {view.isSectionMounted('infrastructure') && worktreeId ? (
        <InfrastructurePane worktreeId={worktreeId} />
      ) : (
        <p className="text-sm text-muted-foreground">
          {translate(
            'components.settings.infrastructure.noWorkspace',
            'Open a workspace to see its clusters and cloud.'
          )}
        </p>
      )}
    </SettingsSection>
  )
}
