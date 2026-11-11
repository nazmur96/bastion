import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { translate } from '@/i18n/i18n'
import { useProjectWorkspaces } from './use-project-workspaces'
import { Button } from '@/components/ui/button'

let preparation: Promise<void> | null = null
async function prepareIncognito(): Promise<void> {
  const entry = await window.api.projectWorkspaces?.incognito?.prepare()
  if (!entry) {
    return
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
  const hasTabs = (fresh.unifiedTabsByWorktree[worktree.id]?.length ?? 0) > 0
  fresh.setActiveWorktree(worktree.id, 'local')
  if (hasTabs) {
    return
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
}

export function IncognitoBootstrap(): React.JSX.Element | null {
  const { snapshot } = useProjectWorkspaces()
  const hydrated = useAppStore((state) => state.hydrationSucceeded)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!hydrated || !snapshot?.activeTask) {
      return
    }
    preparation ??= prepareIncognito()
    let live = true
    void preparation.catch((error: unknown) => {
      if (live) {
        setFailed(true)
        toast.error(error instanceof Error ? error.message : String(error))
      }
    })
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
          preparation = null
          setFailed(false)
          void prepareIncognito().catch((error) => {
            setFailed(true)
            toast.error(String(error))
          })
        }}
      >
        {translate('components.incognito.retry', 'Retry Incognito setup')}
      </Button>
    </div>
  )
}
