import { workspaceErrorMessage } from './workspace-error-message'
import { useEffect, useState } from 'react'
import { ArrowUpRight, LayoutGrid, Loader2, Pencil, Plus } from 'lucide-react'
import logo from '../../../../../resources/icon-source/bastion.svg'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getIntlLocale, translate } from '@/i18n/i18n'
import {
  isListedWorkspace,
  type ProjectWorkspace,
  type ProjectWorkspacesApi
} from '../../../../shared/fork-project-workspaces'
import { useProjectWorkspaces } from './use-project-workspaces'
import { IncognitoTools } from './IncognitoTools'
import { acknowledgeWorkspaceArrival } from './workspace-arrival-ready'

const DRAG: React.CSSProperties & { WebkitAppRegion: 'drag' } = { WebkitAppRegion: 'drag' }
const NO_DRAG: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

function repositoryLine(workspace: ProjectWorkspace): string {
  if (workspace.repoCount === null) {
    return translate(
      'components.applicationHome.repositoriesUnknown',
      'Repository count not recorded yet'
    )
  }
  if (workspace.repoCount === 0) {
    return translate('components.applicationHome.noRepositories', 'No repositories yet')
  }
  return workspace.repoCount === 1
    ? translate('components.applicationHome.oneRepository', '1 repository')
    : translate('components.applicationHome.repositories', '{{count}} repositories', {
        count: workspace.repoCount
      })
}

