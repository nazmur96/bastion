import { chmodSync, lstatSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FlociFailure, type FlociInstance } from '../../../shared/fork-cloud/floci-contract'
import type { FlociProvider } from '../../../shared/fork-cloud/floci-products'
import { privateFlociDirectory } from './floci-paths'
const cloudVariable =
  /^(AWS_|AZURE_|ARM_|GOOGLE_|GCLOUD_|CLOUDSDK_|GCE_|OCI_|FLOCI_|BOTO|MSI_|IDENTITY_|IMDS_|TF_VAR_CLIENT_HOST_OVERRIDES$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$|NO_PROXY$|http_proxy$|https_proxy$|all_proxy$|no_proxy$)|(?:TOKEN|API_KEY|CLIENT_SECRET|CREDENTIALS?|PASSWORD)$/i
const cleared = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_CERTIFICATE_PATH',
  'AZURE_FEDERATED_TOKEN_FILE',
  'AZURE_AUTHORITY_HOST',
  'AZURE_STORAGE_SAS_TOKEN',
  'ARM_CLIENT_SECRET',
  'MSI_ENDPOINT',
  'MSI_SECRET',
  'IDENTITY_ENDPOINT',
  'IDENTITY_HEADER',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_API_KEY',
  'GOOGLE_AUTH_TOKEN',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'CLOUDSDK_AUTH_ACCESS_TOKEN_FILE',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT',
  'OCI_CLI_KEY_CONTENT',
  'OCI_CLI_KEY_FILE',
  'OCI_CLI_SECURITY_TOKEN_FILE',
  'OCI_CLI_AUTH',
  'OCI_RESOURCE_PRINCIPAL_RPST',
  'OCI_RESOURCE_PRINCIPAL_PRIVATE_PEM',
  'OCI_RESOURCE_PRINCIPAL_VERSION',
  'OCI_RESOURCE_PRINCIPAL_RPT_ENDPOINT',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS'
]
function emptyFile(directory: string, name: string): string {
  const path = join(directory, name)
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new FlociFailure('storage')
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  writeFileSync(path, '', { mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600)
  }
  return path
}
export function flociClientProfile(
  root: string,
  instance: FlociInstance,
  provider: Exclude<FlociProvider, 'aws'>,
  owner: NodeJS.ProcessEnv
): Record<string, string> {
  // Inspect names only: ambient credential values and provider files are never read.
  const env: Record<string, string> = Object.fromEntries(
    [
      ...new Set([...cleared, ...Object.keys(owner).filter((name) => cloudVariable.test(name))])
    ].map((name) => [name, ''])
  )
  privateFlociDirectory(join(root, 'bastion-cloud'))
  const control = join(root, 'bastion-cloud', 'control')
  privateFlociDirectory(control)
  const home = join(control, `${instance.targetId}-${instance.id}-home`)
  privateFlociDirectory(home)
  const config = join(home, '.config')
  privateFlociDirectory(config)
  Object.assign(env, {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: config,
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
    AWS_EC2_METADATA_DISABLED: 'true',
    MISE_AUTO_INSTALL: '0',
    ZDOTDIR: home,
    BASH_ENV: '',
    ENV: ''
  })
  for (const name of [
    'PATH',
    'SystemRoot',
    'SystemDrive',
    'WINDIR',
    'PATHEXT',
    'TMP',
    'TEMP',
    'TMPDIR',
    'NIX_LD',
    'NIX_LD_LIBRARY_PATH',
    'LD_LIBRARY_PATH'
  ]) {
    if (owner[name]) {
      env[name] = owner[name]
    }
  }
  env.AWS_CONFIG_FILE = emptyFile(home, 'empty-aws-config')
  env.AWS_SHARED_CREDENTIALS_FILE = env.AWS_CONFIG_FILE
  const endpoint = `http://127.0.0.1:${instance.port}`
  if (provider === 'azure') {
    const azure = join(home, '.azure')
    privateFlociDirectory(azure)
    Object.assign(env, {
      AZURE_CONFIG_DIR: azure,
      AZURE_STORAGE_ACCOUNT: 'devstoreaccount1',
      AZURE_STORAGE_KEY: 'YmFzdGlvbi1lbXVsYXRvcg==',
      AZURE_STORAGE_CONNECTION_STRING: `DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;AccountKey=YmFzdGlvbi1lbXVsYXRvcg==;BlobEndpoint=${endpoint}/devstoreaccount1;`,
      AZURE_EXTENSION_USE_DYNAMIC_INSTALL: 'no',
      AZURE_CORE_COLLECT_TELEMETRY: 'false'
    })
  } else if (provider === 'gcp') {
    const gcloud = join(config, 'gcloud')
    privateFlociDirectory(gcloud)
    Object.assign(env, {
      CLOUDSDK_CONFIG: gcloud,
      CLOUDSDK_CORE_PROJECT: 'bastion-emulated',
      GOOGLE_CLOUD_PROJECT: 'bastion-emulated',
      GCLOUD_PROJECT: 'bastion-emulated',
      CLOUDSDK_AUTH_DISABLE_CREDENTIALS: 'true',
      CLOUDSDK_CORE_DISABLE_PROMPTS: 'true',
      CLOUDSDK_CORE_DISABLE_USAGE_REPORTING: 'true',
      CLOUDSDK_COMPONENT_MANAGER_DISABLE_UPDATE_CHECK: 'true',
      STORAGE_EMULATOR_HOST: endpoint,
      PUBSUB_EMULATOR_HOST: `127.0.0.1:${instance.port}`,
      CLOUDSDK_API_ENDPOINT_OVERRIDES_STORAGE: `${endpoint}/`,
      CLOUDSDK_API_ENDPOINT_OVERRIDES_PUBSUB: `${endpoint}/`
    })
  } else {
    const oci = join(home, '.oci')
    privateFlociDirectory(oci)
    Object.assign(env, {
      OCI_CLI_CONFIG_FILE: emptyFile(oci, 'config'),
      OCI_CLI_RC_FILE: emptyFile(oci, 'oci_cli_rc'),
      FLOCI_OCI_ENDPOINT: endpoint
    })
  }
  return env
}
