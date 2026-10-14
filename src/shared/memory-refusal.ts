export interface ActionRefusal {
  status: number | null;
  error?: string;
  reason?: string;
}

/**
 * Build the sentence shown when the memory gate refuses an action.
 *
 * @remarks An empty or missing reason reads as "memory is low", so callers pass the server reason through untouched.
 */
export function memoryRefusalCopy(
  subject: "start" | "start the group" | "resume",
  reason: string | undefined,
): string {
  return `Not enough memory to ${subject}: ${reason || "memory is low"}. Try again after a loop finishes.`;
}

/** Pick the toast text for a start the server refused. */
export function startRefusalText(result: {
  error: string;
  variant?: string;
}): string {
  return result.variant === "memory"
    ? memoryRefusalCopy("start", result.error)
    : result.error;
}
