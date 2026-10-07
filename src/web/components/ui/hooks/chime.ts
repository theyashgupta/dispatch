let ctx: AudioContext | null = null;

/** The shared `AudioContext`, or null when Web Audio is unsupported. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined = window.AudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** One short sine tone with a linear attack and an exponential decay, to avoid clicks. */
function tone(
  audioCtx: AudioContext,
  frequencyHz: number,
  startAt: number,
  durationSec: number,
  peakGain: number,
): void {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = frequencyHz;
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSec);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(startAt);
  osc.stop(startAt + durationSec + 0.02);
}

/**
 * Play the gentle attention chime: a short ascending fifth, A5 then E6.
 *
 * @remarks Web Audio oscillators make the sound, so there is no asset to fetch or license. It
 * never throws: a missing or blocked Web Audio API is a silent no-op, so the chime never crashes
 * the board.
 */
export function playChime(): void {
  const audioCtx = getContext();
  if (!audioCtx) return;
  try {
    if (audioCtx.state === "suspended") {
      void audioCtx.resume().catch(() => {});
    }
    const now = audioCtx.currentTime;
    tone(audioCtx, 880, now, 0.32, 0.16);
    tone(audioCtx, 1318.51, now + 0.12, 0.34, 0.14);
  } catch {}
}
