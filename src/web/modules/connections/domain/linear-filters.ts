import type { FilterOption, SourceFilters } from "../../../../shared/types.js";

export type MultiDim = "assignees" | "projects" | "teams";

export const MULTI_COPY: Record<
  MultiDim,
  { label: string; placeholder: string; emptyText: string }
> = {
  assignees: {
    label: "Assignees",
    placeholder: "Any assignee",
    emptyText: "No assignees found",
  },
  projects: {
    label: "Projects",
    placeholder: "Any project",
    emptyText: "No projects found",
  },
  teams: {
    label: "Teams",
    placeholder: "Any team",
    emptyText: "No teams found",
  },
};

export type PreviewState =
  | { status: "counting" }
  | { status: "ready"; count: number; more: boolean }
  | { status: "unavailable" };

/** The line under the filters that says how many tickets the draft matches. */
export function previewText(preview: PreviewState): string {
  if (preview.status === "counting") return "counting…";
  if (preview.status === "unavailable") return "preview unavailable";
  if (preview.more) return "Matches 250+ tickets";
  return `Matches ${preview.count} ${preview.count === 1 ? "ticket" : "tickets"}`;
}

/** The preview state for a draft, given the debounced draft and the latest count read. */
export function previewStateFrom(
  draft: SourceFilters | null,
  settled: SourceFilters | null,
  fetching: boolean,
  result: { count: number; more: boolean } | null | undefined,
): PreviewState {
  if (draft === null || draft !== settled || fetching || result === undefined) {
    return { status: "counting" };
  }
  return result
    ? { status: "ready", count: result.count, more: result.more }
    : { status: "unavailable" };
}

/** The trigger text of a multi-select: the selected count, or its placeholder when none. */
export function selectionLabel(selected: number, placeholder: string): string {
  return selected > 0 ? `${selected} selected` : placeholder;
}

/** Toggle one id in a selection, keeping the order of the others. */
export function toggleId(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id];
}

/** The options whose label contains the search text, ignoring case. */
export function filterOptions(
  options: readonly FilterOption[],
  search: string,
): FilterOption[] {
  const needle = search.toLowerCase();
  return options.filter((o) => o.label.toLowerCase().includes(needle));
}
