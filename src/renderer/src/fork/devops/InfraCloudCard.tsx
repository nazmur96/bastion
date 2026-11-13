import { Button } from '@/components/ui/button'
import { openWorkspacePage } from '../workspace-desktop/workspace-desktop-state'
import { InfraCard } from './InfraHomeCards'

type LegacyCloudProps = {
  worktreeId: string
  workspacePath: string
  appName: string
  hasTerraform: boolean
  platformFolder: string
  eks: { cluster: string; region: string } | null
  meterRepo: string | undefined
  commandLine: (command: string) => string
}
export function InfraCloudCard(_props: LegacyCloudProps): React.JSX.Element {
  return (
    <InfraCard
      id="infra-path-cloud"
      title="Cloud connections"
      hint="Cloud targets belong to this workspace."
    >
      <p className="text-sm text-muted-foreground">
        Manage profile references and emulated target metadata. Verification and resource access are
        not available yet.
      </p>
      <Button variant="outline" onClick={() => openWorkspacePage('cloud')}>
        Open cloud connections
      </Button>
    </InfraCard>
  )
}
