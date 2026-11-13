import { translate, getIntlLocale } from '@/i18n/i18n'
import type { ChangeRun, SourceCheckCode } from '../../../../shared/fork-changes/change-contract'

function resultLabel(code: SourceCheckCode): string {
  switch (code) {
    case 'json-valid':
      return translate('changes.jsonValid', 'JSON syntax passed')
    case 'json-invalid':
      return translate('changes.jsonInvalid', 'JSON syntax failed')
    case 'readable':
      return translate('changes.readable', 'Readable UTF-8; language validation not run')
    case 'changed':
      return translate('changes.fileChanged', 'Source differs from the reviewed snapshot')
    case 'unavailable':
      return translate('changes.unavailable', 'Source or its owner is unavailable')
  }
}
function runLabel(status: ChangeRun['status']): string {
  switch (status) {
    case 'running':
      return translate('changes.running', 'Running source checks')
    case 'passed':
      return translate('changes.passed', 'Source checks passed')
    case 'failed':
      return translate('changes.failed', 'Source checks failed')
    case 'interrupted':
      return translate('changes.interrupted', 'Interrupted; completion unknown')
  }
}
export function ChangeRunEvidence({ run }: { run: ChangeRun }): React.JSX.Element {
  return (
    <section className="workspace-card" data-change-run={run.id}>
      <h3>{runLabel(run.status)}</h3>
      <p className="font-mono text-xs">{run.id}</p>
      <p>{new Date(run.at).toLocaleString(getIntlLocale())}</p>
      {run.snapshot.files.map((file) => {
        const step = run.steps.find((item) => item.path === file.path)
        return (
          <div className="border-t border-border py-2" key={file.path}>
            <code className="break-all text-xs">{file.path}</code>
            <p>{step ? resultLabel(step.code) : translate('changes.notRun', 'Not run')}</p>
          </div>
        )
      })}
      <p>
        {run.verification?.code === 'unchanged'
          ? translate(
              'changes.unchanged',
              'Source verification: saved files still match this run. Deployed health is unverified.'
            )
          : run.verification?.code === 'changed'
            ? translate(
                'changes.verificationChanged',
                'Source verification: files changed after this run.'
              )
            : translate('changes.verificationUnknown', 'Source verification: unknown.')}
      </p>
    </section>
  )
}
