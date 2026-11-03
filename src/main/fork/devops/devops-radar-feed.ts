import { devopsRadarMcpFor } from './devops-radar'
import {
  parseMcpResponse,
  pickFindingsTool,
  toolText,
  type RadarFindings
} from '../../../shared/fork-devops-radar-feed'

const MCP_TIMEOUT_MS = 20_000

async function post(
  url: string,
  body: object,
  session: string | null
): Promise<{ text: string; session: string | null }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {})
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS)
  })
  return { text: await response.text(), session: response.headers.get('mcp-session-id') ?? session }
}

/** Asks the workspace's running Radar (read-only MCP) for its findings; nothing is changed. */
export async function readRadarFindings(workspacePath: string): Promise<RadarFindings> {
  const url = devopsRadarMcpFor(workspacePath)
  if (!url) {
    return {
      ok: false,
      error: 'Radar is not running for this workspace. Start it from the cluster card.'
    }
  }
  try {
    const init = await post(
      url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'bastion', version: '1' }
        }
      },
      null
    )
    await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session)
    const listed = parseMcpResponse(
      (await post(url, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.session)).text
    )
    const tools: unknown =
      listed && typeof listed === 'object'
        ? Reflect.get(Reflect.get(listed, 'result') ?? {}, 'tools')
        : null
    const names = Array.isArray(tools)
      ? tools
          .map((tool) =>
            tool && typeof tool === 'object' ? String(Reflect.get(tool, 'name')) : ''
          )
          .filter(Boolean)
      : []
    const tool = pickFindingsTool(names)
    if (!tool) {
      return { ok: false, error: `Radar offers no issues tool (${names.length} tools).` }
    }
    const called = parseMcpResponse(
      (
        await post(
          url,
          { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: {} } },
          init.session
        )
      ).text
    )
    const text = toolText(called)
    return text === null
      ? { ok: false, error: `${tool} returned nothing readable.` }
      : { ok: true, tool, text }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
