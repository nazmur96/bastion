import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import type {
  RecipeRealChallenge,
  RecipeSnapshot,
  RecipeStep
} from '../../../../shared/fork-recipes/recipe-contract'

/**
 * Fork: Step 13.3. A reviewed recipe applied to, or destroyed from, the selected real AWS
 * target. The account must already be verified and accepted on the Cloud page; preparing
 * checks it again and the confirmation shows exactly what will run, on which account.
 */
export function RealRecipeActions({
  projectId,
  snapshot,
  target,
  onChanged
}: {
  projectId: string
  snapshot: RecipeSnapshot
  target: CloudTarget
  /** Reload the files: Terraform adds its dependency lock file on the first run. */
  onChanged: () => void
}): React.JSX.Element {
  const api = window.api.cloudTargets?.recipes
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<RecipeRealChallenge | null>(null)
  const [result, setResult] = useState<{
    operation: 'apply' | 'destroy'
    accountId: string
    steps: RecipeStep[]
    outputs: Record<string, string>
  } | null>(null)
  const anchored = target.configuration.kind === 'real' && target.configuration.expectedAccountId
  const prepare = async (operation: 'apply' | 'destroy'): Promise<void> => {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const prepared = await api?.realPrepare({
        projectId,
        directory: snapshot.directory,
        targetId: target.id,
        operation,
        fingerprint: snapshot.fingerprint
      })
      if (prepared?.ok) {
        setChallenge(prepared.challenge)
      } else {
        setError(prepared?.message ?? 'Real AWS changes are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  const cancel = (): void => {
    if (challenge) {
      void api?.realDeliver({ grantId: challenge.grantId, cancel: true })
    }
    setChallenge(null)
  }
  const confirm = async (): Promise<void> => {
    if (!challenge) {
      return
    }
    const confirmed = challenge
    setChallenge(null)
    setBusy(true)
    try {
      const delivered = await api?.realDeliver({ grantId: confirmed.grantId })
      if (delivered?.ok) {
        setResult({
          operation: confirmed.operation,
          accountId: confirmed.accountId,
          steps: delivered.steps,
          outputs: delivered.outputs
        })
      } else {
        setResult(null)
        setError(delivered?.message ?? 'The change did not run.')
      }
    } finally {
      setBusy(false)
      onChanged()
    }
  }
  return (
    <div className="space-y-2" data-testid="recipe-real-aws">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={busy || !anchored}
          title={capabilityNote('recipes.apply-real')}
          onClick={() => void prepare('apply')}
        >
          Apply to real AWS…
        </Button>
        <Button
          variant="outline"
          disabled={busy || !anchored}
          title={capabilityNote('recipes.destroy-real')}
          onClick={() => void prepare('destroy')}
        >
          Destroy from real AWS…
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {anchored
          ? 'Creates or deletes real, billable resources in your account. Terraform runs in this recipe directory with your own profile, so its state stays here and you can always destroy it with plain Terraform.'
          : 'Verify and accept this target’s AWS identity on the Cloud page first.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div data-testid="recipe-real-result" className="text-xs">
          <p>
            {result.operation === 'apply' ? 'Applied to' : 'Destroyed from'} real AWS account{' '}
            {result.accountId}
          </p>
          <p className="text-muted-foreground">
            Terraform state stays in this directory (ignored by Git). Commit .terraform.lock.hcl
            with the recipe so later runs use the same providers.
          </p>
          <ul aria-label="Real AWS steps">
            {result.steps.map((step) => (
              <li key={step.step} className={step.ok ? '' : 'text-destructive'}>
                {step.step}: {step.ok ? 'passed' : `failed · ${step.message ?? ''}`}
              </li>
            ))}
          </ul>
          {Object.entries(result.outputs).map(([key, value]) => (
            <p key={key} className="font-mono break-all">
              {key} = {value}
            </p>
          ))}
        </div>
      )}
      {challenge && (
        <Dialog open onOpenChange={(open) => !open && cancel()}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>
                {challenge.operation === 'apply'
                  ? 'Create real AWS resources?'
                  : 'Destroy real AWS resources?'}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-1 break-all text-sm">
              <p>
                Account {challenge.accountId} · profile {challenge.profileName} · {challenge.region}
              </p>
              <p className="font-mono text-xs">{challenge.principalArn}</p>
              <p>
                Terraform {challenge.terraform} {challenge.operation} in {challenge.directory} ·
                reviewed fingerprint {challenge.fingerprint.slice(7, 19)}
              </p>
              <ul className="font-mono text-xs">
                {challenge.files.map((file) => (
                  <li key={file}>{file}</li>
                ))}
              </ul>
              <p>
                {challenge.operation === 'apply'
                  ? 'This creates real resources that AWS bills until they are destroyed.'
                  : 'This deletes the resources this recipe manages. Data in them is lost.'}{' '}
                The confirmation is valid once, for one minute, and only for this account.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void confirm()}>
                {challenge.operation === 'apply' ? 'Apply to real AWS' : 'Destroy from real AWS'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
