import { EDITOR_ASSISTANCE_CASES, firstCurrentAssistanceCase } from './assistance-cases'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSidebarHostScopeOptions } from '@/components/sidebar/use-sidebar-host-scope-options'
import { indexExecutionHostsById } from '../../../../shared/managed-orcad-execution-host'
import { Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { parseExecutionHostId, UNRESOLVED_OWNER_HOST_ID } from '../../../../shared/execution-host'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import { useDevopsContext } from '../devops/use-devops-context'
import { useProjectDiscovery } from '../discovery/use-project-discovery'
import { useDeckCommands } from '../devops/command-deck-store'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { openWorkspacePage } from '../workspace-desktop/workspace-desktop-state'
import { openChanges } from '../changes/change-navigation'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { draftAssistanceInOpenChat } from './assistance-chat-draft'
import { readEditorContextEntry, useEditorContextEntry } from './editor-context-store'
import {
  assistanceFileAllowed,
  assistanceSourceCurrent,
  boundedAssistanceDraft,
  runtimeAssistanceKey,
  setRuntimeAssistanceDismissed,
  useRuntimeAssistanceDismissed
} from './editor-runtime-assistance'

export function EditorRuntimeAssistance({
  worktreeId,
  relativePath,
  enabled
}: {
  worktreeId: string | undefined
  relativePath: string
  enabled: boolean
}): React.JSX.Element | null {
  const active = useAppStore((s) => s.activeWorktreeId === worktreeId)
  const hostId = useAppStore(() =>
    worktreeId ? startWorkspaceHost(worktreeId) : UNRESOLVED_OWNER_HOST_ID
  )
  const editor = useEditorContextEntry(worktreeId)
  if (
    !enabled ||
    !worktreeId ||
    !active ||
    hostId === UNRESOLVED_OWNER_HOST_ID ||
    editor?.file !== relativePath ||
    !assistanceFileAllowed(relativePath)
  ) {
    return null
  }
  return <RuntimeHint key={`${worktreeId}:${hostId}`} worktreeId={worktreeId} file={relativePath} />
}

function RuntimeHint({
  worktreeId,
  file
}: {
  worktreeId: string
  file: string
}): React.JSX.Element | null {
  const { state, refresh } = useProjectDiscovery(worktreeId)
  const hostId = useAppStore(() => startWorkspaceHost(worktreeId))
  const parsedHost = parseExecutionHostId(hostId)
  const { hostOptions } = useSidebarHostScopeOptions()
  const owner = indexExecutionHostsById(hostOptions).get(hostId)
  const connected = hostId === 'local' || owner?.health === 'available'
  const continuity = useAppStore((store) => {
    const status =
      parsedHost?.kind === 'runtime'
        ? store.runtimeStatusByEnvironmentId.get(parsedHost.environmentId)
        : undefined
    return JSON.stringify([status?.connectionGeneration ?? 0, status?.hostContactEpoch ?? 0])
  })
  const connectionSignature = JSON.stringify([hostId, owner?.health, continuity])
  const lastConnection = useRef(connectionSignature)
  useEffect(() => {
    if (lastConnection.current !== connectionSignature) {
      lastConnection.current = connectionSignature
      refresh()
    }
  }, [connectionSignature, refresh])
  const editor = useEditorContextEntry(worktreeId)
  const terraformDir = /\.tf(?:\.json)?$/i.test(file)
    ? file.replaceAll('\\', '/').split('/').slice(0, -1).join('/') || '.'
    : null
  const target = useDevopsContext(worktreeId, terraformDir, '')
  const tabs = useAppStore((s) => s.unifiedTabsByWorktree[worktreeId])
  const data = state?.data
  const markers = editor?.readMarkers().slice(0, 100) ?? []
  const counts = {
    errors: markers.filter((m) => m.severity === 8).length,
    warnings: markers.filter((m) => m.severity === 4).length
  }
  const sourceCurrent = !!(data && state && assistanceSourceCurrent(data.snapshot, file, state))
  const candidate = firstCurrentAssistanceCase(EDITOR_ASSISTANCE_CASES, {
    editor: editor
      ? {
          current: editor.file === file && editor.modelVersion !== undefined,
          revision: JSON.stringify([editor.ownerId, editor.modelVersion, counts]),
          value: { file, ...counts }
        }
      : undefined,
    discovery: data
      ? { current: sourceCurrent, revision: data.snapshot.fingerprint, value: data.snapshot }
      : undefined,
    runtime: {
      current: connected,
      revision: getDiskBaselineSignature(
        JSON.stringify([connectionSignature, target, data?.inspection?.tools])
      ),
      value: { inspection: data?.inspection ?? null }
    }
  })
  const suggestion = candidate?.suggestion ?? { tool: 'editor', available: null }
  const context = {
    inputSignature: candidate?.inputSignature ?? '',
    connectionSignature,
    hostId: data?.snapshot.hostId ?? UNRESOLVED_OWNER_HOST_ID,
    modelVersion: editor?.modelVersion ?? -1,
    editorOwner: editor?.ownerId ?? '',
    sourceFingerprint: data?.snapshot.fingerprint ?? '',
    diagnosticSignature: `${counts.errors}:${counts.warnings}`,
    targetSignature: getDiskBaselineSignature(JSON.stringify(target)),
    valid: !!(
      candidate &&
      connected &&
      data &&
      state &&
      editor &&
      editor.modelVersion !== undefined &&
      assistanceSourceCurrent(data.snapshot, file, state)
    )
  }
  const key = runtimeAssistanceKey(worktreeId, file, suggestion, context)
  const dismissalKey = runtimeAssistanceKey(
    worktreeId,
    file,
    { tool: 'editor', available: null },
    {
      hostId,
      targetSignature: context.targetSignature,
      modelVersion: 0,
      editorOwner: '',
      sourceFingerprint: '',
      valid: true
    }
  )
  const latest = useRef(key)
  latest.current = key
  // Opening help after a save re-reads the owner's discovery instead of staying stale.
  const refreshIfStale = useRef(() => {})
  refreshIfStale.current = () => {
    if (state && !state.pending && !sourceCurrent) {
      refresh()
    }
  }
  const dismissed = useRuntimeAssistanceDismissed(dismissalKey)
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ key: string; text: string; current: () => boolean } | null>(
    null
  )
  const [chatId, setChatId] = useState('copy')
  const commands = useMemo(
    () => [
      {
        id: 'assistance:runtime',
        group: translate('components.assistance.commandGroup', 'Editor assistance'),
        label: translate('components.assistance.restore', 'Show assistance for this file'),
        keywords: ['terraform', 'suggestion', 'context', 'setup'],
        run: () => {
          setRuntimeAssistanceDismissed(dismissalKey, false)
          setOpen(true)
          refreshIfStale.current()
        }
      }
    ],
    [dismissalKey]
  )
  useDeckCommands(`editor-assistance:${worktreeId}`, commands)
  if (dismissed) {
    return null
  }
  const currentDraft = draft?.key === key && draft.current()
  const prepare = (): void => {
    if (!data || !context.valid) {
      return
    }
    try {
      const { guard } = captureProjectFileRoute(worktreeId)
      guard.assertCurrent()
      const current = (): boolean => {
        const entry = readEditorContextEntry(worktreeId)
        try {
          guard.assertCurrent()
        } catch {
          return false
        }
        return (
          latest.current === key &&
          useAppStore.getState().activeWorktreeId === worktreeId &&
          startWorkspaceHost(worktreeId) === context.hostId &&
          entry?.file === file &&
          entry.ownerId === context.editorOwner &&
          entry.modelVersion === context.modelVersion
        )
      }
      if (!current()) {
        return
      }
      setDraft({
        key,
        current,
        text: boundedAssistanceDraft(file, suggestion, data.snapshot, counts)
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }
  const chats = (tabs ?? []).filter(
    (tab) =>
      isStructuredTab(tab) &&
      structuredAgentSessionOwnerForTab(useAppStore.getState(), tab) === context.hostId
  )
  const deliver = (): void => {
    if (!draft?.current() || draft.key !== key) {
      return
    }
    if (chatId === 'copy') {
      // The renderer's Clipboard API is permission-denied in Orca; use the app's clipboard bridge.
      void window.api.ui.writeClipboardText(draft.text).then(
        () =>
          toast.success(translate('assistance.copied', 'Draft copied. Review it before sending.')),
        () => toast.error(translate('assistance.copyFailed', 'Could not copy the draft.'))
      )
      return
    }
    if (!draftAssistanceInOpenChat(worktreeId, chatId, context.hostId, draft.text, draft.current)) {
      toast.error(
        translate('assistance.refused', 'Context or chat owner changed. Prepare a new draft.')
      )
    }
  }
  return (
    <div
      className="absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-md border border-border bg-popover text-popover-foreground shadow-xs"
      data-editor-runtime-assistance=""
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) {
            refreshIfStale.current()
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs">
            <Sparkles className="size-4" aria-hidden />
            {translate('assistance.trigger', 'Review file context')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top" className="w-80">
          <div
            className="max-h-[70vh] space-y-3 overflow-y-auto p-3 scrollbar-sleek"
            data-runtime-assistance-details=""
          >
            <h3 className="text-sm font-medium">
              {translate('components.assistance.title', 'Assistance for this file')}
            </h3>
            <p className="break-all font-mono text-xs">{file}</p>
            <p className="text-sm">
              {suggestion.tool === 'editor' ? (
                translate(
                  'assistance.editorOnly',
                  'Editor diagnostics only; runtime capability is unverified.'
                )
              ) : (
                <>
                  {suggestion.tool} ·{' '}
                  {suggestion.available === null
                    ? translate('assistance.unknown', 'CLI availability unverified on this owner.')
                    : suggestion.available
                      ? translate(
                          'assistance.available',
                          'CLI found by the last owner-scoped inspection.'
                        )
                      : translate(
                          'assistance.missing',
                          'CLI not found by the last owner-scoped inspection.'
                        )}
                </>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate(
                'assistance.scope',
                'Source context and editor diagnostics only. No language-server, deployment or failed-run verification is implied.'
              )}
            </p>
            {!context.valid && (
              <div className="space-y-2">
                <p role="status" className="text-xs">
                  {state?.pending
                    ? translate('assistance.refreshing', 'Reading project context…')
                    : translate(
                        'assistance.stale',
                        'Project context is missing, changed or incomplete. Review discovery before preparing a draft.'
                      )}
                </p>
                {!state?.pending && (
                  <Button variant="outline" size="sm" onClick={refresh}>
                    {translate('assistance.refresh', 'Refresh project context')}
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openChanges('agent', [file])}>
                {translate('changes.assistanceEntry', 'Review a source change')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => openWorkspacePage('environments')}>
                {translate('assistance.environment', 'Review environment')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => openWorkspacePage('discovery')}>
                {translate('assistance.discovery', 'Review discovery')}
              </Button>
            </div>
            <Button variant="secondary" size="sm" disabled={!context.valid} onClick={prepare}>
              {translate('assistance.prepare', 'Prepare an unsent draft')}
            </Button>
            {draft && (
              <>
                {!currentDraft && (
                  <p role="status" className="text-xs">
                    {translate(
                      'assistance.draftStale',
                      'Draft context changed. Prepare a new draft before handing it off.'
                    )}
                  </p>
                )}
                <textarea
                  className="min-h-32 w-full rounded-md border border-input bg-background p-2 text-xs"
                  aria-label={translate('assistance.preview', 'Unsent assistance draft')}
                  value={draft.text}
                  readOnly
                />
                <Select value={chatId} onValueChange={setChatId}>
                  <SelectTrigger
                    aria-label={translate('assistance.destination', 'Draft destination')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="copy">
                      {translate('assistance.copyDestination', 'Copy for any agent')}
                    </SelectItem>
                    {chats.map((tab) => (
                      <SelectItem key={tab.id} value={tab.id}>
                        {tab.agentSessionAgent} · {tab.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'assistance.routing',
                    'Existing workspace chats accept unsent composer drafts. Other agents use copy-only handoff. No agent is launched and no message is submitted. Source, selection, diagnostic text and secret values are omitted.'
                  )}
                </p>
                <Button variant="secondary" size="sm" disabled={!currentDraft} onClick={deliver}>
                  {chatId === 'copy'
                    ? translate('assistance.copy', 'Copy reviewed draft')
                    : translate('assistance.append', 'Append to unsent composer')}
                </Button>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={translate('components.assistance.dismiss', 'Dismiss assistance for this file')}
        onClick={() => setRuntimeAssistanceDismissed(dismissalKey, true)}
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  )
}
