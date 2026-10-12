import type { ResumeTarget } from "../../../shared/types.js";

/**
 * Choose what Resume launches: the newest conversation on disk, else the stored one, else a bare
 * continue.
 *
 * @remarks The files on disk are the truth, so an id that has no file is never returned. A file
 * replaces the stored conversation only when it was born after that conversation started.
 */
export function chooseResumeTarget(
  stored: { id: string; startedAt: string } | undefined,
  onDisk: { id: string; bornAtMs: number }[],
): ResumeTarget {
  const candidate = onDisk.reduce<(typeof onDisk)[number] | undefined>(
    (best, entry) =>
      best === undefined || entry.bornAtMs > best.bornAtMs ? entry : best,
    undefined,
  );
  if (
    candidate !== undefined &&
    candidate.id !== stored?.id &&
    (stored === undefined || candidate.bornAtMs > Date.parse(stored.startedAt))
  ) {
    return {
      mode: "resume",
      sessionId: candidate.id,
      startedAt: new Date(candidate.bornAtMs).toISOString(),
      ...(stored && {
        replaced: { storedId: stored.id, reason: "newer-on-disk" },
      }),
    };
  }
  if (stored && onDisk.some((entry) => entry.id === stored.id)) {
    return {
      mode: "resume",
      sessionId: stored.id,
      startedAt: stored.startedAt,
    };
  }
  return {
    mode: "continue",
    ...(stored && {
      replaced: { storedId: stored.id, reason: "no-conversation" },
    }),
  };
}
