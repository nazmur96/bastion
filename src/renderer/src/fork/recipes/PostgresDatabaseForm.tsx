import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  postgresDatabaseSchema,
  renderPostgresDatabase
} from '../../../../shared/fork-recipes/postgres-database'
import { RecipeForm } from './RecipeForm'

const yesNo = [
  { value: 'yes', label: 'yes' },
  { value: 'no', label: 'no' }
]
const items = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/** 10.4: PostgreSQL on RDS. Password managed by RDS; never public; scoped network access. */
export function PostgresDatabaseForm({
  projectId,
  onCreated
}: {
  projectId: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-postgres-database"
      eyebrow="Application dependency"
      title="PostgreSQL database"
      description="Connect to an existing RDS PostgreSQL instance, or create one. RDS keeps the master password in Secrets Manager, so no password reaches your source, Terraform state or Bastion. Never publicly accessible; encrypted storage; port 5432 only from the CIDR blocks you list. Applies to real AWS only: the local emulator cannot run databases under Bastion's policy."
      fields={[
        {
          key: 'mode',
          label: 'Database',
          kind: 'select',
          options: [
            { value: 'existing', label: 'Connect to an existing instance' },
            { value: 'create', label: 'Create a new instance' }
          ]
        },
        { key: 'identifier', label: 'Instance identifier', placeholder: 'orders-db' },
        { key: 'databaseName', label: 'Database name', fallback: () => 'app' },
        {
          key: 'engineVersion',
          label: 'PostgreSQL version',
          kind: 'select',
          options: [
            { value: '17', label: '17' },
            { value: '16', label: '16' }
          ]
        },
        {
          key: 'instanceClass',
          label: 'Instance class',
          kind: 'select',
          options: ['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium'].map((value) => ({
            value,
            label: value
          }))
        },
        { key: 'allocatedStorage', label: 'Storage (GiB, 20–100)', fallback: () => '20' },
        { key: 'vpcId', label: 'VPC (create)', placeholder: 'vpc-…' },
        {
          key: 'subnetIds',
          label: 'Subnets, comma-separated (create)',
          placeholder: 'subnet-…, subnet-…'
        },
        { key: 'allowedCidrs', label: 'Allowed CIDRs (create)', placeholder: '10.0.0.0/16' },
        { key: 'deletionProtection', label: 'Deletion protection', kind: 'select', options: yesNo },
        { key: 'skipFinalSnapshot', label: 'Skip final snapshot', kind: 'select', options: yesNo },
        { key: 'backupRetentionDays', label: 'Backup retention (days)', fallback: () => '7' },
        {
          key: 'configPrefix',
          label: 'Config prefix',
          fallback: (values) =>
            `${(values.identifier || 'app').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`.replace(
              /^[^A-Z]+/,
              'DB_'
            )
        },
        { key: 'configDirectory', label: 'Config directory', fallback: () => 'config' },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) => `infra/${values.identifier || 'database'}`
        },
        { key: 'roleName', label: 'Existing IAM role (optional)', placeholder: 'none' },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{
        mode: 'existing',
        engineVersion: '17',
        instanceClass: 'db.t4g.micro',
        deletionProtection: 'yes',
        skipFinalSnapshot: 'no'
      }}
      schema={postgresDatabaseSchema}
      toInput={(values) => ({
        mode: values.mode,
        identifier: values.identifier,
        databaseName: values.databaseName,
        engineVersion: values.engineVersion,
        instanceClass: values.instanceClass,
        allocatedStorage: Number(values.allocatedStorage),
        vpcId: values.vpcId || null,
        subnetIds: items(values.subnetIds),
        allowedCidrs: items(values.allowedCidrs),
        deletionProtection: values.deletionProtection === 'yes',
        skipFinalSnapshot: values.skipFinalSnapshot === 'yes',
        backupRetentionDays: Number(values.backupRetentionDays),
        directory: values.directory,
        roleName: values.roleName || null,
        configPrefix: values.configPrefix,
        configDirectory: values.configDirectory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderPostgresDatabase}
      request={(id, input) => ({ projectId: id, recipe: 'postgres-database', input })}
      submitLabel="Create database files"
      onCreated={onCreated}
    />
  )
}
