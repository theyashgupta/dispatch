export interface PrEmptyState {
  kind: "filtered" | "no-remote" | "no-rows";
  title: string;
  description: string;
}

/**
 * The empty-state kind, title and sentence the list shows when no row is left.
 *
 * @remarks
 * The no-remote case shows only once the repository list is known and empty, so a list that is
 * still loading or failed reads as no rows. Rows that exist but fail the filters get the filtered case.
 */
export function prEmptyState(input: {
  repos: readonly string[] | null;
  hasRows: boolean;
}): PrEmptyState {
  if (input.hasRows) {
    return {
      kind: "filtered",
      title: "No pull requests match",
      description:
        "Try other filters, or clear them to see every pull request.",
    };
  }
  if (input.repos?.length === 0) {
    return {
      kind: "no-remote",
      title: "No GitHub repositories",
      description: "No board repository has a GitHub remote.",
    };
  }
  return {
    kind: "no-rows",
    title: "No open pull requests",
    description: "Open pull requests in the board repositories show up here.",
  };
}
