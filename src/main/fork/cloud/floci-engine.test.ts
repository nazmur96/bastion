import { describe, expect, it } from 'vitest'
import { flociCreateArgs, classifyEngineFailure, FLOCI_IMAGE } from './floci-engine'

const manifest = {
  namespaceId: '10000000-0000-4000-8000-000000000001',
  targetId: '20000000-0000-4000-8000-000000000001',
  id: '30000000-0000-4000-8000-000000000001',
  name: 'bastion-fixture',
  port: 14566,
  dataPath: '/private/data',
  network: 'bastion-fixture-net'
}
describe('direct Floci image admission', () => {
  it('builds exact fixed loopback/image/mount arguments without a socket or privilege', () => {
    const args = flociCreateArgs(manifest)
    expect(args).toContain('127.0.0.1:14566:4566/tcp')
    expect(args.slice(-3)).toEqual([
      FLOCI_IMAGE,
      '-Dquarkus.http.host=0.0.0.0',
      '-Dfloci.security.allow-unsafe-network-exposure=true'
    ])
    expect(args).toContain('/app/application')
    expect(FLOCI_IMAGE).toMatch(/^floci\/floci@sha256:[a-f0-9]{64}$/)
    expect(args).toContain('type=bind,source=/private/data,target=/app/data')
    expect(args).toContain('FLOCI_STORAGE_MODE=persistent')
    expect(args.join(' ')).not.toMatch(/docker\.sock|--privileged|--device|--network host|:latest/)
    expect(args).toContain(`bastion.target=${manifest.targetId}`)
  })
  it('rejects renderer-like extra argv, unsafe names and invalid ports', () => {
    expect(() => flociCreateArgs({ ...manifest, args: ['--privileged'] })).toThrow()
    expect(() => flociCreateArgs({ ...manifest, port: 0 })).toThrow()
    expect(() => flociCreateArgs({ ...manifest, name: '../foreign' })).toThrow()
  })
  it('reports rootless policy failure honestly without exposing raw host paths', () => {
    const diagnosis = classifyEngineFailure(
      'no policy.json file found at /home/private/.config/containers/policy.json'
    )
    expect(diagnosis.code).toBe('container-policy-missing')
    expect(diagnosis.message).toContain('Podman')
    expect(diagnosis.message).not.toContain('/home/private')
  })
})
