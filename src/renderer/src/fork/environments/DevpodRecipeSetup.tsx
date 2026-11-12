import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import type { WorkspaceEnvironmentFiles } from './workspace-environment-files'

export function DevpodRecipeSetup({
  worktreeId,
  configuration,
  disabled,
  onPrepared
}: {
  worktreeId: string
  configuration: WorkspaceEnvironmentFiles
  disabled: boolean
  onPrepared: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const supported = !navigator.userAgent.includes('Windows')
  const declared =
    configuration.files.includes('.devcontainer/devcontainer.json') ||
    configuration.files.includes('.devcontainer.json')
  const prepare = async (): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      configuration.assertCurrent()
      if (startWorkspaceHost(worktreeId) !== 'local') {
        throw new Error('The project owner changed. Reopen environment setup.')
      }
      const result = await window.api.aiVault.addDevpodRecipe(configuration.root)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setOpen(false)
      onPrepared()
      toast.success(
        translate(
          'workspaceEnvironments.recipeFilesReady',
          'DevPod recipe files prepared. Review them before launching an environment.'
        )
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="workspace-button"
        disabled={disabled || !declared || !supported}
        onClick={() => setOpen(true)}
      >
        {translate('workspaceEnvironments.prepareRecipe', 'Prepare local Docker recipe')}
      </button>
      {!declared && (
        <p>
          {translate(
            'workspaceEnvironments.requireContainer',
            'Add a devcontainer.json before preparing the DevPod recipe.'
          )}
        </p>
      )}
      {!supported && (
        <p>
          {translate(
            'workspaceEnvironments.posixRecipe',
            'This recipe requires a POSIX shell. Use a Linux/WSL execution host on Windows.'
          )}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value)
          }
        }}
      >
        <DialogContent surface="security">
          <DialogHeader>
            <DialogTitle>
              {translate('workspaceEnvironments.reviewRecipe', 'Prepare DevPod recipe files?')}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'workspaceEnvironments.recipeScope',
                'Adds four lifecycle scripts and updates orca.yaml in this project. Existing scripts are not overwritten. The recipe uses the local Docker provider; preparing files starts no container and installs no tools.'
              )}
            </DialogDescription>
          </DialogHeader>
          <p className="break-all font-mono text-xs">{configuration.root}</p>
          <ul className="space-y-1 font-mono text-xs">
            {[
              'orca.yaml',
              'scripts/orca-vm/devpod-create.sh',
              'scripts/orca-vm/devpod-suspend.sh',
              'scripts/orca-vm/devpod-resume.sh',
              'scripts/orca-vm/devpod-destroy.sh'
            ].map((file) => (
              <li key={file}>{file}</li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {translate('workspaceEnvironments.cancel', 'Cancel')}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void prepare()}>
              {busy
                ? translate('workspaceEnvironments.preparing', 'Preparing…')
                : translate('workspaceEnvironments.prepare', 'Prepare files')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {open && <style>{'[data-retained-group]{visibility:hidden}'}</style>}
    </>
  )
}
