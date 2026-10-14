import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createTestRoot,
  findButtons,
  harnessDocument,
  harnessWindow,
} from '../harness/obsidian-dom'

const menus = vi.hoisted((): Array<Array<{ title: string; click: () => void }>> => [])

vi.mock('obsidian', () => {
  class Menu {
    items: Array<{ title: string; click: () => void }> = []

    addItem(callback: (item: unknown) => void): this {
      const state = { title: '', click: (): void => {} }
      const item = {
        setTitle: (title: string) => ((state.title = title), item),
        setIcon: () => item,
        onClick: (click: () => void) => ((state.click = click), item),
      }
      callback(item)
      this.items.push(state)
      return this
    }

    showAtPosition(): void {
      menus.push(this.items)
    }
  }

  class Modal {
    contentEl = createTestRoot()
    modalEl = createTestRoot()
    titleEl = createTestRoot()

    setTitle(title: string): this {
      this.titleEl.textContent = title
      return this
    }

    constructor(readonly app: unknown) {}

    close(): void {
      const maybeClosable = this as { onClose?: () => void }
      maybeClosable.onClose?.()
    }
  }

  return { Menu, Modal, setIcon: (): void => {} }
})

import type { IntervalPreset } from '../../src/domain/interval-presets'
import { IntervalPlanModal } from '../../src/ui/interval-plan-modal'

const SLED = { label: 'Sled', plan: '6 x open @ 120kg, every 2m' }

const open = (
  initial?: string,
  presets: IntervalPreset[] = [SLED],
): { modal: IntervalPlanModal; onSave: ReturnType<typeof vi.fn> } => {
  const onSave = vi.fn()
  const modal = new IntervalPlanModal({} as never, {
    exerciseName: 'Exercise Bike',
    initial,
    presets,
    onSave,
  })
  modal.onOpen()
  return { modal, onSave }
}

const planField = (modal: IntervalPlanModal): HTMLTextAreaElement => {
  const found = modal.contentEl.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan"]')
  if (!found) {
    throw new Error('Plan field not rendered')
  }
  return found
}

const type = (modal: IntervalPlanModal, value: string): void => {
  const input = planField(modal)
  input.value = value
  input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
}

const saveButton = (modal: IntervalPlanModal): HTMLButtonElement => {
  const [save] = findButtons(modal.contentEl, 'Save')
  if (!save) {
    throw new Error('Save not rendered')
  }
  return save
}

const text = (modal: IntervalPlanModal, selector: string): string | null | undefined =>
  modal.contentEl.querySelector(selector)?.textContent

