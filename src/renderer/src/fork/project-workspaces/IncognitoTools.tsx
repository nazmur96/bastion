import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type {
  ProjectWorkspaceList,
  ProjectWorkspacesApi,
  IncognitoKind
} from '../../../../shared/fork-project-workspaces'

type Props = {
  api: ProjectWorkspacesApi
  snapshot: ProjectWorkspaceList
  busy: boolean
  onSnapshot: (value: ProjectWorkspaceList) => void
  onOpen: (id: string) => void
}
export function IncognitoTools({
  api,
  snapshot,
  busy,
  onSnapshot,
  onOpen
}: Props): React.JSX.Element {
  const [view, setView] = useState<'tools' | 'archive' | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('Untitled.txt')
  const [agent, setAgent] = useState<'claude' | 'codex'>('claude')
  const [deleting, setDeleting] = useState<string | null>(null)
  async function create(kind: IncognitoKind): Promise<void> {
    if (!api.incognito || pending || busy) {
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await api.incognito.create({ kind, fileName, agent })
      onSnapshot(result.snapshot)
      onOpen(result.task.workspace.id)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  async function remove(id: string): Promise<void> {
    if (!api.incognito || pending || busy) {
      return
    }
    setPending(true)
    setError('')
    try {
      onSnapshot(await api.incognito.remove({ id, confirmed: true }))
      setDeleting(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setPending(false)
    }
  }
  return (
    <section className="mt-8 border-t pt-6">
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={busy || pending}
          onClick={() => setView(view === 'tools' ? null : 'tools')}
        >
          {translate('components.incognito.open', 'Incognito')}
        </Button>
        <Button
          variant="ghost"
          disabled={busy || pending}
          onClick={() => setView(view === 'archive' ? null : 'archive')}
        >
          {translate('components.incognito.archive', 'Archive')}
        </Button>
      </div>
      {view === 'tools' && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {translate(
              'components.incognito.scope',
              'A separate one-off context. Closing saves it in Archive. Local tools still have host access; this is not a sandbox.'
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || pending}
              onClick={() => void create('terminal')}
            >
              {translate('components.incognito.terminal', 'Terminal')}
            </Button>
            <Button
              variant="outline"
              disabled={busy || pending}
              onClick={() => void create('browser')}
            >
              {translate('components.incognito.browser', 'Browser')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="incognito-agent" className="text-sm">
              {translate('components.incognito.agent', 'Agent')}
            </label>
            <select
              id="incognito-agent"
              className="rounded-md border bg-background p-2 text-sm"
              value={agent}
              disabled={busy || pending}
              onChange={(event) => setAgent(event.target.value === 'codex' ? 'codex' : 'claude')}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
            <Button
              variant="outline"
              disabled={busy || pending}
              onClick={() => void create('agent')}
            >
              {translate('components.incognito.launchAgent', 'Open agent')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="incognito-file" className="text-sm">
              {translate('components.incognito.fileName', 'File name')}
            </label>
            <div className="w-56">
              <Input
                id="incognito-file"
                value={fileName}
                disabled={busy || pending}
                onChange={(event) => setFileName(event.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={busy || pending || !fileName.trim()}
              onClick={() => void create('file')}
            >
              {translate('components.incognito.newFile', 'New file')}
            </Button>
          </div>
        </div>
      )}
      {view === 'archive' && (
        <div className="mt-4 flex flex-col gap-2">
          {(snapshot.incognitoTasks ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              {translate('components.incognito.empty', 'No Incognito tasks yet.')}
            </p>
          )}
          {(snapshot.incognitoTasks ?? []).map((task) => (
            <div
              key={task.workspace.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b py-3"
            >
              <span className="text-sm">{task.workspace.name}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || pending || task.deleting}
                  onClick={() => onOpen(task.workspace.id)}
                >
                  {translate('components.incognito.reopen', 'Reopen')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || pending}
                  onClick={() => setDeleting(task.workspace.id)}
                >
                  {translate('components.incognito.delete', 'Delete permanently')}
                </Button>
              </div>
              {deleting === task.workspace.id && (
                <div className="w-full flex flex-wrap items-center gap-2">
                  <p className="text-sm">
                    {translate(
                      'components.incognito.confirmDelete',
                      'Permanently delete this task, its files and saved sessions?'
                    )}
                  </p>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy || pending}
                    onClick={() => void remove(task.workspace.id)}
                  >
                    {translate('components.incognito.confirm', 'Delete task')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                    {translate('common.cancel', 'Cancel')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {error && (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
