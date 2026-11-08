import { Blocks } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ActiveSettingsSectionProvider,
  SettingsSection
} from '@/components/settings/SettingsSection'
import { PluginsSettingsSection } from '@/components/settings/PluginsSettingsSection'
import { QuickCommandsPane } from '@/components/settings/QuickCommandsPane'
import { McpConfigSection } from '@/components/settings/McpConfigSection'
import { getRepositoryLocalCommandsSectionId } from '@/components/settings/repository/repository-settings-targets'
import type { SettingsRenderContext } from '@/components/settings/settings-render-context'
import type { SettingsNavSection } from '@/lib/settings-navigation-types'
import { getRepoIdFromWorktreeId } from '../../../../shared/worktree/id'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'

export function buildCustomizeSettingsSections(): SettingsNavSection[] {
  return [
    {
      id: 'customize',
      title: translate('components.customize.title', 'Customize'),
      description: translate(
        'components.customize.description',
        'Plugins, tools, skills and commands in one place.'
      ),
      icon: Blocks,
      group: 'capabilities',
      searchEntries: [
        {
          title: translate('components.customize.search', 'Plugins MCPs skills commands hooks')
        }
      ]
    }
  ]
}

function CustomizePane({ context }: { context: SettingsRenderContext }): React.JSX.Element {
  const { model } = context
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  const repoId = worktreeId ? getRepoIdFromWorktreeId(worktreeId) : null
  const repo = model.repos.find((candidate) => candidate.id === repoId)
  const tabs = [
    ['plugins', translate('components.customize.plugins', 'Plugins')],
    ['mcps', translate('components.customize.mcps', 'MCPs')],
    ['skills', translate('components.customize.skills', 'Skills')],
    ['commands', translate('components.customize.commands', 'Commands')],
    ['hooks', translate('components.customize.hooks', 'Hooks')]
  ] as const
  return (
    <div className="bx-customize">
      <Tabs defaultValue="plugins">
        <TabsList variant="line">
          {tabs.map(([id, label]) => (
            <TabsTrigger key={id} value={id}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="plugins">
          <ActiveSettingsSectionProvider value="plugins">
            <PluginsSettingsSection
              mounted
              settings={model.settings}
              updateSettings={model.updateSettingsOrThrow}
            />
          </ActiveSettingsSectionProvider>
        </TabsContent>
        <TabsContent value="mcps">
          {repo ? (
            <McpConfigSection repo={repo} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {translate(
                'components.customize.projectRequired',
                'Open a project to manage its tools and hooks.'
              )}
            </p>
          )}
        </TabsContent>
        <TabsContent value="skills">
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {translate(
                'components.customize.skillsDescription',
                'Browse installed skills, filter by agent and manage their sources.'
              )}
            </p>
            <Button variant="outline" onClick={() => useAppStore.getState().openSkillsPage()}>
              {translate('components.customize.openSkills', 'Manage skills')}
            </Button>
          </div>
        </TabsContent>
        <TabsContent value="commands">
          <QuickCommandsPane
            settings={model.settings}
            addCommandIntentSignal={model.quickCommandAddIntentSignal}
          />
        </TabsContent>
        <TabsContent value="hooks">
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {translate(
                'components.customize.hooksDescription',
                'Project hooks control setup, archive and workspace commands.'
              )}
            </p>
            {repo ? (
              <Button
                variant="outline"
                onClick={() =>
                  useAppStore.getState().openSettingsTarget({
                    pane: 'repo',
                    repoId: repo.id,
                    hostId: getRepoExecutionHostId(repo),
                    sectionId: getRepositoryLocalCommandsSectionId(repo.id)
                  })
                }
              >
                {translate('components.customize.openHooks', 'Manage project hooks')}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                {translate(
                  'components.customize.projectRequired',
                  'Open a project to manage its tools and hooks.'
                )}
              </p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export function renderCustomizeSettingsSection(
  context: SettingsRenderContext
): React.JSX.Element | null {
  if (!context.model.showDesktopOnlySettings) {
    return null
  }
  return (
    <SettingsSection
      id="customize"
      title={translate('components.customize.title', 'Customize')}
      description={translate(
        'components.customize.description',
        'Plugins, tools, skills and commands in one place.'
      )}
      searchEntries={context.navigation.getSectionSearchEntries('customize')}
    >
      {context.view.isSectionMounted('customize') ? <CustomizePane context={context} /> : null}
    </SettingsSection>
  )
}
