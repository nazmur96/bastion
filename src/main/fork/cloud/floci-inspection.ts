import { hasFlociNetworkPolicy } from './floci-network-policy'
import { z } from 'zod'
import { FlociFailure, type FlociInstance } from '../../../shared/fork-cloud/floci-contract'
const inspected = z.object({
  Id: z.string().regex(/^[a-f0-9]{64}$/),
  Image: z.string(),
  Name: z.string(),
  State: z.object({ Running: z.boolean() }),
  Config: z.object({
    Entrypoint: z.array(z.string()),
    Cmd: z.array(z.string()),
    Env: z.array(z.string()),
    Labels: z.record(z.string(), z.string()).nullable()
  }),
  HostConfig: z.object({
    Privileged: z.boolean(),
    ReadonlyRootfs: z.boolean(),
    CapDrop: z.array(z.string()),
    SecurityOpt: z.array(z.string()),
    NetworkMode: z.string(),
    Binds: z.array(z.string()).nullable().optional(),
    Devices: z.array(z.unknown()).nullable().optional(),
    PortBindings: z.record(
      z.string(),
      z.array(z.object({ HostIp: z.string(), HostPort: z.string() })).nullable()
    ),
    CapAdd: z.array(z.string()).nullable().optional()
  }),
  NetworkSettings: z.object({ Networks: z.record(z.string(), z.unknown()) }),
  Mounts: z.array(
    z.object({ Type: z.string(), Source: z.string(), Destination: z.string(), RW: z.boolean() })
  )
})
export function checkFlociInspection(raw: unknown, instance: FlociInstance, imageId: string) {
  const result = inspected.safeParse(raw)
  if (!result.success) {
    throw new FlociFailure('instance-conflict')
  }
  const c = result.data,
    labels = c.Config.Labels
  const ports = c.HostConfig.PortBindings
  const binds = ports['4566/tcp']
  if (
    c.Name.replace(/^\//, '') !== instance.name ||
    c.Image !== imageId ||
    (instance.containerId && c.Id !== instance.containerId) ||
    labels?.['bastion.workspace'] !== instance.namespaceId ||
    labels?.['bastion.target'] !== instance.targetId ||
    labels?.['bastion.instance'] !== instance.id ||
    c.HostConfig.Privileged ||
    !c.HostConfig.ReadonlyRootfs ||
    !c.HostConfig.CapDrop.includes('ALL') ||
    !c.HostConfig.SecurityOpt.includes('no-new-privileges') ||
    JSON.stringify(c.Config.Entrypoint) !== JSON.stringify(['/app/application']) ||
    JSON.stringify(c.Config.Cmd) !==
      JSON.stringify([
        '-Dquarkus.http.host=0.0.0.0',
        '-Dfloci.security.allow-unsafe-network-exposure=true'
      ]) ||
    c.Config.Env.some(
      (value) =>
        ![
          'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          'FLOCI_VERSION=2.4.0',
          'FLOCI_STORAGE_PERSISTENT_PATH=/app/data',
          'LD_LIBRARY_PATH=/app',
          'FLOCI_STORAGE_MODE=persistent',
          'AWS_EC2_METADATA_DISABLED=true'
        ].includes(value)
    ) ||
    !c.Config.Env.includes('FLOCI_STORAGE_MODE=persistent') ||
    !c.Config.Env.includes('AWS_EC2_METADATA_DISABLED=true') ||
    Object.keys(c.NetworkSettings.Networks).length !== 1 ||
    !(instance.network in c.NetworkSettings.Networks) ||
    !hasFlociNetworkPolicy(c.HostConfig.SecurityOpt) ||
    c.HostConfig.NetworkMode !== instance.network ||
    c.HostConfig.Devices?.length ||
    c.HostConfig.CapAdd?.length ||
    Object.keys(ports).length !== 1 ||
    binds?.length !== 1 ||
    binds[0].HostIp !== '127.0.0.1' ||
    binds[0].HostPort !== String(instance.port) ||
    c.Mounts.length !== 1 ||
    c.Mounts[0].Type !== 'bind' ||
    c.Mounts[0].Source !== instance.dataPath ||
    c.Mounts[0].Destination !== '/app/data' ||
    !c.Mounts[0].RW
  ) {
    throw new FlociFailure('instance-conflict')
  }
  return { id: c.Id, running: c.State.Running }
}
