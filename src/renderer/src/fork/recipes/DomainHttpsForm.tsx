import type { RecipeSnapshot } from '../../../../shared/fork-recipes/recipe-contract'
import {
  domainHttpsSchema,
  renderDomainHttps
} from '../../../../shared/fork-recipes/domain-and-https'
import { suggestedResourceVariable } from '../../../../shared/fork-recipes/messaging-recipes'
import { RecipeForm } from './RecipeForm'

/** 14.6: a DNS record and a DNS-validated certificate in an existing hosted zone. */
export function DomainHttpsForm({
  projectId,
  onCreated
}: {
  projectId: string
  onCreated: (snapshot: RecipeSnapshot) => void
}): React.JSX.Element {
  return (
    <RecipeForm
      projectId={projectId}
      testId="recipe-domain-https"
      eyebrow="Application dependency"
      title="Domain and HTTPS"
      description="Adds a DNS record for the application in an existing Route 53 hosted zone and an ACM certificate validated through DNS records in that zone. Apply waits until the certificate is issued. The zone itself is never created or changed, and existing records are never overwritten."
      fields={[
        { key: 'zoneName', label: 'Hosted zone', placeholder: 'example.com' },
        { key: 'recordName', label: 'Application name', placeholder: 'app.example.com' },
        {
          key: 'targetKind',
          label: 'Points to',
          kind: 'select',
          options: [
            { value: 'cname', label: 'a hostname (CNAME)' },
            { value: 'alias', label: 'an AWS load balancer or CloudFront (alias)' }
          ]
        },
        { key: 'targetHostname', label: 'Target hostname', placeholder: 'my-lb.elb.amazonaws.com' },
        { key: 'targetZoneId', label: 'Target hosted zone id (alias only)', placeholder: 'Z…' },
        {
          key: 'alternativeNames',
          label: 'Extra certificate names (optional)',
          placeholder: 'www.example.com'
        },
        {
          key: 'certificateScope',
          label: 'Certificate for',
          kind: 'select',
          options: [
            { value: 'regional', label: 'a load balancer or API (this region)' },
            { value: 'cloudfront', label: 'CloudFront (us-east-1)' }
          ]
        },
        {
          key: 'configVariable',
          label: 'Config variable',
          fallback: (values) =>
            suggestedResourceVariable((values.recordName || 'app').split('.')[0], 'PUBLIC_URL')
        },
        { key: 'configDirectory', label: 'Config directory', fallback: () => 'config' },
        {
          key: 'directory',
          label: 'Infra directory (new)',
          fallback: (values) =>
            `infra/${(values.recordName || 'app').replace(/[^a-z0-9-]+/g, '-')}-https`
        },
        { key: 'owner', label: 'Owner tag' },
        { key: 'project', label: 'Project tag' }
      ]}
      initial={{ targetKind: 'cname', certificateScope: 'regional' }}
      schema={domainHttpsSchema}
      toInput={(values) => ({
        zoneName: values.zoneName,
        recordName: values.recordName,
        target:
          values.targetKind === 'alias'
            ? { kind: 'alias', hostname: values.targetHostname, zoneId: values.targetZoneId }
            : { kind: 'cname', hostname: values.targetHostname },
        alternativeNames: values.alternativeNames.split(/[\s,]+/).filter(Boolean),
        certificateScope: values.certificateScope,
        directory: values.directory,
        configVariable: values.configVariable,
        configDirectory: values.configDirectory,
        tags: { owner: values.owner, project: values.project }
      })}
      render={renderDomainHttps}
      request={(id, input) => ({ projectId: id, recipe: 'domain-https', input })}
      submitLabel="Create domain files"
      onCreated={onCreated}
    />
  )
}