function openedLine(workspace: ProjectWorkspace): string {
  if (workspace.openedAt === null) {
    return translate('components.applicationHome.neverOpened', 'Not opened yet')
  }
  const when = new Date(workspace.openedAt).toLocaleString(getIntlLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
  return translate('components.applicationHome.lastOpened', 'Last opened {{when}}', { when })
}

/** The first page: outside every workspace, owning creation and opening only. */
export function ApplicationHome(): React.JSX.Element {
  const api = window.api.projectWorkspaces
  const { snapshot, error: loadError, setSnapshot } = useProjectWorkspaces()
  useEffect(() => {
    if (snapshot || loadError) {
      acknowledgeWorkspaceArrival()
    }
  }, [snapshot, loadError])
  const [form, setForm] = useState<{ mode: 'create' } | { mode: 'rename'; id: string } | null>(null)
  const [name, setName] = useState('')
  const [opening, setOpening] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const workspaces = (snapshot?.workspaces ?? []).filter(isListedWorkspace)

  async function perform(
    action: (workspacesApi: ProjectWorkspacesApi, activeId: string) => Promise<void>
  ): Promise<void> {
    if (busy || !api || !snapshot) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await action(api, snapshot.activeId)
    } catch (cause) {
      setOpening(null)
      setError(workspaceErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  function open(id: string): void {
    void perform(async (workspacesApi, activeId) => {
      setOpening(id)
      await workspacesApi.switch({ fromId: activeId, toId: id })
    })
  }

  function startForm(next: NonNullable<typeof form>, initialName = ''): void {
    setForm(next)
    setName(initialName)
    setError('')
  }

  function submit(event: React.FormEvent): void {
    event.preventDefault()
    const current = form
    if (!current) {
      return
    }
    void perform(async (workspacesApi) => {
      if (current.mode === 'rename') {
        setSnapshot(await workspacesApi.rename({ id: current.id, name }))
        setForm(null)
        return
      }
      const before = new Set(workspaces.map((workspace) => workspace.id))
      const result = await workspacesApi.create({ name })
      setSnapshot(result)
      setForm(null)
      const created = result.workspaces.find((workspace) => !before.has(workspace.id))
      if (created) {
        setOpening(created.id)
        await workspacesApi.switch({ fromId: result.activeId, toId: created.id })
      }
    })
  }

  const nameForm = (label: string, action: string): React.JSX.Element => (
    <form className="flex w-full flex-col gap-3" onSubmit={submit}>
      <label className="text-xs text-muted-foreground" htmlFor="application-home-name">
        {label}
      </label>
      <Input
        id="application-home-name"
        autoFocus
        value={name}
        maxLength={80}
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && setForm(null)}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setForm(null)}>
          {translate('common.cancel', 'Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={busy || !name.trim()}>
          {action}
        </Button>
      </div>
    </form>
  )

  return (
    <div className="fixed inset-0 flex flex-col bg-background text-foreground">
      <header
        className="flex h-12 shrink-0 items-center gap-3 border-b"
        style={{
          ...DRAG,
          paddingLeft: 'calc(8px + var(--mac-traffic-lights-width, 0px))',
          paddingRight: 'calc(16px + var(--window-controls-width, 0px))'
        }}
      >
        <img src={logo} alt="" aria-hidden className="titlebar-logo" />
        <span className="text-sm font-semibold uppercase tracking-wider">
          {translate('components.bastion.name', 'Bastion')}
        </span>
        <span className="h-4 w-px bg-border" aria-hidden />
        <span className="text-xs text-muted-foreground">
          {translate('components.applicationHome.product', 'Engineering workspace')}
        </span>
      </header>
      <main className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-12">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {translate(
              'components.applicationHome.eyebrow',
              'Application home · Outside any workspace'
            )}
          </p>
          <div className="mt-4 flex flex-wrap items-end justify-between gap-6">
            <div>
              <h1 className="text-4xl font-medium tracking-tight">
                {translate('components.applicationHome.title', 'Where would you like to work?')}
              </h1>
              <p className="mt-3 text-sm text-muted-foreground">
                {translate(
                  'components.applicationHome.subtitle',
                  'Open a project workspace. Each one keeps its own repositories, agents, terminals and settings.'
                )}
              </p>
            </div>
            <Button
              variant="outline"
              style={NO_DRAG}
              disabled={busy}
              onClick={() => startForm({ mode: 'create' })}
            >
              {translate('components.applicationHome.newWorkspace', 'New workspace')}
            </Button>
          </div>
          {api?.incognito && snapshot && (
            <IncognitoTools
              api={api}
              snapshot={snapshot}
              busy={busy}
              onSnapshot={setSnapshot}
              onOpen={open}
            />
          )}
          <div className="mt-10 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">
              {translate('components.applicationHome.yourWorkspaces', 'Your workspaces')}
            </h2>
            <span className="text-xs text-muted-foreground">
              {translate('components.applicationHome.count', '{{count}} workspaces', {
                count: workspaces.length
              })}
            </span>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {workspaces.map((workspace) =>
              form?.mode === 'rename' && form.id === workspace.id ? (
                <div key={workspace.id} className="flex min-h-40 rounded-xl border bg-card p-5">
                  {nameForm(
                    translate('components.applicationHome.renameLabel', 'Workspace name'),
                    translate('common.save', 'Save')
                  )}
                </div>
              ) : (
                <div key={workspace.id} className="relative">
                  <button
                    type="button"
                    className="flex min-h-40 w-full flex-col rounded-xl border bg-card p-5 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                    disabled={busy}
                    onClick={() => open(workspace.id)}
                  >
                    <span className="flex size-9 items-center justify-center rounded-md border bg-background">
                      <LayoutGrid className="size-4" />
                    </span>
                    <span className="mt-5 truncate pr-8 text-base font-medium">
                      {workspace.name}
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      {repositoryLine(workspace)}
                    </span>
                    <span className="text-xs text-muted-foreground">{openedLine(workspace)}</span>
                    <span className="mt-auto flex items-center justify-between pt-5 text-xs">
                      {opening === workspace.id ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="size-4 animate-spin" />
                          {translate('components.applicationHome.opening', 'Opening…')}
                        </span>
                      ) : (
                        translate('components.applicationHome.open', 'Open workspace')
                      )}
                      <ArrowUpRight className="size-4" />
                    </span>
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="absolute top-4 right-4"
                    disabled={busy}
                    aria-label={translate('components.applicationHome.rename', 'Rename {{name}}', {
                      name: workspace.name
                    })}
                    onClick={() => startForm({ mode: 'rename', id: workspace.id }, workspace.name)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                </div>
              )
            )}
            {form?.mode === 'create' ? (
              <div className="flex min-h-40 rounded-xl border border-dashed bg-card p-5">
                {nameForm(
                  translate('components.applicationHome.newLabel', 'New workspace name'),
                  translate('components.applicationHome.create', 'Create and open')
                )}
              </div>
            ) : (
              <button
                type="button"
                className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed text-center transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                disabled={busy || !snapshot}
                onClick={() => startForm({ mode: 'create' })}
              >
                <Plus className="size-6 text-muted-foreground" />
                <span className="text-sm font-medium">
                  {translate('components.applicationHome.createCard', 'Create a workspace')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {translate(
                    'components.applicationHome.createCardHint',
                    'A complete, independent project desktop'
                  )}
                </span>
              </button>
            )}
          </div>
          {(error || loadError) && (
            <p role="alert" className="mt-6 text-sm text-destructive">
              {error || loadError}
            </p>
          )}
          <p className="mt-8 text-sm text-muted-foreground">
            {translate(
              'components.applicationHome.footnote',
              'Repositories, branches and worktrees are added inside a workspace. Opening a workspace reopens the app inside it.'
            )}
          </p>
        </div>
      </main>
      <footer className="flex h-8 shrink-0 items-center border-t px-4 text-2xs text-muted-foreground">
        {translate(
          'components.applicationHome.status',
          'No workspace is open. Your project contexts stay separate.'
        )}
      </footer>
    </div>
  )
}
