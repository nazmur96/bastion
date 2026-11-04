import { useAppStore } from '@/store'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { containsGroup } from '../claude-panel/claude-panel-layout'

const KEY = 'orca-fork.terminalDock.v1'
/** Share of the column the workbench keeps above the terminal dock. */
const WORKBENCH_RATIO = 0.68

function readAll(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object'
      ? Object.fromEntries(
          Object.entries(parsed).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {}
  } catch {
    return {}
  }
}

function save(worktreeId: string, groupId: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [worktreeId]: groupId }))
  } catch {
    // Without storage the dock is found again by its id for this session only.
  }
}

/** The terminal dock under the workbench, while its group is still on screen. */
export function liveTerminalDockId(worktreeId: string): string | null {
  const groupId = readAll()[worktreeId]
  const state = useAppStore.getState()
  const layout = state.layoutByWorktree[worktreeId]
  return groupId &&
    layout &&
    containsGroup(layout, groupId) &&
    (state.groupsByWorktree[worktreeId] ?? []).some((group) => group.id === groupId)
    ? groupId
    : null
}

/** The vertical split whose lower side is the dock, as the path Orca's ratio setter takes. */
function dockSplitPath(node: TabGroupLayoutNode, dock: string, path = ''): string | null {
  if (node.type === 'leaf') {
    return null
  }
  if (
    node.direction === 'vertical' &&
    node.second.type === 'leaf' &&
    node.second.groupId === dock
  ) {
    return path
  }
  for (const side of ['first', 'second'] as const) {
    const found = dockSplitPath(node[side], dock, path ? `${path}.${side}` : side)
    if (found !== null) {
      return found
    }
  }
  return null
}

/** The dock below the workbench that terminals open in, made on first use. */
export function ensureTerminalDock(worktreeId: string, workbenchId: string): string | null {
  const live = liveTerminalDockId(worktreeId)
  if (live) {
    return live
  }
  const state = useAppStore.getState()
  const dock = state.createEmptySplitGroup(worktreeId, workbenchId, 'down', { activate: false })
  if (!dock) {
    return null
  }
  save(worktreeId, dock)
  const layout = useAppStore.getState().layoutByWorktree[worktreeId]
  const path = layout ? dockSplitPath(layout, dock) : null
  if (path !== null) {
    state.setTabGroupSplitRatio(worktreeId, path, WORKBENCH_RATIO)
  }
  return dock
}
