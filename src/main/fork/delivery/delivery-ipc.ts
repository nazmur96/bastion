import { ipcMain, type WebContents } from 'electron'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { admitChannelOperation } from '../../../shared/fork-cloud/operation-capabilities'
import {
  deliveryConfigSchema,
  deliveryPromoteSchema
} from '../../../shared/fork-delivery/delivery-contract'
import type { CloudWorkspaceProvider } from '../cloud/cloud-workspace-provider'
import { readDeliveryChain } from './delivery-chain'
import { PromoteError, promoteDigest } from './delivery-promote'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import { deliverySources } from './delivery-sources'

const MESSAGES: Record<string, string> = {
  invalid: 'Invalid delivery request.',
  workspace: 'Delivery requires a project workspace.',
  owner:
    "Promotion edits source on this computer only. For a remote (SSH) project, make the one-line digest edit in the editor and commit it; the evidence itself is read on the project's owner.",
  blocked:
    'This revision is not promotable: its CI run, published artifact and registry label must all be verified first.',
  changed: 'The deployment config changed since you reviewed it. Refresh the evidence first.',
  'unsafe-path': 'The deployment config path contains a symlink. Nothing was changed.',
  failed: 'The delivery operation failed.'
}

/** Fork: Step 11 delivery handlers. Local owners only; read-only except one reviewed edit. */
export function registerDeliveryHandlers(
  requireProvider: (sender: WebContents) => CloudWorkspaceProvider
): void {
  for (const operation of ['deliveryChain', 'deliveryPromote'] as const) {
    ipcMain.handle(`bastionCloud:${operation}`, async (event, raw: unknown) => {
      try {
        const context = readProjectWorkspaceContext()
        const assertCurrent = () => {
          if (
            !context?.workspace ||
            context.incognito ||
            readProjectWorkspaceContext() !== context ||
            event.sender.isDestroyed() ||
            !isTrustedUIRenderer(event.sender) ||
            event.senderFrame !== event.sender.mainFrame
          ) {
            throw new Error('workspace')
          }
        }
        assertCurrent()
        const provider = requireProvider(event.sender)
        if (operation === 'deliveryChain') {
          const parsed = deliveryConfigSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error('invalid')
          }
          admitChannelOperation('bastionCloud:deliveryChain', 'delivery.evidence')
          const { owner } = await provider.owner(parsed.data.projectId)
          const chain = await readDeliveryChain(
            parsed.data,
            deliverySources(owner.root, parsed.data.repository)
          )
          assertCurrent()
          return { ok: true, chain }
        }
        const parsed = deliveryPromoteSchema.safeParse(raw)
        if (!parsed.success || parsed.data.revision === null) {
          throw new Error('invalid')
        }
        admitChannelOperation('bastionCloud:deliveryPromote', 'delivery.promote')
        const { owner, assertOwner } = await provider.owner(parsed.data.projectId)
        // Never trust the renderer's view: re-read the evidence for this exact revision.
        const chain = await readDeliveryChain(
          parsed.data,
          deliverySources(owner.root, parsed.data.repository)
        )
        if (!chain.promotable || chain.digest !== parsed.data.digest) {
          throw new Error('blocked')
        }
        assertOwner()
        assertCurrent()
        const result = await promoteDigest({
          root: owner.root,
          configPath: parsed.data.configPath,
          imageName: parsed.data.imageName,
          digest: parsed.data.digest,
          reviewedFingerprint: parsed.data.configFingerprint
        })
        return { ok: true, path: parsed.data.configPath, ...result }
      } catch (error) {
        const code =
          error instanceof PromoteError
            ? error.code
            : error instanceof FlociFailure
              ? 'owner'
              : error instanceof Error && error.message in MESSAGES
                ? error.message
                : 'failed'
        return { ok: false, code, message: MESSAGES[code] }
      }
    })
  }
}
