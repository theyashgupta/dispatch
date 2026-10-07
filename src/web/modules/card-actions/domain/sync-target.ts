export const TEAM_DEFAULT_STATE = "team-default";

export const SYNC_FAILED_COPY =
  "Sync to Linear failed. Retrying is safe, no duplicate will be created.";

/**
 * Turn the state select value into the `stateId` of the sync request.
 *
 * @remarks Radix Select cannot hold an empty item value, so "Team default" carries a sentinel and sends no state.
 */
export function stateIdOf(choice: string): string | undefined {
  return choice === TEAM_DEFAULT_STATE ? undefined : choice;
}
