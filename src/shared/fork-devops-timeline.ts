/** Fork: Release flight, Time machine and Incident mode, from git, gh and cluster events. */
export type TimelineEvent = {
  /** Unix ms. */
  at: number
  kind: 'commit' | 'warning'
  title: string
  detail: string
  /** Commit hash, or `Kind/namespace/name` of the object the event is about. */
  ref: string
}

export type PullRequest = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  reviewDecision: string
  checks: { passed: number; failed: number; pending: number }
}

export type StageState = 'done' | 'now' | 'waiting' | 'failed'
export type FlightStage = {
  id: 'review' | 'ci' | 'merged' | 'deployed' | 'shipped'
  state: StageState
  detail: string
}

function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

/** `git log --format=%ct%x09%h%x09%an%x09%s` lines → commit events. */
export function parseGitLog(stdout: string): TimelineEvent[] {
  return stdout.split('\n').flatMap((line): TimelineEvent[] => {
    const [time, hash, author, ...subject] = line.split('\t')
    const seconds = Number(time)
    return hash && Number.isFinite(seconds)
      ? [
          {
            at: seconds * 1000,
            kind: 'commit',
            title: subject.join('\t'),
            detail: author ?? '',
            ref: hash
          }
        ]
      : []
  })
}

/** Warning events from `kubectl get events -A -o json`, newest timestamp available on each. */
export function parseWarningEvents(json: string): TimelineEvent[] {
  let items: unknown
  try {
    items = at(JSON.parse(json), 'items')
  } catch {
    return []
  }
  return (Array.isArray(items) ? items : []).flatMap((item): TimelineEvent[] => {
    if (at(item, 'type') !== 'Warning') {
      return []
    }
    const stamp =
      at(item, 'lastTimestamp') ??
      at(item, 'eventTime') ??
      at(item, 'metadata', 'creationTimestamp')
    const ms = typeof stamp === 'string' ? Date.parse(stamp) : Number.NaN
    const kind = at(item, 'involvedObject', 'kind')
    const name = at(item, 'involvedObject', 'name')
    const namespace = at(item, 'involvedObject', 'namespace') ?? at(item, 'metadata', 'namespace')
    if (!Number.isFinite(ms) || typeof kind !== 'string' || typeof name !== 'string') {
      return []
    }
    return [
      {
        at: ms,
        kind: 'warning',
        title: `${String(at(item, 'reason') ?? 'Warning')} · ${kind}/${name}`,
        detail: String(at(item, 'message') ?? '').slice(0, 300),
        ref: `${kind}/${String(namespace ?? '')}/${name}`
      }
    ]
  })
}

/** Newest first, within the last `hours`. */
export function timelineWindow(
  events: readonly TimelineEvent[],
  now: number,
  hours: number
): TimelineEvent[] {
  const since = now - hours * 3_600_000
  return events.filter((event) => event.at >= since).toSorted((a, b) => b.at - a.at)
}

/** Events about a workload or its pods (`web` matches Pod/ns/web-7d9f…). */
export function eventsFor(
  events: readonly TimelineEvent[],
  namespace: string,
  name: string
): TimelineEvent[] {
  return events.filter((event) => {
    const [, ns, objectName] = event.ref.split('/')
    return (
      event.kind === 'warning' &&
      ns === namespace &&
      (objectName === name || objectName?.startsWith(`${name}-`))
    )
  })
}

/** `gh pr view --json number,title,url,state,reviewDecision,statusCheckRollup` → the PR, or null. */
export function parsePullRequest(json: string): PullRequest | null {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  const number = at(value, 'number')
  const state = at(value, 'state')
  if (
    typeof number !== 'number' ||
    (state !== 'OPEN' && state !== 'MERGED' && state !== 'CLOSED')
  ) {
    return null
  }
  const rollup = at(value, 'statusCheckRollup')
  const checks = { passed: 0, failed: 0, pending: 0 }
  for (const check of Array.isArray(rollup) ? rollup : []) {
    const result = String(at(check, 'conclusion') ?? at(check, 'state') ?? '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(result)) {
      checks.passed += 1
    } else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(result)) {
      checks.failed += 1
    } else {
      checks.pending += 1
    }
  }
  return {
    number,
    title: String(at(value, 'title') ?? ''),
    url: String(at(value, 'url') ?? ''),
    state,
    reviewDecision: String(at(value, 'reviewDecision') ?? ''),
    checks
  }
}

/** Where this branch's change is on its way to production. */
export function flightStages(
  pr: PullRequest | null,
  deployed: boolean,
  shipped: boolean
): FlightStage[] {
  const merged = pr?.state === 'MERGED'
  const review: StageState = !pr
    ? 'waiting'
    : merged || pr.reviewDecision === 'APPROVED'
      ? 'done'
      : pr.reviewDecision === 'CHANGES_REQUESTED'
        ? 'failed'
        : 'now'
  const ci: StageState = !pr
    ? 'waiting'
    : pr.checks.failed > 0
      ? 'failed'
      : pr.checks.pending > 0
        ? 'now'
        : 'done'
  return [
    {
      id: 'review',
      state: review,
      detail: pr ? `#${pr.number} ${pr.reviewDecision || 'no review yet'}` : 'no pull request'
    },
    {
      id: 'ci',
      state: ci,
      detail: pr
        ? `${pr.checks.passed} passed · ${pr.checks.failed} failed · ${pr.checks.pending} running`
        : ''
    },
    {
      id: 'merged',
      state: merged
        ? 'done'
        : pr?.state === 'CLOSED'
          ? 'failed'
          : review === 'done' && ci === 'done'
            ? 'now'
            : 'waiting',
      detail: pr?.state ?? ''
    },
    {
      id: 'deployed',
      state: deployed ? 'done' : merged ? 'now' : 'waiting',
      detail: deployed ? 'Argo CD synced (local)' : ''
    },
    {
      id: 'shipped',
      state: shipped ? 'done' : deployed ? 'now' : 'waiting',
      detail: shipped ? 'on the cloud cluster' : ''
    }
  ]
}
