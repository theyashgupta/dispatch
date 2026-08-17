import {
  COLUMNS,
  type Card as CardModel,
  type Column,
} from "../../../shared/types.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "../board/index.js";
import type { LastOpenedMap } from "../../hooks/useUnseenActivity.js";

/** Side-nav section order: Inbox first, then the board's exact column order — exactly 7 sections. */
export const ORCA_SECTIONS: readonly Column[] = ["inbox", ...COLUMNS];

export type GroupDimension = "status" | "workspace";
export type SubgroupDimension = "none" | "status" | "workspace";
export type SortKey = "id" | "title";

export interface WorkspaceSubgroup {
  key: string;
  label: string;
  accent?: string;
  cards: CardModel[];
}

export interface WorkspaceGroup {
  key: string;
  label: string;
  accent?: string;
  count: number;
  subgrouped: boolean;
  subgroups: WorkspaceSubgroup[];
}

const NO_WORKSPACE_KEY = "";
const NO_WORKSPACE_LABEL = "No workspace";

function workspaceKeyOf(card: CardModel): string {
  return card.workspace?.folder ?? NO_WORKSPACE_KEY;
}

function workspaceLabelOf(key: string): string {
  if (key === NO_WORKSPACE_KEY) return NO_WORKSPACE_LABEL;
  const segments = key.split("/").filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? key;
}

function dimensionKeyOf(
  dimension: "status" | "workspace",
  card: CardModel,
): string {
  return dimension === "status" ? card.column : workspaceKeyOf(card);
}

function dimensionLabelOf(
  dimension: "status" | "workspace",
  key: string,
): string {
  return dimension === "status"
    ? COLUMN_LABELS[key as Column]
    : workspaceLabelOf(key);
}

function dimensionAccentOf(
  dimension: "status" | "workspace",
  key: string,
): string | undefined {
  return dimension === "status" ? COLUMN_ACCENT[key as Column] : undefined;
}

function statusKeysInUse(cards: CardModel[]): readonly string[] {
  const present = new Set(cards.map((c) => c.column));
  return ORCA_SECTIONS.filter((section) => present.has(section));
}

function workspaceKeysInUse(cards: CardModel[]): readonly string[] {
  const present = new Set(cards.map(workspaceKeyOf));
  const named = [...present]
    .filter((key) => key !== NO_WORKSPACE_KEY)
    .sort((a, b) => workspaceLabelOf(a).localeCompare(workspaceLabelOf(b)));
  return present.has(NO_WORKSPACE_KEY) ? [...named, NO_WORKSPACE_KEY] : named;
}

function dimensionKeysInUse(
  dimension: "status" | "workspace",
  cards: CardModel[],
): readonly string[] {
  return dimension === "status"
    ? statusKeysInUse(cards)
    : workspaceKeysInUse(cards);
}

function sortCards(cards: CardModel[], sort: SortKey): CardModel[] {
  const sorted = [...cards];
  if (sort === "title") {
    sorted.sort((a, b) => a.title.localeCompare(b.title));
  } else {
    sorted.sort((a, b) =>
      a.identifier.localeCompare(b.identifier, undefined, { numeric: true }),
    );
  }
  return sorted;
}

function buildSubgroups(
  cards: CardModel[],
  subgroup: SubgroupDimension,
  sort: SortKey,
): WorkspaceSubgroup[] {
  if (subgroup === "none") {
    return [{ key: "", label: "", cards: sortCards(cards, sort) }];
  }
  return dimensionKeysInUse(subgroup, cards).map((key) => ({
    key,
    label: dimensionLabelOf(subgroup, key),
    accent: dimensionAccentOf(subgroup, key),
    cards: sortCards(
      cards.filter((c) => dimensionKeyOf(subgroup, c) === key),
      sort,
    ),
  }));
}

/**
 * Build the Workspace view's nav sections: grouped by `group`, optionally nested by `subgroup`
 * (collapsed to "none" when it equals `group` — nesting a dimension under itself is meaningless),
 * cards within each leaf sorted by `sort`.
 * @remarks Group members are excluded — same member-exclusion convention as
 * `isInboxWaiting`/`StatusPillSwitcher`'s per-column count (`features/board/inbox-count.ts`) —
 * so only top-level cards (including `source: "group"` pseudo-cards) appear. STATUS as the
 * top-level `group` always yields exactly the 7 {@link ORCA_SECTIONS}, even empty ones, matching
 * the board's fixed-column familiarity (`group.subgrouped` stays consistent — an empty group has
 * zero subgroups regardless); every other bucket — a WORKSPACE group, or any subgroup — is present
 * only when it holds at least one card.
 */
export function buildWorkspaceGroups(
  cards: CardModel[],
  group: GroupDimension,
  subgroup: SubgroupDimension,
  sort: SortKey,
): WorkspaceGroup[] {
  const topLevel = cards.filter((c) => c.groupId == null);
  const effectiveSubgroup = subgroup === group ? "none" : subgroup;
  const groupKeys: readonly string[] =
    group === "status" ? ORCA_SECTIONS : workspaceKeysInUse(topLevel);

  return groupKeys.map((key) => {
    const inGroup = topLevel.filter((c) => dimensionKeyOf(group, c) === key);
    return {
      key,
      label: dimensionLabelOf(group, key),
      accent: dimensionAccentOf(group, key),
      count: inGroup.length,
      subgrouped: effectiveSubgroup !== "none",
      subgroups: buildSubgroups(inGroup, effectiveSubgroup, sort),
    };
  });
}

/**
 * The most recently opened card still present on the board, excluding the `"__feed__"` sentinel
 * key stamped by the activity-feed dot (not a card id). Used to auto-select on empty Workspace
 * view selection.
 */
export function mostRecentCardId(
  lastOpened: LastOpenedMap,
  cards: CardModel[],
): string | null {
  let best: { id: string; ts: string } | null = null;
  for (const [id, ts] of Object.entries(lastOpened)) {
    if (id === "__feed__") continue;
    if (!cards.some((c) => c.id === id)) continue;
    if (best == null || ts > best.ts) best = { id, ts };
  }
  return best?.id ?? null;
}
