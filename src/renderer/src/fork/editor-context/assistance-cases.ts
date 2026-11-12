import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'
import type { DiscoverySnapshot } from '../discovery/service-knowledge'
import { runtimeAssistanceForFile, type RuntimeAssistance } from './editor-runtime-assistance'

export type AssistanceInput<T> = { current: boolean; revision: string; value: T }
export type AssistanceInputs<Sources extends object> = {
  [Key in keyof Sources]?: AssistanceInput<Sources[Key]>
}
export type AssistanceCase<Sources extends object, Output> = {
  id: string
  inputs: readonly (keyof Sources & string)[]
  evaluate: (inputs: AssistanceInputs<Sources>) => Output | null
}

/** Sources are supplied by their existing owners; cases never fetch or execute anything. */
export function firstCurrentAssistanceCase<Sources extends object, Output>(
  cases: readonly AssistanceCase<Sources, Output>[],
  inputs: AssistanceInputs<Sources>
): { caseId: string; inputSignature: string; suggestion: Output } | null {
  for (const candidate of cases) {
    if (candidate.inputs.some((name) => !inputs[name]?.current)) {
      continue
    }
    const declared: AssistanceInputs<Sources> = {}
    for (const name of candidate.inputs) {
      declared[name] = inputs[name]
    }
    const suggestion = candidate.evaluate(declared)
    if (suggestion !== null) {
      return {
        caseId: candidate.id,
        inputSignature: JSON.stringify([
          candidate.id,
          ...candidate.inputs.map((name) => [name, inputs[name]?.revision])
        ]),
        suggestion
      }
    }
  }
  return null
}

export type EditorAssistanceSources = {
  editor: { file: string; errors: number; warnings: number }
  discovery: DiscoverySnapshot
  runtime: { inspection: DevopsInspection | null }
}

export const EDITOR_ASSISTANCE_CASES: readonly AssistanceCase<
  EditorAssistanceSources,
  RuntimeAssistance
>[] = [
  {
    id: 'runtime-tooling',
    inputs: ['editor', 'discovery', 'runtime'],
    evaluate: (inputs) => {
      const editor = inputs.editor?.value
      const snapshot = inputs.discovery?.value
      const runtime = inputs.runtime?.value
      if (!editor || !snapshot || !runtime) {
        return null
      }
      const direct = runtimeAssistanceForFile(editor.file, runtime.inspection, true)
      if (direct) {
        return direct
      }
      const kubernetes = snapshot.findings.some(
        (finding) =>
          finding.stack === 'kubernetes' &&
          (finding.evidence.includes(editor.file) ||
            finding.dirs.some((dir) =>
              dir !== '.' ? editor.file.startsWith(`${dir}/`) : /\.ya?ml$/i.test(editor.file)
            ))
      )
      return kubernetes
        ? { tool: 'kubectl', available: runtime.inspection?.tools.kubectl?.available ?? null }
        : null
    }
  },
  {
    id: 'editor-diagnostics',
    inputs: ['editor', 'discovery'],
    evaluate: (inputs) => (inputs.editor?.value.errors ? { tool: 'editor', available: null } : null)
  },
  {
    id: 'explicit-file-review',
    inputs: ['editor', 'discovery'],
    evaluate: () => ({ tool: 'editor', available: null })
  }
]
