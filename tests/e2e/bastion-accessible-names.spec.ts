import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'

// Fork: Step 13.4 accessibility audit. Every visible control on Bastion's own pages has an
// accessible name, so it can be found and operated by keyboard and screen reader.
const PAGES = [
  'Workspace home',
  'Project discovery',
  'Changes & runs',
  'Environments',
  'Cloud',
  'Recipes',
  'Delivery'
]

test('13.4 Bastion pages give every visible control an accessible name', async ({ orcaPage }) => {
  const unnamed: string[] = []
  for (const label of PAGES) {
    await openBastionPage(orcaPage, label)
    await orcaPage.waitForTimeout(1500)
    const found = await orcaPage.evaluate(() => {
      const page = document.querySelector('.workspace-page')
      if (!page) {
        return { checked: 0, unnamed: ['(no page)'] }
      }
      const name = (element: HTMLElement): string => {
        const labelledBy = element.getAttribute('aria-labelledby')
        const byId = labelledBy
          ?.split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
        const forLabel =
          element.id && document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
        return (
          element.getAttribute('aria-label') ??
          byId ??
          (forLabel ? forLabel.textContent : null) ??
          element.closest('label')?.textContent ??
          (element instanceof HTMLInputElement ? null : element.textContent) ??
          element.getAttribute('title') ??
          ''
        ).trim()
      }
      const controls = [
        ...page.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')
      ].filter(
        (element) => element.offsetParent !== null && element.getAttribute('type') !== 'hidden'
      )
      return {
        checked: controls.length,
        unnamed: controls
          .filter((element) => !name(element))
          .map((element) => `${element.tagName.toLowerCase()} ${element.outerHTML.slice(0, 120)}`)
      }
    })
    // A page with nothing to check would make this test vacuous.
    expect(found.checked, label).toBeGreaterThan(0)
    unnamed.push(...found.unnamed.map((entry) => `${label}: ${entry}`))
  }
  expect(unnamed).toEqual([])
})
