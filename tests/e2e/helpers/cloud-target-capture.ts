import { writeFileSync } from 'node:fs'
import {
  expect,
  type ElectronApplication,
  type Page,
  type TestInfo
} from '@stablyai/playwright-test'

export async function captureCloudWindow(
  app: ElectronApplication,
  page: Page,
  info: TestInfo,
  name: string
): Promise<void> {
  if (process.env.ORCA_E2E_ISOLATED_X11 !== '1') {
    return
  }
  const png = await app.evaluate(async ({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find(
      (window) => window.webContents.getURL() === url
    )
    if (!window) {
      throw new Error('Owned renderer window missing')
    }
    const [width, height] = window.getSize()
    window.setSize(width + 1, height)
    await new Promise((resolve) => setTimeout(resolve, 100))
    window.setSize(width, height)
    window.webContents.invalidate()
    const frame = await window.capturePage(undefined, { stayHidden: true, stayAwake: true })
    return frame.toPNG().toString('base64')
  }, page.url())
  expect(png.length).toBeGreaterThan(20000)
  writeFileSync(info.outputPath(name), Buffer.from(png, 'base64'))
}
