import { useEffect, useState } from 'react'
import { BookOpen, ListChecks, Play, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { commandFromCodeBlock, isRunnableShellLanguage } from '../chat-run/chat-command'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import { openWorkspaceFile } from './open-manifest'
import type { RepoDocs } from '../../../../shared/fork-devops-docs'

function useRepoDocs(workspacePath: string): { docs: RepoDocs | null; reload: () => void } {
  const [docs, setDocs] = useState<RepoDocs | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let current = true
    void window.api.aiVault.repoDocs(workspacePath).then((next) => {
      if (current) {
        setDocs(next)
      }
    })
    return () => {
      current = false
    }
  }, [workspacePath, round])
  return { docs, reload: () => setRound((value) => value + 1) }
}

/** C2 runbooks (runnable blocks) and C3 the project tracker, both plain Markdown in the repo. */
export function InfraDocsCards({
  worktreeId,
  workspacePath,
  appName
}: {
  worktreeId: string
  workspacePath: string
  appName: string
}): React.JSX.Element {
  const { docs, reload } = useRepoDocs(workspacePath)
  const [openBook, setOpenBook] = useState<string | null>(null)
  const items = docs?.tracker?.items ?? []
  const done = items.filter((item) => item.checked).length
  return (
    <>
      <InfraCard
        id="infra-path-runbooks"
        className="mb-4"
        title={translate('components.devops.runbooks.title', 'Runbooks')}
        hint={translate(
          'components.devops.runbooks.hint',
          'Markdown in runbooks/ (or RUNBOOK*.md); every shell block runs in a terminal you watch.'
        )}
      >
        {docs && docs.runbooks.length === 0 ? (
          <p className="mb-2 text-xs text-muted-foreground">
            {translate('components.devops.runbooks.none', 'No runbooks in this repo yet.')}
          </p>
        ) : null}
        <ul className="space-y-1.5">
          {(docs?.runbooks ?? []).map((book) => (
            <li key={book.file} className="rounded-md border border-border px-2 py-1.5">
              <div className="flex items-center gap-2 text-sm">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-medium"
                  onClick={() => setOpenBook(openBook === book.file ? null : book.file)}
                >
                  {book.title}
                </button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  onClick={() => openWorkspaceFile(worktreeId, book.file, 1)}
                >
                  <BookOpen aria-hidden />
                  {translate('components.devops.runbooks.open', 'Open')}
                </Button>
              </div>
              {openBook === book.file ? (
                <ol className="mt-1 space-y-1">
                  {book.blocks
                    .filter((block) => isRunnableShellLanguage(block.lang) || block.lang === '')
                    .map((block) => {
                      const command = commandFromCodeBlock(block.code)
                      return (
                        <li
                          key={`${block.heading}:${block.code}`}
                          className="flex items-start gap-2 text-xs"
                        >
                          <span className="w-28 shrink-0 truncate text-muted-foreground">
                            {block.heading}
                          </span>
                          <pre className="min-w-0 flex-1 truncate font-mono">{block.code}</pre>
                          {command ? (
                            <Button
                              type="button"
                              size="xs"
                              variant="outline"
                              onClick={() => runInWorkbenchTerminal(worktreeId, command)}
                            >
                              <Play aria-hidden />
                              {translate('components.devops.runbooks.run', 'Run')}
                            </Button>
                          ) : null}
                        </li>
                      )
                    })}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              draftForClaude(
                worktreeId,
                `Write a runbook for ${appName} in runbooks/: the 3–5 most likely failures from this repo's manifests and config, each with symptoms, a check, and a fix as runnable shell blocks under their own headings. Files only.`
              )
            }
          >
            <Sparkles aria-hidden />
            {translate('components.devops.runbooks.write', 'Write a runbook with Claude')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              draftForClaude(
                worktreeId,
                `Draft an RCA in docs/rca/ for the incident we just worked on in ${appName}: timeline, impact, root cause, what fixed it, and follow-ups (each as a checkbox). Ask me for anything you cannot see.`
              )
            }
          >
            <Sparkles aria-hidden />
            {translate('components.devops.runbooks.rca', 'Draft an RCA with Claude')}
          </Button>
        </div>
      </InfraCard>
      <InfraCard
        id="infra-path-tracker"
        className="mb-4"
        title={
          docs?.tracker
            ? translate('components.devops.tracker.title', 'Tracker · {{done}}/{{total}}', {
                done,
                total: items.length
              })
            : translate('components.devops.tracker.empty', 'Tracker')
        }
        hint={translate(
          'components.devops.tracker.hint',
          'Checkboxes in TRACKER.md; ticking one writes the file (commit it like any change).'
        )}
      >
        {docs?.tracker ? (
          <>
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-status-success"
                style={{ width: `${items.length ? (done / items.length) * 100 : 0}%` }}
              />
            </div>
            <ul className="scrollbar-sleek max-h-72 space-y-0.5 overflow-y-auto">
              {items.map((item, index) => (
                <li key={item.line}>
                  {index === 0 || items[index - 1].section !== item.section ? (
                    <div className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {item.section}
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(event) => {
                        const tracker = docs.tracker
                        if (tracker) {
                          void window.api.aiVault
                            .setTrackerItem({
                              workspacePath,
                              file: tracker.file,
                              line: item.line,
                              checked: event.target.checked
                            })
                            .then(reload)
                        }
                      }}
                    />
                    <span className={item.checked ? 'text-muted-foreground line-through' : ''}>
                      {item.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              draftForClaude(
                worktreeId,
                `Create TRACKER.md for ${appName}: the project's phases as Markdown headings with "- [ ]" checkboxes, based on its plan (for example a devsecops-template folder next to the repo, if there is one: one heading per phase, its tickets and its "Prove it" drill). File only.`
              )
            }
          >
            <ListChecks aria-hidden />
            {translate('components.devops.tracker.create', 'Create a tracker with Claude')}
          </Button>
        )}
      </InfraCard>
    </>
  )
}
