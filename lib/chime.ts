export type ChimeId = 'arpeggio' | 'ding' | 'beeps' | 'custom'

export const CHIMES: { id: ChimeId; label: string }[] = [
  { id: 'arpeggio', label: 'Arpeggio' },
  { id: 'ding', label: 'Ding' },
  { id: 'beeps', label: 'Bíp bíp bíp' },
  { id: 'custom', label: 'Tùy chỉnh' },
]

export const CUSTOM_CHIME_MIN = 200
export const CUSTOM_CHIME_MAX = 1760

let audioCtx: AudioContext | null = null

function getAudioCtx(): AudioContext | null {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    const ctx = audioCtx ?? new Ctor()
    audioCtx = ctx
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

function tone(
  ctx: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  volume = 0.3,
  type: OscillatorType = 'sine',
) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.02)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)
  osc.connect(gain).connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.05)
}

/** Play the chosen chime through WebAudio (silent no-op when audio is blocked). */
export function playChime(chime: ChimeId, customFreq = 660) {
  const ctx = getAudioCtx()
  if (!ctx) return
  const t = ctx.currentTime
  switch (chime) {
    case 'arpeggio': {
      // C5 → E5 → G5, classic "timer done" arpeggio.
      const notes = [523.25, 659.25, 783.99]
      notes.forEach((f, i) => tone(ctx, f, t + i * 0.22, 0.2))
      break
    }
    case 'ding': {
      // Single bell: fundamental + a quiet harmonic sparkle.
      tone(ctx, 880, t, 0.7, 0.3)
      tone(ctx, 1760, t, 0.45, 0.06)
      break
    }
    case 'beeps': {
      // Three short equal beeps.
      for (let i = 0; i < 3; i++) tone(ctx, 1046.5, t + i * 0.25, 0.14, 0.28)
      break
    }
    case 'custom': {
      const f = Math.min(CUSTOM_CHIME_MAX, Math.max(CUSTOM_CHIME_MIN, customFreq))
      tone(ctx, f, t, 0.4, 0.3)
      break
    }
  }
}
