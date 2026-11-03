import { createServer } from 'node:net'

function canListen(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRNOTAVAIL'))
    server.listen(port, host, () => server.close(() => resolve(true)))
  })
}

/**
 * The first port from `start` that is free on both loopbacks, because kubectl port-forward
 * binds 127.0.0.1 and ::1 and fails if either is taken (a host without IPv6 counts as free).
 */
export async function freeLocalPort(start: number): Promise<number> {
  for (let port = start; port < start + 200; port += 1) {
    if ((await canListen(port, '127.0.0.1')) && (await canListen(port, '::1'))) {
      return port
    }
  }
  return start
}
