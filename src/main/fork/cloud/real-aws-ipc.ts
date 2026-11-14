import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { ipcMain, type WebContents } from 'electron'
import { isTrustedUIRenderer } from '../../ipc/ui'
import {
  RealAwsFailure,
  realAwsMessages,
  realAwsRefSchema,
  realAwsReadSchema,
  realAwsAcceptSchema,
  type RealAwsCode
} from '../../../shared/fork-cloud/real-aws-contract'
import type { CloudWorkspaceProvider } from './cloud-workspace-provider'
export function registerRealAwsHandlers(
  requireProvider: (sender: WebContents) => CloudWorkspaceProvider
): void {
  for (const operation of ['verifyRealTarget', 'acceptRealIdentity', 'readRealTarget'] as const) {
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
            throw new RealAwsFailure('workspace')
          }
        }
        assertCurrent()
        if (operation === 'verifyRealTarget') {
          const parsed = realAwsRefSchema.safeParse(raw)
          if (!parsed.success) {
            throw new RealAwsFailure('invalid')
          }
          const value = await requireProvider(event.sender).real.verify(
            parsed.data.projectId,
            parsed.data.targetId
          )
          assertCurrent()
          return { ok: true, kind: 'real-aws', value }
        }
        if (operation === 'acceptRealIdentity') {
          const parsed = realAwsAcceptSchema.safeParse(raw)
          if (!parsed.success) {
            throw new RealAwsFailure('invalid')
          }
          const args = parsed.data
          const value = await requireProvider(event.sender).real.accept(
            args.projectId,
            args.targetId,
            args.observationId,
            args.revision
          )
          assertCurrent()
          return { ok: true, kind: 'real-aws', value }
        }
        const parsed = realAwsReadSchema.safeParse(raw)
        if (!parsed.success) {
          throw new RealAwsFailure('invalid')
        }
        if (parsed.data.operation === 'cost-and-usage') {
          throw new RealAwsFailure('consent-required')
        }
        const value = await requireProvider(event.sender).real.read(
          parsed.data.projectId,
          parsed.data.targetId,
          parsed.data.operation
        )
        assertCurrent()
        return { ok: true, kind: 'real-aws', value }
      } catch (error) {
        const code: RealAwsCode = error instanceof RealAwsFailure ? error.code : 'owner-changed'
        return { ok: false, code, message: realAwsMessages[code] }
      }
    })
  }
}
