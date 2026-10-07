import type { ActivityEvent, FilterOption } from "../../../../shared/types.js";
import type { ActivityFilter } from "./activity-groups.js";

/**
 * Builds the card and type options for the activity header filters from the feed.
 *
 * @remarks Ids that are selected in the filter stay in the lists even when no event carries them, so a selection never loses its label.
 */
export function activityFilterOptions(
  events: readonly ActivityEvent[],
  filter: ActivityFilter,
  identifiers: Readonly<Record<string, string>>,
): { cardOptions: FilterOption[]; typeOptions: FilterOption[] } {
  const cardIds = new Set(
    events.map((e) => e.cardId).filter((id): id is string => id != null),
  );
  if (filter.cardId != null) cardIds.add(filter.cardId);
  const cardOptions = [...cardIds].map((id) => ({
    id,
    label: identifiers[id] ?? id,
  }));
  const typeOptions = [
    ...new Set([...events.map((e) => e.type), ...filter.types]),
  ].map((type) => ({ id: type, label: type.replace(/_/g, " ") }));
  return { cardOptions, typeOptions };
}
