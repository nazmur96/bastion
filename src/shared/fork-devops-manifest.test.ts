import { describe, expect, it } from 'vitest'
import { manifestLine } from './fork-devops-manifest'

describe('manifestLine', () => {
  const yaml = [
    'apiVersion: v1',
    'kind: Service',
    'metadata:',
    '  name: web',
    '---',
    'apiVersion: apps/v1',
    'kind: Deployment',
    'metadata:',
    '  name: "web" # app',
    'spec:',
    '  template:',
    '    metadata:',
    '      name: other'
  ].join('\n')

  it('finds the document by kind and metadata name', () => {
    expect(manifestLine(yaml, 'Deployment', 'web')).toBe(7)
    expect(manifestLine(yaml, 'Service', 'web')).toBe(2)
  })

  it('ignores nested names and other kinds', () => {
    expect(manifestLine(yaml, 'Deployment', 'other')).toBeNull()
    expect(manifestLine(yaml, 'ConfigMap', 'web')).toBeNull()
  })
})
