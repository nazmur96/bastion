import { flociProduct, type FlociProvider } from '../../../shared/fork-cloud/floci-products'
import { z } from 'zod'
import { request } from 'node:http'

// The pinned image probes /_floci/init; require ready=true rather than its timed fallback.
export function flociHealthy(port: number, provider: FlociProvider = 'aws'): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        hostname: '127.0.0.1',
        port,
        path: flociProduct(provider).readyPath,
        method: 'GET',
        agent: false
      },
      (res) => {
        let size = 0,
          body = ''
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 65536) {
            req.destroy()
          } else {
            body += chunk.toString('utf8')
          }
        })
        res.on('end', () => {
          try {
            const value: unknown = JSON.parse(body)
            resolve(
              res.statusCode === 200 &&
                (flociProduct(provider).readyKind === 'status-up'
                  ? z.object({ status: z.literal('UP') })
                  : z.object({ completed: z.object({ ready: z.literal(true) }) })
                ).safeParse(value).success
            )
          } catch {
            resolve(false)
          }
        })
        res.on('error', () => resolve(false))
      }
    )
    req.setTimeout(2000, () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}
