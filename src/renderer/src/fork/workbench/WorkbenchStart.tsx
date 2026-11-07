import { useState } from 'react'
import { ArrowUp, ChevronDown, FolderOpen, GitBranch, Laptop, Plus, Server } from 'lucide-react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { launchClaudeChatInPanel } from '../claude-panel/ensure-claude-panel'
import { draftForClaude } from '../devops/ask-claude'

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
  const openModal = useAppStore((state) => state.openModal)
  const all = Object.values(byRepo).flat()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="bx-picker">
          {current ? shortPath(current.path) : translate('components.start.noFolder', 'No folder')}
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{translate('components.start.folders', 'Folders')}</DropdownMenuLabel>
        <div className="scrollbar-sleek max-h-72 overflow-y-auto">
          {all.map((worktree) => (
            <DropdownMenuItem
              key={worktree.id}
              onSelect={() => activateAndRevealWorktree(worktree.id)}
            >
              {shortPath(worktree.path)}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openModal('add-repo')}>
          {translate('components.start.openFolder', 'Open another folder…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Where the work runs: this computer, or a remote machine Bastion can reach over SSH. */
function EnvironmentPicker(): React.JSX.Element {
  const hosts = useAppStore((state) => state.sshTargetLabels)
  const openModal = useAppStore((state) => state.openModal)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="bx-picker">
          <Laptop aria-hidden />
          {translate('components.start.thisComputer', 'This computer')}
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem disabled>
          <Laptop aria-hidden />
          {translate('components.start.thisComputer', 'This computer')}
        </DropdownMenuItem>
        {[...hosts].map(([id, label]) => (
          <DropdownMenuItem key={id} onSelect={() => openModal('add-repo')}>
            <Server aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openModal('add-repo')}>
          {translate('components.start.remote', 'Remote machine…')}
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
  const openModal = useAppStore((state) => state.openModal)
  const start = (): void => {
    launchClaudeChatInPanel(worktreeId, groupId, { focusComposer: true })
    if (text.trim()) {
      // The chat appears a moment later; draft into it, never start a second one.
      draftForClaude(worktreeId, text.trim(), 1)
    }
    setText('')
  }
  return (
    <div className="bx-start" data-workbench-start="">
      <div className="bx-start-inner">
        <div className="bx-start-pickers">
          <FolderPicker worktreeId={worktreeId} />
          <EnvironmentPicker />
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
            aria-label={translate('components.start.ask', 'Ask Claude')}
            placeholder={translate(
              'components.start.placeholder',
              'Ask Claude to plan, build or fix something in this project'
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
            <span>{translate('components.start.agent', 'Claude')}</span>
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
          <button type="button" className="bx-chip-btn" onClick={() => openModal('add-repo')}>
            <FolderOpen aria-hidden />
            {translate('components.start.open', 'Open folder')}
          </button>
          <button type="button" className="bx-chip-btn" onClick={() => openModal('add-repo')}>
            <GitBranch aria-hidden />
            {translate('components.start.clone', 'Clone from Git')}
          </button>
          <button type="button" className="bx-chip-btn" onClick={() => openModal('add-repo')}>
            <Plus aria-hidden />
            {translate('components.start.create', 'New project')}
          </button>
        </div>
      </div>
    </div>
  )
}
