import {
  Activity,
  Blocks,
  Cloud,
  FileCode2,
  GitBranch,
  LayoutGrid,
  Rocket,
  ScanSearch,
  Server,
  Sparkles
} from 'lucide-react'
import { translate } from '@/i18n/i18n'

export function workspaceNavigation() {
  return [
    {
      id: 'home',
      label: translate('workspaceDesktop.home', 'Workspace home'),
      icon: LayoutGrid,
      group: 0
    },
    {
      id: 'discovery',
      label: translate('workspaceDesktop.discovery', 'Project discovery'),
      icon: ScanSearch,
      group: 0
    },
    {
      id: 'editor',
      label: translate('workspaceDesktop.editor', 'Editor & files'),
      icon: FileCode2,
      group: 0
    },
    {
      id: 'source',
      label: translate('workspaceDesktop.source', 'Source control'),
      icon: GitBranch,
      group: 0
    },
    {
      id: 'agents',
      label: translate('workspaceDesktop.agents', 'Agent dashboard'),
      icon: Sparkles,
      group: 0
    },
    {
      id: 'environments',
      label: translate('workspaceDesktop.environments', 'Environments'),
      icon: Server,
      group: 1
    },
    { id: 'cloud', label: translate('workspaceDesktop.cloud', 'Cloud'), icon: Cloud, group: 1 },
    {
      id: 'recipes',
      label: translate('workspaceDesktop.recipes', 'Recipes'),
      icon: Blocks,
      group: 1
    },
    {
      id: 'delivery',
      label: translate('workspaceDesktop.delivery', 'Delivery'),
      icon: Rocket,
      group: 1
    },
    {
      id: 'observability',
      label: translate('workspaceDesktop.observability', 'Observability'),
      icon: Activity,
      group: 1
    }
  ] as const
}
