import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { listFlociResources, type FlociHttp } from './floci-resources'
import { normalizeResourceListing } from '../../../shared/fork-cloud/cloud-resource-view'
const resultSchema = z.object({
  results: z.array(
    z.object({
      service: z.string(),
      status: z.string(),
      items: z.array(
        z.object({
          name: z.string(),
          arn: z.string().nullable(),
          resourceId: z.string().optional()
        })
      ),
      truncated: z.boolean()
    })
  )
})
const tenancy = 'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
const cases = [
  {
    provider: 'azure',
    services: ['azure-containers'],
    reply: (_path: string) => ({
      status: 200,
      body: '<EnumerationResults><Containers><Container><Name>fixture-container</Name><Metadata><secret>PRIVATE_PAYLOAD</secret></Metadata></Container></Containers><NextMarker /></EnumerationResults>'
    }),
    names: ['fixture-container']
  },
  {
    provider: 'gcp',
    services: ['gcp-buckets', 'gcp-topics'],
    reply: (path: string) => ({
      status: 200,
      body: JSON.stringify(
        path.startsWith('/storage/')
          ? {
              items: [
                {
                  name: 'fixture-bucket',
                  id: 'fixture-bucket',
                  labels: { secret: 'PRIVATE_PAYLOAD' }
                }
              ]
            }
          : {
              topics: [
                {
                  name: 'projects/bastion-emulated/topics/fixture-topic',
                  labels: { secret: 'PRIVATE_PAYLOAD' }
                }
              ]
            }
      )
    }),
    names: ['fixture-bucket', 'fixture-topic']
  },
  {
    provider: 'oci',
    services: ['oci-buckets', 'oci-compartments'],
    reply: (path: string) => ({
      status: 200,
      body: JSON.stringify(
        path.startsWith('/n/')
          ? [
              {
                name: 'fixture-bucket',
                namespace: 'floci-local',
                metadata: { secret: 'PRIVATE_PAYLOAD' }
              }
            ]
          : [
              {
                name: 'fixture-compartment',
                id: 'ocid1.compartment.oc1..fixture',
                description: 'PRIVATE_PAYLOAD'
              }
            ]
      )
    }),
    names: ['fixture-bucket', 'fixture-compartment']
  }
]
describe('MC-04 fixed provider listers and the existing 9.4 normalizer', () => {
  it.each(cases)(
    'projects $provider metadata through the shared resources path, not AWS or a secret reader',
    async (scenario) => {
      const calls: { method: string; path: string; headers: Record<string, string> }[] = []
      const http: FlociHttp = async (port, req) => {
        expect(port).toBe(14888)
        calls.push(req)
        return scenario.reply(req.path)
      }
      const listing = resultSchema.parse(
        await Reflect.apply(listFlociResources, undefined, [
          14888,
          http,
          () => 1234,
          { provider: scenario.provider }
        ])
      )
      expect(listing.results.map((r) => r.service)).toEqual(scenario.services)
      expect(listing.results.every((r) => r.status === 'ok')).toBe(true)
      expect(listing.results.flatMap((r) => r.items.map((i) => i.name))).toEqual(scenario.names)
      expect(listing.results.flatMap((r) => r.items).every((i) => i.arn === null)).toBe(true)
      expect(JSON.stringify(listing)).not.toContain('PRIVATE_PAYLOAD')
      expect(calls.every((req) => req.method === 'GET')).toBe(true)
      expect(calls.some((req) => Object.hasOwn(req.headers, 'X-Amz-Target'))).toBe(false)
      if (scenario.provider === 'gcp') {
        expect(calls.map((r) => r.path).join(' ')).toContain('bastion-emulated')
      }
      if (scenario.provider === 'oci') {
        expect(calls.map((r) => r.path).join(' ')).toContain(encodeURIComponent(tenancy))
      }
      const view = z
        .object({
          kind: z.literal('emulated'),
          services: z.array(z.object({ label: z.string().min(1), state: z.string() }))
        })
        .parse(
          Reflect.apply(normalizeResourceListing, undefined, [
            'emulated',
            { at: 1234, results: listing.results },
            'fixture'
          ])
        )
      expect(view.services.every((s) => s.state === 'listed')).toBe(true)
      expect(view.services.map((s) => s.label).join(' ')).not.toMatch(/S3|DynamoDB|Lambda/)
    }
  )
  it('does not follow a GCP pagination URL to a real endpoint and reports an independent denial', async () => {
    const paths: string[] = []
    const http: FlociHttp = async (_port, req) => {
      paths.push(req.path)
      if (req.path.startsWith('/storage/')) {
        return { status: 403, body: '{"message":"PRIVATE_DENIAL"}' }
      }
      return {
        status: 200,
        body: JSON.stringify({
          topics: [],
          nextPageToken: 'https://pubsub.googleapis.com/v1/projects/foreign/topics'
        })
      }
    }
    const listing = resultSchema.parse(
      await Reflect.apply(listFlociResources, undefined, [
        14888,
        http,
        () => 1234,
        { provider: 'gcp' }
      ])
    )
    expect(listing.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ service: 'gcp-buckets', status: 'denied' }),
        expect.objectContaining({ service: 'gcp-topics', truncated: true })
      ])
    )
    expect(paths.every((path) => path.startsWith('/') && !path.includes('googleapis.com'))).toBe(
      true
    )
    expect(JSON.stringify(listing)).not.toContain('PRIVATE_DENIAL')
  })
})
