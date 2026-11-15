import { flociProduct } from '../../../../shared/fork-cloud/floci-products'
import { getIntlLocale } from '@/i18n/i18n'
import { Badge } from '@/components/ui/badge'
import type { CloudResourceListing } from '../../../../shared/fork-cloud/cloud-resource-view'

/** The one resources view for emulated and real targets: same states, limits and hint rules. */
export function CloudResourcesView({
  listing,
  region
}: {
  listing: CloudResourceListing
  region?: string
}): React.JSX.Element {
  return (
    <div className="space-y-3 text-xs" data-testid="cloud-resources-view">
      <p>
        {listing.kind === 'real'
          ? 'Real AWS'
          : listing.provider
            ? `${flociProduct(listing.provider).label} · Local emulator`
            : 'Local emulator'}{' '}
        · observed {new Date(listing.observedAt).toLocaleString(getIntlLocale())} · up to{' '}
        {listing.limits.pages} pages and {listing.limits.items} items per service
        {listing.kind === 'real' && region
          ? ` · S3 buckets are global; other lists use ${region}`
          : ''}
      </p>
      <ul className="space-y-2" aria-label="Listed resources">
        {listing.services.map((service) => (
          <li key={service.service}>
            <p className="font-medium">
              {service.label}:{' '}
              {service.state === 'listed'
                ? `${service.items.length} listed`
                : service.state === 'empty'
                  ? 'None listed'
                  : `Unknown · ${service.message ?? ''}`}
              {service.truncated ? ' · incomplete, more may exist beyond the limits' : ''}
            </p>
            {service.items.length > 0 && (
              <ul className="font-mono break-all">
                {service.items.map((item, index) => (
                  <li key={`${item.resourceId ?? item.arn ?? item.name}:${index}`}>
                    {item.name}
                    {(item.resourceId ?? item.arn) ? ` · ${item.resourceId ?? item.arn}` : ''}
                    {item.hint && (
                      <Badge variant="outline" className="ml-2">
                        name matches this project · hint
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        Ownership is not inferred. Nothing listed here is adopted or changed.
      </p>
    </div>
  )
}
