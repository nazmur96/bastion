import { useAppStore } from '@/store'
import type { TabGroupLayoutNode } from '../../../../shared/tab-types'
import { containsGroup } from '../claude-panel/claude-panel-layout'

const KEY = 'orca-fork.terminalDock.v1'
/** Share of the width the workbench keeps beside the side panel. */
const WORKBENCH_RATIO = 0.66

function load(): Record<string, string> {
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

// Read once: the lookup runs inside store selectors, on every store update.
let docks: Record<string, string> | null = null

function readAll(): Record<string, string> {
  docks ??= load()
  return docks
}

function save(worktreeId: string, groupId: string): void {
  docks = { ...readAll(), [worktreeId]: groupId }
  try {
    localStorage.setItem(KEY, JSON.stringify(docks))
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

/** The left/right split whose right side is the dock, as the path Orca's ratio setter takes. */
function dockSplitPath(node: TabGroupLayoutNode, dock: string, path = ''): string | null {
  if (node.type === 'leaf') {
    return null
  }
  if (
    node.direction === 'horizontal' &&
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

/** The older layout's dock: the lower half of an up/down split. Anything else the person
 *  arranged stays where it is. */
function isBelowWorkbench(node: TabGroupLayoutNode, dock: string): boolean {
  if (node.type === 'leaf') {
    return false
  }
  if (
    node.direction === 'vertical' &&
    node.second.type === 'leaf' &&
    node.second.groupId === dock
  ) {
    return true
  }
  return isBelowWorkbench(node.first, dock) || isBelowWorkbench(node.second, dock)
}

/** The side panel right of the workbench that terminals open in, made on first use. A dock
 *  saved below the workbench (an older layout) hands its terminals to the new one. */
export function ensureTerminalDock(worktreeId: string, workbenchId: string): string | null {
  const live = liveTerminalDockId(worktreeId)
  const layout = useAppStore.getState().layoutByWorktree[worktreeId]
  if (live && !(layout && isBelowWorkbench(layout, live))) {
    return live
  }
  const state = useAppStore.getState()
  const dock = state.createEmptySplitGroup(worktreeId, workbenchId, 'right', { activate: false })
  if (!dock) {
    return null
  }
  save(worktreeId, dock)
  if (live) {
    for (const tab of (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
      (candidate) => candidate.groupId === live
    )) {
      useAppStore.getState().moveUnifiedTabToGroup(tab.id, dock, { activate: true })
    }
  }
  sizeTerminalDock(worktreeId, dock)
  return dock
}

/** The prototype's proportions: the workbench keeps about two thirds beside the side panel. */
export function sizeTerminalDock(worktreeId: string, dock: string): void {
  const state = useAppStore.getState()
  const layout = state.layoutByWorktree[worktreeId]
  const path = layout ? dockSplitPath(layout, dock) : null
  if (path !== null) {
    state.setTabGroupSplitRatio(worktreeId, path, WORKBENCH_RATIO)
  }
}

function nodeAt(node: TabGroupLayoutNode, path: string): TabGroupLayoutNode | null {
  let current: TabGroupLayoutNode | null = node
  for (const side of path ? path.split('.') : []) {
    current = current?.type === 'split' ? (side === 'first' ? current.first : current.second) : null
  }
  return current
}

/** A dock still at Orca's even split gets the prototype's proportions; one the person
 *  resized keeps its size. */
export function sizeEvenTerminalDock(worktreeId: string, dock: string): void {
  const layout = useAppStore.getState().layoutByWorktree[worktreeId]
  const path = layout ? dockSplitPath(layout, dock) : null
  const split = layout && path !== null ? nodeAt(layout, path) : null
  if (split?.type === 'split' && (split.ratio ?? 0.5) === 0.5) {
    sizeTerminalDock(worktreeId, dock)
  }
}
