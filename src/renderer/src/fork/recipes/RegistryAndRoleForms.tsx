import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  containerRegistrySchema,
  renderContainerRegistry,
  renderWorkloadRole,
  workloadRoleSchema
} from '../../../../shared/fork-recipes/registry-and-role'
import { RecipeForm } from './RecipeForm'

type Props = { projectId: string; onCreated: (snapshot: RecipeSnapshot) => void }

/** 10.5: an immutable, scanned, encrypted ECR repository with a retention rule. */
export function ContainerRegistryForm({ projectId, onCreated }: Props): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-container-registry"
      eyebrow="Quick resource"
      title="Container image registry"
      description="An Amazon ECR repository with immutable tags, scan on push, encryption, and a rule keeping only the most recent images."
      fields={[
        { key: 'name', label: 'Repository name', placeholder: 'checkout/api' },
        { key: 'keepImages', label: 'Images to keep', fallback: () => '20' },
        {
          key: 'scanOnPush',
          label: 'Scan on push',
          kind: 'select',
          options: [
            { value: 'yes', label: 'yes' },
            { value: 'no', label: 'no' }
          ]
        },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) =>
            `infra/${(values.name || 'registry').replace(/[^a-z0-9_-]+/g, '-')}-registry`
        },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{ scanOnPush: 'yes' }}
      schema={containerRegistrySchema}
      toInput={(values) => ({
        name: values.name,
        keepImages: Number(values.keepImages),
        scanOnPush: values.scanOnPush === 'yes',
        directory: values.directory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderContainerRegistry}
      request={(id, input) => ({ projectId: id, recipe: 'container-registry', input })}
      submitLabel="Create registry files"
      onCreated={onCreated}
    />
  )
}

/** 10.5: a role one AWS service may assume for this account only; grants nothing itself. */
export function WorkloadRoleForm({ projectId, onCreated }: Props): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-workload-role"
      eyebrow="Workload identity"
      title="Workload role"
      description="An IAM role that only ECS tasks or Lambda functions in this account can assume. It grants nothing by itself: attach the scoped policies from the bucket, secret and database recipes by giving them this role name."
      fields={[
        { key: 'name', label: 'Role name', placeholder: 'checkout-task' },
        {
          key: 'service',
          label: 'Assumed by',
          kind: 'select',
          options: [
            { value: 'ecs-tasks.amazonaws.com', label: 'ECS tasks' },
            { value: 'lambda.amazonaws.com', label: 'Lambda functions' }
          ]
        },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) => `infra/${values.name || 'workload'}-role`
        },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{ service: 'ecs-tasks.amazonaws.com' }}
      schema={workloadRoleSchema}
      toInput={(values) => ({
        name: values.name,
        service: values.service,
        directory: values.directory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderWorkloadRole}
      request={(id, input) => ({ projectId: id, recipe: 'workload-role', input })}
      submitLabel="Create role files"
      onCreated={onCreated}
    />
  )
}
