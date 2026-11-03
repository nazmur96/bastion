import { run } from './devops-inspect'
import { kubectlIn } from './devops-kubectl'
import {
  parseGitLog,
  parsePullRequest,
  parseWarningEvents,
  type PullRequest,
  type TimelineEvent
} from '../../../shared/fork-devops-timeline'

/** Recent commits and cluster warnings, read-only; a cluster that does not answer just adds none. */
export async function readTimeline(workspacePath: string): Promise<TimelineEvent[]> {
  const [log, events] = await Promise.all([
    run('git', ['log', '-n', '40', '--format=%ct%x09%h%x09%an%x09%s'], workspacePath),
    kubectlIn(
      workspacePath,
      ['get', 'events', '--all-namespaces', '-o', 'json', '--request-timeout=8s'],
      15_000
    )
  ])
  return [
    ...(log.ok ? parseGitLog(log.stdout) : []),
    ...(events.ok ? parseWarningEvents(events.out) : [])
  ]
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
