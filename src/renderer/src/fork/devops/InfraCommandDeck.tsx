import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import { draftGoalForClaude } from './ask-claude'
import { useAllDeckCommands } from './command-deck-store'

function typingSomewhere(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      target.closest('.xterm, .monaco-editor') !== null)
  )
}

/** k9s-style `:` palette over the Infra home: launch, inspect, or hand the words to Claude. */
export const OPEN_DECK_EVENT = 'orca-fork:open-command-deck'

export function InfraCommandDeck({
  worktreeId,
  open,
  onOpenChange
}: {
  worktreeId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const commands = useAllDeckCommands()
  const [query, setQuery] = useState('')
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === ':' && !event.ctrlKey && !event.metaKey && !typingSomewhere(event.target)) {
        event.preventDefault()
        onOpenChange(true)
      }
    }
    const onAsk = (): void => onOpenChange(true)
    // Capture: the app's own shortcut layer stops some keys before they bubble to window.
    window.addEventListener('keydown', onKey, true)
    // The top bar's "⌘ : commands" asks for the deck too.
    window.addEventListener(OPEN_DECK_EVENT, onAsk)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(OPEN_DECK_EVENT, onAsk)
    }
  }, [onOpenChange])
  const groups = [...new Set(commands.map((command) => command.group))]
  const close = (): void => {
    onOpenChange(false)
    setQuery('')
  }
  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={translate('components.devops.deck.title', 'Command deck')}
      description={translate(
        'components.devops.deck.description',
        'Launch, inspect, or ask Claude'
      )}
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder={translate(
          'components.devops.deck.placeholder',
          'kind, logs web, describe, source… or anything for Claude'
        )}
      />
      <CommandList>
        <CommandEmpty>
          {translate('components.devops.deck.empty', 'No command. Enter asks Claude.')}
        </CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group} heading={group}>
            {commands
              .filter((command) => command.group === group)
              .map((command) => (
                <CommandItem
                  key={command.id}
                  value={`${command.group} ${command.label} ${(command.keywords ?? []).join(' ')}`}
                  onSelect={() => {
                    close()
                    command.run()
                  }}
                >
                  <span className="min-w-0 truncate">{command.label}</span>
                  {command.hint ? (
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                      {command.hint}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        {query.trim() ? (
          <CommandGroup heading="Claude">
            <CommandItem
              value={`claude ask ${query}`}
              onSelect={() => {
                const goal = query.trim()
                close()
                draftGoalForClaude(worktreeId, goal)
              }}
            >
              <MessageSquare aria-hidden />
              <span className="min-w-0 truncate">
                {translate('components.devops.deck.ask', 'Ask Claude: {{goal}}', {
                  goal: query.trim()
                })}
              </span>
            </CommandItem>
          </CommandGroup>
        ) : null}
      </CommandList>
    </CommandDialog>
  )
}
