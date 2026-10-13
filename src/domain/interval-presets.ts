import { parseIntervalPlan } from './interval-plan'

/** A plan the plan form offers under "Start from". */
export interface IntervalPreset {
  label: string
  plan: string
}

export interface IntervalPresetList {
  presets: IntervalPreset[]
  /** Lines left out because their plan cannot run, as written. */
  invalid: string[]
}

/** One `Label: plan` per line, the form the setting is edited in. */
export const DEFAULT_INTERVAL_PRESETS = [
  'Tabata: 8 x 20s @ 400W, 10s rest',
  'EMOM: 10 x 40s @ 300W, every 1m',
].join('\n')

/**
 * Reads the presets setting. The label ends at the first colon followed by a space,
 * so a plan's `1:30` is never mistaken for one; a line without a label is named by its plan.
 */
export function parseIntervalPresets(text: string): IntervalPresetList {
  const list: IntervalPresetList = { presets: [], invalid: [] }
  for (const line of text.split('\n').map((raw) => raw.trim())) {
    if (!line) {
      continue
    }
    const split = line.indexOf(': ')
    const label = split === -1 ? line : line.slice(0, split).trim()
    const plan = split === -1 ? line : line.slice(split + 2).trim()
    if (label && parseIntervalPlan(plan).ok) {
      list.presets.push({ label, plan })
    } else {
      list.invalid.push(line)
    }
  }
  return list
}
