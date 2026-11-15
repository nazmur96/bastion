import { z } from 'zod'
import type { FlociResourceService } from '../../../shared/fork-cloud/floci-resources-contract'
import { ListingFailure, clean, json, xmlText, type Operation } from './floci-listing-operations'
export const FLOCI_GCP_PROJECT = 'bastion-emulated'
export const FLOCI_OCI_TENANCY =
  'ocid1.tenancy.oc1..flocilocaltenancy0000000000000000000000000000000000000000'
export const PROVIDER_SERVICES: Record<'azure' | 'gcp' | 'oci', FlociResourceService[]> = {
  azure: ['azure-containers'],
  gcp: ['gcp-buckets', 'gcp-topics'],
  oci: ['oci-buckets', 'oci-compartments']
}
function continuation(value: unknown): string | null {
  if (value === undefined || value === null || value === '') {
    return null
  }
  if (typeof value !== 'string' || value.length > 4096 || /[:\r\n\0]|^\/\//.test(value)) {
    throw new ListingFailure('invalid', true)
  }
  return value
}
function get(
  path: string,
  token: string | null,
  key: string,
  headers: Record<string, string> = {}
) {
  return {
    method: 'GET' as const,
    path: path + (token ? `&${key}=${encodeURIComponent(token)}` : ''),
    headers
  }
}
const nativeItem = (name: string, resourceId: string) => ({ name, arn: null, resourceId })
const container = z.string().regex(/^(?:[a-z0-9][a-z0-9-]{1,61}[a-z0-9]|\$root|\$web)$/)
const name = z
  .string()
  .min(1)
  .max(256)
  .refine((value) => clean(value, 256) === value && !/[/\\]/.test(value))
const parseRows = (value: unknown) => z.array(z.record(z.string(), z.unknown())).parse(value ?? [])
export const PROVIDER_OPERATIONS = {
  'azure-containers': {
    build: (next: string | null) =>
      get('/devstoreaccount1?comp=list&maxresults=100', next, 'marker'),
    parse: (body: string) => {
      if (
        /<!DOCTYPE|<!ENTITY/i.test(body) ||
        !/^\s*(?:<\?xml[^>]*>\s*)?<EnumerationResults\b[^>]*>[\s\S]*<\/EnumerationResults>\s*$/.test(
          body
        )
      ) {
        throw new ListingFailure('invalid')
      }
      const content = body.match(/<Containers>([\s\S]*?)<\/Containers>/)?.[1]
      if (content === undefined && !/<Containers\s*\/>/.test(body)) {
        throw new ListingFailure('invalid')
      }
      const blocks = [...(content ?? '').matchAll(/<Container>([\s\S]*?)<\/Container>/g)]
      if ((content ?? '').replace(/<Container>[\s\S]*?<\/Container>/g, '').trim()) {
        throw new ListingFailure('invalid')
      }
      const items = blocks.map((block) => {
        const n = container.parse(xmlText(block[1].match(/^\s*<Name>([^<]*)<\/Name>/)?.[1] ?? ''))
        return nativeItem(n, `devstoreaccount1/containers/${n}`)
      })
      const marker = body.match(/<NextMarker>([^<]*)<\/NextMarker>/)?.[1] ?? ''
      return { items, next: continuation(xmlText(marker)) }
    }
  },
  'gcp-buckets': {
    build: (next: string | null) =>
      get(`/storage/v1/b?project=${FLOCI_GCP_PROJECT}&maxResults=100`, next, 'pageToken'),
    parse: (body: string) => {
      const value = json(body)
      return {
        items: parseRows(value.items).map((row) => {
          const n = name.parse(row.name)
          return nativeItem(n, `projects/_/buckets/${n}`)
        }),
        next: continuation(value.nextPageToken)
      }
    }
  },
  'gcp-topics': {
    build: (next: string | null) =>
      get(`/v1/projects/${FLOCI_GCP_PROJECT}/topics?pageSize=100`, next, 'pageToken'),
    parse: (body: string) => {
      const value = json(body)
      return {
        items: parseRows(value.topics).map((row) => {
          const id = z
            .string()
            .max(2048)
            .startsWith(`projects/${FLOCI_GCP_PROJECT}/topics/`)
            .parse(row.name)
          const n = name.parse(id.slice(`projects/${FLOCI_GCP_PROJECT}/topics/`.length))
          return nativeItem(n, id)
        }),
        next: continuation(value.nextPageToken)
      }
    }
  },
  'oci-buckets': {
    build: (next: string | null) =>
      get(
        `/n/floci-local/b?compartmentId=${encodeURIComponent(FLOCI_OCI_TENANCY)}&limit=100`,
        next,
        'page'
      ),
    parse: (body: string, headers?: Record<string, string>) => ({
      items: parseRows(JSON.parse(body)).map((row) => {
        const n = name.parse(row.name)
        if (row.namespace !== undefined && row.namespace !== 'floci-local') {
          throw new ListingFailure('invalid')
        }
        return nativeItem(n, `n/floci-local/b/${n}`)
      }),
      next: continuation(headers?.['opc-next-page'])
    })
  },
  'oci-compartments': {
    build: (next: string | null) =>
      get(
        `/20160918/compartments?compartmentId=${encodeURIComponent(FLOCI_OCI_TENANCY)}&limit=100`,
        next,
        'page'
      ),
    parse: (body: string, headers?: Record<string, string>) => ({
      items: parseRows(JSON.parse(body)).map((row) =>
        nativeItem(
          name.parse(row.name),
          z
            .string()
            .min(1)
            .max(2048)
            .regex(/^ocid1\.compartment\.[a-z0-9.]+$/)
            .parse(row.id)
        )
      ),
      next: continuation(headers?.['opc-next-page'])
    })
  }
} satisfies Record<
  Exclude<FlociResourceService, 'tagging' | 's3' | 'dynamodb' | 'sqs' | 'lambda'>,
  Operation
>
