import { useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate, getIntlLocale } from '@/i18n/i18n'
import { openWorkspaceFile } from '../devops/open-manifest'
import { showWorkspaceEditor } from '../workspace-desktop/WorkspaceQuickActions'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { CONTRACT_FILE, SERVICE_QUESTIONS, draftServiceContract } from './service-knowledge'
import { useProjectDiscovery } from './use-project-discovery'

export function WorkspaceDiscoveryPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const [view, setView] = useState<'evidence' | 'contract'>('evidence')
  const [expanded, setExpanded] = useState(false)
  const { state, refresh } = useProjectDiscovery(worktreeId)
  const data = state?.data
  const facts = [...(data?.snapshot.facts ?? [])].sort((a, b) => {
    const rank = (id: string): number =>
      id.startsWith('stack:') ? 0 : id.includes(':configuration:') ? 2 : 1
    return rank(a.id) - rank(b.id)
  })
  const stale =
    state?.stale ||
    (data?.snapshot.limits.length ?? 0) > 1 ||
    data?.contract?.sourceFingerprint !== data?.snapshot.fingerprint
  const openSource = (path: string, line = 1): void => {
    try {
      const { root, guard } = captureProjectFileRoute(worktreeId)
      guard.assertCurrent()
      if (
        path.split(/[\\/]/).some((part) => !part || part === '..' || part === '.') ||
        path.includes(':')
      ) {
        throw new Error('Invalid evidence path.')
      }
      if (root !== data?.snapshot.root) {
        throw new Error('Project path changed. Refresh discovery.')
      }
      showWorkspaceEditor()
      openWorkspaceFile(worktreeId, path, line)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  return (
    <div className="workspace-page scrollbar-sleek" data-project-discovery="">
      <div className="workspace-eyebrow">
        {translate('workspaceDesktop.discovery', 'Project discovery')}
      </div>
      <header className="workspace-page-heading">
        <div>
          <h1>
            {translate('workspaceDesktop.projectNeeds', 'Understand what this project needs.')}
          </h1>
          <p>
            {translate(
              'discovery.scope',
              'Source evidence, reviewed service knowledge and the questions code cannot answer.'
            )}
          </p>
        </div>
      </header>
      <section className="mb-5 rounded-md border border-border bg-card p-3">
        <div className="workspace-card-title">
          <h2>{translate('discovery.evidence', 'Source evidence')}</h2>
          <button
            className="workspace-button"
            type="button"
            disabled={state?.pending}
            onClick={refresh}
          >
            {translate('discovery.refresh', 'Refresh discovery')}
          </button>
        </div>
        <p role="status">
          {!state || state.pending
            ? translate('workspaceDesktop.inspecting', 'Reading project requirements…')
            : state?.stale
              ? translate(
                  'discovery.stale',
                  'Needs refresh: source or connection may have changed.'
                )
              : translate('discovery.inspected', 'Inspected snapshot; live health is unknown.')}
        </p>
        {data && (
          <p className="break-all font-mono text-xs">
            {data.snapshot.root} · {new Date(data.snapshot.at).toLocaleString(getIntlLocale())}
          </p>
        )}
        {state?.error && (
          <p role="alert" className="text-destructive">
            {state.error}
          </p>
        )}
      </section>
      <div className="workspace-card-actions mb-5">
        <button
          type="button"
          className="workspace-button"
          aria-pressed={view === 'evidence'}
          onClick={() => setView('evidence')}
        >
          {translate('discovery.evidence', 'Source evidence')}
        </button>
        <button
          type="button"
          className="workspace-button"
          aria-pressed={view === 'contract'}
          onClick={() => setView('contract')}
        >
          {translate('discovery.contract', 'Reviewed service contract')}
        </button>
      </div>
      {view === 'evidence' && (
        <>
          <div className="workspace-home-grid">
            {(expanded ? facts : facts.slice(0, 12)).map((fact) => (
              <section className="workspace-card" key={fact.id}>
                <div className="workspace-eyebrow">
                  {fact.kind === 'observed'
                    ? translate('discovery.observed', 'Observed in source')
                    : translate('discovery.inferred', 'Inferred · needs confirmation')}
                </div>
                <p>{fact.summary}</p>
                {fact.evidence.map((evidence) => (
                  <button
                    className="workspace-button max-w-full min-w-0 font-mono"
                    type="button"
                    key={`${evidence.path}:${evidence.line}`}
                    onClick={() => openSource(evidence.path, evidence.line)}
                  >
                    <span className="truncate" title={`${evidence.path}:${evidence.line}`}>
                      {evidence.path}:{evidence.line}
                    </span>
                  </button>
                ))}
              </section>
            ))}
          </div>
          {facts.length > 12 && (
            <button
              type="button"
              className="workspace-button mt-5"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded
                ? translate('discovery.less', 'Show less evidence')
                : translate('discovery.more', 'Show all evidence')}
            </button>
          )}
          {data && data.snapshot.facts.length === 0 && (
            <section className="workspace-card">
              <p>
                {translate(
                  'discovery.noEvidence',
                  'No supported source evidence found. Operational requirements remain unknown.'
                )}
              </p>
            </section>
          )}
        </>
      )}
      {view === 'contract' && (
        <section className="workspace-card mt-5">
          <div className="workspace-card-title">
            <h2>{translate('discovery.contract', 'Reviewed service contract')}</h2>
            {data?.contract ? (
              <button
                type="button"
                className="workspace-button"
                onClick={() => openSource(CONTRACT_FILE)}
              >
                {translate('discovery.editContract', 'Edit contract')}
              </button>
            ) : (
              <button
                type="button"
                className="workspace-button"
                disabled={!data || state?.stale || state.pending || !!data.contractError}
                onClick={() => {
                  if (!data) {
                    return
                  }
                  const current = useAppStore.getState()
                  if (current.activeWorktreeId !== worktreeId) {
                    return
                  }
                  showWorkspaceEditor()
                  void current.openSampleFileInActiveWorkspace({
                    extension: '.json',
                    content: draftServiceContract(data.snapshot)
                  })
                }}
              >
                {translate('discovery.draft', 'Create contract draft')}
              </button>
            )}
          </div>
          <p>
            {translate(
              'discovery.contractScope',
              'Answers are repository-owned human statements, not verified deployment facts. Edit the JSON draft, rename it to bastion.service.json, then return and refresh. Existing contracts are never regenerated or overwritten. Record references, never secret values.'
            )}
          </p>
          {data?.contractError && (
            <p role="alert" className="text-destructive">
              {data.contractError}
            </p>
          )}
          {data?.contract && (
            <p role="status">
              {stale
                ? translate(
                    'discovery.reviewStale',
                    'Source review needs refreshing. Saved answers are preserved; re-review them against current evidence.'
                  )
                : translate(
                    'discovery.reviewCurrent',
                    'Saved answers refer to this source snapshot. Operational verification remains separate.'
                  )}
            </p>
          )}
          {SERVICE_QUESTIONS.map((question) => {
            const answer = data?.contract?.answers[question.id]
            return (
              <div className="border-t border-border py-3" key={question.id}>
                <h3 className="font-medium">{question.title}</h3>
                {answer?.trim() && (
                  <small>
                    {translate(
                      'discovery.human',
                      'Human-provided · operational verification separate'
                    )}
                  </small>
                )}
                <p>
                  {answer?.trim()
                    ? answer
                    : translate('discovery.unknown', 'Unknown · needs a human answer')}
                </p>
                {!answer?.trim() && (
                  <>
                    <p className="text-muted-foreground">{question.why}</p>
                    <p className="text-muted-foreground">{question.how}</p>
                  </>
                )}
              </div>
            )
          })}
        </section>
      )}
      {data && (
        <section className="workspace-card mt-5">
          <h3>{translate('discovery.limits', 'Inspection scope and limits')}</h3>
          {data.snapshot.limits.map((limit) => (
            <p key={limit}>{limit}</p>
          ))}
        </section>
      )}
    </div>
  )
}
