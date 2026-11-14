# Deferred 9.2b acceptance

FL-08 (sealed execution), FL-09 (new terminal/agent env), FL-13 (five read-only listers), FL-14 (legacy fold-in/dead readiness) remain red requirements from Part F/F12. They are not claimed by the 9.2a suite.

Original FL-13 UI contract, retained for 9.2b implementation:

```ts
test('FL-13 distinguishes unavailable resource evidence from an empty running emulator', async ({
  orcaPage
}) => {
  const resources = orcaPage.getByTestId('floci-target-resources')
  await expect(resources).toBeVisible()
  await expect(resources).toContainText('Start this target to list resources')
  await expect(resources).not.toContainText('No resources found')
  await expect(resources.getByRole('button', { name: 'Create resource', exact: true })).toHaveCount(
    0
  )
})
```
