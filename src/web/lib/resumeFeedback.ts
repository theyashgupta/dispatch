export const RESUME_WATCHDOG_MS = 30000;

/**
 * Pick the resume-failure copy shared by both Resume affordances: a server
 * `resumeError` verbatim, else a distinct message for a 409 conflict (which
 * never claims the worktree is gone), else a neutral network/other-failure line.
 */
export function resumeFailureCopy(
  resumeError: string | null | undefined,
  status: number | null,
): string {
  if (resumeError != null) return resumeError;
  if (status === 409) {
    return "Resume was rejected — the session may already be starting. Wait a moment and try Resume again.";
  }
  return "Resume didn't go through. Try Resume again, or use Restart to begin a fresh session in the same branch.";
}
