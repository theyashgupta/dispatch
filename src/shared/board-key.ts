import type { BoardKey, BoardPolicy } from "./types.js";

export const BOARD_KEY_RE = /^[A-Z][A-Z0-9]{1,5}$/;

export const DEFAULT_BOARD_KEY = "LOCAL" as BoardKey;

export const ALL_BOARDS = "*" as const;

export const DEFAULT_CHECK_COMMAND = "npm run check";

const RESERVED_BOARD_KEYS: ReadonlySet<string> = new Set(["LOCAL", "GROUP"]);

/** Brand a string as a board key when it matches the D-2 key rule. */
export function parseBoardKey(value: string): BoardKey | null {
  return BOARD_KEY_RE.test(value) ? (value as BoardKey) : null;
}

/** True for a key that no new board can take (D-2). */
export function isReservedBoardKey(value: string): boolean {
  return RESERVED_BOARD_KEYS.has(value);
}

/** The team key of an identifier such as `ENG-12`; an id with no numeric suffix comes back whole. */
export function identifierPrefix(id: string): string {
  return id.replace(/-\d+$/, "");
}

/**
 * The D-6 policy defaults for a board.
 *
 * @remarks The supervisor starts off on the default board, so it behaves as the single board of
 * today, and on for a new board (D-6).
 */
export function defaultBoardPolicy(key: BoardKey): BoardPolicy {
  return {
    roadmapApproval: "ask",
    concurrencyCap: 3,
    loopModel: null,
    orchestratorModel: "opus",
    handoffPercent: 50,
    handoffHardPercent: 80,
    usageLimit: "wait",
    shipRights: "none",
    budgetPerGroup: null,
    supervisor: key === DEFAULT_BOARD_KEY ? "off" : "on",
    groupPlaybook: null,
    wakeMinutes: 15,
  };
}
