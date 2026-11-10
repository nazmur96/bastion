import { useEffect, useState } from 'react'
import { Layers, Check, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import type { ProjectWorkspaceList } from '../../../../shared/fork-project-workspaces'

const NO_DRAG: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

/** Application-level owner; repository and worktree actions remain inside the workbench. */
export function ProjectWorkspacePicker(): React.JSX.Element | null {
  const api = window.api.projectWorkspaces
  const [snapshot, setSnapshot] = useState<ProjectWorkspaceList | null>(null)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const active = snapshot?.workspaces.find((workspace) => workspace.id === snapshot.activeId)
  useEffect(() => {
    if (api) {
      void api
        .list()
        .then(setSnapshot)
        .catch((cause: unknown) => setError(String(cause)))
    }
  }, [api])
  if (!api) {
    return null
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) {
      return
    }
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) {
          void perform(async () => setSnapshot(await api.list()))
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="titlebar-icon-button !w-auto gap-2 px-2"
          style={NO_DRAG}
          aria-label={translate('components.projectWorkspaces.manage', 'Project workspaces')}
          title={
            active?.name ?? translate('components.projectWorkspaces.manage', 'Project workspaces')
          }
        >
          <Layers size={14} />
          <span className="max-w-32 truncate text-xs">{active?.name}</span>
        </button>
      </PopoverTrigger>
      {open && <style>{'[data-retained-group]{visibility:hidden}'}</style>}
      <PopoverContent align="start" className="w-80">
        <div className="space-y-3 p-4">
          <div>
            <p className="text-sm font-medium">
              {translate('components.projectWorkspaces.manage', 'Project workspaces')}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate(
                'components.projectWorkspaces.description',
                'Each workspace keeps its own projects, agents, terminals and settings. Opening another reopens the workbench.'
              )}
            </p>
          </div>
          <div className="scrollbar-sleek max-h-64 space-y-1 overflow-y-auto">
            {snapshot?.workspaces.map((workspace) => (
              <Button
                key={workspace.id}
                variant="ghost"
                className="w-full justify-between"
                disabled={busy || workspace.id === snapshot.activeId}
                onClick={() =>
                  void perform(async () => {
                    await api.switch({ fromId: snapshot.activeId, toId: workspace.id })
                  })
                }
              >
                <span className="truncate">{workspace.name}</span>
                {workspace.id === snapshot.activeId ? (
                  <Check size={14} />
                ) : (
                  <ArrowRight size={14} />
                )}
              </Button>
            ))}
          </div>
          <form
            className="space-y-2 border-t pt-3"
            onSubmit={(event) => {
              event.preventDefault()
              void perform(async () => {
                const result =
                  renaming && active
                    ? await api.rename({ id: active.id, name })
                    : await api.create({ name })
                setSnapshot(result)
                setName('')
                setRenaming(false)
              })
            }}
          >
            <label className="text-xs" htmlFor="project-workspace-name">
              {renaming
                ? translate('components.projectWorkspaces.renameLabel', 'Rename current workspace')
                : translate('components.projectWorkspaces.newLabel', 'New empty workspace')}
            </label>
            <Input
              id="project-workspace-name"
              value={name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            <div className="flex justify-between gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy || !active}
                onClick={() => {
                  setRenaming(!renaming)
                  setName(renaming ? '' : (active?.name ?? ''))
                }}
              >
                {renaming
                  ? translate('common.cancel', 'Cancel')
                  : translate('components.projectWorkspaces.rename', 'Rename current')}
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                {renaming
                  ? translate('common.save', 'Save')
                  : translate('components.projectWorkspaces.create', 'Create workspace')}
              </Button>
            </div>
          </form>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
