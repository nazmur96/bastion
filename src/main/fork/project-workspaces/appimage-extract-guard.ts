export const APPIMAGE_EXTRACT_FLAG = '--appimage-extract'

/**
 * Orca's CLI setup runs the AppImage with --appimage-extract. Extracting launchers such as NixOS
 * appimage-run ignore that runtime flag and start the app itself, so refuse to open a window.
 */
export function isMisroutedAppImageExtract(argv: readonly string[], isPackaged: boolean): boolean {
  return (
    isPackaged &&
    argv
      .slice(1)
      .some((arg) => arg === APPIMAGE_EXTRACT_FLAG || arg.startsWith(`${APPIMAGE_EXTRACT_FLAG}=`))
  )
}
