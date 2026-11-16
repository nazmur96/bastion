import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getIntlLocale } from '@/i18n/i18n'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import {
  deliveryConfigSchema,
  type DeliveryChain,
  type DeliveryConfig
} from '../../../../shared/fork-delivery/delivery-contract'
import type { WorkloadDiagnosis } from '../../../../shared/fork-delivery/operations-contract'
import { DeliveryDiagnosisSection } from './DeliveryDiagnosisSection'
import { DeliveryVerificationSection } from './DeliveryVerificationSection'

const LABELS: Record<string, string> = {
  revision: 'Source revision',
  ci: 'CI result',
  artifact: 'Published artifact',
  registry: 'Registry image',
  config: 'Deployment config',
  controller: 'Controller (Argo CD)',
  running: 'Running pods'
}
const FIELDS: {
  key: keyof Omit<DeliveryConfig, 'projectId' | 'revision'>
  label: string
  placeholder: string
}[] = [
  { key: 'repository', label: 'GitHub repository', placeholder: 'owner/name' },
  { key: 'workflow', label: 'CI workflow file', placeholder: 'build.yml' },
  { key: 'configPath', label: 'Deployment config', placeholder: 'deploy/kustomization.yaml' },
  { key: 'imageName', label: 'Image name in config', placeholder: 'app' },
  { key: 'application', label: 'Argo CD application', placeholder: 'my-app' },
  { key: 'applicationNamespace', label: 'Application namespace', placeholder: 'argocd' }
]
const storageKey = (projectId: string) => `bastion.delivery.${projectId}`
function remembered(projectId: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(projectId)) ?? '{}')
    return value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {}
  } catch {
    return {}
  }
}

/** Fork: Step 11 Delivery page. Evidence from real sources; promotion is a reviewed edit. */
export function WorkspaceDeliveryPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    applicationNamespace: 'argocd',
    ...remembered(worktreeId)
  }))
  const [revision, setRevision] = useState('')
  const [chain, setChain] = useState<DeliveryChain | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [promoting, setPromoting] = useState(false)
  const [promoted, setPromoted] = useState<string | null>(null)
  const [diagnosis, setDiagnosis] = useState<WorkloadDiagnosis | null>(null)
  const parsed = deliveryConfigSchema.safeParse({
    projectId: worktreeId,
    ...values,
    revision: revision.trim() || null
  })
  const read = async (): Promise<void> => {
    if (!parsed.success) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      localStorage.setItem(storageKey(worktreeId), JSON.stringify(values))
    } catch {
      // Remembering the settings is a convenience only.
    }
    try {
      const result = await window.api.cloudTargets?.delivery?.chain(parsed.data)
      if (result?.ok) {
        setChain(result.chain)
      } else {
        setError(result?.message ?? 'Delivery evidence is unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  const promote = async (): Promise<void> => {
    if (!parsed.success || !chain?.digest || !chain.revision || !chain.configFingerprint) {
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.delivery?.promote({
        ...parsed.data,
        revision: chain.revision,
        digest: chain.digest,
        configFingerprint: chain.configFingerprint
      })
      setPromoting(false)
      if (result?.ok) {
        setPromoted(
          `${result.path} now pins ${result.to.slice(0, 19)}… (was ${result.from?.slice(0, 19) ?? 'unset'}…).`
        )
      } else {
        setError(result?.message ?? 'Promotion is unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  const alreadyPinned = chain?.digest !== null && chain?.digest === chain?.configDigest
  return (
    <div className="workspace-page scrollbar-sleek" data-testid="workspace-delivery">
      <header className="workspace-page-heading">
        <div>
          <div className="workspace-eyebrow">Environments & delivery</div>
          <h1>Delivery</h1>
          <p>
            Follow one revision from source to running pods. Every link is read from its real
            source; anything that cannot be read is unknown, never assumed.
          </p>
        </div>
      </header>
      <section className="workspace-card space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field.key} className="flex flex-col gap-1 text-xs">
              {field.label}
              <input
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
                value={values[field.key] ?? ''}
                placeholder={field.placeholder}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1 text-xs">
            Revision (full SHA; empty for HEAD)
            <input
              className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
              value={revision}
              placeholder="HEAD"
              onChange={(event) => setRevision(event.target.value)}
            />
          </label>
        </div>
        <Button
          disabled={busy || !parsed.success}
          title={capabilityNote('delivery.evidence')}
          onClick={() => void read()}
        >
          {busy ? 'Reading…' : 'Read delivery evidence'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>
      {chain && (
        <section className="workspace-card space-y-3" data-testid="delivery-chain">
          <p className="text-xs text-muted-foreground">
            Read {new Date(chain.readAt).toLocaleTimeString(getIntlLocale())}
          </p>
          <ol className="space-y-2">
            {chain.links.map((link) => (
              <li
                key={link.id}
                className="flex flex-wrap items-baseline gap-2 text-sm"
                data-link={link.id}
              >
                <Badge variant={link.status === 'verified' ? 'secondary' : 'outline'}>
                  {link.status}
                </Badge>
                <span className="font-medium">{LABELS[link.id]}</span>
                <span className="font-mono text-xs">{link.detail}</span>
                <span className="text-xs text-muted-foreground">· {link.source}</span>
              </li>
            ))}
          </ol>
          {chain.promotable ? (
            <Button
              disabled={busy || alreadyPinned}
              title={capabilityNote('delivery.promote')}
              onClick={() => setPromoting(true)}
            >
              {alreadyPinned ? 'This digest is already pinned' : 'Promote this revision…'}
            </Button>
          ) : (
            <p className="text-sm" data-testid="delivery-blocked">
              Not promotable: {LABELS[chain.blockedBy ?? 'ci']} is not verified for this revision.
            </p>
          )}
          {promoted && (
            <p className="text-sm" data-testid="delivery-promoted">
              {promoted} Commit and push it with Source Control; the controller deploys from Git.
              Then read the evidence again.
            </p>
          )}
        </section>
      )}
      <DeliveryDiagnosisSection
        config={parsed.success ? parsed.data : null}
        diagnosis={diagnosis}
        onDiagnosis={setDiagnosis}
      />
      <DeliveryVerificationSection
        projectId={worktreeId}
        config={parsed.success ? parsed.data : null}
        diagnosis={diagnosis}
      />
      {promoting && chain?.digest && (
        <Dialog open onOpenChange={(open) => !open && setPromoting(false)}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Pin this verified image in the deployment config?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 break-all text-sm">
              <p>
                {values.configPath} · image {values.imageName}
              </p>
              <p className="font-mono text-xs">
                {chain.configDigest ?? 'unset'} → {chain.digest}
              </p>
              <p>
                Revision {chain.revision?.slice(0, 12)}: CI, artifact and registry label verified.
                Only this one field changes; you commit and push it, and the controller deploys it.
              </p>
              <p className="text-xs text-muted-foreground">
                Rolling back is the same step with an earlier verified revision. It does not undo
                data or schema changes or external side effects, and the controller&apos;s sync
                policy decides when it takes effect.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPromoting(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void promote()}>
                Pin digest
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
