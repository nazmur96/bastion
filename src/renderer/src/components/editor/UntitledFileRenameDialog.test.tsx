// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { UntitledFileRenameDialog } from './UntitledFileRenameDialog'

afterEach(cleanup)

function saveAs(currentName: string, typed: string): ReturnType<typeof vi.fn> {
  const onConfirm = vi.fn()
  render(
    <UntitledFileRenameDialog
      open
      currentName={currentName}
      worktreePath="/repo"
      onClose={() => {}}
      onConfirm={onConfirm}
    />
  )
  const input = screen.getByPlaceholderText('file name')
  fireEvent.change(input, { target: { value: typed } })
  fireEvent.keyDown(input, { key: 'Enter' })
  return onConfirm
}

it('keeps a non-markdown untitled file on its own extension', () => {
  expect(saveAs('untitled.json', 'bastion.service')).toHaveBeenCalledWith('bastion.service.json')
  cleanup()
  expect(saveAs('untitled.json', 'bastion.service.json')).toHaveBeenCalledWith(
    'bastion.service.json'
  )
})

it('still saves markdown drafts as markdown', () => {
  expect(saveAs('untitled.md', 'notes')).toHaveBeenCalledWith('notes.md')
})
