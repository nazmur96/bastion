import { useEffect } from 'react'
import { useAppStore } from '@/store'
import { getShortcutPlatform } from '@/lib/shortcut-platform'
import { keybindingMatchesAction } from '../../../../shared/keybindings'
import { runClaudePanelToggle, syncClaudePanelVisibility } from './claude-panel-actions'
import { applyClaudeView, toggleClaudeView } from './claude-panel-view'
import { newWorkbenchTerminal, showWorkbenchTerminals } from '../workbench/workbench-terminals'
import { isIncognitoWindow } from '../project-workspaces/use-project-workspaces'

/** Mounted once: restores saved panel layout and owns workbench shortcuts. */
export function ClaudePanelController(): null {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  const hasLayout = useAppStore((s) =>
    worktreeId ? Boolean(s.layoutByWorktree[worktreeId]) : false
  )
  // Before the saved layout is restored the panel's group looks missing; acting then made a duplicate.
  const sessionReady = useAppStore((s) => s.workspaceSessionReady)

  useEffect(() => {
    if (isIncognitoWindow() || !worktreeId || !hasLayout || !sessionReady) {
      return undefined
    }
    syncClaudePanelVisibility(worktreeId)
    applyClaudeView(worktreeId)
    // A new panel's moved-out groups are pruned a tick later, rebuilding the split.
    const timer = setTimeout(() => applyClaudeView(worktreeId), 50)
    return () => clearTimeout(timer)
  }, [worktreeId, hasLayout, sessionReady])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const state = useAppStore.getState()
      const worktree = state.activeWorktreeId
      if (event.repeat || !worktree) {
        return
      }
      const platform = getShortcutPlatform()
      const run = keybindingMatchesAction('claudePanel.toggle', event, platform, state.keybindings)
        ? runClaudePanelToggle
        : keybindingMatchesAction('claudePanel.toggleView', event, platform, state.keybindings)
          ? toggleClaudeView
          : keybindingMatchesAction('workbench.newTerminal', event, platform, state.keybindings)
            ? newWorkbenchTerminal
            : keybindingMatchesAction('workbench.showTerminals', event, platform, state.keybindings)
              ? showWorkbenchTerminals
              : null
      if (run) {
        event.preventDefault()
        event.stopPropagation()
        run(worktree)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return null
}
