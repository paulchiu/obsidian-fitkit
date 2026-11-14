import type { RunPhase } from './interval-run'

export type RunCue = 'count' | 'go' | 'shift'

/**
 * The cue a tick owes between two readings of the run: `shift` when work runs straight
 * into the next step, `go` on any other phase change, `count` as each of a timed phase's
 * last `countdownSeconds` seconds arrives, otherwise nothing.
 */
export function cueBetween(
  previous: RunPhase,
  next: RunPhase,
  countdownSeconds: number,
): RunCue | null {
  if (previous.kind === 'idle' || next.kind === 'idle') {
    return null
  }
  if (previous.kind === 'work' && next.kind === 'work' && previous.rep !== next.rep) {
    return 'shift'
  }
  if (previous.kind !== next.kind || previous.rep !== next.rep) {
    return 'go'
  }
  if (previous.remaining === null || next.remaining === null) {
    return null
  }
  return next.remaining < previous.remaining &&
    next.remaining > 0 &&
    next.remaining <= countdownSeconds
    ? 'count'
    : null
}
