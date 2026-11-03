import { useState } from 'react'
import { ShieldCheck, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import { openWorkspaceFile } from './open-manifest'
import { setScanFindings, useScanFindings } from './scan-store'
import { useDeckCommands } from './command-deck-store'
import {
  fixFindingsPrompt,
  type ScanFinding,
  type ScanSeverity
} from '../../../../shared/fork-devops-scan'

const SEVERITY_CLASS: Record<ScanSeverity, string> = {
  CRITICAL: 'text-destructive',
  HIGH: 'text-destructive',
  MEDIUM: 'text-status-warning',
  LOW: 'text-muted-foreground',
  UNKNOWN: 'text-muted-foreground'
}

const FILES_SHOWN = 8

/** Path stage Harden: Trivy findings on their files and lines, each file one Claude fix away. */
export function InfraHardenCard({
  worktreeId,
  workspacePath,
  onScanned
}: {
  worktreeId: string
  workspacePath: string
  /** Marks the Hardened stage once a scan has run. */
  onScanned: () => void
}): React.JSX.Element {
  const findings = useScanFindings(workspacePath)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = (): void => {
    if (running) {
      return
    }
    setRunning(true)
    setError(null)
    void window.api.aiVault
      .scanRepo(workspacePath)
      .then((result) => {
        if (result.ok) {
          setScanFindings(workspacePath, result.findings)
          onScanned()
        } else {
          setError(result.error)
        }
      })
      .finally(() => setRunning(false))
  }
  useDeckCommands('path:harden', [
    {
      id: 'path:harden',
      group: translate('components.devops.deck.path', 'Project path'),
      label: translate('components.devops.harden.scan', 'Scan for risks'),
      keywords: ['trivy', 'scan', 'security', 'harden'],
      run: scan
    }
  ])

  const byFile = new Map<string, ScanFinding[]>()
  for (const finding of findings ?? []) {
    byFile.set(finding.file, [...(byFile.get(finding.file) ?? []), finding])
  }
  const count = (severity: ScanSeverity): number =>
    (findings ?? []).filter((finding) => finding.severity === severity).length

  return (
    <InfraCard
      id="infra-path-harden"
      className="mb-4"
      title={translate('components.devops.harden.title', 'Harden · security findings')}
      hint={translate(
        'components.devops.harden.hint',
        'Trivy checks manifests, charts, Terraform and Dockerfiles. Findings also show as squiggles in the editor.'
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <Button type="button" size="xs" onClick={scan} disabled={running}>
          <ShieldCheck aria-hidden />
          {running
            ? translate('components.devops.harden.running', 'Scanning…')
            : findings
              ? translate('components.devops.harden.rescan', 'Scan again')
              : translate('components.devops.harden.scan', 'Scan for risks')}
        </Button>
        {findings ? (
          <span className="text-xs">
            {findings.length === 0 ? (
              <span className="text-status-success">
                {translate('components.devops.harden.clean', 'No misconfigurations found.')}
              </span>
            ) : (
              (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
                .filter((severity) => count(severity) > 0)
                .map((severity) => (
                  <span key={severity} className={cn('mr-3', SEVERITY_CLASS[severity])}>
                    {count(severity)} {severity.toLowerCase()}
                  </span>
                ))
            )}
          </span>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {byFile.size > 0 ? (
        <div className="scrollbar-sleek max-h-80 space-y-2 overflow-y-auto">
          {[...byFile].slice(0, FILES_SHOWN).map(([file, items]) => (
            <div key={file} className="rounded-md border border-border px-2 py-1.5">
              <div className="mb-1 flex items-center gap-2">
                <span className="min-w-0 truncate font-mono text-xs">{file}</span>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="ml-auto shrink-0"
                  onClick={() => draftForClaude(worktreeId, fixFindingsPrompt(file, items))}
                >
                  <Sparkles aria-hidden />
                  {translate('components.devops.harden.fix', 'Fix with Claude')}
                </Button>
              </div>
              <ul className="space-y-0.5">
                {items.map((finding) => (
                  <li key={`${finding.id}:${finding.line}`}>
                    <button
                      type="button"
                      className="flex w-full items-baseline gap-2 text-left text-xs hover:underline"
                      onClick={() => openWorkspaceFile(worktreeId, file, finding.line)}
                      title={finding.resolution}
                    >
                      <span
                        className={cn(
                          'w-16 shrink-0 font-medium',
                          SEVERITY_CLASS[finding.severity]
                        )}
                      >
                        {finding.severity.toLowerCase()}
                      </span>
                      <span className="w-10 shrink-0 font-mono text-muted-foreground">
                        :{finding.line}
                      </span>
                      <span className="min-w-0 truncate">{finding.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {byFile.size > FILES_SHOWN ? (
            <p className="text-xs text-muted-foreground">
              {translate('components.devops.harden.more', '{{count}} more files with findings.', {
                count: byFile.size - FILES_SHOWN
              })}
            </p>
          ) : null}
        </div>
      ) : null}
    </InfraCard>
  )
}
