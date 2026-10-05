/**
 * Format the remaining time until a scheduled deferred cleanup as a relative `{n}d`/`{n}h`/`{n}m`
 * (or sub-minute) copy string.
 *
 * @remarks
 * Inverts `format-age.ts`'s elapsed-time formatter into a remaining-time one, and takes `now` as a
 * parameter rather than reading the clock itself for the same reason: it stays a pure function so
 * it recomputes on the board's existing ~2s SSE re-render cadence, which is finer than its own
 * minute-level granularity — deliberately no dedicated per-card ticker (that would break the
 * standing "board interactions instant" constraint). No negative-number branch is needed: the boot
 * sweep/tick loop reaches a due card within one tick interval, so a due-or-past `dueAtMs` is a
 * transient race, not a state worth its own copy — it floors into the same `<1m` bucket. Returns
 * `""` for a non-finite `dueAtMs`, matching `formatAge`'s own guard.
 */
export function formatCleanupCountdown(dueAtMs: number, now: number): string {
  const remainingMs = dueAtMs - now;
  if (!Number.isFinite(remainingMs)) return "";
  const minutes = Math.floor(remainingMs / 60_000);
  if (minutes < 1) return "cleans in <1m";
  const hours = Math.floor(minutes / 60);
  if (hours < 1) return `cleans in ${minutes}m`;
  const days = Math.floor(hours / 24);
  if (days < 1) return `cleans in ${hours}h`;
  return `cleans in ${days}d`;
}
