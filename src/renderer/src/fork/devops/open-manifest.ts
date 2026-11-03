import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { joinPath } from '@/lib/path'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'

type Found = { root: string; path: string; line: number; kustomize: string | null }

async function locate(worktreeId: string, kind: string, name: string): Promise<Found | null> {
  const root = selectKnownWorktreeById(useAppStore.getState(), worktreeId)?.path
  if (!root) {
    return null
  }
  const found = await window.api.aiVault.findManifest({ workspacePath: root, kind, name })
  if (!found) {
    toast.info(
      translate(
        'components.devops.map.noSource',
        '{{kind}} {{name}} is not defined in this repo. It came from a Helm chart, another repo, or kubectl by hand.',
        { kind, name }
      )
    )
    return null
  }
  return { root, ...found }
}

/** A repo file in the editor at a line (scan findings, manifests). */
export function openWorkspaceFile(worktreeId: string, relativePath: string, line: number): void {
  const root = selectKnownWorktreeById(useAppStore.getState(), worktreeId)?.path
  if (!root) {
    return
  }
  const filePath = joinPath(root, relativePath)
  const fileId = useAppStore.getState().openFile({
    filePath,
    relativePath,
    worktreeId,
    language: detectLanguage(filePath),
    mode: 'edit'
  })
  scheduleEditorLineReveal(useAppStore.getState, filePath, line, 1, fileId)
}

/** Map node → the manifest that defines it, opened at its `kind:` line. */
export async function openManifest(worktreeId: string, kind: string, name: string): Promise<void> {
  const found = await locate(worktreeId, kind, name)
  if (found) {
    openWorkspaceFile(worktreeId, found.path, found.line)
  }
}

/** B2: what differs between the repo and the cluster, via `kubectl diff` (read-only, server-side dry run). */
export async function diffManifest(
  worktreeId: string,
  kind: string,
  name: string,
  kubectlPrefix: string
): Promise<void> {
  const found = await locate(worktreeId, kind, name)
  if (!found) {
    return
  }
  const target = found.kustomize !== null ? `-k "${found.kustomize}"` : `-f "${found.path}"`
  runInWorkbenchTerminal(
    worktreeId,
    `${kubectlPrefix}kubectl diff ${target} && echo "No drift: the cluster matches ${found.kustomize ?? found.path}"`
  )
}
