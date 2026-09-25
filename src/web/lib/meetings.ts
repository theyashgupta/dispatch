/**
 * The notice shown after the meeting notes flow creates or updates Inbox items.
 */
export function meetingNotice(result: {
  created: number;
  updated: number;
}): string {
  const items = (n: number) => (n === 1 ? "1 item" : `${n} items`);
  if (result.created === 0) {
    return `Updated ${items(result.updated)} in the Inbox.`;
  }
  const created = `Created ${items(result.created)} in the Inbox.`;
  return result.updated > 0 ? `${created} Updated ${result.updated}.` : created;
}
