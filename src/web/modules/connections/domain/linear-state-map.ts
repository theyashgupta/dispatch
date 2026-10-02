import {
  MAPPED_COLUMNS,
  resolveTargetState,
} from "../../../../shared/linear-state-map.js";
import type {
  LinearStateMap,
  LinearWorkflow,
  MappedColumn,
} from "../../../../shared/types.js";

/** Every team's six columns resolved against the saved map, so defaults show as chosen. */
export function resolvedMap(
  workflow: LinearWorkflow,
  saved: LinearStateMap,
): LinearStateMap {
  return Object.fromEntries(
    workflow.teams.map((team) => [
      team.id,
      Object.fromEntries(
        MAPPED_COLUMNS.map((column) => [
          column,
          resolveTargetState(saved[team.id], team.states, column),
        ]),
      ),
    ]),
  );
}

/**
 * The draft the state map rows show: the resolved map with the user's edits on top.
 *
 * @remarks Save writes every team's six columns explicitly (U4-11), so the defaults the user saw
 * become the stored choice.
 */
export function stateMapDraft(
  workflow: LinearWorkflow,
  saved: LinearStateMap,
  edits: LinearStateMap,
): LinearStateMap {
  return Object.fromEntries(
    Object.entries(resolvedMap(workflow, saved)).map(([teamId, columns]) => [
      teamId,
      { ...columns, ...edits[teamId] },
    ]),
  );
}

/** Record one choice in the edits; an empty value means "Do not sync". */
export function chooseState(
  edits: LinearStateMap,
  teamId: string,
  column: MappedColumn,
  value: string,
): LinearStateMap {
  return {
    ...edits,
    [teamId]: { ...edits[teamId], [column]: value === "" ? null : value },
  };
}

export const NO_SYNC_VALUE = "__no-sync__";

/** The select value for a stored choice; a missing or null choice reads as "Do not sync". */
export function selectValueFor(choice: string | null | undefined): string {
  return choice ? choice : NO_SYNC_VALUE;
}

/** The choice a select value stands for, in the form `chooseState` takes. */
export function choiceFromSelectValue(value: string): string {
  return value === NO_SYNC_VALUE ? "" : value;
}
