import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  renderSecretRotation,
  secretRotationSchema
} from '../../../../shared/fork-recipes/secret-rotation'
import { RecipeForm } from './RecipeForm'

/** 14.8: rotation for an existing secret, by a rotation function or a manual runbook. */
export function SecretRotationForm({
  projectId,
  onCreated
}: {
  projectId: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-secret-rotation"
      eyebrow="Application dependency"
      title="Secret rotation"
      description="Rotates an existing Secrets Manager secret on a schedule with an existing rotation function, or writes a manual-rotation runbook. Bastion never writes, reads or shows the value; the application keeps its reference."
      fields={[
        { key: 'secretName', label: 'Secret name', placeholder: 'checkout/db-password' },
        {
          key: 'mode',
          label: 'Rotation',
          kind: 'select',
          options: [
            { value: 'function', label: 'Managed, by a rotation function' },
            { value: 'manual', label: 'Manual, with a runbook' }
          ]
        },
        {
          key: 'functionName',
          label: 'Rotation function (managed only)',
          placeholder: 'checkout-db-rotation'
        },
        { key: 'everyDays', label: 'Every (days)', fallback: () => '30' },
        {
          key: 'rotateImmediately',
          label: 'Rotate once on apply',
          kind: 'select',
          options: [
            { value: 'no', label: 'no' },
            { value: 'yes', label: 'yes' }
          ]
        },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) =>
            `infra/${(values.secretName || 'secret').replace(/[^A-Za-z0-9_-]+/g, '-')}-rotation`
        },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{ mode: 'function', rotateImmediately: 'no' }}
      schema={secretRotationSchema}
      toInput={(values) => ({
        secretName: values.secretName,
        mode: values.mode,
        functionName: values.mode === 'function' ? values.functionName || null : null,
        everyDays: Number(values.everyDays),
        rotateImmediately: values.mode === 'function' && values.rotateImmediately === 'yes',
        directory: values.directory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderSecretRotation}
      request={(id, input) => ({ projectId: id, recipe: 'secret-rotation', input })}
      submitLabel="Create rotation files"
      onCreated={onCreated}
    />
  )
}
