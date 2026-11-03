/** Fork, project path step 4: where the project is, computed from what is real. */
export type PathStageId = 'understand' | 'cluster' | 'app' | 'gitops' | 'harden' | 'cloud' | 'ship'

export type PathStageState = 'done' | 'next' | 'todo' | 'coming'

export type PathStage = { id: PathStageId; state: PathStageState }

export const PATH_STAGES: readonly PathStageId[] = [
  'understand',
  'cluster',
  'app',
  'gitops',
  'harden',
  'cloud',
  'ship'
]

export type PathFacts = {
  understood: boolean
  /** The current context is a local cluster whose API answers. */
  localCluster: boolean
  /** The map shows workloads in the app's namespace. */
  appRunning: boolean
  /** An Argo CD Application for this repo exists. */
  gitops: boolean
  hardened: boolean
  /** The platform's outputs name an EKS cluster. */
  cloud: boolean
  /** This repo's Argo CD Application exists on a real (non-local) cluster. */
  shipped: boolean
}

/** The fact that marks each stage done; null for stages not built yet (shown, never clickable). */
const DONE: Record<PathStageId, keyof PathFacts | null> = {
  understand: 'understood',
  cluster: 'localCluster',
  app: 'appRunning',
  gitops: 'gitops',
  harden: 'hardened',
  cloud: 'cloud',
  ship: 'shipped'
}

/** The first stage that is not done (and is built) is next; later ones wait. */
export function pathStages(facts: PathFacts): PathStage[] {
  let nextGiven = false
  return PATH_STAGES.map((id) => {
    const key = DONE[id]
    if (key === null) {
      return { id, state: 'coming' as const }
    }
    if (facts[key]) {
      return { id, state: 'done' as const }
    }
    if (!nextGiven) {
      nextGiven = true
      return { id, state: 'next' as const }
    }
    return { id, state: 'todo' as const }
  })
}
