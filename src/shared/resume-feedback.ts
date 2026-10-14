export const RESUME_WATCHDOG_MS = 30000;

/**
 * Pick the resume-failure copy shared by both Resume affordances.
 *
 * @remarks
 * A 409 conflict gets its own message so the copy never claims the worktree is gone, and a 409
 * `memory-pressure` refusal names the memory reason.
 */
export function resumeFailureCopy(
  resumeError: string | null | undefined,
  status: number | null,
  refusal?: { error?: string; reason?: string },
): string {
  if (resumeError != null) return resumeError;
  if (status === 409 && refusal?.error === "memory-pressure") {
    return `Not enough memory to resume: ${refusal.reason ?? "memory is low"}. Try again after a loop finishes.`;
  }
  if (status === 409) {
    return "Resume was rejected. The session may already be starting. Wait a moment and try Resume again.";
  }
  return "Resume didn't go through. Try Resume again, or use Restart to begin a fresh session in the same branch.";
}
