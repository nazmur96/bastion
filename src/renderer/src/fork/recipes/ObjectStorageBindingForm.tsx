import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import {
  BINDING_ACTIONS,
  objectStorageBindingSchema,
  renderObjectStorageBinding,
  suggestedConfigVariable,
  type ObjectStorageBinding
} from '../../../../shared/fork-recipes/object-storage-binding'
import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <input
        className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

/** Bind an application to an existing bucket: a scoped policy plus one config example. */
export function ObjectStorageBindingForm({
  projectId,
  target,
  onCreated
}: {
  projectId: string
  target: CloudTarget | null
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  const [bucket, setBucket] = useState('')
  const [directory, setDirectory] = useState('')
  const [access, setAccess] = useState<'read' | 'read-write'>('read')
  const [roleName, setRoleName] = useState('')
  const [variable, setVariable] = useState('')
  const [configDirectory, setConfigDirectory] = useState('config')
  const [owner, setOwner] = useState('')
  const [project, setProject] = useState('')
  const [buckets, setBuckets] = useState<string[] | null>(null)
  const [confirming, setConfirming] = useState<ObjectStorageBinding | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const floci =
    target?.configuration.kind === 'emulated' && target.configuration.provider === 'aws'
      ? target
      : null
  const candidate = {
    bucket,
    directory: directory || `infra/${bucket || 'bucket'}-access`,
    access,
    roleName: roleName || null,
    configVariable: variable || suggestedConfigVariable(bucket || 'bucket'),
    configDirectory,
    tags: { owner, project }
  }
  const parsed = objectStorageBindingSchema.safeParse(candidate)
  const loadBuckets = async (): Promise<void> => {
    if (!floci) {
      return
    }
    setError(null)
    const result = await window.api.cloudTargets?.listResources?.({
      projectId,
      targetId: floci.id
    })
    if (result?.ok) {
      const s3 = result.resources.results.find((item) => item.service === 's3')
      setBuckets(s3?.status === 'ok' ? s3.items.map((item) => item.name) : [])
    } else {
      setError(result?.message ?? 'Start the Floci target to list its buckets.')
    }
  }
  const create = async (input: ObjectStorageBinding): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.recipes?.create({
        projectId,
        recipe: 'object-storage-binding',
        input
      })
      if (result?.ok) {
        setConfirming(null)
        onCreated(result)
      } else {
        setConfirming(null)
        setError(result?.message ?? 'Recipes are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="recipe-object-storage-binding">
      <div className="workspace-eyebrow">Application dependency</div>
      <h2>Bind object storage to this application</h2>
      <p className="text-sm">
        Connects to a bucket that already exists, never creates it. Generates an IAM policy scoped
        to that bucket ({access === 'read' ? 'read' : 'read and write'} objects), optionally
        attached to an existing role, and one config example for the application.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Existing bucket" value={bucket} onChange={setBucket} />
        <Field
          label="Config variable"
          value={variable || suggestedConfigVariable(bucket || 'bucket')}
          onChange={setVariable}
        />
        <Field label="Config directory" value={configDirectory} onChange={setConfigDirectory} />
        <Field
          label="Infra directory (new)"
          value={directory || `infra/${bucket || 'bucket'}-access`}
          onChange={setDirectory}
        />
        <Field
          label="Existing IAM role (optional)"
          value={roleName}
          onChange={setRoleName}
          placeholder="none"
        />
        <label className="flex flex-col gap-1 text-xs">
          Access
          <select
            className="rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={access}
            onChange={(event) =>
              setAccess(event.target.value === 'read-write' ? 'read-write' : 'read')
            }
          >
            <option value="read">read ({BINDING_ACTIONS.read.join(', ')})</option>
            <option value="read-write">
              read-write ({BINDING_ACTIONS['read-write'].join(', ')})
            </option>
          </select>
        </label>
        <Field label="Owner tag" value={owner} onChange={setOwner} />
        <Field label="Project tag" value={project} onChange={setProject} />
      </div>
      {floci && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button variant="outline" size="sm" onClick={() => void loadBuckets()}>
            Load buckets from {floci.label}
          </Button>
          {buckets?.length === 0 && <span>No buckets listed.</span>}
          {buckets?.map((name) => (
            <Button key={name} variant="ghost" size="sm" onClick={() => setBucket(name)}>
              {name}
            </Button>
          ))}
        </div>
      )}
      {!parsed.success && bucket && (
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
        Create binding files
      </Button>
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Create these files?</DialogTitle>
            </DialogHeader>
            <ul className="font-mono text-xs">
              {renderObjectStorageBinding(confirming).map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <p className="text-xs">
              The infra directory must be new and no existing file is overwritten. The
              application&apos;s own configuration is not edited. Nothing is provisioned.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void create(confirming)}>
                Create binding files
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
