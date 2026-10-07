/**
 * The comments list the Linear section shows for a card.
 *
 * @remarks TanStack drops placeholder data when a refetch errors, so a failed refetch falls back
 * to the last list loaded for the same card; another card's list never shows.
 */
export function shownComments<T>(
  cardId: string,
  data: T[] | undefined,
  loaded: { cardId: string; comments: T[] } | null,
): T[] {
  return data ?? (loaded?.cardId === cardId ? loaded.comments : []);
}
