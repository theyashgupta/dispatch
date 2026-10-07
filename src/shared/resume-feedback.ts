export const RESUME_WATCHDOG_MS = 30000;

/**
 * Pick the resume-failure copy shared by both Resume affordances.
 *
 * @remarks
 * A 409 conflict gets its own message so the copy never claims the worktree is gone.
 */
export function resumeFailureCopy(
  resumeError: string | null | undefined,
  status: number | null,
): string {
  if (resumeError != null) return resumeError;
  if (status === 409) {
    return "Resume was rejected. The session may already be starting. Wait a moment and try Resume again.";
  }
  return "Resume didn't go through. Try Resume again, or use Restart to begin a fresh session in the same branch.";
}
