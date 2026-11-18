import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import type { RecipeSnapshot, RecipeStep } from '../../../../shared/fork-recipes/recipe-contract'
import { openWorkspaceFile } from '../devops/open-manifest'
import { RealRecipeActions } from './RealRecipeActions'

function Steps({ steps }: { steps: RecipeStep[] }): React.JSX.Element {
  return (
    <ul className="space-y-1 text-xs" aria-label="Recipe steps">
      {steps.map((step) => (
        <li key={step.step} className={step.ok ? '' : 'text-destructive'}>
          {step.step}: {step.ok ? 'passed' : `failed · ${step.message ?? ''}`}
        </li>
      ))}
    </ul>
  )
}

/** A created recipe: its current files, validation, and delivery to the selected Floci target. */
export function RecipeDirectoryCard({
  projectId,
  snapshot,
  target,
  onSnapshot
}: {
  projectId: string
  snapshot: RecipeSnapshot
  target: CloudTarget | null
  onSnapshot: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  const api = window.api.cloudTargets?.recipes
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validation, setValidation] = useState<{ tool: string; steps: RecipeStep[] } | null>(null)
  const [delivery, setDelivery] = useState<{
    operation: 'apply' | 'destroy'
    steps: RecipeStep[]
    outputs: Record<string, string>
  } | null>(null)
  const [reviewing, setReviewing] = useState<'apply' | 'destroy' | null>(null)
  const unsupported = snapshot.flociUnsupported ?? null
  const floci =
    !unsupported &&
    target?.configuration.kind === 'emulated' &&
    target.configuration.provider === 'aws'
      ? target
      : null
  const run = async (action: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }
  const refresh = () =>
    run(async () => {
      const result = await api?.read({ projectId, directory: snapshot.directory })
      if (result?.ok) {
        onSnapshot(result)
      } else {
        setError(result?.message ?? 'Recipes are unavailable.')
      }
    })
  const validate = () =>
    run(async () => {
      const result = await api?.validate({ projectId, directory: snapshot.directory })
      if (result?.ok) {
        setValidation({ tool: result.tool, steps: result.steps })
      } else {
        setError(result?.message ?? 'Validation is unavailable.')
      }
    })
  const deliver = (operation: 'apply' | 'destroy') =>
    run(async () => {
      if (!floci) {
        return
      }
      const result = await api?.deliver({
        projectId,
        directory: snapshot.directory,
        targetId: floci.id,
        operation,
        fingerprint: snapshot.fingerprint
      })
      setReviewing(null)
      if (result?.ok) {
        setDelivery({ operation, steps: result.steps, outputs: result.outputs })
      } else {
        setError(result?.message ?? 'Delivery is unavailable.')
      }
    })
  return (
    <section className="workspace-card space-y-3" data-testid="recipe-directory">
      <div className="workspace-eyebrow">Recipe source · {snapshot.directory}</div>
      <ul className="space-y-1 font-mono text-xs" aria-label="Recipe files">
        {snapshot.files.map((file) => (
          <li key={file.path} className="flex items-center gap-2">
            <button
              type="button"
              className="hover:underline"
              onClick={() => openWorkspaceFile(projectId, file.path, 1)}
            >
              {file.path}
            </button>
            <span className="text-muted-foreground">{file.bytes} B</span>
          </li>
        ))}
      </ul>
      {snapshot.companions?.map((path) => (
        <p key={path} className="text-xs">
          Also created for the application:{' '}
          <button
            type="button"
            className="font-mono hover:underline"
            onClick={() => openWorkspaceFile(projectId, path, 1)}
          >
            {path}
          </button>
        </p>
      ))}
      <p className="text-xs text-muted-foreground">
        Fingerprint {snapshot.fingerprint.slice(7, 19)} · ordinary source you own. Edit it freely,
        then refresh before applying.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void refresh()}
          title={capabilityNote('recipes.read')}
        >
          Refresh files
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void validate()}
          title={capabilityNote('recipes.validate')}
        >
          {busy ? 'Working…' : 'Validate'}
        </Button>
        <Button
          disabled={busy || !floci}
          onClick={() => setReviewing('apply')}
          title={capabilityNote('recipes.apply-emulated')}
        >
          Apply to Floci…
        </Button>
        <Button
          variant="outline"
          disabled={busy || !floci}
          onClick={() => setReviewing('destroy')}
          title={capabilityNote('recipes.destroy-emulated')}
        >
          Destroy from Floci…
        </Button>
      </div>
      {unsupported && (
        <p className="text-xs text-muted-foreground" data-testid="recipe-floci-unsupported">
          {unsupported} needs the local emulator&apos;s Docker backends, which Bastion does not
          allow, so this recipe can be validated here but not applied to Floci. Apply it on a real
          AWS target instead.
        </p>
      )}
      {target?.configuration.kind === 'real' && (
        <RealRecipeActions
          projectId={projectId}
          snapshot={snapshot}
          target={target}
          onChanged={() => void refresh()}
        />
      )}
      {!floci && !unsupported && target?.configuration.kind !== 'real' && (
        <p className="text-xs text-muted-foreground">
          Select a Floci AWS target on the Cloud page and start it to apply this recipe locally,
          free of charge, or a verified real AWS target to apply it to your account.
        </p>
      )}
      {validation && (
        <div data-testid="recipe-validation">
          <p className="text-xs">Validated with {validation.tool}</p>
          <Steps steps={validation.steps} />
        </div>
      )}
      {delivery && (
        <div data-testid="recipe-delivery">
          <p className="text-xs">
            {delivery.operation === 'apply' ? 'Applied to' : 'Destroyed from'} {floci?.label} ·
            local emulator · no charges
          </p>
          <Steps steps={delivery.steps} />
          {Object.entries(delivery.outputs).map(([key, value]) => (
            <p key={key} className="font-mono text-xs break-all">
              {key} = {value}
            </p>
          ))}
        </div>
      )}
      {reviewing && floci && (
        <Dialog open onOpenChange={(open) => !open && setReviewing(null)}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>
                {reviewing === 'apply' ? 'Apply' : 'Destroy'} on {floci.label}?
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm">
              Local Floci emulator · no charges · reviewed fingerprint{' '}
              <span className="font-mono">{snapshot.fingerprint.slice(7, 19)}</span>. If the files
              change before this runs, it is refused.
            </p>
            <ul className="font-mono text-xs">
              {snapshot.files.map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReviewing(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void deliver(reviewing)}>
                {reviewing === 'apply' ? 'Confirm apply' : 'Confirm destroy'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
