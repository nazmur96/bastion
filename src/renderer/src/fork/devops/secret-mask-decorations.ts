import type { editor } from 'monaco-editor'
import { isSopsEncrypted, secretRanges } from '../../../../shared/fork-secret-mask'

const RECOMPUTE_MS = 250

/**
 * Secret values render as dots, except on the lines the cursor or selection touches,
 * so they can still be edited; SOPS files get a lock note on line 1.
 */
export function installSecretMask(codeEditor: editor.IStandaloneCodeEditor): () => void {
  const decorations = codeEditor.createDecorationsCollection()
  let timer: number | undefined
  const render = (): void => {
    const model = codeEditor.getModel()
    if (!model) {
      decorations.clear()
      return
    }
    const text = model.getValue()
    const selections = codeEditor.getSelections() ?? []
    const revealed = (line: number): boolean =>
      selections.some(
        (selection) => line >= selection.startLineNumber && line <= selection.endLineNumber
      )
    const masks = secretRanges(text)
      .filter((range) => !revealed(range.line))
      .map((range) => ({
        range: {
          startLineNumber: range.line,
          startColumn: range.startColumn,
          endLineNumber: range.line,
          endColumn: range.endColumn
        },
        options: {
          inlineClassName: 'fork-secret-masked',
          hoverMessage: { value: 'Secret masked. Put the cursor on this line to see or edit it.' }
        }
      }))
    const sops = isSopsEncrypted(text)
      ? [
          {
            range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            options: {
              after: { content: '  🔒 SOPS-encrypted', inlineClassName: 'fork-sops-badge' }
            }
          }
        ]
      : []
    decorations.set([...masks, ...sops])
  }
  const schedule = (): void => {
    window.clearTimeout(timer)
    timer = window.setTimeout(render, RECOMPUTE_MS)
  }
  const subscriptions = [
    codeEditor.onDidChangeModel(render),
    codeEditor.onDidChangeModelContent(schedule),
    codeEditor.onDidChangeCursorSelection(render)
  ]
  render()
  return () => {
    window.clearTimeout(timer)
    subscriptions.forEach((subscription) => subscription.dispose())
    decorations.clear()
  }
}
