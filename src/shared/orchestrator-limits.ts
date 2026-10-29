import { COLUMNS, type Column } from "./types.js";

export const ITEM_TITLE_MAX = 300;
export const BOARD_NAME_MAX = 100;
export const ITEM_DESCRIPTION_MAX = 20000;
export const TEAM_KEY_RE = /^[A-Z][A-Z0-9]{0,9}$/;
export const CARD_ID_MAX = 200;
export const BLOCKED_BY_MAX = 50;
export const MOVABLE_COLUMNS: readonly Column[] = [...COLUMNS, "inbox"];
export const DIRECTION_MAX = 10000;
export const ORCHESTRATOR_TOKEN_HEADER = "x-orchestrator-token";
export const SESSION_INPUT_MAX = 20000;
export const DECISION_QUESTION_MAX = 2000;
export const DECISION_LABEL_MAX = 200;
export const DECISION_OPTION_ID_RE = /^[a-z0-9_-]{1,40}$/;
export const DECISION_ID_RE = /^[A-Za-z0-9-]{1,40}$/;
export const PLAN_ENTRIES_MAX = 20;
export const PLAN_REF_MAX = 300;
export const PLAN_PLAYBOOK_MAX = 200;
export const CONVERSATION_LIMIT_MAX = 200;
export const CONVERSATION_TEXT_MAX = 8000;
export const SHIP_TITLE_MAX = 200;
export const SHIP_BODY_MAX = 20000;
export const ORCHESTRATOR_STATE_MAX_BYTES = 65536;
export const INTAKE_GOAL_MAX = 2000;
export const INTAKE_REQUIREMENTS_MAX_BYTES = 65536;
export const STALE_MINUTES = 15;
export const FROZEN_RELAUNCH_MINUTES = 15;
export const RELEASE_BUMPS = ["patch", "minor", "major"] as const;
export const RELEASE_FEATURE_MAX = 200;
export const RELEASE_FEATURES_MAX = 20;
export const RELEASE_PRS_MAX = 50;
export const ACCOUNT_ID_MAX = 200;

export type ReleaseBump = (typeof RELEASE_BUMPS)[number];

const SHIP_BRANCH_MAX = 255;
const SHIP_BRANCH_FORBIDDEN_RE = /[ ~^:?*[\\]|\.\.|\/\/|@\{/;

/**
 * True when `name` is a branch name that git accepts, by the `git check-ref-format` branch rules.
 *
 * @remarks The 255 character cap bounds the input at the trust boundary.
 */
export function isShipBranchName(name: string): boolean {
  if (name.length < 1 || name.length > SHIP_BRANCH_MAX) return false;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return false;
  }
  if (SHIP_BRANCH_FORBIDDEN_RE.test(name) || name === "@") return false;
  if (/^[-/]|[/.]$/.test(name)) return false;
  return name
    .split("/")
    .every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}
