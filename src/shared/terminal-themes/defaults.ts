import type { TerminalThemeMap } from './types'

export const DEFAULT_TERMINAL_THEMES: TerminalThemeMap = {
  // Fork: the Bastion prototype's terminal panel (docs/fork/mockups/workbench-video.html).
  'Bastion Dark': {
    background: '#07090c',
    foreground: '#9aa5b8',
    cursor: '#e3e8f1',
    cursorAccent: '#07090c',
    selectionBackground: '#2c3446',
    selectionForeground: '#e3e8f1',
    black: '#11141b',
    red: '#e5534b',
    green: '#3fb68b',
    yellow: '#e2b340',
    blue: '#5b9cf6',
    magenta: '#c792ea',
    cyan: '#56b6c2',
    white: '#9aa5b8',
    brightBlack: '#4e566a',
    brightRed: '#ff6b62',
    brightGreen: '#c3e88d',
    brightYellow: '#f0c674',
    brightBlue: '#82aaff',
    brightMagenta: '#d7a5ff',
    brightCyan: '#89ddff',
    brightWhite: '#e3e8f1'
  },

  // Most colors come from Ghostty. Orca raises dark selection contrast because Ghostty's
  // original #3e4451 blends into Codex-style gray instruction blocks.
  'Ghostty Default Style Dark': {
    background: '#282c34',
    foreground: '#ffffff',
    cursor: '#ffffff',
    cursorAccent: '#282c34',
    selectionBackground: '#5a7898',
    selectionForeground: '#ffffff',
    black: '#1d1f21',
    red: '#cc6666',
    green: '#b5bd68',
    yellow: '#f0c674',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#c5c8c6',
    brightBlack: '#666666',
    brightRed: '#d54e53',
    brightGreen: '#b9ca4a',
    brightYellow: '#e7c547',
    brightBlue: '#7aa6da',
    brightMagenta: '#c397d8',
    brightCyan: '#70c0b1',
    brightWhite: '#eaeaea'
  },

  'Builtin Tango Light': {
    background: '#ffffff',
    foreground: '#2e3434',
    cursor: '#2e3434',
    cursorAccent: '#ffffff',
    selectionBackground: '#accef7',
    selectionForeground: '#2e3434',
    black: '#2e3436',
    red: '#cc0000',
    green: '#4e9a06',
    // Why: Claude-style previews use ANSI accent colors for readable text,
    // so the light theme cannot keep Tango's near-white legacy values.
    yellow: '#8e7700',
    blue: '#3465a4',
    magenta: '#75507b',
    cyan: '#05727e',
    white: '#6a6a6a',
    brightBlack: '#555753',
    brightRed: '#ef2929',
    brightGreen: '#1b7a1b',
    brightYellow: '#6d5a00',
    brightBlue: '#204a87',
    brightMagenta: '#ad7fa8',
    brightCyan: '#034b50',
    brightWhite: '#3d3d3d'
  }
}
