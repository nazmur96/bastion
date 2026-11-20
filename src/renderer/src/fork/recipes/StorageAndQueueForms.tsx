import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  messageQueueSchema,
  notificationTopicSchema,
  renderMessageQueue,
  renderNotificationTopic,
  suggestedResourceVariable
} from '../../../../shared/fork-recipes/messaging-recipes'
import {
  keyValueTableSchema,
  renderKeyValueTable
} from '../../../../shared/fork-recipes/key-value-table'
import { RecipeForm, type RecipeField } from './RecipeForm'

type Props = { projectId: string; onCreated: (snapshot: RecipeSnapshot) => void }
const yesNo = [
  { value: 'yes', label: 'yes' },
  { value: 'no', label: 'no' }
]
const keyTypes = [
  { value: 'S', label: 'string' },
  { value: 'N', label: 'number' },
  { value: 'B', label: 'binary' }
]
const slug = (value: string, fallback: string) =>
  (value || fallback).replace(/[^A-Za-z0-9_-]+/g, '-')
function common(suffix: string, kind: string): RecipeField[] {
  return [
    {
      key: 'configVariable',
      label: 'Config variable',
      fallback: (values) => suggestedResourceVariable(values.name || 'app', suffix)
    },
    { key: 'configDirectory', label: 'Config directory', fallback: () => 'config' },
    {
      key: 'directory',
      label: 'Infra directory (new)',
      fallback: (values) => `infra/${slug(values.name, kind)}-${kind}`
    },
    { key: 'owner', label: 'Owner tag' },
    { key: 'project', label: 'Project tag' }
  ]
}
const tags = (values: Record<string, string>) => ({ owner: values.owner, project: values.project })

/** 14.7: an SQS queue with a dead-letter queue and scoped producer/consumer policies. */
export function MessageQueueForm({ projectId, onCreated }: Props): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-message-queue"
      eyebrow="Application dependency"
      title="Message queue"
      description="An encrypted Amazon SQS queue with a dead-letter queue, TLS-only access, and separate producer and consumer policies you can attach to existing roles."
      fields={[
        { key: 'name', label: 'Queue name', placeholder: 'orders' },
        { key: 'visibilityTimeoutSeconds', label: 'Visibility timeout (s)', fallback: () => '30' },
        { key: 'retentionDays', label: 'Retention (days, 1–14)', fallback: () => '4' },
        { key: 'maxReceiveCount', label: 'Receives before dead-letter', fallback: () => '5' },
        { key: 'producerRole', label: 'Producer role (optional)', placeholder: 'none' },
        { key: 'consumerRole', label: 'Consumer role (optional)', placeholder: 'none' },
        ...common('QUEUE_NAME', 'queue')
      ]}
      initial={{}}
      schema={messageQueueSchema}
      toInput={(values) => ({
        name: values.name,
        visibilityTimeoutSeconds: Number(values.visibilityTimeoutSeconds),
        retentionDays: Number(values.retentionDays),
        maxReceiveCount: Number(values.maxReceiveCount),
        producerRole: values.producerRole || null,
        consumerRole: values.consumerRole || null,
        directory: values.directory,
        configVariable: values.configVariable,
        configDirectory: values.configDirectory,
        tags: tags(values)
      })}
      render={renderMessageQueue}
      request={(id, input) => ({ projectId: id, recipe: 'message-queue', input })}
      submitLabel="Create queue files"
      onCreated={onCreated}
    />
  )
}

/** 14.7: an SNS topic with a scoped publisher policy. */
export function NotificationTopicForm({ projectId, onCreated }: Props): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-notification-topic"
      eyebrow="Application dependency"
      title="Notification topic"
      description="An Amazon SNS topic encrypted with the AWS-managed key, TLS-only access, and a publisher policy you can attach to an existing role. Subscriptions are added by the consumers."
      fields={[
        { key: 'name', label: 'Topic name', placeholder: 'order-events' },
        { key: 'publisherRole', label: 'Publisher role (optional)', placeholder: 'none' },
        ...common('TOPIC_NAME', 'topic')
      ]}
      initial={{}}
      schema={notificationTopicSchema}
      toInput={(values) => ({
        name: values.name,
        publisherRole: values.publisherRole || null,
        directory: values.directory,
        configVariable: values.configVariable,
        configDirectory: values.configDirectory,
        tags: tags(values)
      })}
      render={renderNotificationTopic}
      request={(id, input) => ({ projectId: id, recipe: 'notification-topic', input })}
      submitLabel="Create topic files"
      onCreated={onCreated}
    />
  )
}

/** 14.7: an on-demand DynamoDB table with reader and writer policies. */
export function KeyValueTableForm({ projectId, onCreated }: Props): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-key-value-table"
      eyebrow="Application dependency"
      title="Key-value table"
      description="An on-demand Amazon DynamoDB table with point-in-time recovery and deletion protection, plus separate reader and writer policies for existing roles."
      fields={[
        { key: 'name', label: 'Table name', placeholder: 'orders' },
        { key: 'partitionKey', label: 'Partition key', placeholder: 'id' },
        { key: 'partitionKeyType', label: 'Partition key type', kind: 'select', options: keyTypes },
        { key: 'sortKey', label: 'Sort key (optional)', placeholder: 'none' },
        { key: 'sortKeyType', label: 'Sort key type', kind: 'select', options: keyTypes },
        {
          key: 'pointInTimeRecovery',
          label: 'Point-in-time recovery',
          kind: 'select',
          options: yesNo
        },
        { key: 'deletionProtection', label: 'Deletion protection', kind: 'select', options: yesNo },
        { key: 'readerRole', label: 'Reader role (optional)', placeholder: 'none' },
        { key: 'writerRole', label: 'Writer role (optional)', placeholder: 'none' },
        ...common('TABLE_NAME', 'table')
      ]}
      initial={{
        partitionKeyType: 'S',
        sortKeyType: 'S',
        pointInTimeRecovery: 'yes',
        deletionProtection: 'yes'
      }}
      schema={keyValueTableSchema}
      toInput={(values) => ({
        name: values.name,
        partitionKey: values.partitionKey,
        partitionKeyType: values.partitionKeyType,
        sortKey: values.sortKey || null,
        sortKeyType: values.sortKeyType,
        pointInTimeRecovery: values.pointInTimeRecovery === 'yes',
        deletionProtection: values.deletionProtection === 'yes',
        readerRole: values.readerRole || null,
        writerRole: values.writerRole || null,
        directory: values.directory,
        configVariable: values.configVariable,
        configDirectory: values.configDirectory,
        tags: tags(values)
      })}
      render={renderKeyValueTable}
      request={(id, input) => ({ projectId: id, recipe: 'key-value-table', input })}
      submitLabel="Create table files"
      onCreated={onCreated}
    />
  )
}
