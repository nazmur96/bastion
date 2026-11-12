import { detectLanguage } from '@/lib/language-detect'
import { matchPluginSyntax } from '@/store/plugin-syntax-packs'
import type { PluginSyntaxMetadata } from '../../../../shared/plugins/artifacts/plugin-syntax-artifact'

export function fileCapabilities(filePath: string, syntaxes: readonly PluginSyntaxMetadata[]) {
  const language = detectLanguage(filePath)
  const syntax = language === 'plaintext' ? matchPluginSyntax(syntaxes, filePath) : null
  return {
    language,
    syntax,
    highlighting:
      language !== 'plaintext'
        ? ('built-in' as const)
        : syntax
          ? ('plugin' as const)
          : ('plain-text' as const)
  }
}
