import { run } from './devops-inspect'
import { kubectlCurrentContext, kubectlIn } from './devops-kubectl'
import {
  parseGitLog,
  parsePullRequest,
  parseWarningEvents,
  type PullRequest,
  type Timeline
} from '../../../shared/fork-devops-timeline'

/**
 * Recent commits and cluster warnings, read-only. A cluster that does not answer is reported as
 * unknown with the context and kubeconfig it would have used; it never reads as "no warnings".
 */
export async function readTimeline(workspacePath: string): Promise<Timeline> {
  const [log, pinned] = await Promise.all([
    run('git', ['log', '-n', '40', '--format=%ct%x09%h%x09%an%x09%s'], workspacePath),
    kubectlCurrentContext(workspacePath)
  ])
  const commits = log.ok ? parseGitLog(log.stdout) : []
  if (!pinned.context) {
    return { events: commits, cluster: pinned.evidence }
  }
  const events = await kubectlIn(
    workspacePath,
    [
      '--context',
      pinned.context,
      'get',
      'events',
      '--all-namespaces',
      '-o',
      'json',
      '--request-timeout=8s'
    ],
    15_000
  )
  return {
    events: [...commits, ...(events.ok ? parseWarningEvents(events.out) : [])],
    cluster: { ...pinned.evidence, status: events.code }
  }
}

/** This branch's pull request via gh, or null (no gh, not signed in, or no PR). */
export async function readPullRequest(workspacePath: string): Promise<PullRequest | null> {
  const result = await run(
    'gh',
    ['pr', 'view', '--json', 'number,title,url,state,reviewDecision,statusCheckRollup'],
    workspacePath,
    15_000
  )
  return result.ok ? parsePullRequest(result.stdout) : null
}
