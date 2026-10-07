export const NETWORK_FAILURE_COPY = "Couldn't reach the server. Try again.";

export const START_FAILURE_COPY = {
  config: {
    label: "Can't start: a selected repo is missing",
    body: "One of the chosen repositories no longer exists on disk. Reopen the workspace and re-pick.",
  },
  playbook: {
    label: "Can't start: that playbook is gone",
    body: "The selected playbook was deleted. The list has refreshed. Pick another and press Start again.",
  },
  ineligible: {
    label: "Can't start: some members are no longer eligible",
  },
} as const;

export interface StartFailure {
  variant: "config" | "playbook" | "ineligible" | null;
  text: string;
}

export interface Refusal {
  error: string;
  variant?: string;
  ineligibleIds?: string[];
}

/**
 * Map a refused start to the failure the dialog shows.
 *
 * @remarks Only a `config` and a `playbook` variant get their own copy, from `START_FAILURE_COPY`. Any other 400 shows the server text as is.
 */
export function startFailure(result: Refusal): StartFailure {
  return {
    variant:
      result.variant === "config" || result.variant === "playbook"
        ? result.variant
        : null,
    text: result.error,
  };
}

/**
 * Map a refused group start to the failure the dialog shows.
 *
 * @remarks An `ineligible` refusal names the members the server rejected, as far as the dialog still lists them, and shows the server text when none match.
 */
export function groupStartFailure(
  result: Refusal,
  members: readonly { id: string; identifier: string }[],
): StartFailure {
  if (result.variant !== "ineligible") return startFailure(result);
  const stale = members
    .filter((m) => result.ineligibleIds?.includes(m.id))
    .map((m) => m.identifier);
  return {
    variant: "ineligible",
    text:
      stale.length > 0
        ? `No longer eligible: ${stale.join(", ")}. Remove ${stale.length === 1 ? "it" : "them"} and try again.`
        : result.error,
  };
}
