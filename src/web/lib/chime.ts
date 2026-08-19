/** Lazily-constructed, reused across calls — expensive to construct and browsers cap how many can be live at once. */
let ctx: AudioContext | null = null;

/** `AudioContext` (prefixed on old Safari); null in a non-browser environment or when unsupported. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  return ctx;
}

/** One short sine tone with a linear attack + exponential decay envelope, to avoid clicks. */
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
 * Play the gentle attention chime (Settings ▸ Notifications' "Sound" toggle;
 * `useTransitionNotifications` fires this on a needs_input/agent_done transition). Synthesized via
 * Web Audio oscillators — a short two-note ascending fifth (A5 then E6) — rather than a bundled
 * audio asset, so there is no licensing/binary-size concern and no network fetch. Never throws: a
 * missing/blocked/failing Web Audio API silently no-ops, the same "cosmetic feature never crashes
 * the board" posture as the desktop Notification call it accompanies.
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
