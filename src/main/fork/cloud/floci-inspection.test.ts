import {
  flociContainerEnvironment,
  flociImageEnvironment,
  flociApplicationArgs,
  flociProduct
} from '../../../shared/fork-cloud/floci-products'
import { flociContainerUser, FLOCI_IMAGE } from './floci-engine'
import { FLOCI_NETWORK_POLICY } from './floci-network-policy'
import { describe, expect, it } from 'vitest'
import { checkFlociInspection } from './floci-inspection'
import { flociInstanceSchema } from '../../../shared/fork-cloud/floci-contract'
const instance = flociInstanceSchema.parse({
  id: '10000000-0000-4000-8000-000000000001',
  namespaceId: 'fixture',
  targetId: '20000000-0000-4000-8000-000000000001',
  name: 'bastion-fixture',
  network: 'bastion-fixture-net',
  port: 14566,
  dataPath: '/private/data',
  engine: 'docker',
  engineId: 'engine',
  containerId: 'a'.repeat(64),
  imageId: 'sha256:fixture',
  epoch: 1,
  state: 'ready',
  code: 'complete',
  operationId: null,
  operationPid: null
})
const raw = {
  Id: instance.containerId,
  Name: `/${instance.name}`,
  Image: instance.imageId,
  State: { Running: true },
  NetworkSettings: { Networks: { [instance.network]: {} } },
  Config: {
    Entrypoint: ['/app/application'],
    Cmd: ['-Dquarkus.http.host=0.0.0.0', '-Dfloci.security.allow-unsafe-network-exposure=true'],
    Env: ['FLOCI_STORAGE_MODE=persistent', 'AWS_EC2_METADATA_DISABLED=true'],
    Labels: {
      'bastion.workspace': instance.namespaceId,
      'bastion.target': instance.targetId,
      'bastion.instance': instance.id
    }
  },
  HostConfig: {
    Privileged: false,
    ReadonlyRootfs: true,
    CapDrop: ['ALL'],
    SecurityOpt: ['no-new-privileges', `seccomp=${JSON.stringify(FLOCI_NETWORK_POLICY)}`],
    NetworkMode: instance.network,
    PortBindings: { '4566/tcp': [{ HostIp: '127.0.0.1', HostPort: '14566' }] }
  },
  Mounts: [{ Type: 'bind', Source: instance.dataPath, Destination: '/app/data', RW: true }]
}
describe('fresh engine admission inspection', () => {
  it('accepts only the admitted loopback instance', () => {
    expect(checkFlociInspection(raw, instance, 'sha256:fixture')).toEqual({
      id: instance.containerId,
      running: true
    })
  })
  it.each([
    { ...raw, Image: 'foreign-image' },
    { ...raw, Id: 'b'.repeat(64) },
    {
      ...raw,
      Config: { ...raw.Config, Labels: { ...raw.Config.Labels, 'bastion.workspace': 'foreign' } }
    },
    { ...raw, HostConfig: { ...raw.HostConfig, Privileged: true } },
    { ...raw, HostConfig: { ...raw.HostConfig, NetworkMode: 'host' } },
    {
      ...raw,
      HostConfig: {
        ...raw.HostConfig,
        PortBindings: { '4566/tcp': [{ HostIp: '0.0.0.0', HostPort: '14566' }] }
      }
    },
    {
      ...raw,
      Mounts: [
        ...raw.Mounts,
        {
          Type: 'bind',
          Source: '/var/run/docker.sock',
          Destination: '/var/run/docker.sock',
          RW: true
        }
      ]
    }
  ])('refuses substituted image, ownership, exposure or mount', (input) => {
    expect(() => checkFlociInspection(input, instance, 'sha256:fixture')).toThrow('does not match')
  })
})

describe('provider-specific engine inspection', () => {
  it.each(['azure', 'gcp', 'oci'] as const)(
    'matches %s image, non-root user, service switches and provider port',
    (provider) => {
      const p = flociProduct(provider)
      const fixture = {
        ...raw,
        Config: {
          ...raw.Config,
          Image: p.image,
          User: flociContainerUser(),
          Cmd: flociApplicationArgs(provider),
          Env: [
            ...new Set([
              ...flociImageEnvironment(provider),
              ...flociContainerEnvironment(provider, instance.port)
            ])
          ]
        },
        HostConfig: {
          ...raw.HostConfig,
          PortBindings: {
            [`${p.port}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(instance.port) }]
          }
        }
      }
      expect(checkFlociInspection(fixture, instance, 'sha256:fixture', provider).running).toBe(true)
      for (const config of [
        { ...fixture.Config, User: '0:0' },
        { ...fixture.Config, Image: FLOCI_IMAGE },
        {
          ...fixture.Config,
          Env: [...fixture.Config.Env, `${p.prefix}_SERVICES_FUNCTIONS_ENABLED=true`]
        }
      ]) {
        expect(() =>
          checkFlociInspection({ ...fixture, Config: config }, instance, 'sha256:fixture', provider)
        ).toThrow()
      }
      expect(() =>
        checkFlociInspection(
          {
            ...fixture,
            HostConfig: {
              ...fixture.HostConfig,
              PortBindings: {
                '4566/tcp': [{ HostIp: '127.0.0.1', HostPort: String(instance.port) }]
              }
            }
          },
          instance,
          'sha256:fixture',
          provider
        )
      ).toThrow()
    }
  )
})
