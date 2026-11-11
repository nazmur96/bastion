import { useState } from 'react'
import { ArrowUp, ChevronDown, FolderOpen, GitBranch, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { WorkbenchAgentMenu } from './WorkbenchAgentMenu'
import { StartEnvironmentPicker } from './StartEnvironmentPicker'
import { openStartProject } from './start-project-actions'
import { getWorktreeExecutionHostId } from '../../../../shared/execution-host'
import { getFolderWorkspaceHostId } from '../../../../shared/folder-workspace-execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

/** ~/… for home paths; very long ones keep only their last two folders, like Cursor. */
function shortPath(path: string): string {
  const home = path.match(/^\/(?:home|Users)\/[^/]+/)?.[0]
  const short = home ? `~${path.slice(home.length)}` : path
  return short.length > 42 ? `…/${short.split('/').filter(Boolean).slice(-2).join('/')}` : short
}

/** Which folder the chat works in: any workspace Bastion knows, or another one added. */
function FolderPicker({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const current = useAppStore((state) => selectKnownWorktreeById(state, worktreeId))
  const byRepo = useAppStore((state) => state.worktreesByRepo)
  const repos = useAppStore((state) => state.repos)
  const folders = useAppStore((state) => state.folderWorkspaces)
  const projectGroups = useAppStore((state) => state.projectGroups)
  const all = [
    ...Object.values(byRepo)
      .flat()
      .map((worktree) => ({
        id: worktree.id,
        path: worktree.path,
        hostId: getWorktreeExecutionHostId(
          worktree,
          repos.find((repo) => repo.id === worktree.repoId)
        )
      })),
    ...folders.map((folder) => ({
      id: folderWorkspaceKey(folder.id),
      path: folder.folderPath,
      hostId: getFolderWorkspaceHostId(folder, projectGroups)
    }))
  ]
  const currentPath = current?.path ?? all.find((entry) => entry.id === worktreeId)?.path
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="bx-picker">
          {currentPath
            ? shortPath(currentPath)
            : translate('components.start.noFolder', 'No folder')}
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{translate('components.start.folders', 'Folders')}</DropdownMenuLabel>
        <div className="scrollbar-sleek max-h-72 overflow-y-auto">
          {all.map((worktree) => (
            <DropdownMenuItem
              key={`${worktree.hostId}:${worktree.id}`}
              onSelect={() =>
                activateAndRevealWorkspace(worktree.id, { executionHostId: worktree.hostId })
              }
            >
              {shortPath(worktree.path)}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openStartProject('open', worktreeId)}>
          {translate('components.start.openFolder', 'Open another folder…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** What the middle shows with no tab open: a chat to start, and where to start from. */
export function WorkbenchStart({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [agentMenuOpen, setAgentMenuOpen] = useState(false)
  const start = (): void => setAgentMenuOpen(true)
  return (
    <div className="bx-start" data-workbench-start="">
      <div className="bx-start-inner">
        <div className="bx-start-pickers">
          <FolderPicker worktreeId={worktreeId} />
          <StartEnvironmentPicker workspaceId={worktreeId} />
        </div>
        <form
          className="bx-composer"
          onSubmit={(event) => {
            event.preventDefault()
            start()
          }}
        >
          <textarea
            value={text}
            rows={2}
            aria-label={translate('components.start.askAgent', 'Ask an agent')}
            placeholder={translate(
              'components.start.agentPlaceholder',
              'Ask an agent to plan, build or fix something in this project'
            )}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !isImeOwnedKeyboardEvent(event)) {
                event.preventDefault()
                start()
              }
            }}
          />
          <div className="bx-composer-row">
            <WorkbenchAgentMenu
              key={`${worktreeId}:${groupId}`}
              worktreeId={worktreeId}
              groupId={groupId}
              open={agentMenuOpen}
              onOpenChange={setAgentMenuOpen}
              prompt={text.trim() || undefined}
              onPromptDelivered={() => setText('')}
            >
              <button type="button" className="bx-picker">
                {translate('components.start.chooseAgent', 'Choose agent')}
                <ChevronDown aria-hidden />
              </button>
            </WorkbenchAgentMenu>
            <button
              type="submit"
              className="bx-send"
              aria-label={translate('components.start.send', 'Start chat')}
            >
              <ArrowUp aria-hidden />
            </button>
          </div>
        </form>
        <div className="bx-start-actions">
          <button
            type="button"
            className="bx-chip-btn"
            onClick={() => openStartProject('open', worktreeId)}
          >
            <FolderOpen aria-hidden />
            {translate('components.start.open', 'Open folder')}
          </button>
          <button
            type="button"
            className="bx-chip-btn"
            onClick={() => openStartProject('clone', worktreeId)}
          >
            <GitBranch aria-hidden />
            {translate('components.start.clone', 'Clone from Git')}
          </button>
          <button
            type="button"
            className="bx-chip-btn"
            onClick={() => openStartProject('create', worktreeId)}
          >
            <Plus aria-hidden />
            {translate('components.start.create', 'New project')}
          </button>
        </div>
      </div>
    </div>
  )
}
