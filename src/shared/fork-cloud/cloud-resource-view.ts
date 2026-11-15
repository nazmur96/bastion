import type { FlociProvider } from './floci-products'
import {
  FLOCI_RESOURCE_LABELS,
  FLOCI_SERVICE_STATUS_MESSAGES,
  type FlociResourceService
} from './floci-resources-contract'
import { realAwsMessages } from './real-aws-contract'

type Listing = {
  provider?: FlociProvider
  at: number
  results: {
    service: FlociResourceService
    status: string
    items: { name: string; arn: string | null; resourceId?: string }[]
    truncated: boolean
  }[]
}
export type CloudResourceService = {
  service: FlociResourceService
  label: string
  /** Anything other than a successful listing is unknown, never empty. */
  state: 'listed' | 'empty' | 'unknown'
  message: string | null
  items: { name: string; arn: string | null; resourceId?: string; hint: boolean }[]
  truncated: boolean
}
export type CloudResourceListing = {
  provider?: FlociProvider
  kind: 'emulated' | 'real'
  observedAt: number
  limits: { pages: number; items: number }
  services: CloudResourceService[]
}
/** Listers stop after these, per service; the view states them. */
export const RESOURCE_LISTING_LIMITS = { pages: 3, items: 500 }

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}
/** A name that contains the project's name is a hint only; ownership is never inferred. */
export function ownershipHint(name: string, projectLabel: string): boolean {
  const project = slug(projectLabel)
  return project.length >= 3 && slug(name).includes(project)
}
const MESSAGES: Record<CloudResourceListing['kind'], Record<string, string>> = {
  emulated: FLOCI_SERVICE_STATUS_MESSAGES,
  real: realAwsMessages
}
function message(kind: CloudResourceListing['kind'], status: string): string {
  return (
    MESSAGES[kind][status] ??
    (kind === 'emulated' ? FLOCI_SERVICE_STATUS_MESSAGES.error : realAwsMessages['cli-failed'])
  )
}
export function normalizeResourceListing(
  kind: CloudResourceListing['kind'],
  listing: Listing,
  projectLabel: string
): CloudResourceListing {
  return {
    ...(listing.provider ? { provider: listing.provider } : {}),
    kind,
    observedAt: listing.at,
    limits: RESOURCE_LISTING_LIMITS,
    services: listing.results.map((result) => {
      const ok = result.status === 'ok'
      return {
        service: result.service,
        label: FLOCI_RESOURCE_LABELS[result.service],
        state: !ok ? 'unknown' : result.items.length ? 'listed' : 'empty',
        message: ok ? null : message(kind, result.status),
        items: result.items.map((item) => ({
          ...item,
          hint: ownershipHint(item.name, projectLabel)
        })),
        truncated: result.truncated
      }
    })
  }
}
