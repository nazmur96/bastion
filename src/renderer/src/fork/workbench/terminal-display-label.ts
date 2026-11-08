import type { Tab } from '../../../../shared/tab-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import { getRuntimePathBasename } from '../../../../shared/cross-platform-path'

export function terminalDisplayLabel(
  tab: Tab,
  terminal: TerminalTab | undefined,
  defaultShell: string
): string {
  if (tab.customLabel) {
    return tab.customLabel
  }
  const shell = terminal?.shellOverride || defaultShell
  if (!shell || !tab.label.startsWith('Terminal ')) {
    return tab.label
  }
  const ordinal = tab.label.slice('Terminal '.length)
  const name = getRuntimePathBasename(shell)
  return ordinal === '1' ? name : `${name} ${ordinal}`
}
