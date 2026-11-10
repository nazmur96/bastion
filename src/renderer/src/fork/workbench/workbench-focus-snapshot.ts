import type { SideSection } from './side-panel-store'

export type WorkbenchFocusTarget = 'workbench' | 'terminal'
export type FocusSession = {
  worktreeId: string
  target: WorkbenchFocusTarget
  dockId: string
  share: number
  sidebarOpen: boolean
  pathCollapsed: boolean
  section: SideSection
}

const KEY = 'orca-fork.workbenchFocus.restore.v1'

function isSession(value: unknown): value is FocusSession {
  return (
    value !== null &&
    typeof value === 'object' &&
    'worktreeId' in value &&
    typeof value.worktreeId === 'string' &&
    'dockId' in value &&
    typeof value.dockId === 'string' &&
    'target' in value &&
    (value.target === 'terminal' || value.target === 'workbench') &&
    'share' in value &&
    typeof value.share === 'number' &&
    Number.isFinite(value.share) &&
    value.share >= 0 &&
    value.share <= 1 &&
    'sidebarOpen' in value &&
    typeof value.sidebarOpen === 'boolean' &&
    'pathCollapsed' in value &&
    typeof value.pathCollapsed === 'boolean' &&
    'section' in value &&
    ['files', 'changes', 'terminal', 'browser', 'checks'].some((id) => id === value.section)
  )
}

export function loadFocusSnapshot(): FocusSession | null {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null')
    return isSession(value) ? value : null
  } catch {
    return null
  }
}

export function saveFocusSnapshot(session: FocusSession | null): void {
  try {
    if (session) {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(session))
    } else {
      globalThis.localStorage?.removeItem(KEY)
    }
  } catch {
    // Storage denial leaves focus available for this session only.
  }
}
