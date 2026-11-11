import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: {} }))
vi.mock('@orca/process-host', () => ({ spawnProcess: vi.fn() }))
vi.mock('./workspace-dev-restart', () => ({ requestDevWorkspaceRestart: () => false }))
const { packagedWorkspaceLaunch } = await import('./workspace-destination')

it.runIf(process.platform === 'linux')(
  'relaunches an AppImage from its image file, not the mount that exits with this process',
  () => {
    const launch = packagedWorkspaceLaunch(
      'home',
      '/data/handoffs/a.json',
      {
        APPIMAGE: '/home/dev/Bastion.AppImage',
        APPDIR: '/tmp/.mount_Bastion',
        PATH: '/tmp/.mount_Bastion/usr/bin:/usr/bin'
      },
      ['/tmp/.mount_Bastion/bastion', '--bastion-project-workspace=existing'],
      '/tmp/.mount_Bastion/bastion'
    )
    expect(launch.program).toBe('/home/dev/Bastion.AppImage')
    expect(launch.args).toEqual(['--bastion-project-workspace=home'])
    expect(launch.env.APPDIR).toBeUndefined()
    expect(launch.env.PATH).toBe('/usr/bin')
    expect(launch.env.BASTION_WORKSPACE_HANDOFF).toBe('/data/handoffs/a.json')
  }
)

it.runIf(process.platform === 'linux')(
  'keeps an extracted appimage-run executable, whose re-launch would die with this process',
  () => {
    const cache = '/home/dev/.cache/appimage-run/abc'
    const launch = packagedWorkspaceLaunch(
      'home',
      '/h.json',
      { APPIMAGE: '/home/dev/Bastion.AppImage', APPDIR: cache },
      [`${cache}/bastion`],
      `${cache}/bastion`
    )
    expect(launch.program).toBe(`${cache}/bastion`)
  }
)

it('relaunches the installed executable when not running from an AppImage', () => {
  const launch = packagedWorkspaceLaunch(
    'home',
    '/h.json',
    { PATH: '/usr/bin' },
    ['/opt/b'],
    '/opt/b'
  )
  expect(launch.program).toBe('/opt/b')
  expect(launch.env.PATH).toBe('/usr/bin')
})
