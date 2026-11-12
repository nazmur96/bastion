export type EditorContextSelection = {
  startLine: number
  endLine: number
  text: string
  truncated: boolean
}

export type EditorContextDiagnostic = {
  line: number
  severity: 'error' | 'warning'
  message: string
  code?: string
}

export type EditorContextSnapshot = {
  file: string
  language: string
  cursorLine: number
  selection: EditorContextSelection | null
  diagnostics: readonly EditorContextDiagnostic[]
}

/** The subset of a Monaco marker the snapshot reads. */
export type EditorContextMarker = {
  startLineNumber: number
  severity: number
  message: string
  code?: string | { value: string }
}

/** The live state of the last-focused code editor in a worktree. */
export type EditorContextEntry = {
  modelVersion?: number
  ownerId: string
  file: string
  language: string
  cursorLine: number
  selection: { startLine: number; endLine: number; text: string } | null
  readMarkers: () => readonly EditorContextMarker[]
}
