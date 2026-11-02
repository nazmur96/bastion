import type * as ClaudeAgentSdk from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { createOrcaCliCall, type OrcaCliCall } from './orca-cli-call'
import { loadOrcaDocs, searchOrcaDocs } from './orca-docs-search'
import { toolText } from './orca-app-tool-text'
import { withClaudeEditHooks } from '../claude-edits/claude-edit-hooks'
import { withDevopsGateHooks } from '../devops/devops-command-gate-hook'
import { buildOrcaSettingsTools } from './orca-app-settings-tools'
import { buildOrcaWorkspaceTools } from './orca-app-workspace-tools'

const ORCA_APP_INSTRUCTIONS = `You are running inside Orca, the user's IDE, as its built-in agent. The orca tools act in the app the user is looking at:
- After changing files, open the most important one at the changed line (open_file) or show its diff (show_diff); use open_changed_files for a set of changes.
- After UI or web changes, open the running page with open_preview.
- Use run_in_terminal for long-running or interactive commands the user should watch, such as dev servers.
- For questions about Orca itself (features, shortcuts, settings, how to do something in this app), call search_orca_docs before answering.
- Workspaces: list_worktrees, create_worktree for a separate task, remove_worktree only when the user asks.
- hand_off_to_agent passes the task to another agent with a self-contained summary; use it when the user asks, or when you are blocked (e.g. out of usage).
- get_orca_settings / update_orca_setting change workflow settings such as the default agent; confirm before changing anything the user did not ask for.
Paths are relative to the workspace root.`

/** Tools that only open or show things in the app; they need no approval. */
export const ORCA_APP_READ_ONLY_TOOLS = [
  'mcp__orca__open_file',
  'mcp__orca__show_diff',
  'mcp__orca__open_changed_files',
  'mcp__orca__open_preview',
  'mcp__orca__search_orca_docs',
  'mcp__orca__list_worktrees',
  'mcp__orca__get_orca_settings'
]

type Sdk = Pick<typeof ClaudeAgentSdk, 'createSdkMcpServer' | 'tool'>

async function viaCli(call: OrcaCliCall, args: readonly string[], done: string) {
  const result = await call(args)
  return result.ok ? toolText(done) : toolText(`Orca could not do that: ${result.output}`, true)
}

function isWebUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export function buildOrcaAppTools(sdk: Sdk, call: OrcaCliCall, cwd: string) {
  const worktree = ['--worktree', `path:${cwd}`]
  return [
    sdk.tool(
      'open_file',
      'Open a workspace file in the editor, optionally at a line, and bring the user to it.',
      { path: z.string().min(1), line: z.number().int().positive().optional() },
      async ({ path, line }) =>
        viaCli(
          call,
          ['file', 'open', path, ...worktree, ...(line ? ['--line', String(line)] : []), '--focus'],
          `Opened ${path}${line ? ` at line ${line}` : ''}.`
        )
    ),
    sdk.tool(
      'show_diff',
      'Show the git diff of a workspace file in the diff view.',
      { path: z.string().min(1) },
      async ({ path }) =>
        viaCli(call, ['file', 'diff', path, ...worktree, '--focus'], `Showing the diff of ${path}.`)
    ),
    sdk.tool(
      'open_changed_files',
      'Open every git-changed file in the workspace as editor tabs.',
      {},
      async () =>
        viaCli(call, ['file', 'open-changed', ...worktree, '--focus'], 'Opened the changed files.')
    ),
    sdk.tool(
      'open_preview',
      "Open an http(s) URL, such as the app's dev server, in Orca's built-in browser.",
      { url: z.string().min(1) },
      async ({ url }) =>
        isWebUrl(url)
          ? viaCli(call, ['tab', 'create', '--url', url, ...worktree], `Opened ${url}.`)
          : toolText('Only http and https URLs can be previewed.', true)
    ),
    sdk.tool(
      'run_in_terminal',
      'Run a shell command in a new Orca terminal tab the user can watch, e.g. a dev server or test watcher.',
      { command: z.string().min(1), title: z.string().max(80).optional() },
      async ({ command, title }) =>
        viaCli(
          call,
          [
            'terminal',
            'create',
            ...worktree,
            '--command',
            command,
            ...(title ? ['--title', title] : []),
            '--focus'
          ],
          `Started \`${command}\` in a new terminal tab.`
        )
    ),
    sdk.tool(
      'search_orca_docs',
      "Search Orca's own documentation: features, shortcuts, settings and how-tos for this app.",
      { query: z.string().min(1) },
      async ({ query }) => {
        const hits = searchOrcaDocs(await loadOrcaDocs(), query)
        return toolText(
          hits.length === 0
            ? 'No Orca docs matched; answer from general knowledge and say so.'
            : hits.map((hit) => `## ${hit.title} (${hit.path})\n${hit.excerpt}`).join('\n\n')
        )
      }
    )
  ]
}

/** SDK options that give a Claude chat Orca's app tools; empty when this app's CLI is unavailable. */
export function orcaAppToolOptions(
  sdk: Sdk,
  env: Readonly<Record<string, string | undefined>>,
  cwd: string
): Pick<ClaudeAgentSdk.Options, 'mcpServers' | 'allowedTools' | 'hooks'> {
  // Edit snapshots for the Keep/Undo review do not depend on the CLI.
  const editHooks = withDevopsGateHooks(withClaudeEditHooks(undefined, cwd).hooks, cwd)
  const call = createOrcaCliCall(env, cwd)
  if (!call) {
    return editHooks
  }
  const server = sdk.createSdkMcpServer({
    name: 'orca',
    instructions: ORCA_APP_INSTRUCTIONS,
    tools: [
      ...buildOrcaAppTools(sdk, call, cwd),
      ...buildOrcaWorkspaceTools(sdk, call, cwd),
      ...buildOrcaSettingsTools(sdk)
    ]
  })
  return { mcpServers: { orca: server }, allowedTools: ORCA_APP_READ_ONLY_TOOLS, ...editHooks }
}
