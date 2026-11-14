import { createServer } from 'node:net'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
export function availableFlociPort(requested?: number): Promise<number> {
  const server = createServer()
  return new Promise((resolve, reject) => {
    server.once('error', () => reject(new FlociFailure('port-conflict')))
    server.listen(requested ?? 0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address
          ? resolve(address.port)
          : reject(new FlociFailure('port-conflict'))
      )
    })
  })
}
