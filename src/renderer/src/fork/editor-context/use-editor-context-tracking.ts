import { useEffect } from 'react'
import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { freezeEditorContextEntry, setEditorContextEntry } from './editor-context-store'
import { installAddSelectionToChatShortcut } from './editor-context-add-selection'
import { installInlineEditShortcut } from '../inline-edit/inline-edit-shortcut'
import { installClaudeSuggestShortcut } from '../inline-edit/claude-suggest'
import { installClaudeEditGutter } from '../claude-edits/claude-edit-gutter'
import { installSecretMask } from '../devops/secret-mask-decorations'
import { installScanMarkers } from '../devops/scan-markers'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { maskSecrets } from '../../../../shared/fork-secret-mask'

export function useEditorContextTracking({
  editor: codeEditor,
  worktreeId,
  relativePath,
  language,
  enabled
}: {
  editor: editor.IStandaloneCodeEditor | null
  worktreeId: string | undefined
  relativePath: string
  language: string
  enabled: boolean
}): void {
  useEffect(() => {
    if (!codeEditor || !worktreeId || !enabled) {
      return
    }
    const publish = (): void => {
      const model = codeEditor.getModel()
      const selection = codeEditor.getSelection()
      if (!model || !selection) {
        return
      }
      setEditorContextEntry(worktreeId, {
        ownerId: codeEditor.getId(),
        file: relativePath,
        language,
        cursorLine: selection.positionLineNumber,
        selection: selection.isEmpty()
          ? null
          : {
              startLine: selection.startLineNumber,
              endLine: selection.endLineNumber,
              // A4: secrets never reach Claude, even when selected.
              text: maskSecrets(model.getValueInRange(selection))
            },
        readMarkers: () => monaco.editor.getModelMarkers({ resource: model.uri })
      })
    }
    const subscriptions = [
      codeEditor.onDidFocusEditorText(publish),
      codeEditor.onDidChangeCursorSelection(() => {
        if (codeEditor.hasTextFocus()) {
          publish()
        }
      })
    ]
    if (codeEditor.hasTextFocus()) {
      publish()
    }
    const removeShortcut = installAddSelectionToChatShortcut(
      codeEditor.getContainerDomNode(),
      worktreeId
    )
    const removeInlineEdit = installInlineEditShortcut(codeEditor, {
      worktreeId,
      relativePath,
      language
    })
    const removeSuggest = installClaudeSuggestShortcut(codeEditor, {
      worktreeId,
      relativePath,
      language
    })
    const removeGutter = installClaudeEditGutter(codeEditor, worktreeId, relativePath)
    const removeSecretMask = installSecretMask(codeEditor)
    const repo = selectKnownWorktreeById(useAppStore.getState(), worktreeId)?.path
    const removeScanMarkers = repo ? installScanMarkers(codeEditor, repo, relativePath) : () => {}
    return () => {
      for (const subscription of subscriptions) {
        subscription.dispose()
      }
      removeShortcut()
      removeInlineEdit()
      removeSuggest()
      removeGutter()
      removeSecretMask()
      removeScanMarkers()
      freezeEditorContextEntry(worktreeId, codeEditor.getId())
    }
  }, [codeEditor, worktreeId, relativePath, language, enabled])
}
