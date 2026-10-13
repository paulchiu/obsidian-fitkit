import { parseIntervalProgram } from './interval-program'

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
  'Tabata: (x 8 (work 20s 400W) (rest 10s))',
  'EMOM: (x 10 (every 1m (work 40s 300W)))',
  'Over-unders: (warmup 10m 150W) (x 3 (x 3 (over 1m 300W) (under 2m 220W)) (rest 4m)) (cooldown 5m 120W)',
  'Pyramid: (x 6 (climb 1m (L8 L10 L12 L14 L12 L10)) (rest 1m))',
  '30/30: (x 10 (on 30s 350W) (off 30s 150W))',
  'Norwegian 4x4: (warmup 10m 150W) (x 4 (hard 4m 280W) (rest 3m))',
].join('\n')

/** Earlier defaults that a settings save stored verbatim; matched exactly, so presets someone wrote are kept. */
const FIRST_DEFAULT_PRESETS = [
  'Tabata: 8 x 20s @ 400W, 10s rest',
  'EMOM: 10 x 40s @ 300W, every 1m',
].join('\n')

/** Stored presets, with the untouched first defaults swapped for the current ones. */
export function upgradeIntervalPresets(stored: string): string {
  return stored === FIRST_DEFAULT_PRESETS ? DEFAULT_INTERVAL_PRESETS : stored
}

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
    if (label && parseIntervalProgram(plan).ok) {
      list.presets.push({ label, plan })
    } else {
      list.invalid.push(line)
    }
  }
  return list
}
