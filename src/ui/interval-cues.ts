import type { RunCue } from '../domain/interval-cues'

export interface CuePlayer {
  /** Creates the audio context; call from a tap, since iOS only unlocks audio inside a user gesture. */
  prime: () => void
  play: (cue: RunCue) => void
  keepAwake: () => void
  release: () => void
}

const TONES: Record<RunCue, { hz: number; seconds: number; vibrateMs: number }> = {
  count: { hz: 880, seconds: 0.12, vibrateMs: 40 },
  go: { hz: 1320, seconds: 0.4, vibrateMs: 200 },
}

/**
 * Beeps, vibration and the screen wake lock for the runner. All three are best
 * effort: a platform without them still runs the plan, it just stays quiet or dims.
 */
export function createCuePlayer(win: Window, beeps: boolean): CuePlayer {
  let audio: AudioContext | null = null
  let lock: WakeLockSentinel | null = null
  let wantAwake = false

  return {
    prime: () => {
      const AudioContextCtor = (win as Window & { AudioContext?: typeof AudioContext }).AudioContext
      if (!beeps || audio || !AudioContextCtor) {
        return
      }
      const context = new AudioContextCtor()
      audio = context
      void context.resume()
    },
    play: (cue) => {
      if (!beeps) {
        return
      }
      const tone = TONES[cue]
      win.navigator.vibrate?.(tone.vibrateMs)
      if (!audio) {
        return
      }
      const oscillator = audio.createOscillator()
      const gain = audio.createGain()
      oscillator.frequency.value = tone.hz
      gain.gain.setValueAtTime(0.25, audio.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + tone.seconds)
      oscillator.connect(gain)
      gain.connect(audio.destination)
      oscillator.start()
      oscillator.stop(audio.currentTime + tone.seconds)
    },
    keepAwake: () => {
      wantAwake = true
      const wakeLock = win.navigator.wakeLock as WakeLock | undefined
      if (!wakeLock || lock) {
        return
      }
      /** A refused lock (low battery, no permission) only means the screen may dim. */
      wakeLock.request('screen').then(
        (sentinel) => {
          if (wantAwake) {
            lock = sentinel
          } else {
            void sentinel.release()
          }
        },
        () => undefined,
      )
    },
    release: () => {
      wantAwake = false
      void lock?.release()
      lock = null
      void audio?.close()
      audio = null
    },
  }
}
