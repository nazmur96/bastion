// Fork: launch a packaged Bastion build on a disposable profile and prove it reaches Home.
// Usage: node config/scripts/bastion-packaged-launch-smoke.mjs <executable> <out-dir>
// Attaches over CDP (packaged builds may block Playwright's own Electron launcher).
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const [executable, out] = process.argv.slice(2)
if (!executable || !out) {
  console.error('usage: bastion-packaged-launch-smoke.mjs <executable> <out-dir>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'bastion-smoke-'))
const profile = join(root, 'profile')
const home = join(root, 'home')
mkdirSync(home)
const port = 9333
const log = []
const note = (line) => {
  log.push(line)
  console.log(line)
}
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  XDG_DATA_HOME: join(home, '.local/share'),
  XDG_CACHE_HOME: join(home, '.cache')
}
const child = spawn(executable, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
  env,
  stdio: ['ignore', 'pipe', 'pipe']
})
child.stdout.on('data', (data) => log.push(`[stdout] ${data}`))
child.stderr.on('data', (data) => log.push(`[stderr] ${data}`))
const exited = new Promise((resolve) =>
  child.on('exit', (code, signal) => resolve({ code, signal }))
)
let failure = null
try {
  let browser = null
  for (let attempt = 0; attempt < 90 && !browser; attempt++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  if (!browser) {
    throw new Error('no CDP endpoint within 90 s')
  }
  note('attached over CDP')
  let page = null
  for (let attempt = 0; attempt < 60 && !page; attempt++) {
    page =
      browser
        .contexts()
        .flatMap((context) => context.pages())
        .find((item) => item.url().startsWith('file:')) ?? null
    if (!page) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }
  if (!page) {
    throw new Error('no renderer window within 60 s')
  }
  await page.getByText('Create a workspace', { exact: false }).first().waitFor({ timeout: 60000 })
  note('Home shows "Create a workspace"')
  const existing = await page.getByText('Existing projects').count()
  note(`"Existing projects" cards: ${existing}`)
  if (existing !== 0) {
    throw new Error('empty "Existing projects" card is shown on a fresh profile')
  }
  await page.screenshot({ path: join(out, 'home.png') })
  note(`title: ${await page.title()}`)
  await browser.close()
} catch (error) {
  failure = error
  note(`FAILED: ${error.message}`)
} finally {
  child.kill('SIGTERM')
  const result = await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(() => resolve(null), 20000))
  ])
  note(`exit: ${result ? JSON.stringify(result) : 'still running after 20 s'}`)
  if (!result) {
    child.kill('SIGKILL')
  }
  const written = readdirSync(profile).length
  note(`profile entries written: ${written}`)
  if (!failure && written === 0) {
    failure = new Error('nothing was written to the disposable profile')
  }
  writeFileSync(join(out, 'launch.log'), log.join('\n'))
}
process.exit(failure ? 1 : 0)
