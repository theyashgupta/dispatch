import type { SourceFilters } from "../../../shared/types.js";

/**
 * A Linear `IssueFilter` value, narrowed to the dimensions this app constrains on. Every key is
 * optional EXCEPT `state`, which is always AND'd (unstarted-only by default, or unstarted+started
 * when `includeActive` is on). Absent keys mean "unconstrained" — the builder never emits
 * `assignee`/`team`/`project` with an empty membership list, which Linear would treat as
 * match-nothing and wipe the board (Pitfall P1).
 */
export interface LinearIssueFilter {
  assignee?: { id: { in: string[] } };
  team?: { id: { in: string[] } };
  project?: { id: { in: string[] } };
  cycle?: { isActive: { eq: true } };
  state:
    { type: { eq: "unstarted" } } | { type: { in: ["unstarted", "started"] } };
}

/**
 * Translate a `SourceFilters` selection into a query-shape decision, shared verbatim by the poll's
 * `fetch()` and the preview's `countMatches()` so the two can never drift (Pitfall P2).
 *
 * @remarks
 * `useViewerScope` is true only while `assignees` is empty: `viewer.assignedIssues` keeps the
 * implicit assigned-to-me scope while still accepting team/project/cycle/state, so a non-empty
 * assignee multi-select is the ONLY thing that forces the root `issues()` shape (which viewer-scope
 * cannot express). The filter object is composed key-by-key, adding a dimension only when its list
 * is non-empty (or the cycle toggle is on); `state` is always present, and switches from
 * `unstarted`-only to `unstarted`+`started` when `includeActive` is on. With everything empty and
 * `includeActive:false` the result is exactly `{ state: { type: { eq: "unstarted" } } }` — today's
 * default, byte-for-byte (FILT-05).
 */
export function buildLinearQuery(filters: SourceFilters): {
  useViewerScope: boolean;
  filter: LinearIssueFilter;
} {
  const filter: LinearIssueFilter = {
    state: filters.includeActive
      ? { type: { in: ["unstarted", "started"] } }
      : { type: { eq: "unstarted" } },
  };
  if (filters.assignees.length > 0) {
    filter.assignee = { id: { in: filters.assignees } };
  }
  if (filters.teams.length > 0) {
    filter.team = { id: { in: filters.teams } };
  }
  if (filters.projects.length > 0) {
    filter.project = { id: { in: filters.projects } };
  }
  if (filters.currentCycle) {
    filter.cycle = { isActive: { eq: true } };
  }
  return { useViewerScope: filters.assignees.length === 0, filter };
}
