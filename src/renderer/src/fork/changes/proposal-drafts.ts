const drafts = new Map<string, string>()
const key = (projectId: string, name: string): string => JSON.stringify([projectId, name])
export function proposalDraft(projectId: string, name: string): string | undefined {
  return drafts.get(key(projectId, name))
}
export function retainProposalDraft(projectId: string, name: string, content: string): void {
  if (content.length > 65536) {
    return
  }
  const id = key(projectId, name)
  drafts.delete(id)
  drafts.set(id, content)
  if (drafts.size > 16) {
    const oldest = drafts.keys().next().value
    if (oldest) {
      drafts.delete(oldest)
    }
  }
}
