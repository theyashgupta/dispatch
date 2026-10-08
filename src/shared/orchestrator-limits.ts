import { COLUMNS, type Column } from "./types.js";

export const ITEM_TITLE_MAX = 300;
export const ITEM_DESCRIPTION_MAX = 20000;
export const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;
export const CARD_ID_MAX = 200;
export const MOVABLE_COLUMNS: readonly Column[] = [...COLUMNS, "inbox"];
export const DIRECTION_MAX = 10000;
export const ORCHESTRATOR_TOKEN_HEADER = "x-orchestrator-token";
export const SESSION_INPUT_MAX = 20000;
export const DECISION_QUESTION_MAX = 2000;
export const DECISION_LABEL_MAX = 200;
export const DECISION_OPTION_ID_RE = /^[a-z0-9_-]{1,40}$/;
export const DECISION_ID_RE = /^[A-Za-z0-9-]{1,40}$/;
export const SHIP_TITLE_MAX = 200;
export const SHIP_BODY_MAX = 20000;
export const ORCHESTRATOR_STATE_MAX_BYTES = 65536;
export const INTAKE_GOAL_MAX = 2000;
export const INTAKE_REQUIREMENTS_MAX_BYTES = 65536;

const SHIP_BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

/**
 * True when `name` is a branch name that the ship flow accepts.
 *
 * @remarks Refuses a `..` run, which git also refuses in a ref name.
 */
export function isShipBranchName(name: string): boolean {
  return SHIP_BRANCH_RE.test(name) && !name.includes("..");
}
