import { useState } from 'react'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { RecipeFile } from '../../../../shared/fork-recipes/object-storage-recipe'
import type {
  RecipeCreateRequest,
  RecipeSnapshot
} from '../../../../shared/fork-recipes/recipe-contract'

export type RecipeField = {
  key: string
  label: string
  kind?: 'text' | 'select'
  options?: { value: string; label: string }[]
  placeholder?: string
  /** Shown while the engineer has not typed a value. */
  fallback?: (values: Record<string, string>) => string
}

/** One recipe form: validated before anything is written; files listed before creation. */
export function RecipeForm<Input>({
  projectId,
  testId,
  eyebrow,
  title,
  description,
  fields,
  initial,
  schema,
  toInput,
  render,
  request,
  submitLabel,
  onCreated
}: {
  projectId: string
  testId: string
  eyebrow: string
  title: string
  description: string
  fields: RecipeField[]
  initial: Record<string, string>
  schema: z.ZodType<Input>
  toInput: (values: Record<string, string>) => unknown
  render: (input: Input) => RecipeFile[]
  request: (projectId: string, input: Input) => RecipeCreateRequest
  submitLabel: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  const [values, setValues] = useState(initial)
  const [confirming, setConfirming] = useState<Input | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const effective = Object.fromEntries(
    fields.map((field) => [field.key, values[field.key] || field.fallback?.(values) || ''])
  )
  const parsed = schema.safeParse(toInput(effective))
  const touched = fields.some(
    (field) => values[field.key] && values[field.key] !== initial[field.key]
  )
  const create = async (input: Input): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.cloudTargets?.recipes?.create(request(projectId, input))
      setConfirming(null)
      if (result?.ok) {
        onCreated(result)
      } else {
        setError(result?.message ?? 'Recipes are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid={testId}>
      <div className="workspace-eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p className="text-sm">{description}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs">
            {field.label}
            {field.kind === 'select' ? (
              <select
                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                value={effective[field.key]}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              >
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="rounded-md border border-input bg-background px-2 py-1 font-mono text-sm"
                value={effective[field.key]}
                placeholder={field.placeholder}
                onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
              />
            )}
          </label>
        ))}
      </div>
      {!parsed.success && touched && (
        <p className="text-xs text-destructive">
          {parsed.error.issues[0]
            ? `${parsed.error.issues[0].path.join('.') || 'input'}: ${parsed.error.issues[0].message}`
            : 'Check the values.'}
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
        {submitLabel}
      </Button>
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && setConfirming(null)}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Create these files?</DialogTitle>
            </DialogHeader>
            <ul className="font-mono text-xs">
              {render(confirming).map((file) => (
                <li key={file.path}>{file.path}</li>
              ))}
            </ul>
            <p className="text-xs">
              The infra directory must be new and no existing file is overwritten. Nothing is
              provisioned until you apply.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void create(confirming)}>
                {submitLabel}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
