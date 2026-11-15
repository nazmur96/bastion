import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import {
  objectStorageInputSchema,
  renderObjectStorageRecipe,
  type ObjectStorageInput
} from '../../../../shared/fork-recipes/object-storage-recipe'
import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'

function Field({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <input
        className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** The object storage recipe form: inputs are checked before anything is written. */
export function ObjectStorageRecipeForm({
  projectId,
  onCreated
}: {
  projectId: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [directory, setDirectory] = useState('')
  const [versioning, setVersioning] = useState(true)
  const [owner, setOwner] = useState('')
  const [project, setProject] = useState('')
  const [confirming, setConfirming] = useState<ObjectStorageInput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const candidate = {
    name,
    directory: directory || `infra/${name || 'bucket'}`,
    versioning,
    tags: { owner, project }
  }
  const parsed = objectStorageInputSchema.safeParse(candidate)
  const create = async (input: ObjectStorageInput): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.recipes?.create({
        projectId,
        recipe: 'object-storage',
        input
      })
      if (result?.ok) {
        setConfirming(null)
        onCreated(result)
      } else {
        setError(result?.message ?? 'Recipes are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="recipe-object-storage">
      <div className="workspace-eyebrow">Quick resource</div>
      <h2>Object storage bucket</h2>
      <p className="text-sm">
        An S3 bucket with public access blocked, bucket-owner enforced ownership, SSE-S3 encryption,
        optional versioning and ownership tags. Generates ordinary Terraform you own and can edit.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Bucket name" value={name} onChange={setName} />
        <Field
          label="Directory (new)"
          value={directory || `infra/${name || 'bucket'}`}
          onChange={setDirectory}
        />
        <Field label="Owner tag" value={owner} onChange={setOwner} />
        <Field label="Project tag" value={project} onChange={setProject} />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={versioning}
          onChange={(event) => setVersioning(event.target.checked)}
        />
        Keep previous object versions
      </label>
      {!parsed.success && name && (
        <p className="text-xs text-destructive">
          {parsed.error.issues[0]?.message ?? 'Check the values.'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={busy || !parsed.success}
        title={capabilityNote('recipes.create')}
        onClick={() => parsed.success && setConfirming(parsed.data)}
      >
        Create files
      </Button>
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Create these files?</DialogTitle>
            </DialogHeader>
            <ul className="font-mono text-xs">
              {renderObjectStorageRecipe(confirming).map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <p className="text-xs">
              The directory must be new; existing files are never overwritten. Nothing is
              provisioned.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void create(confirming)}>
                Create files
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
