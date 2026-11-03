import * as monaco from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { readScanFindings, subscribeScanFindings } from './scan-store'

const OWNER = 'fork-trivy'

/** Trivy findings for this file as Monaco markers: squiggles, hovers and the problems count. */
export function installScanMarkers(
  codeEditor: editor.IStandaloneCodeEditor,
  repo: string,
  relativePath: string
): () => void {
  const file = relativePath.replaceAll('\\', '/')
  const render = (): void => {
    const model = codeEditor.getModel()
    if (!model) {
      return
    }
    const findings = (readScanFindings(repo) ?? []).filter((finding) => finding.file === file)
    monaco.editor.setModelMarkers(
      model,
      OWNER,
      findings.map((finding) => ({
        severity:
          finding.severity === 'CRITICAL' || finding.severity === 'HIGH'
            ? monaco.MarkerSeverity.Error
            : monaco.MarkerSeverity.Warning,
        message: `${finding.title}${finding.resolution ? `\nFix: ${finding.resolution}` : ''}`,
        source: 'Trivy',
        code: finding.id,
        startLineNumber: finding.line,
        startColumn: 1,
        endLineNumber: finding.endLine,
        endColumn: model.getLineMaxColumn(Math.min(finding.endLine, model.getLineCount()))
      }))
    )
  }
  render()
  const unsubscribe = subscribeScanFindings(render)
  const modelChange = codeEditor.onDidChangeModel(render)
  return () => {
    unsubscribe()
    modelChange.dispose()
    const model = codeEditor.getModel()
    if (model) {
      monaco.editor.setModelMarkers(model, OWNER, [])
    }
  }
}
