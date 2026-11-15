import { beforeEach, describe, expect, it, vi } from 'vitest'

type Reply = { stdout?: string; stderr?: string; error?: boolean; killed?: boolean }
const m = vi.hoisted(() => {
  const calls: string[][] = []
  return { replies: new Map<string, Reply>(), calls }
})
vi.mock('node:child_process', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  execFile: (
    _command: string,
    args: string[],
    _options: unknown,
    done: (error: (Error & { killed?: boolean }) | null, stdout: string, stderr: string) => void
  ) => {
    m.calls.push(args)
    const key = args.includes('current-context') ? 'context' : 'events'
    const reply = m.replies.get(key) ?? {}
    const error = reply.error
      ? Object.assign(new Error('kubectl failed'), { killed: reply.killed })
      : null
    done(error, reply.stdout ?? '', reply.stderr ?? '')
  }
}))
vi.mock('./devops-inspect', () => ({
  MISE_FILES: ['mise.toml'],
  resolveTool: async () => ({ tool: 'kubectl', available: true, runner: 'path', prefix: '' }),
  run: async () => ({ ok: true, stdout: '1700000000\tabc123\tdev\tfix: thing\n', stderr: '' })
}))
vi.mock('./devops-context', () => ({ workspaceEnv: async () => ({}) }))

beforeEach(() => {
  m.replies.clear()
  m.calls.length = 0
  vi.stubEnv('KUBECONFIG', '')
})

describe('timeline cluster evidence', () => {
  it('reports denied cluster warnings as unknown, keeping commits', async () => {
    m.replies.set('context', { stdout: 'kind-dev\n' })
    m.replies.set('events', {
      error: true,
      stderr: 'Error from server (Forbidden): events is forbidden: User "dev" cannot list'
    })
    const { readTimeline } = await import('./devops-timeline')
    const timeline = await readTimeline('/work/app')
    expect(timeline.events.map((event) => event.kind)).toEqual(['commit'])
    expect(timeline.cluster).toEqual({
      status: 'denied',
      context: 'kind-dev',
      kubeconfig: 'default',
      runner: 'path'
    })
    // The events read is pinned to the context resolved once at the start.
    expect(m.calls.at(-1)?.slice(0, 2)).toEqual(['--context', 'kind-dev'])
  })
  it('does not read events at all without a current context', async () => {
    m.replies.set('context', { error: true, stderr: 'error: current-context is not set' })
    const { readTimeline } = await import('./devops-timeline')
    const timeline = await readTimeline('/work/app')
    expect(timeline.cluster.status).toBe('no-context')
    expect(m.calls).toHaveLength(1)
  })
  it('marks a read killed by the deadline as a timeout', async () => {
    m.replies.set('context', { stdout: 'kind-dev\n' })
    m.replies.set('events', { error: true, killed: true, stderr: '' })
    const { readTimeline } = await import('./devops-timeline')
    expect((await readTimeline('/work/app')).cluster.status).toBe('timeout')
  })
})
