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

/**
 * The first free board key for a name, or null when no candidate is free.
 *
 * @remarks The base is the first 6 letters and digits of the name, uppercased, with leading digits
 * dropped. A reserved or taken base gets one digit 2 to 9 on 5 characters, then two digits 10 to 99
 * on 4 characters.
 */
export function deriveBoardKey(
  name: string,
  taken: ReadonlySet<string>,
): BoardKey | null {
  let base = name
    .normalize("NFD")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/^[0-9]+/, "")
    .slice(0, 6);
  if (base === "") base = "BOARD";
  else if (base.length === 1) base += "1";
  const candidates = [base];
  for (let d = 2; d <= 9; d++) candidates.push(base.slice(0, 5) + d);
  for (let n = 10; n <= 99; n++) candidates.push(base.slice(0, 4) + n);
  for (const candidate of candidates) {
    if (
      BOARD_KEY_RE.test(candidate) &&
      !isReservedBoardKey(candidate) &&
      !taken.has(candidate)
    ) {
      return candidate as BoardKey;
    }
  }
  return null;
}

export function boardLink(key: BoardKey | string): string {
  return `/boards/${key}`;
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
    crossSessionInbound: null,
    memoryFloorMb: 1024,
    swapCeilingMb: 8192,
  };
}
