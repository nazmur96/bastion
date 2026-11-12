import { expect, it } from 'vitest'
import { fileCapabilities } from './file-capabilities'
it.each([
  ['main.tf', 'hcl'],
  ['main.py', 'python'],
  ['deployment.yaml', 'yaml']
])('recognizes built-in support for %s without a plugin install', (file, language) => {
  expect(fileCapabilities(file, [])).toMatchObject({
    language,
    highlighting: 'built-in',
    syntax: null
  })
})
it('selects an installed syntax only for an otherwise unknown file type', () => {
  const syntax = {
    id: 'plugin:fixture',
    pluginKey: 'local/fixture',
    label: 'Fixture',
    extensions: ['.fixture'],
    filenames: [],
    revision: '1'
  } as const
  const entry = { ...syntax, extensions: [...syntax.extensions], filenames: [] }
  expect(fileCapabilities('main.fixture', [entry])).toMatchObject({
    highlighting: 'plugin',
    syntax: entry
  })
  expect(fileCapabilities('main.unknown', [])).toMatchObject({
    highlighting: 'plain-text',
    syntax: null
  })
})
