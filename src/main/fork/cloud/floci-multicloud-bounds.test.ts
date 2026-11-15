import { createServer, type RequestListener } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { flociHttp, listFlociResources, type FlociHttp } from './floci-resources'
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0)) {
    await close()
  }
})
async function server(handler: RequestListener) {
  const listener = createServer(handler)
  await new Promise<void>((resolve) => listener.listen(0, '127.0.0.1', resolve))
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        listener.closeAllConnections()
        listener.close(() => resolve())
      })
  )
  const address = listener.address()
  if (!address || typeof address === 'string') {
    throw new Error('Missing listener')
  }
  return address.port
}
describe('MC-04 fixed transport and provider pagination bounds', () => {
  it('encodes OCI header tokens, stops repeats and ignores response endpoints', async () => {
    const calls: string[] = []
    const http: FlociHttp = async (_port, request) => {
      calls.push(request.path)
      return {
        status: 200,
        body: request.path.startsWith('/n/')
          ? '[{"name":"fixture","namespace":"floci-local","endpoint":"https://invalid.example"}]'
          : '[]',
        headers: { 'opc-next-page': 'same&query=changed' }
      }
    }
    const result = await listFlociResources(14888, http, () => 0, { provider: 'oci' })
    expect(calls).toHaveLength(4)
    expect(calls.filter((path) => path.includes('&page=same%26query%3Dchanged'))).toHaveLength(2)
    expect(result.results.every((r) => r.truncated)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('invalid.example')
  })
  it('caps each service at three pages and 500 items even on a final unpaginated page', async () => {
    let pages = 0
    const http: FlociHttp = async (_port, request) => ({
      status: 200,
      body: JSON.stringify(
        request.path.startsWith('/storage/')
          ? { items: Array.from({ length: 501 }, (_, i) => ({ name: `bucket-${i}` })) }
          : { topics: [], nextPageToken: String(++pages) }
      )
    })
    const result = await listFlociResources(14888, http, () => 0, { provider: 'gcp' })
    expect(result.results[0].items).toHaveLength(500)
    expect(result.results.every((r) => r.truncated)).toBe(true)
    expect(pages).toBe(3)
  })
  it('refuses XML entities and unknown providers without AWS fallback', async () => {
    const result = await listFlociResources(
      14888,
      async () => ({
        status: 200,
        body: '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///not-read">]><EnumerationResults><Containers /></EnumerationResults>'
      }),
      Date.now,
      { provider: 'azure' }
    )
    expect(result.results[0].status).toBe('invalid')
    let calls = 0
    await expect(
      Reflect.apply(listFlociResources, undefined, [
        14888,
        async () => {
          calls++
        },
        Date.now,
        { provider: 'unknown' }
      ])
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
  it('uses a literal loopback socket, refuses redirects and caps bytes', async () => {
    let redirects = 0
    const port = await server((req, res) => {
      if (req.url === '/redirect') {
        redirects++
        res.writeHead(302, { Location: '/must-not-follow' })
        res.end()
      } else {
        res.end('x'.repeat(1024 * 1024 + 1))
      }
    })
    const redirected = await flociHttp(
      port,
      { method: 'GET', path: '/redirect', headers: {} },
      1000
    )
    expect(redirected.status).toBe(302)
    expect(redirects).toBe(1)
    await expect(
      flociHttp(port, { method: 'GET', path: '/large', headers: {} }, 1000)
    ).rejects.toThrow()
  })
  it('enforces a wall-clock request deadline even while a server keeps streaming', async () => {
    const port = await server((_req, res) => {
      const timer = setInterval(() => res.write(' '), 5)
      res.once('close', () => clearInterval(timer))
    })
    await expect(
      flociHttp(port, { method: 'GET', path: '/', headers: {} }, 50)
    ).rejects.toMatchObject({ status: 'timeout' })
  })
})
