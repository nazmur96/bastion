import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { detectLanguage } from '@/lib/language-detect'
import { scheduleEditorLineReveal } from '@/store/slices/editor/focus/editor-focus-reveal'
import { joinPath } from '@/lib/path'

/** Map node → the manifest that defines it, opened at its `kind:` line. */
export async function openManifest(worktreeId: string, kind: string, name: string): Promise<void> {
  const root = selectKnownWorktreeById(useAppStore.getState(), worktreeId)?.path
  if (!root) {
    return
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
    return
  }
  const filePath = joinPath(root, found.path)
  const store = useAppStore.getState()
  const fileId = store.openFile({
    filePath,
    relativePath: found.path,
    worktreeId,
    language: detectLanguage(filePath),
    mode: 'edit'
  })
  scheduleEditorLineReveal(useAppStore.getState, filePath, found.line, 1, fileId)
}
