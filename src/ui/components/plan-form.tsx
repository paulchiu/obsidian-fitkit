import type { JSX } from 'preact'
import { useLayoutEffect, useRef } from 'preact/hooks'

import type { IntervalPreset } from '../../domain/interval-presets'
import type { DraftItem } from '../model/plan-draft'
import { DOCS_URL, PLAN_EXAMPLES, type PlanPreview } from '../model/plan-form'
import { ActionBar } from './action-bar'
import { TextAreaField } from './fields'
import { IconButton, PlanBuilder, type PlanBuilderActions } from './plan-builder'

export interface PlanFormActions extends PlanBuilderActions {
  onPreset: (plan: string) => void
  onSteps: () => void
  onText: () => void
  onTextInput: (text: string) => void
  onToggleExamples: () => void
  onClear: () => void
  onCancel: () => void
  onSave: () => void
}

export interface PlanFormProps {
  presets: readonly IntervalPreset[]
  /** The step editor's rows, or null while the plan is edited as text. */
  rows: DraftItem[] | null
  /** Says the plan was asked for as steps but cannot be shown as them. */
  showNote: boolean
  text: string
  examplesOpen: boolean
  preview: PlanPreview
  canClear: boolean
  actions: PlanFormActions
  /** Receives, once mounted, the parts the shell keeps in view over the phone keyboard. */
  onLayout: (parts: PlanFormLayout) => void
}

export interface PlanFormLayout {
  heading: HTMLElement
  field: HTMLTextAreaElement
  bar: HTMLElement
}

const TEXT_ATTRIBUTES = { spellcheck: 'false', autocapitalize: 'off' }

/**
 * The interval plan form: presets, the Steps and Text views of the plan, what it comes to, the
 * examples, and the button bar.
 */
export function PlanForm({
  presets,
  rows,
  showNote,
  text,
  examplesOpen,
  preview,
  canClear,
  actions,
  onLayout,
}: PlanFormProps): JSX.Element {
  const inSteps = rows !== null
  const heading = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (heading.current && field.current && bar.current) {
      onLayout({ heading: heading.current, field: field.current, bar: bar.current })
    }
  }, [])
  return (
    <>
      {presets.length > 0 ? (
        <div class="fitkit-plan-presets">
          <span class="fitkit-label">Start from</span>
          {presets.map((preset) => (
            <button
              key={preset.label}
              class="fitkit-btn"
              onClick={() => actions.onPreset(preset.plan)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      <div class="fitkit-plan-heading" ref={heading}>
        <span class="fitkit-label">Plan</span>
        <IconButton
          cls="fitkit-plan-info"
          label="Plan examples"
          icon="info"
          hidden={inSteps}
          expanded={examplesOpen}
          onClick={actions.onToggleExamples}
        />
        <div class="fitkit-plan-modes">
          <button type="button" class="fitkit-btn" aria-pressed={inSteps} onClick={actions.onSteps}>
            Steps
          </button>
          <button type="button" class="fitkit-btn" aria-pressed={!inSteps} onClick={actions.onText}>
            Text
          </button>
        </div>
      </div>
      <div class="fitkit-plan-builder" hidden={!inSteps}>
        {rows ? <PlanBuilder items={rows} actions={actions} /> : null}
      </div>
      <TextAreaField
        class="fitkit-input fitkit-plan-text"
        aria-label="Plan"
        rows={3}
        attributes={TEXT_ATTRIBUTES}
        fieldRef={field}
        hidden={inSteps}
        value={text}
        onValueInput={actions.onTextInput}
      />
      <div class="fitkit-plan-note" hidden={!showNote}>
        This plan can't be shown as steps, so edit it as text.
      </div>
      <div class="fitkit-plan-preview">
        {preview.ok ? preview.summary : <span class="fitkit-plan-error">{preview.reason}</span>}
      </div>
      <div class="fitkit-plan-examples" hidden={!examplesOpen}>
        {PLAN_EXAMPLES.map((example) => (
          <div key={example.plan} class="fitkit-plan-example">
            <code>{example.plan}</code>
            <div class="fitkit-plan-example-about">{example.about}</div>
            <button class="fitkit-btn" onClick={() => actions.onPreset(example.plan)}>
              Use this
            </button>
          </div>
        ))}
        <a href={DOCS_URL}>Full syntax and more examples</a>
      </div>
      <ActionBar cls="fitkit-set-note-actions" barRef={bar}>
        {canClear ? (
          <button class="fitkit-btn" onClick={actions.onClear}>
            Clear plan
          </button>
        ) : null}
        <button class="fitkit-btn" onClick={actions.onCancel}>
          Cancel
        </button>
        <button
          class="fitkit-btn fitkit-btn-primary"
          disabled={!preview.ok}
          onClick={actions.onSave}
        >
          Save
        </button>
      </ActionBar>
    </>
  )
}
