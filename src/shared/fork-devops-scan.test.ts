import { describe, expect, it } from 'vitest'
import { fixFindingsPrompt, parseTrivyConfig } from './fork-devops-scan'

const report = JSON.stringify({
  Results: [
    {
      Target: 'k8s\\app.yaml',
      Misconfigurations: [
        {
          AVDID: 'AVD-KSV-0012',
          Title: 'Runs as root user',
          Severity: 'MEDIUM',
          Resolution: 'Set runAsNonRoot to true',
          Status: 'FAIL',
          CauseMetadata: { StartLine: 12, EndLine: 20 }
        },
        { AVDID: 'AVD-KSV-0001', Title: 'ok', Severity: 'LOW', Status: 'PASS' }
      ]
    },
    {
      Target: 'Dockerfile',
      Misconfigurations: [
        {
          ID: 'DS002',
          Title: 'Image user should not be root',
          Severity: 'HIGH',
          Status: 'FAIL',
          CauseMetadata: {}
        }
      ]
    },
    { Target: 'go.mod' }
  ]
})

describe('trivy findings', () => {
  it('keeps failures with their lines, worst first, with forward slashes', () => {
    expect(parseTrivyConfig(report)).toEqual([
      {
        file: 'Dockerfile',
        line: 1,
        endLine: 1,
        severity: 'HIGH',
        id: 'DS002',
        title: 'Image user should not be root',
        resolution: ''
      },
      {
        file: 'k8s/app.yaml',
        line: 12,
        endLine: 20,
        severity: 'MEDIUM',
        id: 'AVD-KSV-0012',
        title: 'Runs as root user',
        resolution: 'Set runAsNonRoot to true'
      }
    ])
  })

  it('survives output that is not a report', () => {
    expect(parseTrivyConfig('oops')).toEqual([])
    expect(parseTrivyConfig('{}')).toEqual([])
  })

  it('asks Claude for a minimal, file-scoped fix', () => {
    const prompt = fixFindingsPrompt('k8s/app.yaml', parseTrivyConfig(report).slice(1))
    expect(prompt).toContain(
      'line 12: [MEDIUM] AVD-KSV-0012 Runs as root user (fix: Set runAsNonRoot to true)'
    )
    expect(prompt).toContain('Edit only that file')
  })
})
