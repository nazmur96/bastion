/** Fork: runbooks with runnable blocks, and a checklist tracker, both plain Markdown in the repo. */
export type RunbookBlock = { heading: string; lang: string; code: string }
export type Runbook = { file: string; title: string; blocks: RunbookBlock[] }
export type TrackerItem = { line: number; text: string; checked: boolean; section: string }
export type RepoDocs = {
  runbooks: Runbook[]
  tracker: { file: string; items: TrackerItem[] } | null
}

export const TRACKER_FILES = ['TRACKER.md', '.bastion/tracker.md', 'docs/tracker.md']

export function isRunbookPath(file: string): boolean {
  return (
    /(^|\/)(runbooks?|playbooks?)\/[^/]+\.md$/i.test(file) || /(^|\/)RUNBOOK[^/]*\.md$/i.test(file)
  )
}

/** Title from the first heading, and every fenced block under the heading it sits in. */
export function parseRunbook(file: string, markdown: string): Runbook {
  const lines = markdown.split(/\r?\n/)
  let title = file.split('/').at(-1)?.replace(/\.md$/i, '') ?? file
  let heading = ''
  const blocks: RunbookBlock[] = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const h = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line)
    if (h) {
      if (h[1].length === 1 && blocks.length === 0 && heading === '') {
        title = h[2]
      }
      heading = h[2]
      continue
    }
    const fence = /^```\s*([\w-]*)/.exec(line)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !lines[index].startsWith('```')) {
        body.push(lines[index])
        index += 1
      }
      blocks.push({ heading, lang: fence[1].toLowerCase(), code: body.join('\n') })
    }
  }
  return { file, title, blocks }
}

export function parseTracker(markdown: string): TrackerItem[] {
  let section = ''
  return markdown.split(/\r?\n/).flatMap((line, index): TrackerItem[] => {
    const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(line)
    if (h) {
      section = h[1]
      return []
    }
    const item = /^\s*[-*]\s+\[([ xX])\]\s+(.+)$/.exec(line)
    return item ? [{ line: index + 1, text: item[2], checked: item[1] !== ' ', section }] : []
  })
}

/** The Markdown with one checkbox set; null when that line is not a checkbox. */
export function setTrackerItem(markdown: string, line: number, checked: boolean): string | null {
  const lines = markdown.split('\n')
  const current = lines[line - 1]
  if (current === undefined || !/^\s*[-*]\s+\[[ xX]\]\s/.test(current)) {
    return null
  }
  lines[line - 1] = current.replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]')
  return lines.join('\n')
}
