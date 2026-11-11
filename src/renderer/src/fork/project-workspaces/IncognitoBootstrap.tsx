import { workspaceErrorMessage } from './workspace-error-message'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { translate } from '@/i18n/i18n'
import type { TabContentType } from '../../../../shared/tab-types'
import type { IncognitoKind } from '../../../../shared/fork-project-workspaces'
import { useProjectWorkspaces } from './use-project-workspaces'
import { acknowledgeWorkspaceArrival } from './workspace-arrival-ready'
import { Button } from '@/components/ui/button'

// Storage is per namespace, so this records only this task's own completed setup.
const PREPARED_KEY = 'bastion.incognito.prepared.v1'
const TOOL_CONTENT: Record<IncognitoKind, TabContentType[]> = {
  terminal: ['terminal'],
  browser: ['browser'],
  agent: ['agent-session', 'terminal'],
  file: ['editor']
}

function readPrepared(): boolean {
  try {
    return localStorage.getItem(PREPARED_KEY) === '1'
  } catch {
    return false
  }
}

function markPrepared(): void {
  try {
    localStorage.setItem(PREPARED_KEY, '1')
  } catch {
    // Without storage, a later launch re-checks for the chosen tool instead.
  }
}

let preparation: Promise<string> | null = null
async function prepareIncognito(): Promise<string> {
  const entry = await window.api.projectWorkspaces?.incognito?.prepare()
  if (!entry) {
    throw new Error('This window is not an Incognito task.')
  }
  const state = useAppStore.getState()
  let repo = state.repos.find((row) => row.path === entry.root)
  repo ??=
    (await state.addRepoPath(entry.root, 'folder', { runtimeEnvironmentId: null })) ?? undefined
  if (!repo) {
    throw new Error('Incognito folder could not open.')
  }
  await state.fetchWorktrees(repo.id)
  const worktree = useAppStore.getState().worktreesByRepo[repo.id]?.[0]
  if (!worktree) {
    throw new Error('Incognito context could not open.')
  }
  const fresh = useAppStore.getState()
  const groupId = fresh.ensureWorktreeRootGroup(worktree.id)
  fresh.setActiveWorktree(worktree.id, 'local')
  const tabs = fresh.unifiedTabsByWorktree[worktree.id] ?? []
  const wanted = TOOL_CONTENT[entry.task.kind]
  const hasTool = tabs.some(
    (tab) =>
      wanted.includes(tab.contentType) &&
      (entry.task.kind !== 'file' || tab.entityId === entry.filePath)
  )
  // Restored tabs win only after a setup that finished; a half-finished one still gets its tool.
  if (hasTool || (readPrepared() && tabs.length > 0)) {
    markPrepared()
    return worktree.id
  }
  fresh.setSidebarOpen(false)
  fresh.setRightSidebarOpen(false)
  if (entry.task.kind === 'terminal') {
    fresh.createTab(worktree.id, groupId)
  } else if (entry.task.kind === 'browser') {
    fresh.createBrowserTab(worktree.id, 'about:blank', {
      title: translate('components.incognito.browserTitle', 'Incognito browser'),
      focusAddressBar: true
    })
  } else if (entry.task.kind === 'agent') {
    const launched = launchAgentInNewTab({
      requestId: newAgentLaunchRequestId(),
      agent: entry.task.agent,
      worktreeId: worktree.id,
      groupId,
      promptDelivery: 'draft'
    })
    if (!launched) {
      throw new Error('The selected agent could not start. Check its setup, then retry.')
    }
  } else if (entry.filePath) {
    fresh.openFile(
      {
        filePath: entry.filePath,
        relativePath: entry.task.fileName ?? 'Untitled.txt',
        worktreeId: worktree.id,
        language: detectLanguage(entry.filePath),
        mode: 'edit'
      },
      { targetGroupId: groupId, focusEditor: true }
    )
  }
  markPrepared()
  return worktree.id
}

function archiveAndLeave(activeId: string): void {
  void window.api.projectWorkspaces
    ?.switch({ fromId: activeId, toId: 'home' })
    .catch((cause: unknown) => toast.error(workspaceErrorMessage(cause)))
}

/** An Incognito task is one tool: closing its last tab archives the task instead of leaving a bare IDE. */
function useArchiveWhenEmpty(worktreeId: string | null, activeId: string | undefined): void {
  const count = useAppStore((state) =>
    worktreeId ? (state.unifiedTabsByWorktree[worktreeId]?.length ?? 0) : 0
  )
  // A ref, not state: whether the task ever held a tab never needs its own render.
  const hadTabs = useRef(false)
  useEffect(() => {
    if (!worktreeId || !activeId) {
      return
    }
    if (count > 0) {
      hadTabs.current = true
    } else if (hadTabs.current) {
      hadTabs.current = false
      archiveAndLeave(activeId)
    }
  }, [count, worktreeId, activeId])
}

export function IncognitoBootstrap(): React.JSX.Element | null {
  const { snapshot } = useProjectWorkspaces()
  const hydrated = useAppStore((state) => state.hydrationSucceeded)
  const [failed, setFailed] = useState(false)
  const [worktreeId, setWorktreeId] = useState<string | null>(null)
  useArchiveWhenEmpty(worktreeId, snapshot?.activeTask ? snapshot.activeId : undefined)
  useEffect(() => {
    if (!hydrated || !snapshot?.activeTask) {
      return
    }
    preparation ??= prepareIncognito()
    let live = true
    void preparation
      .then((id) => live && setWorktreeId(id))
      .catch((error: unknown) => {
        if (live) {
          setFailed(true)
          toast.error(workspaceErrorMessage(error))
        }
      })
      // The task window stays hidden until it holds its tool or a visible retry.
      .finally(acknowledgeWorkspaceArrival)
    return () => {
      live = false
    }
  }, [hydrated, snapshot?.activeTask])
  if (!failed) {
    return null
  }
  return (
    <div className="fixed bottom-10 left-4 z-50 rounded-md border bg-background p-3">
      <Button
        onClick={() => {
          setFailed(false)
          preparation = prepareIncognito()
          void preparation.then(setWorktreeId).catch((error: unknown) => {
            setFailed(true)
            toast.error(workspaceErrorMessage(error))
          })
        }}
      >
        {translate('components.incognito.retry', 'Retry Incognito setup')}
      </Button>
    </div>
  )
}
