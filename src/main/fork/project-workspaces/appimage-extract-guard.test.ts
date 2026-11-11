import { expect, it } from 'vitest'
import { isMisroutedAppImageExtract } from './appimage-extract-guard'
import { projectWorkspaceRelaunchArgs } from './workspace-context'

it('refuses a packaged launch that was meant to extract the AppImage', () => {
  expect(isMisroutedAppImageExtract(['/opt/bastion', '--appimage-extract'], true)).toBe(true)
  expect(isMisroutedAppImageExtract(['/opt/bastion', '--appimage-extract=usr/bin'], true)).toBe(
    true
  )
  expect(isMisroutedAppImageExtract(['/opt/bastion', '--remote-debugging-port=1'], true)).toBe(
    false
  )
  expect(isMisroutedAppImageExtract(['/electron', '--appimage-extract'], false)).toBe(false)
})

it('never forwards an extraction flag into a workspace relaunch', () => {
  expect(projectWorkspaceRelaunchArgs(['--appimage-extract', '--x=1'], 'home')).toEqual([
    '--x=1',
    '--bastion-project-workspace=home'
  ])
})