describe('interval plan modal', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { setTimeout: (callback: () => void): number => (callback(), 1) })
    vi.stubGlobal('activeWindow', harnessWindow)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    menus.length = 0
  })

  it('opens on the plan already on the card, with how many reps it has and how long it takes', () => {
    const { modal } = open('(x 8 (work 20s 400W) (rest 10s))')

    expect([
      modal.titleEl.textContent,
      planField(modal).value,
      text(modal, '.fitkit-plan-preview'),
    ]).toEqual([
      'Interval plan for Exercise Bike',
      '(x 8 (work 20s 400W) (rest 10s))',
      '8 reps · 3m50s',
    ])
  })

  it('saves a nested plan as typed, on one line', () => {
    const { modal, onSave } = open('8 x 30s @ 300W, 90s rest')

    type(modal, '(warmup 10m 150W)\n  (x 3 (over 1m 300W) (under 2m 220W))')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['(warmup 10m 150W) (x 3 (over 1m 300W) (under 2m 220W))']])
  })

  it('keeps the spacing inside a quoted name', () => {
    const { modal, onSave } = open(undefined)

    type(modal, '("big  gear" 2m 260W)\n   (spin 5m)')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['("big  gear" 2m 260W) (spin 5m)']])
  })

  it('tidies a one-line plan into its usual spelling', () => {
    const { modal, onSave } = open(undefined)

    type(modal, ' 6 x OPEN @ 120KG ,  every 2:00 ')
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['6 x open @ 120kg, every 2m']])
  })

  it('explains a plan that cannot run and will not save it', () => {
    const { modal, onSave } = open('(x 3 (over 1m 300W))')

    type(modal, '(x 3 (over 1m 300W)')
    saveButton(modal).click()

    expect([
      text(modal, '.fitkit-plan-error'),
      saveButton(modal).disabled,
      onSave.mock.calls,
    ]).toEqual(['Missing ) to close (x.', true, []])
  })

  it('fills the plan from a preset it was given', () => {
    const { modal, onSave } = open(undefined)

    findButtons(modal.contentEl, 'Sled')[0]?.click()
    saveButton(modal).click()

    expect(onSave.mock.calls).toEqual([['6 x open @ 120kg, every 2m']])
  })

  it('shows examples behind the info button, each one ready to use', () => {
    const { modal, onSave } = open(undefined)
    findButtons(modal.contentEl, 'Text')[0]?.click()
    const hiddenAtFirst = modal.contentEl
      .querySelector('.fitkit-plan-examples')
      ?.hasAttribute('hidden')

    modal.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Plan examples"]')?.click()
    const examples = modal.contentEl.querySelector('.fitkit-plan-examples')
    const pyramid = [...(examples?.querySelectorAll('.fitkit-plan-example') ?? [])].find(
      (example) => example.textContent?.includes('(L8 L10 L12'),
    )
    pyramid?.querySelector<HTMLButtonElement>('button')?.click()
    const shown = !examples?.hasAttribute('hidden')
    modal.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Plan examples"]')?.click()
    saveButton(modal).click()

    expect({
      hiddenAtFirst,
      shown,
      hiddenAgain: examples?.hasAttribute('hidden'),
      docs: examples?.querySelector('a')?.getAttribute('href'),
      saved: onSave.mock.calls,
    }).toEqual({
      hiddenAtFirst: true,
      shown: true,
      hiddenAgain: true,
      docs: 'https://github.com/paulchiu/obsidian-fitkit/blob/main/docs/note-format.md#interval-plans',
      saved: [['(x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))']],
    })
  })

  describe('when the phone keyboard opens', () => {
    /** Lays the form out as iOS leaves it: in Text, examples open and scrolled so the plan sits above the visible top. */
    const scrolledPastPlan = (modal: IntervalPlanModal): HTMLElement => {
      const { contentEl } = modal
      harnessDocument.body.append(contentEl)
      findButtons(contentEl, 'Text')[0]?.click()
      contentEl.querySelector<HTMLButtonElement>('button[aria-label="Plan examples"]')?.click()
      let scrollTop = 500
      Object.defineProperty(contentEl, 'scrollTop', {
        get: () => scrollTop,
        set: (value: number) => (scrollTop = value),
      })
      contentEl.getBoundingClientRect = (): DOMRect => ({ top: 60 }) as DOMRect
      const heading = contentEl.querySelector<HTMLElement>('.fitkit-plan-heading')
      if (heading) {
        heading.getBoundingClientRect = (): DOMRect => ({ top: -340 }) as DOMRect
      }
      return contentEl
    }

    const keyboardShows = (): void => {
      harnessDocument.defaultView?.dispatchEvent(new harnessWindow.Event('keyboardDidShow'))
    }

    it('scrolls the plan back to the top of the form while it is being typed in', () => {
      const { modal } = open('(x 3 (over 1m 300W))')
      const form = scrolledPastPlan(modal)

      planField(modal).focus()
      keyboardShows()

      expect(form.scrollTop).toBe(100)
      modal.close()
    })

    it('leaves the form where it is when the plan is not being typed in, or the form has closed', () => {
      const { modal } = open('(x 3 (over 1m 300W))')
      const form = scrolledPastPlan(modal)

      keyboardShows()
      const unfocused = form.scrollTop
      planField(modal).focus()
      modal.close()
      keyboardShows()

      expect([unfocused, form.scrollTop]).toEqual([500, 500])
    })

    describe('in the step editor', () => {
      /**
       * The form at the top of its scroll in a window 768 tall, with step fields whose bottoms sit
       * at `bottoms` and the Save bar's top at `barTop`.
       */
      const formWithFields = (
        modal: IntervalPlanModal,
        bottoms: number[],
        barTop = 900,
      ): { form: HTMLElement; fields: HTMLInputElement[] } => {
        const { contentEl } = modal
        const bar = contentEl.querySelector<HTMLElement>('.fitkit-set-note-actions')
        if (bar) {
          bar.getBoundingClientRect = (): DOMRect => ({ top: barTop }) as DOMRect
        }
        harnessDocument.body.append(contentEl)
        let scrollTop = 0
        Object.defineProperty(contentEl, 'scrollTop', {
          get: () => scrollTop,
          set: (value: number) => (scrollTop = value),
        })
        const fields = [
          ...contentEl.querySelectorAll<HTMLInputElement>('input[aria-label="Target"]'),
        ]
        fields.forEach((field, index) => {
          field.getBoundingClientRect = (): DOMRect =>
            ({ bottom: (bottoms[index] ?? 0) - scrollTop }) as DOMRect
        })
        return { form: contentEl, fields }
      }

      const keyboardShows = (height: number): void => {
        harnessDocument.defaultView?.dispatchEvent(
          Object.assign(new harnessWindow.Event('keyboardDidShow'), { keyboardHeight: height }),
        )
      }

      it('scrolls the field being typed in to just above the keyboard, with room below the last rows', () => {
        const { modal } = open('(x 3 (over 1m 300W) (under 2m 200W))')
        const { form, fields } = formWithFields(modal, [600, 700])

        fields[1]?.focus()
        keyboardShows(300)

        expect({
          scrollTop: form.scrollTop,
          room: form.style.getPropertyValue('--fitkit-keyboard-height'),
        }).toEqual({ scrollTop: 248, room: '300px' })
        modal.close()
      })

      it('brings a field tapped while the keyboard is up into view, and leaves one already in view', () => {
        const { modal } = open('(x 3 (over 1m 300W) (under 2m 200W))')
        const { form, fields } = formWithFields(modal, [400, 600])

        keyboardShows(300)
        fields[0]?.focus()
        const inView = form.scrollTop
        fields[1]?.focus()

        expect([inView, form.scrollTop]).toEqual([0, 148])
        modal.close()
      })

      it('keeps the field clear of the Save bar when the bar rides above the keyboard', () => {
        const { modal } = open('(x 3 (over 1m 300W))')
        const { form, fields } = formWithFields(modal, [450], 400)

        fields[0]?.focus()
        keyboardShows(300)

        expect(form.scrollTop).toBe(66)
        modal.close()
      })

      it('gives the room back once the keyboard hides', () => {
        const { modal } = open('(x 3 (over 1m 300W))')
        const { form, fields } = formWithFields(modal, [700])

        fields[0]?.focus()
        keyboardShows(300)
        harnessDocument.defaultView?.dispatchEvent(new harnessWindow.Event('keyboardDidHide'))

        expect(form.style.getPropertyValue('--fitkit-keyboard-height')).toBe('')
        modal.close()
      })
    })
  })

  describe('step editor', () => {
    const inputs = (modal: IntervalPlanModal, label: string): HTMLInputElement[] => [
      ...modal.contentEl.querySelectorAll<HTMLInputElement>(`input[aria-label="${label}"]`),
    ]

    const edit = (input: HTMLInputElement | undefined, value: string): void => {
      if (!input) {
        throw new Error('Field not rendered')
      }
      input.value = value
      input.dispatchEvent(new harnessWindow.Event('input', { bubbles: true }))
    }

    const pick = (
      modal: IntervalPlanModal,
      options: string,
      index: number,
      title: string,
    ): void => {
      const buttons = modal.contentEl.querySelectorAll<HTMLButtonElement>(
        `button[aria-label="${options}"]`,
      )
      buttons[index]?.click()
      menus
        .at(-1)
        ?.find((item) => item.title === title)
        ?.click()
    }

    const hidden = (modal: IntervalPlanModal, selector: string): boolean | undefined =>
      modal.contentEl.querySelector(selector)?.hasAttribute('hidden')

    it('shows a plan as rows, with repeats holding their steps', () => {
      const { modal } = open('(warmup 10m 150W) (x 3 (over 1m 300W) (rest 2m))')

      expect({
        names: inputs(modal, 'Step name').map((input) => input.value),
        work: inputs(modal, 'Work time').map((input) => input.value),
        targets: inputs(modal, 'Target').map((input) => input.value),
        rounds: inputs(modal, 'Rounds').map((input) => input.value),
        rests: inputs(modal, 'Rest time').map((input) => input.value),
        textHidden: hidden(modal, '.fitkit-plan-text'),
        preview: text(modal, '.fitkit-plan-preview'),
      }).toEqual({
        names: ['warmup', 'over'],
        work: ['10m', '1m'],
        targets: ['150W', '300W'],
        rounds: ['3'],
        rests: ['2m'],
        textHidden: true,
        preview: '4 reps · 17m',
      })
    })

    it('saves what was changed in the rows, previewing it as it is typed', () => {
      const { modal, onSave } = open('(x 3 (over 1m 300W) (rest 2m))')

      edit(inputs(modal, 'Rounds')[0], '4')
      edit(inputs(modal, 'Work time')[0], '90s')
      const preview = text(modal, '.fitkit-plan-preview')
      saveButton(modal).click()

      expect([preview, onSave.mock.calls]).toEqual([
        '4 reps · 12m',
        [['(x 4 (over 90s 300W) (rest 2m))']],
      ])
    })

    it('adds to a repeat from the + on its bracket, and to the plan from one Add bar', () => {
      const { modal, onSave } = open('(x 3 (over 1m 300W))')
      const add = (label: string, index: number, title: string): void =>
        pick(modal, label, index, title)
      const controls = {
        bars: modal.contentEl.querySelectorAll('button[aria-label="Add to plan"]').length,
        feet: modal.contentEl.querySelectorAll('button[aria-label="Add to repeat"]').length,
        menu: (): string[] => menus.at(-1)?.map((item) => item.title) ?? [],
      }

      add('Add to repeat', 0, 'Rest')
      const offered = controls.menu()
      add('Add to plan', 0, 'Repeat')
      add('Add to repeat', 1, 'Step')
      add('Add to plan', 0, 'Step')
      edit(inputs(modal, 'Step name')[3], 'cooldown')
      saveButton(modal).click()

      expect({
        bars: controls.bars,
        feet: controls.feet,
        offered,
        saved: onSave.mock.calls,
      }).toEqual({
        bars: 1,
        feet: 1,
        offered: ['Step', 'Rest', 'Repeat'],
        saved: [['(x 3 (over 1m 300W) (rest 1m)) (x 3 (work 1m) (work 1m)) (cooldown 1m)']],
      })
    })

    it('moves, copies, groups and removes rows from their menu', () => {
      const { modal, onSave } = open('(a 1m) (b 2m) (x 2 (c 3m))')

      pick(modal, 'Step options', 1, 'Move up')
      pick(modal, 'Step options', 0, 'Duplicate')
      pick(modal, 'Step options', 1, 'Delete')
      pick(modal, 'Step options', 1, 'Put in a repeat')
      pick(modal, 'Repeat options', 1, 'Ungroup')
      saveButton(modal).click()

      expect(onSave.mock.calls).toEqual([['(b 2m) (x 3 (a 1m)) (c 3m)']])
    })

    it('names the blank field and will not save until it is filled', () => {
      const { modal, onSave } = open('(x 3 (over 1m 300W))')

      edit(inputs(modal, 'Work time')[0], '')
      saveButton(modal).click()

      expect([
        text(modal, '.fitkit-plan-error'),
        saveButton(modal).disabled,
        onSave.mock.calls,
      ]).toEqual(['Give over a time, like 1m, or open.', true, []])
    })

    it('switches to text with the plan so far, and back to rows with what was typed', () => {
      const { modal, onSave } = open('(x 3 (over 1m 300W))')

      edit(inputs(modal, 'Target')[0], '320W')
      findButtons(modal.contentEl, 'Text')[0]?.click()
      const typedFrom = planField(modal).value
      type(modal, '(x 2 (under 2m 220W))')
      findButtons(modal.contentEl, 'Steps')[0]?.click()
      const names = inputs(modal, 'Step name').map((input) => input.value)
      saveButton(modal).click()

      expect([typedFrom, names, onSave.mock.calls]).toEqual([
        '(x 3 (over 1m 320W))',
        ['under'],
        [['(x 2 (under 2m 220W))']],
      ])
    })

    it('offers the text examples only in Text, closing them on the way back to Steps', () => {
      const { modal } = open('(x 3 (over 1m 300W))')
      const info = (): HTMLButtonElement | null =>
        modal.contentEl.querySelector<HTMLButtonElement>('button[aria-label="Plan examples"]')
      const inSteps = info()?.hasAttribute('hidden')

      findButtons(modal.contentEl, 'Text')[0]?.click()
      const inText = info()?.hasAttribute('hidden')
      info()?.click()
      findButtons(modal.contentEl, 'Steps')[0]?.click()

      expect({
        inSteps,
        inText,
        examplesBack: hidden(modal, '.fitkit-plan-examples'),
        expanded: info()?.getAttribute('aria-expanded'),
      }).toEqual({ inSteps: true, inText: false, examplesBack: true, expanded: 'false' })
    })

    it('opens a plan the rows cannot show as text, says why, and stays there on Steps', () => {
      const { modal } = open('(every 1m (work 40s 300W))')
      const opened = [hidden(modal, '.fitkit-plan-text'), hidden(modal, '.fitkit-plan-note')]

      findButtons(modal.contentEl, 'Text')[0]?.click()
      const inText = hidden(modal, '.fitkit-plan-note')
      findButtons(modal.contentEl, 'Steps')[0]?.click()

      expect({
        opened,
        inText,
        afterSteps: [hidden(modal, '.fitkit-plan-text'), hidden(modal, '.fitkit-plan-note')],
        note: text(modal, '.fitkit-plan-note'),
      }).toEqual({
        opened: [false, false],
        inText: true,
        afterSteps: [false, false],
        note: "This plan can't be shown as steps, so edit it as text.",
      })
    })
  })

  it('leaves out Start from when there are no presets', () => {
    const { modal } = open(undefined, [])

    expect(modal.contentEl.querySelector('.fitkit-plan-presets')).toBeNull()
  })

  it('offers Clear plan only for a card that has one, and clears it', () => {
    const fresh = open(undefined)
    const planned = open('8 x 30s @ 300W, 90s rest')

    findButtons(planned.modal.contentEl, 'Clear plan')[0]?.click()

    expect([findButtons(fresh.modal.contentEl, 'Clear plan'), planned.onSave.mock.calls]).toEqual([
      [],
      [[undefined]],
    ])
  })
})
