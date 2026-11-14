import { expect, type Locator } from '@stablyai/playwright-test'

// Hidden renderers may suspend locator.click's stability frames; security dialogs also use frames.
export async function clickCloudControl(control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  await expect(control).toBeEnabled()
  await control.evaluate((element) =>
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })
  )
  let point = { x: 0, y: 0 }
  let previous: { x: number; y: number } | null = null
  await expect
    .poll(
      async () => {
        const ready = await control.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          if (!hit || !element.contains(hit)) {
            return false
          }
          for (let parent: Element | null = element; parent; parent = parent.parentElement) {
            const region = getComputedStyle(parent).getPropertyValue('-webkit-app-region')
            if (region === 'no-drag') {
              break
            }
            if (region === 'drag') {
              return false
            }
          }
          return true
        })
        const box = await control.boundingBox()
        if (!ready || !box) {
          return false
        }
        point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        const stable =
          previous !== null &&
          Math.abs(previous.x - point.x) < 0.5 &&
          Math.abs(previous.y - point.y) < 0.5
        previous = point
        return stable
      },
      {
        message: 'Cloud control must be uncovered, stable and outside native drag areas',
        intervals: [50, 100, 150]
      }
    )
    .toBe(true)
  await control.page().mouse.click(point.x, point.y)
}
