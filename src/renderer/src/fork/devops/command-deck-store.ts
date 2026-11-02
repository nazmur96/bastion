import { useEffect, useSyncExternalStore } from 'react'

/** One thing the `:` deck can do; `keywords` widen the fuzzy match (kubectl verbs, tool names). */
export type DeckCommand = {
  id: string
  group: string
  label: string
  hint?: string
  keywords?: string[]
  run: () => void
}

const sources = new Map<string, DeckCommand[]>()
const listeners = new Set<() => void>()
let snapshot: DeckCommand[] = []

function publish(): void {
  snapshot = [...sources.values()].flat()
  listeners.forEach((listener) => listener())
}

/** A component offers its commands while mounted; the latest list replaces the previous one. */
export function useDeckCommands(source: string, commands: DeckCommand[]): void {
  useEffect(() => {
    sources.set(source, commands)
    publish()
  }, [source, commands])
  useEffect(
    () => () => {
      sources.delete(source)
      publish()
    },
    [source]
  )
}

export function useAllDeckCommands(): DeckCommand[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => snapshot
  )
}
