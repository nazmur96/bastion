import { describe, expect, it } from 'vitest'
import { parseMcpResponse, pickFindingsTool, toolText } from './fork-devops-radar-feed'

describe('radar feed', () => {
  it('reads JSON and SSE MCP responses', () => {
    expect(parseMcpResponse('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true }
    })
    expect(
      parseMcpResponse('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"x":1}}\n\n')
    ).toMatchObject({ id: 2 })
    expect(parseMcpResponse('nope')).toBeNull()
  })

  it('picks the issues tool first', () => {
    expect(pickFindingsTool(['get_topology', 'list_issues', 'diagnose'])).toBe('list_issues')
    expect(pickFindingsTool(['get_topology', 'diagnose_pod'])).toBe('diagnose_pod')
    expect(pickFindingsTool(['logs'])).toBeNull()
  })

  it('joins the text parts of a tool result', () => {
    expect(
      toolText({
        result: {
          content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }]
        }
      })
    ).toBe('a\nb')
    expect(toolText({ error: {} })).toBeNull()
  })
})
