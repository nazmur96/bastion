import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import type { ActiveRightSidebarTab } from '@/store/slices/editor'

/** The right-hand side panel's sections, as in the Bastion prototype. */
export type SideSection = 'files' | 'changes' | 'terminal' | 'browser' | 'checks'

export const SIDE_SECTIONS: readonly SideSection[] = [
  'files',
  'changes',
  'terminal',
  'browser',
  'checks'
]

const KEY = 'orca-fork.sidePanel.v1'

function load(): Record<string, SideSection> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object'
      ? Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, SideSection] =>
            SIDE_SECTIONS.some((section) => section === entry[1])
          )
        )
      : {}
  } catch {
    return {}
  }
}

let sections = load()
const listeners = new Set<() => void>()

/** The Orca panel each section draws; the store's tab is kept on it so the panel loads. */
const TAB_FOR_SECTION: Partial<Record<SideSection, ActiveRightSidebarTab>> = {
  files: 'explorer',
  changes: 'source-control',
  checks: 'checks'
}

/** Point Orca's right-sidebar state at the section's panel (the sidebar itself is not drawn). */
export function syncSideSection(worktreeId: string): void {
  const tab = TAB_FOR_SECTION[sections[worktreeId] ?? 'files']
  const ui = useAppStore.getState()
  if (tab && ui.rightSidebarTab !== tab) {
    ui.setRightSidebarTab(tab)
  }
}

export function setSideSection(worktreeId: string, section: SideSection): void {
  if (sections[worktreeId] === section) {
    return
  }
  sections = { ...sections, [worktreeId]: section }
  try {
    localStorage.setItem(KEY, JSON.stringify(sections))
  } catch {
    // The section resets to Files next time; nothing else is lost.
  }
  syncSideSection(worktreeId)
  for (const listener of listeners) {
    listener()
  }
}

export function useSideSection(worktreeId: string): SideSection {
  const read = (): SideSection => sections[worktreeId] ?? 'files'
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    read,
    read
  )
}
