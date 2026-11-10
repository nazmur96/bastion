import { describe, expect, it } from 'vitest'
import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'
import {
  isRuntimeAssistanceDismissed,
  runtimeAssistanceForFile,
  runtimeAssistanceKey,
  setRuntimeAssistanceDismissed
} from './editor-runtime-assistance'

const missing: DevopsInspection = {
  findings: [],
  environment: 'mise',
  shell: 'posix',
  tools: { terraform: { tool: 'terraform', available: false, hint: 'Review runtime' } }
}

describe('evidence-based editor assistance', () => {
  it('distinguishes a missing CLI from an uninspected tool', () => {
    expect(runtimeAssistanceForFile('infra/main.tf', missing)).toEqual({
      tool: 'terraform',
      available: false
    })
    expect(runtimeAssistanceForFile('infra/main.tf', null)).toBeNull()
    expect(runtimeAssistanceForFile('infra/main.tf', { ...missing, tools: {} })).toBeNull()
  })

  it('uses a positive CLI lookup without claiming language-server support', () => {
    const available: DevopsInspection = {
      ...missing,
      tools: {
        terraform: { tool: 'terraform', available: true, runner: 'path', prefix: '' }
      }
    }
    expect(runtimeAssistanceForFile('C:\\project\\main.TF', available)).toEqual({
      tool: 'terraform',
      available: true
    })
    expect(runtimeAssistanceForFile('main.py', available)).toBeNull()
  })

  it('keeps dismissal specific to the workspace, file and inspected capability', () => {
    const missingTool = { tool: 'terraform' as const, available: false }
    const key = runtimeAssistanceKey('folder:a', 'main.tf', missingTool)
    setRuntimeAssistanceDismissed(key, true)
    expect(isRuntimeAssistanceDismissed(key)).toBe(true)
    expect(
      isRuntimeAssistanceDismissed(runtimeAssistanceKey('folder:b', 'main.tf', missingTool))
    ).toBe(false)
    expect(
      isRuntimeAssistanceDismissed(runtimeAssistanceKey('folder:a', 'other.tf', missingTool))
    ).toBe(false)
    expect(
      isRuntimeAssistanceDismissed(
        runtimeAssistanceKey('folder:a', 'main.tf', { ...missingTool, available: true })
      )
    ).toBe(false)
    setRuntimeAssistanceDismissed(key, false)
    expect(isRuntimeAssistanceDismissed(key)).toBe(false)
  })
})
