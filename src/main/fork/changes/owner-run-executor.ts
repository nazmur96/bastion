import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import type { OwnerRunReceipt, SourceCheckCode } from '../../../shared/fork-changes/change-contract'
import { checkSourceText } from '../../../shared/fork-changes/source-check-result'
import { createOwnerSource, readOwnerSource } from './owner-source-files'

export async function executeOwnerRun(
  receipt: OwnerRunReceipt,
  root: string,
  proposal: string | undefined,
  checkpoint: (receipt: OwnerRunReceipt) => void,
  read: typeof readOwnerSource = readOwnerSource
): Promise<void> {
  for (const source of receipt.snapshot.files) {
    let code: SourceCheckCode = 'unavailable'
    try {
      code =
        receipt.snapshot.adapter === 'create-file/v1'
          ? await createOwnerSource(root, source.path, proposal ?? '')
          : checkSourceText(source.path, await read(root, source.path), source.fingerprint)
    } catch {
      code = 'unavailable'
    }
    receipt.steps.push({ path: source.path, code, at: Date.now() })
    checkpoint(receipt)
    if (code !== 'created' && code !== 'readable' && code !== 'json-valid') {
      break
    }
  }
  let verification: 'unchanged' | 'changed' | 'unavailable' = 'unchanged'
  try {
    for (const source of receipt.snapshot.files) {
      if (getDiskBaselineSignature(await read(root, source.path)) !== source.fingerprint) {
        verification = 'changed'
      }
    }
  } catch {
    verification = 'unavailable'
  }
  receipt.verification = { at: Date.now(), code: verification }
  receipt.status =
    receipt.steps.length === receipt.snapshot.files.length &&
    receipt.steps.every((step) => ['created', 'readable', 'json-valid'].includes(step.code))
      ? 'passed'
      : 'failed'
  receipt.finishedAt = Date.now()
  checkpoint(receipt)
}
