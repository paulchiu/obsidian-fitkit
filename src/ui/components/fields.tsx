import type { ComponentChildren, JSX, RefObject } from 'preact'
import { useLayoutEffect } from 'preact/hooks'

import { useDomEffect } from './dom-effect'

/**
 * Fields are uncontrolled: `value` is written to the element whenever it changes, so a draft must
 * echo the raw text typed (`1.`, not `1`); writing back the same text leaves the caret alone.
 */
type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

function useValue<T extends ValueElement>(value: string): RefObject<T | null> {
  return useDomEffect<T>(
    (el) => {
      el.value = value
    },
    [value],
  )
}

/**
 * Attributes Preact would set as properties (`spellcheck="false"` becomes the boolean `true`),
 * written as the attributes they are.
 */
function useAttributes(
  ref: RefObject<HTMLElement | null>,
  attributes?: Record<string, string>,
): void {
  useLayoutEffect(() => {
    for (const [name, value] of Object.entries(attributes ?? {})) {
      ref.current?.setAttribute(name, value)
    }
  }, [])
}

function useFocusOnMount(ref: RefObject<HTMLElement | null>, focus?: boolean): void {
  useLayoutEffect(() => {
    if (focus) {
      ref.current?.focus()
    }
  }, [])
}

export interface TextFieldProps {
  class?: string
  'aria-label'?: string
  placeholder?: string
  value: string
  onValueInput: (value: string) => void
  focusOnMount?: boolean
  attributes?: Record<string, string>
}

/** A one-line text box holding `value` and reporting each edit. */
export function TextField({
  value,
  onValueInput,
  focusOnMount,
  attributes,
  ...rest
}: TextFieldProps): JSX.Element {
  const ref = useValue<HTMLInputElement>(value)
  useAttributes(ref, attributes)
  useFocusOnMount(ref, focusOnMount)
  return (
    <input
      type="text"
      {...rest}
      ref={ref}
      onInput={(event) => onValueInput(event.currentTarget.value)}
    />
  )
}

export interface TextAreaFieldProps {
  /** Receives the text box once mounted, for a shell that needs its node. */
  fieldRef?: RefObject<HTMLTextAreaElement | null>
  class?: string
  'aria-label'?: string
  rows?: number
  hidden?: boolean
  value: string
  onValueInput: (value: string) => void
  attributes?: Record<string, string>
}

/** A multi-line text box holding `value` and reporting each edit. */
export function TextAreaField({
  value,
  onValueInput,
  attributes,
  fieldRef,
  ...rest
}: TextAreaFieldProps): JSX.Element {
  const ref = useValue<HTMLTextAreaElement>(value)
  useAttributes(ref, attributes)
  useLayoutEffect(() => {
    if (fieldRef) {
      fieldRef.current = ref.current
    }
  }, [])
  return (
    <textarea {...rest} ref={ref} onInput={(event) => onValueInput(event.currentTarget.value)} />
  )
}

/** A drop-down over its `children` options holding `value` and reporting each change. */
export function SelectField({
  value,
  onValueChange,
  children,
  ...rest
}: {
  class?: string
  'aria-label'?: string
  value: string
  onValueChange: (value: string) => void
  children: ComponentChildren
}): JSX.Element {
  const ref = useValue<HTMLSelectElement>(value)
  return (
    <select {...rest} ref={ref} onChange={(event) => onValueChange(event.currentTarget.value)}>
      {children}
    </select>
  )
}

/** An option that always carries a `value` attribute, which Preact skips when it equals the label. */
export function Choice({ value, label }: { value: string; label: string }): JSX.Element {
  const option = useDomEffect<HTMLOptionElement>((el) => el.setAttribute('value', value), [value])
  return (
    <option value={value} ref={option}>
      {label}
    </option>
  )
}
