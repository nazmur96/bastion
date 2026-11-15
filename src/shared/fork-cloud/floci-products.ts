import { FLOCI_IMAGE } from './floci-contract'
export type FlociProvider = 'aws' | 'azure' | 'gcp' | 'oci'
const pendingResources = 'Resource listings are not available for this provider yet.'
export const FLOCI_PRODUCTS: Record<
  FlociProvider,
  {
    label: string
    image: string
    version: string
    prefix: string
    port: number
    readyPath: string
    readyKind: string
    services: string[]
    enabled: string[]
    terminalUnavailableReason: string | null
    resourcesUnavailableReason: string | null
  }
> = {
  aws: {
    label: 'Floci AWS',
    image: FLOCI_IMAGE,
    version: '2.4.0',
    prefix: 'FLOCI',
    port: 4566,
    readyPath: '/_floci/init',
    readyKind: 'completed-ready',
    services: [],
    enabled: [],
    terminalUnavailableReason: null,
    resourcesUnavailableReason: null
  },
  azure: {
    label: 'Floci Azure',
    image: 'floci/floci-az@sha256:f9d7552c9c02be84f12e266d6201ff52c1f23421af94943cbf687526ded89790',
    version: '0.16.0',
    prefix: 'FLOCI_AZ',
    port: 4577,
    readyPath: '/ready',
    readyKind: 'status-up',
    services: [
      'signalr',
      'blob',
      'queue',
      'table',
      'functions',
      'app-config',
      'cosmos',
      'key-vault',
      'event-hub',
      'sql',
      'service-bus',
      'monitor',
      'aks',
      'aci',
      'container-apps',
      'vm',
      'apim',
      'redis',
      'acr',
      'entra',
      'graph',
      'email',
      'arm',
      'network',
      'event-grid',
      'deployments',
      'managed-identity',
      'policy',
      'resource-graph',
      'management-groups'
    ],
    enabled: ['blob'],
    terminalUnavailableReason: 'Azure terminal integration is not available yet.',
    resourcesUnavailableReason: pendingResources
  },
  gcp: {
    label: 'Floci GCP',
    image:
      'floci/floci-gcp@sha256:d02e70407d6b37c3e24e31b5ccf100606735cba4f84fd476708b35afd052abb3',
    version: '0.12.0',
    prefix: 'FLOCI_GCP',
    port: 4588,
    readyPath: '/_floci-gcp/init',
    readyKind: 'completed-ready',
    services: [
      'compute',
      'gcs',
      'pubsub',
      'firestore',
      'datastore',
      'iam',
      'iamcredentials',
      'sts',
      'secretmanager',
      'logging',
      'kms',
      'kafka',
      'cloudsql',
      'cloudtasks',
      'cloudrun',
      'cloudfunctions',
      'monitoring',
      'scheduler',
      'eventarc',
      'bigquery',
      'gke',
      'serviceusage',
      'resourcemanager',
      'cloudbilling',
      'firebaseauth'
    ],
    enabled: ['gcs', 'pubsub'],
    terminalUnavailableReason: 'GCP terminal integration is not available yet.',
    resourcesUnavailableReason: pendingResources
  },
  oci: {
    label: 'Floci OCI',
    image:
      'floci/floci-oci@sha256:7b976aabefd8a53ebf09df52b788a1b3c3cd4e71f2e0b29efe8f9d8b3954fbd3',
    version: '0.6.0',
    prefix: 'FLOCI_OCI',
    port: 4599,
    readyPath: '/_floci-oci/init',
    readyKind: 'completed-ready',
    services: [
      'identity',
      'objectstorage',
      'queue',
      'kms',
      'vault',
      'streaming',
      'organizations',
      'governancerules',
      'functions',
      'oke',
      'psql'
    ],
    enabled: ['identity', 'objectstorage'],
    terminalUnavailableReason:
      'OCI CLI is unavailable: its local signing-key setup is not supported yet. No real profile or key is used.',
    resourcesUnavailableReason: pendingResources
  }
}

export function flociProduct(provider: FlociProvider = 'aws') {
  return FLOCI_PRODUCTS[provider]
}
export function flociContainerEnvironment(provider: FlociProvider, port: number): string[] {
  if (provider === 'aws') {
    return ['FLOCI_STORAGE_MODE=persistent', 'AWS_EC2_METADATA_DISABLED=true']
  }
  const p = flociProduct(provider)
  return [
    `${p.prefix}_STORAGE_MODE=persistent`,
    `${p.prefix}_STORAGE_PERSISTENT_PATH=/app/data`,
    `${p.prefix}_BASE_URL=http://127.0.0.1:${port}`,
    `${p.prefix}_TLS_ENABLED=false`,
    `${p.prefix}_TLS_HTTPS_PORT=0`,
    `${p.prefix}_DNS_CONTAINER_FALLBACK_ENABLED=false`,
    ...p.services.map(
      (name) =>
        `${p.prefix}_SERVICES_${name.replaceAll('-', '_').toUpperCase()}_ENABLED=${p.enabled.includes(name)}`
    ),
    ...(provider === 'azure'
      ? ['FLOCI_AZ_UI_ENABLED=false', 'FLOCI_AZ_SERVICES_FUNCTIONS_CODE_PATH=/app/data/functions']
      : [])
  ]
}
export function flociImageEnvironment(provider: FlociProvider): string[] {
  const p = flociProduct(provider)
  return [
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `${p.prefix}_VERSION=${p.version}`,
    `${p.prefix}_STORAGE_PERSISTENT_PATH=/app/data`,
    ...(provider === 'aws' ? ['LD_LIBRARY_PATH=/app'] : [])
  ]
}
export function flociApplicationArgs(provider: FlociProvider): string[] {
  return [
    '-Dquarkus.http.host=0.0.0.0',
    ...(provider === 'aws' ? ['-Dfloci.security.allow-unsafe-network-exposure=true'] : [])
  ]
}
