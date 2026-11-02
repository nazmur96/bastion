import { useCallback, useEffect, useState } from 'react'
import { Cloud, FlaskConical, Monitor, Rocket, Ship, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import type { DevopsSandbox } from './use-devops-sandbox'
import { InfraCard } from './InfraHomeCards'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import {
  MISE_TOOL_SPECS,
  devopsCommandLine,
  type DevopsInspection,
  type DevopsToolStatus
} from '../../../../shared/fork-devops-inspection'
import {
  LAUNCHPAD_GROUPS,
  LAUNCHPAD_TILES,
  launchpadScript,
  type LaunchpadGroup,
  type LaunchpadTile
} from '../../../../shared/fork-devops-launchpad'
import { sandboxClusterName } from '../../../../shared/fork-devops-sandbox'

const GROUP_ICONS: Record<LaunchpadGroup, typeof Ship> = {
  local: Ship,
  demo: FlaskConical,
  machine: Monitor,
  real: Cloud
}

function groupTitle(group: LaunchpadGroup): string {
  switch (group) {
    case 'local':
      return translate('components.devops.launchpad.local', 'Try it now · local and free')
    case 'demo':
      return translate('components.devops.launchpad.demo', 'Demos · into your local cluster')
    case 'machine':
      return translate('components.devops.launchpad.machine', 'A machine to work on')
    case 'real':
      return translate(
        'components.devops.launchpad.real',
        'Real infrastructure · plan and dry run only'
      )
  }
}

function useLaunchpadTools(path: string | undefined): {
  tools: Record<string, DevopsToolStatus> | null
  recheck: () => void
} {
  const [tools, setTools] = useState<Record<string, DevopsToolStatus> | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    void window.api.aiVault.checkLaunchpadTools(path).then((next) => {
      if (current) {
        setTools(next)
      }
    })
    return () => {
      current = false
    }
  }, [path, round])
  return { tools, recheck: useCallback(() => setRound((value) => value + 1), []) }
}

/** Problems first: "give me a cluster / a demo / a VM", each one click into a workbench terminal. */
export function InfraLaunchpad({
  worktreeId,
  inspection,
  sandbox,
  context,
  terraformDir
}: {
  worktreeId: string
  inspection: DevopsInspection | null
  sandbox: DevopsSandbox
  context: DevopsContext
  terraformDir: string | null
}): React.JSX.Element {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const { tools, recheck } = useLaunchpadTools(path)
  const usesMise = inspection?.environment === 'mise'
  const name = path ? sandboxClusterName(path).replace(/-dev$/, '') : 'workspace'
  const localCluster = context.kube?.tone === 'local'

  const blockedReason = (tile: LaunchpadTile): string | null => {
    if (tile.needsLocalCluster && !localCluster) {
      return translate(
        'components.devops.launchpad.needsLocal',
        'Start a local cluster first; demos never install into a real one.'
      )
    }
    if (tile.id === 'terraform-plan' && terraformDir === null) {
      return translate('components.devops.launchpad.noTerraform', 'No Terraform in this repo yet.')
    }
    return null
  }

  const launch = (tile: LaunchpadTile, status: DevopsToolStatus | undefined): void => {
    if (tile.sandbox) {
      sandbox.run(tile.sandbox, 'start')
      return
    }
    const script = launchpadScript(tile, { name, tfdir: terraformDir ?? '.' })
    if (script) {
      runInWorkbenchTerminal(
        worktreeId,
        devopsCommandLine(status, script, inspection?.shell),
        sandbox.state.awsEnv
      )
    }
  }

  const addTool = (tool: string): void => {
    runInWorkbenchTerminal(worktreeId, `mise use ${MISE_TOOL_SPECS[tool]}`)
    // The terminal takes the screen; the check reruns for when the person comes back.
    window.setTimeout(recheck, 15_000)
  }

  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.launchpad.title', 'What do you want to do?')}
      hint={translate(
        'components.devops.launchpad.hint',
        'Each tile runs in a terminal you can watch. Nothing billed is created from here.'
      )}
    >
      <div className="space-y-4">
        {LAUNCHPAD_GROUPS.map((group) => {
          const Icon = GROUP_ICONS[group]
          return (
            <div key={group}>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <Icon className="size-3.5" aria-hidden />
                {groupTitle(group)}
              </h3>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {LAUNCHPAD_TILES.filter((tile) => tile.group === group).map((tile) => {
                  const status = tools?.[tile.tool]
                  const missing = tools !== null && !status?.available
                  const blocked = blockedReason(tile)
                  const canAdd = missing && usesMise && Boolean(MISE_TOOL_SPECS[tile.tool])
                  return (
                    <div
                      key={tile.id}
                      className={cn(
                        'flex flex-col gap-1.5 rounded-md border border-border bg-background p-3',
                        blocked && 'opacity-60'
                      )}
                      data-launchpad-tile={tile.id}
                    >
                      <div className="text-sm font-medium">{tile.title}</div>
                      <p className="text-xs text-muted-foreground">{tile.blurb}</p>
                      <div className="mt-auto flex items-center gap-1.5 pt-1">
                        <span
                          className={cn(
                            'rounded-full border px-1.5 text-[11px]',
                            tile.cost ? 'text-status-warning' : 'text-status-success'
                          )}
                        >
                          {tile.cost ?? translate('components.devops.launchpad.free', 'free')}
                        </span>
                        <span className="truncate font-mono text-[11px] text-muted-foreground">
                          {tile.tool}
                        </span>
                        {missing && canAdd ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            className="ml-auto"
                            title={`mise use ${MISE_TOOL_SPECS[tile.tool]}`}
                            onClick={() => addTool(tile.tool)}
                          >
                            <Wrench aria-hidden />
                            {translate('components.devops.launchpad.add', 'Add {{tool}}', {
                              tool: tile.tool
                            })}
                          </Button>
                        ) : missing ? (
                          <span
                            className="ml-auto truncate text-[11px] text-destructive"
                            title={status && !status.available ? status.hint : undefined}
                          >
                            {translate('components.devops.launchpad.missing', 'not installed')}
                          </span>
                        ) : (
                          <Button
                            type="button"
                            variant={tile.cost ? 'outline' : 'default'}
                            size="xs"
                            className="ml-auto"
                            disabled={Boolean(blocked) || tools === null || sandbox.busy !== null}
                            title={
                              blocked ??
                              launchpadScript(tile, { name, tfdir: terraformDir ?? '.' }) ??
                              undefined
                            }
                            onClick={() => launch(tile, status)}
                          >
                            <Rocket aria-hidden />
                            {tile.cost
                              ? translate('components.devops.launchpad.preview', 'Preview')
                              : translate('components.devops.launchpad.launch', 'Launch')}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </InfraCard>
  )
}
