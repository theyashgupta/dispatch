export interface PollState {
  intervalMs: number | null;
  lastPercent: number | null;
  last429At: number | null;
}

export const INITIAL_POLL_STATE: PollState = {
  intervalMs: null,
  lastPercent: null,
  last429At: null,
};

export type PollResult =
  | { kind: "ok"; bindingPercent: number | null; nextResetAt: number | null }
  | { kind: "rate-limited"; retryAfterMs: number | null }
  | { kind: "rejected" }
  | { kind: "failed" };

export interface PollInput {
  now: number;
  inUse: boolean;
  thresholdPercent: number;
  result: PollResult;
  random: () => number;
  scale?: number;
}

export interface PollPlan {
  state: PollState;
  nextDueAt: number;
  holdUntil: number | null;
}

const FLOOR = 180;
const URGENT = 60;
const FIRST = 300;
export const IN_USE_CEILING = 300;
const IDLE_CEILING = 600;
const LIMITED_MIN = 600;
const GROWTH = 1.5;
const JITTER = 0.1;
const URGENT_MARGIN_PERCENT = 15;
const MOVE_PERCENT = 1;
const RESET_SLACK = 60;
const POST_429_FLOOR = 360;
export const POST_429_WINDOW = 3600;
const POST_429_GROWTH = 1.5;
const POST_429_CAP = 1800;
const RETRY_AFTER_MARGIN = 900;
const DEFAULT_HOLD = 300;
const RETRY_AFTER_CAP = 86400;
const REJECTED = 600;

/**
 * Return the binding bucket percent: the highest percent among the windows, or null with none.
 */
export function bindingPercent(
  windows: readonly { percent: number }[],
): number | null {
  if (windows.length === 0) return null;
  return Math.max(...windows.map((w) => w.percent));
}

/**
 * Plan when an account usage read is due next, from the result of the read that just finished.
 *
 * @remarks The design target is at most 20 reads per hour for each account, although the endpoint
 * allows about 28 to 30. The 180 second floor wins over the reset clamp and over jitter, and the
 * floor is 360 seconds inside the hour after a 429. Only an urgent read may go below it.
 */
export function planNextPoll(prev: PollState, input: PollInput): PollPlan {
  const { now, inUse, thresholdPercent, result, random, scale = 1 } = input;
  const ms = (seconds: number): number => (seconds * 1000) / scale;
  const base = prev.intervalMs;
  const recent429 =
    prev.last429At !== null && now - prev.last429At < ms(POST_429_WINDOW);
  const grown429 = Math.min(
    ms(POST_429_CAP),
    Math.max((base ?? ms(FIRST)) * POST_429_GROWTH, ms(POST_429_FLOOR)),
  );

  if (result.kind === "rate-limited") {
    const { retryAfterMs } = result;
    const hold =
      retryAfterMs !== null && retryAfterMs > 0
        ? Math.min(retryAfterMs / scale, ms(RETRY_AFTER_CAP))
        : ms(DEFAULT_HOLD);
    const holdUntil = now + hold + ms(RETRY_AFTER_MARGIN);
    return {
      state: {
        intervalMs: grown429,
        lastPercent: prev.lastPercent,
        last429At: holdUntil,
      },
      nextDueAt: holdUntil,
      holdUntil,
    };
  }

  const idleGrowth =
    base === null
      ? ms(FIRST)
      : Math.min(
          ms(inUse ? IN_USE_CEILING : IDLE_CEILING),
          Math.max(ms(FLOOR), base * GROWTH),
        );
  let interval = idleGrowth;
  let urgent = false;
  let percent: number | null = null;
  let nextResetAt: number | null = null;
  let limited = false;

  if (result.kind === "ok") {
    percent = result.bindingPercent;
    limited = percent !== null && percent >= thresholdPercent;
    nextResetAt = result.nextResetAt;
    const delta =
      prev.lastPercent !== null && percent !== null
        ? percent - prev.lastPercent
        : null;
    const moved = delta !== null && Math.abs(delta) >= MOVE_PERCENT;
    urgent =
      inUse &&
      delta !== null &&
      delta >= MOVE_PERCENT &&
      !recent429 &&
      percent !== null &&
      percent >= thresholdPercent - URGENT_MARGIN_PERCENT &&
      percent < thresholdPercent;
    if (urgent) interval = ms(URGENT);
    else if (limited) interval = ms(LIMITED_MIN);
    else if (base === null) interval = ms(FIRST);
    else if (moved)
      interval = Math.min(
        ms(inUse ? IN_USE_CEILING : IDLE_CEILING),
        Math.max(ms(FLOOR), base / 2),
      );
  } else if (result.kind === "rejected") {
    interval = ms(REJECTED);
  }

  const state: PollState = {
    intervalMs: interval,
    lastPercent: percent ?? prev.lastPercent,
    last429At: prev.last429At,
  };
  if (recent429 && !urgent && result.kind !== "rejected") {
    interval = Math.min(ms(POST_429_CAP), Math.max(interval, grown429));
    state.intervalMs = interval;
  }

  let delay = interval * (1 + (random() * 2 - 1) * JITTER);
  delay = Math.min(
    delay,
    recent429 ? ms(POST_429_CAP) : Math.max(interval, ms(IDLE_CEILING)),
  );
  if (limited) delay = Math.max(delay, ms(LIMITED_MIN));
  if (nextResetAt !== null && nextResetAt > now)
    delay = Math.min(delay, nextResetAt + ms(RESET_SLACK) - now);
  const floor = urgent
    ? ms(URGENT)
    : recent429 && result.kind !== "rejected"
      ? ms(POST_429_FLOOR)
      : ms(FLOOR);
  delay = Math.max(delay, floor);

  return { state, nextDueAt: now + delay, holdUntil: null };
}
