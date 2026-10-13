import type { RunPhase } from './interval-run'

export type RunCue = 'count' | 'go'

const COUNTDOWN_SECONDS = 3

/**
 * The cue a tick owes between two readings of the run: `go` when the phase changed,
 * `count` as each of a timed phase's last three seconds arrives, otherwise nothing.
 */
export function cueBetween(previous: RunPhase, next: RunPhase): RunCue | null {
  if (previous.kind === 'idle' || next.kind === 'idle') {
    return null
  }
  if (previous.kind !== next.kind || previous.rep !== next.rep) {
    return 'go'
  }
  if (previous.remaining === null || next.remaining === null) {
    return null
  }
  return next.remaining < previous.remaining &&
    next.remaining > 0 &&
    next.remaining <= COUNTDOWN_SECONDS
    ? 'count'
    : null
}
