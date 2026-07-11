import { getLinearSource } from "../sources/registry.js";
import type {
  FilterCapabilities,
  FilterDimension,
  FilterOption,
  TicketSource,
} from "../sources/ticket.source.js";
import type { SourceFilters } from "../../shared/types.js";

/**
 * Thrown when a route asks for a source id the registry does not serve. It lives in the adapters
 * layer so routes can map it to a 404 without importing `sources` directly — the eslint boundary
 * forbids routes from reaching into `sources`, so this gateway is the only seam between them.
 */
export class SourceNotFound extends Error {
  constructor(sourceId: string) {
    super(`unknown source: ${sourceId}`);
    this.name = "SourceNotFound";
  }
}

/**
 * Resolve a source id to its TicketSource. Only `linear` exists today; anything else is a
 * SourceNotFound the route turns into a 404, keeping the not-found decision out of the routes layer.
 */
function resolveSource(sourceId: string): TicketSource {
  if (sourceId !== "linear") {
    throw new SourceNotFound(sourceId);
  }
  return getLinearSource();
}

/** The source's static filter surface — the dimensions the settings UI is allowed to render. */
export function getSourceCapabilities(sourceId: string): FilterCapabilities {
  return resolveSource(sourceId).capabilities;
}

/** Live workspace options for a multi-select dimension (users/teams/projects), fetched on demand. */
export function listSourceOptions(
  sourceId: string,
  dimension: Exclude<FilterDimension, "cycle">,
): Promise<{ options: FilterOption[]; truncated: boolean }> {
  return resolveSource(sourceId).listOptions(dimension);
}

/** Match count for a candidate filter set, routed through the poll's own builder (preview == reality). */
export function countSourceMatches(
  sourceId: string,
  filters: SourceFilters,
): Promise<{ count: number; more: boolean }> {
  return resolveSource(sourceId).countMatches(filters);
}
