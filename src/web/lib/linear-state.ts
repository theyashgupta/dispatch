import type { LinearState, LinearTeam } from "../../shared/types.js";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const STATE_TYPE_ORDER = [
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
];

const TYPE_FALLBACK: Record<string, string> = {
  triage: "var(--col-todo)",
  backlog: "var(--col-todo)",
  unstarted: "var(--col-todo)",
  started: "var(--prio-medium)",
  completed: "var(--col-in-review)",
  canceled: "var(--col-done)",
};

/**
 * Pick the color a Linear state chip renders in.
 *
 * @remarks Linear's own color is API data, so it is used only when it is a 6-digit hex; anything
 * else falls back to a token by state type, which keeps an arbitrary string out of a style value.
 */
export function stateChipColor(
  state: Pick<LinearState, "type" | "color">,
): string {
  if (state.color && HEX_COLOR.test(state.color)) return state.color;
  return TYPE_FALLBACK[state.type] ?? "var(--text-muted)";
}

/** Build the muted "<team key> · Cycle <n>" text, or null when neither part is known. */
export function teamCycleLabel(
  team: Pick<LinearTeam, "key"> | undefined | null,
  cycle: number | undefined | null,
): string | null {
  const parts = [
    team?.key,
    cycle != null ? `Cycle ${cycle}` : undefined,
  ].filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Rank a Linear state type in workflow order (triage first, canceled last, unknown types after). */
export function stateTypeRank(type: string): number {
  const i = STATE_TYPE_ORDER.indexOf(type);
  return i === -1 ? STATE_TYPE_ORDER.length : i;
}
