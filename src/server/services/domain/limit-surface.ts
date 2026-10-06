import type {
  AccountSessionEntry,
  ClaudeUsageSnapshot,
} from "../../../shared/types.js";

export type LimitSurface =
  { kind: "a" } | { kind: "b"; options: string[]; cursor: number };

export const CREDITS_OPTION = /credit|extra usage|upgrade|funds|pay/i;

const AUTO_CONTINUE = /continuing automatically/i;
const ESC_TO_CANCEL = /esc to cancel/i;
const MENU_TITLE = /what do you want to do\?/i;
const MENU_ROW = /^\s*([❯›>])?\s*(\d+)\.\s+(.+?)\s*$/;
const STOP_OPTION = /^stop(?: and wait\b|$)/i;
const WAIT_OPTION = /^wait here\b/i;
const UNTITLED_LIMIT_OPTION =
  /stop and wait for limit to reset|wait here, then continue automatically/i;
const TITLED_LIMIT_OPTION =
  /^stop\b|limit to reset|continue automatically|usage credits|more usage|upgrade your plan|lower priority/i;

/**
 * Find the last menu numbered from 1 in `lines`, with the row the pointer marks.
 *
 * @remarks Rows must count up from 1, so a numbered list in the conversation above the menu
 * starts its own block and never shifts the menu's indices.
 */
function lastMenu(lines: string[]): { options: string[]; cursor: number } {
  let menu = { options: [] as string[], cursor: -1 };
  let current: typeof menu | null = null;
  for (const raw of lines) {
    const row = MENU_ROW.exec(raw.replace(/^\s*│/, "").replace(/│\s*$/, ""));
    if (!row) continue;
    const n = Number(row[2]);
    if (n === 1) {
      current = { options: [], cursor: -1 };
      menu = current;
    } else if (current === null || n !== current.options.length + 1) {
      current = null;
      continue;
    }
    if (row[1] !== undefined && current.cursor < 0) {
      current.cursor = current.options.length;
    }
    current.options.push(row[3]);
  }
  return menu;
}

/**
 * Recognise a usage limit surface in a captured Claude pane, or `null` for any other pane.
 *
 * @remarks The menu counts only with its title and a known limit row, or without the title when
 * a row carries the exact stop or wait text, so a pane that merely mentions usage credits is not
 * a surface. A menu with no pointer row gets cursor -1.
 */
export function parseLimitSurface(pane: string): LimitSurface | null {
  const lines = pane.split("\n");
  let titleAt = -1;
  lines.forEach((l, i) => {
    if (MENU_TITLE.test(l)) titleAt = i;
  });
  const menu = lastMenu(titleAt >= 0 ? lines.slice(titleAt + 1) : lines);
  const isMenu =
    titleAt >= 0
      ? menu.options.some((o) => TITLED_LIMIT_OPTION.test(o))
      : menu.options.some((o) => UNTITLED_LIMIT_OPTION.test(o));
  if (isMenu) return { kind: "b", ...menu };
  if (AUTO_CONTINUE.test(pane) && ESC_TO_CANCEL.test(pane))
    return { kind: "a" };
  return null;
}

/**
 * Pick the menu row the limit action selects: the stop option, else the wait option, else `null`.
 *
 * @remarks The credits pattern is checked again on the chosen text, so no paid option is ever
 * returned whatever the stop and wait patterns match.
 */
export function limitChoice(options: readonly string[]): number | null {
  let index = options.findIndex((o) => STOP_OPTION.test(o));
  if (index < 0) index = options.findIndex((o) => WAIT_OPTION.test(o));
  if (index < 0 || CREDITS_OPTION.test(options[index])) return null;
  return index;
}

/**
 * Plan the tmux keys that leave a limit surface without a paid option, or `null` to send no key.
 *
 * @remarks Surface (a) is cancelled with Escape. On the menu the arrows may pass over a credits
 * row; only the row under the cursor at Enter is selected.
 */
export function planLimitKeys(surface: LimitSurface): string[] | null {
  if (surface.kind === "a") return ["Escape"];
  const index = limitChoice(surface.options);
  const { cursor } = surface;
  if (index === null || cursor < 0 || cursor >= surface.options.length) {
    return null;
  }
  const arrow = index > cursor ? "Down" : "Up";
  return [
    ...Array.from({ length: Math.abs(index - cursor) }, () => arrow),
    "Enter",
  ];
}

/**
 * Report whether the active account has allowance for a session at a limit.
 *
 * @remarks The result is `available` when every usage bucket is below 100 percent, `usage-unknown`
 * with no windows, else `undefined`.
 */
export function continueActionFor(
  usage: ClaudeUsageSnapshot,
): AccountSessionEntry["continueAction"] {
  if (usage.windows.length === 0) return "usage-unknown";
  return usage.windows.every((w) => w.percent < 100) ? "available" : undefined;
}
