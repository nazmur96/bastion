import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  renderSecretReference,
  secretReferenceSchema
} from '../../../../shared/fork-recipes/secret-reference'
import { RecipeForm } from './RecipeForm'

function variableFor(name: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${/^[A-Z]/.test(base) ? base : `SECRET_${base}`}_SECRET`.slice(0, 64)
}

/** 10.3: a reference to a secret, never its value. */
export function SecretReferenceForm({
  projectId,
  onCreated
}: {
  projectId: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-secret-reference"
      eyebrow="Application dependency"
      title="Secret reference"
      description="Creates an empty AWS Secrets Manager secret, or connects to an existing one, plus a read policy scoped to that secret. Bastion never writes, reads or stores the secret value; set it yourself with your own tools."
      fields={[
        {
          key: 'mode',
          label: 'Secret',
          kind: 'select',
          options: [
            { value: 'create', label: 'Create an empty secret' },
            { value: 'existing', label: 'Connect to an existing secret' }
          ]
        },
        { key: 'secretName', label: 'Secret name', placeholder: 'checkout/db-password' },
        {
          key: 'recoveryWindowDays',
          label: 'Recovery window (days: 0 or 7–30)',
          fallback: () => '7'
        },
        {
          key: 'configVariable',
          label: 'Config variable',
          fallback: (values) => variableFor(values.secretName || 'app')
        },
        { key: 'configDirectory', label: 'Config directory', fallback: () => 'config' },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) =>
            `infra/${(values.secretName || 'secret').replace(/[^A-Za-z0-9_-]+/g, '-')}-secret`
        },
        { key: 'roleName', label: 'Existing IAM role (optional)', placeholder: 'none' },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{ mode: 'create' }}
      schema={secretReferenceSchema}
      toInput={(values) => ({
        mode: values.mode,
        secretName: values.secretName,
        recoveryWindowDays: Number(values.recoveryWindowDays),
        directory: values.directory,
        roleName: values.roleName || null,
        configVariable: values.configVariable,
        configDirectory: values.configDirectory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderSecretReference}
      request={(id, input) => ({ projectId: id, recipe: 'secret-reference', input })}
      submitLabel="Create secret reference files"
      onCreated={onCreated}
    />
  )
}
