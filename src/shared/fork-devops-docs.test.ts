import { describe, expect, it } from 'vitest'
import { isRunbookPath, parseRunbook, parseTracker, setTrackerItem } from './fork-devops-docs'

describe('repo docs', () => {
  it('finds runbooks by folder or name', () => {
    expect(isRunbookPath('docs/runbooks/cache.md')).toBe(true)
    expect(isRunbookPath('RUNBOOK-db.md')).toBe(true)
    expect(isRunbookPath('docs/notes.md')).toBe(false)
  })

  it('reads a runbook title and its blocks under their headings', () => {
    const book = parseRunbook(
      'docs/runbooks/cache.md',
      '# Cache down\n\n## Check\n```sh\nkubectl get pods\n```\n## Fix\n```bash\nkubectl rollout restart deploy/web\n```\n'
    )
    expect(book.title).toBe('Cache down')
    expect(book.blocks).toEqual([
      { heading: 'Check', lang: 'sh', code: 'kubectl get pods' },
      { heading: 'Fix', lang: 'bash', code: 'kubectl rollout restart deploy/web' }
    ])
  })

  it('reads and toggles tracker checkboxes, refusing other lines', () => {
    const md = '# P0 Setup\n- [x] Budget alert\n- [ ] mise.toml\n# P1\n* [ ] Fork the app\n'
    expect(parseTracker(md)).toEqual([
      { line: 2, text: 'Budget alert', checked: true, section: 'P0 Setup' },
      { line: 3, text: 'mise.toml', checked: false, section: 'P0 Setup' },
      { line: 5, text: 'Fork the app', checked: false, section: 'P1' }
    ])
    expect(setTrackerItem(md, 3, true)?.split('\n')[2]).toBe('- [x] mise.toml')
    expect(setTrackerItem(md, 1, true)).toBeNull()
  })
})
