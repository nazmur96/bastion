import { createHash } from 'node:crypto'
import { isMap, isSeq, parseDocument } from 'yaml'

/** Fork: read and edit one image's pinned digest in a kustomization, preserving the rest. */
export function fileFingerprint(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`
}

function imageEntry(text: string, imageName: string) {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    throw new Error('The deployment config is not valid YAML.')
  }
  const images = document.get('images', true)
  if (!isSeq(images)) {
    throw new Error('The deployment config has no images list.')
  }
  const matches = images.items.filter((item) => isMap(item) && item.get('name') === imageName)
  if (matches.length !== 1 || !isMap(matches[0])) {
    throw new Error(`The deployment config must list the image "${imageName}" exactly once.`)
  }
  return { document, entry: matches[0] }
}

export function pinnedDigest(text: string, imageName: string): string | null {
  const value = imageEntry(text, imageName).entry.get('digest')
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value) ? value : null
}

/** Sets only that image's `digest`; tag fields are removed so the digest is the identity. */
export function withPinnedDigest(text: string, imageName: string, digest: string): string {
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error('Invalid digest.')
  }
  const { document, entry } = imageEntry(text, imageName)
  entry.set('digest', digest)
  entry.delete('newTag')
  return document.toString()
}

/** The image repository (`newName`) for that entry, if set. */
export function imageRepository(text: string, imageName: string): string | null {
  const value = imageEntry(text, imageName).entry.get('newName')
  return typeof value === 'string' && /^[a-z0-9.-]+(?::\d+)?\/[a-z0-9._/-]+$/.test(value)
    ? value
    : null
}
