import { describe, expect, it } from 'vitest'
import { terminalAgentDraft, terminalExcerpt } from './fork-terminal-excerpt'

describe('a bounded, redacted terminal excerpt for an agent draft', () => {
  it('redacts common secrets before anything leaves the terminal', () => {
    const text = [
      'export AWS_ACCESS_KEY_ID=AKIAABCDEFGHIJKLMNOP',
      'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF123_-x',
      'DB_PASSWORD=hunter2 token: ghp_0123456789abcdefghijABCDEFGHIJ012345',
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQEA',
      '-----END RSA PRIVATE KEY-----',
      'Error: connection refused'
    ].join('\n')
    const excerpt = terminalExcerpt(text)
    for (const secret of [
      'AKIAABCDEFGHIJKLMNOP',
      'wJalrXUtnFEMI',
      'eyJhbGciOiJIUzI1NiJ9',
      'hunter2',
      'ghp_0123456789',
      'MIIEowIBAAKCAQEA'
    ]) {
      expect(excerpt.text).not.toContain(secret)
    }
    expect(excerpt.text).toContain('Error: connection refused')
    expect(excerpt.redactions).toBeGreaterThanOrEqual(6)
  })
  it('strips terminal colour codes and keeps the last lines that fit', () => {
    const lines = Array.from({ length: 400 }, (_, index) => `\u001b[31mline ${index}\u001b[0m`)
    const excerpt = terminalExcerpt(lines.join('\n'), 300)
    expect(excerpt.text).not.toContain('\u001b')
    expect(excerpt.text.endsWith('line 399')).toBe(true)
    expect(excerpt.text.length).toBeLessThanOrEqual(300)
    expect(excerpt.omittedLines).toBeGreaterThan(0)
    expect(excerpt.text.startsWith('line ')).toBe(true)
  })
  it('builds a draft that asks for a diagnosis and says nothing was run', () => {
    const draft = terminalAgentDraft(terminalExcerpt('npm ERR! missing script: build'))
    expect(draft).toContain('npm ERR! missing script: build')
    expect(draft).toMatch(/do not run/i)
    expect(draft.length).toBeLessThanOrEqual(2400)
  })
  it('reports an empty selection as nothing to send', () => {
    expect(terminalExcerpt('   \n  ').text).toBe('')
  })
})
