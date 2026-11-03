import { spawn, type ChildProcess } from 'node:child_process'
import type { WebContents } from 'electron'
import { workspaceEnv } from './devops-context'
import { devopsSandboxEnvFor } from './devops-sandbox'
import type { StepsEvent, StepsRequest } from '../../../shared/fork-devops-steps'

const STEP_TIMEOUT_MS = 30 * 60_000
const running = new Map<string, { child: ChildProcess | null; cancelled: boolean }>()

/**
 * Runs the steps in order through the platform shell (sh, or cmd on Windows), with the
 * repo's mise env and Floci's env, streaming each step's state and output. The first
 * failure stops the run; cancel kills the current step.
 */
export async function runSteps(sender: WebContents, request: StepsRequest): Promise<void> {
  const send = (event: StepsEvent): void => {
    if (!sender.isDestroyed()) {
      sender.send('aiVault:stepsEvent', event)
    }
  }
  const run: { child: ChildProcess | null; cancelled: boolean } = { child: null, cancelled: false }
  running.set(request.runId, run)
  const env = {
    ...process.env,
    ...(await workspaceEnv(request.workspacePath)),
    ...devopsSandboxEnvFor(request.workspacePath),
    ...request.env
  }
  let ok = true
  for (const [index, step] of request.steps.entries()) {
    if (run.cancelled) {
      send({ runId: request.runId, kind: 'step', index, state: 'cancelled' })
      ok = false
      continue
    }
    if (!ok) {
      send({ runId: request.runId, kind: 'step', index, state: 'cancelled' })
      continue
    }
    send({ runId: request.runId, kind: 'step', index, state: 'running' })
    const code = await new Promise<number>((resolve) => {
      const child = spawn(step, {
        cwd: request.workspacePath,
        env,
        shell: true,
        timeout: STEP_TIMEOUT_MS
      })
      run.child = child
      const forward = (chunk: Buffer): void =>
        send({ runId: request.runId, kind: 'output', index, text: chunk.toString() })
      child.stdout?.on('data', forward)
      child.stderr?.on('data', forward)
      child.on('error', (error) => {
        forward(Buffer.from(`${error.message}\n`))
        resolve(1)
      })
      child.on('close', (exit) => resolve(exit ?? 1))
    })
    ok = code === 0 && !run.cancelled
    send({
      runId: request.runId,
      kind: 'step',
      index,
      state: run.cancelled ? 'cancelled' : ok ? 'done' : 'failed'
    })
  }
  running.delete(request.runId)
  send({ runId: request.runId, kind: 'finished', ok })
}

export function cancelSteps(runId: string): void {
  const run = running.get(runId)
  if (run) {
    run.cancelled = true
    run.child?.kill()
  }
}
