import { defineFixture } from '../../component-fixtures/component-fixture'
import { normalizeResourceListing } from '../../../../shared/fork-cloud/cloud-resource-view'
import { CloudResourcesView } from './CloudResourcesView'
import type { FlociProvider } from '../../../../shared/fork-cloud/floci-products'
import type { FlociServiceResult } from '../../../../shared/fork-cloud/floci-resources-contract'
function sample(provider: FlociProvider, results: FlociServiceResult[]) {
  return defineFixture({
    width: 700,
    render: () => (
      <CloudResourcesView
        listing={normalizeResourceListing(
          'emulated',
          { provider, at: Date.UTC(2026, 10, 15, 12), results },
          'fixture'
        )}
      />
    )
  })
}
export const azure = sample('azure', [
  {
    service: 'azure-containers',
    status: 'ok',
    items: [
      {
        name: 'fixture-container',
        arn: null,
        resourceId: 'devstoreaccount1/containers/fixture-container'
      }
    ],
    truncated: false
  }
])
export const gcp = sample('gcp', [
  {
    service: 'gcp-buckets',
    status: 'ok',
    items: [{ name: 'fixture-bucket', arn: null, resourceId: 'projects/_/buckets/fixture-bucket' }],
    truncated: false
  },
  {
    service: 'gcp-topics',
    status: 'ok',
    items: [
      {
        name: 'fixture-topic',
        arn: null,
        resourceId: 'projects/bastion-emulated/topics/fixture-topic'
      }
    ],
    truncated: false
  }
])
export const oci = sample('oci', [
  {
    service: 'oci-buckets',
    status: 'ok',
    items: [{ name: 'fixture-bucket', arn: null, resourceId: 'n/floci-local/b/fixture-bucket' }],
    truncated: false
  },
  {
    service: 'oci-compartments',
    status: 'ok',
    items: [
      { name: 'fixture-compartment', arn: null, resourceId: 'ocid1.compartment.oc1..fixture' }
    ],
    truncated: false
  }
])
export const unknown = sample('gcp', [
  { service: 'gcp-buckets', status: 'denied', items: [], truncated: false },
  { service: 'gcp-topics', status: 'ok', items: [], truncated: true }
])
