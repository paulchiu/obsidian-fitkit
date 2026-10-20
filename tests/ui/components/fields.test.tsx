import { render } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { Choice, SelectField, TextField } from '../../../src/ui/components/fields'
import { createTestRoot, harnessDocument, harnessWindow } from '../../harness/obsidian-dom'

const mount = (): HTMLElement => {
  const root = createTestRoot()
  harnessDocument.body.appendChild(root)
  return root
}

const typeInto = (input: HTMLInputElement, text: string): void => {
  input.value = text
  input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
}

describe('text field', () => {
  afterEach(() => {
    harnessDocument.body.replaceChildren()
  })

  it('leaves the text, caret and focus alone when the draft echoes what was typed', () => {
    const root = mount()
    const onValueInput = vi.fn()
    render(<TextField value="1" onValueInput={onValueInput} />, root)
    const input = root.querySelector('input') as HTMLInputElement
    input.focus()
    typeInto(input, '1.')
    input.setSelectionRange(1, 1)

    render(<TextField value="1." onValueInput={onValueInput} />, root)

    expect(root.querySelector('input')).toBe(input)
    expect([input.value, input.selectionStart]).toEqual(['1.', 1])
    expect(harnessDocument.activeElement).toBe(input)
    expect(onValueInput).toHaveBeenCalledExactlyOnceWith('1.')
  })

  it('writes a value that differs from what was typed, so drafts must keep the raw text', () => {
    const root = mount()
    render(<TextField value="1" onValueInput={() => {}} />, root)
    const input = root.querySelector('input') as HTMLInputElement
    typeInto(input, '1.')

    render(<TextField value="1" onValueInput={() => {}} />, root)
    const unchangedDraft = input.value
    render(<TextField value="2" onValueInput={() => {}} />, root)

    expect([unchangedDraft, input.value]).toEqual(['1.', '2'])
  })
})

describe('select field', () => {
  it('gives every option a value attribute, even one matching its label', () => {
    const root = createTestRoot()
    render(
      <SelectField value="lbs" onValueChange={() => {}}>
        <Choice value="kg" label="kg" />
        <Choice value="lbs" label="Pounds" />
      </SelectField>,
      root,
    )

    expect(
      Array.from(root.querySelectorAll('option'), (option) => option.getAttribute('value')),
    ).toEqual(['kg', 'lbs'])
    expect(root.querySelector('select')?.value).toBe('lbs')
  })
})
