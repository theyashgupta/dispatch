import {
  ATTACHMENT_MIME_TYPES,
  MAX_ATTACHMENTS,
} from "../../../../shared/types.js";

/**
 * Pick the image files out of a clipboard paste, and nothing else.
 *
 * @remarks Only the four formats the server stores are kept, so a paste can never produce a
 * thumbnail the request would later reject. Text-only pastes yield an empty list.
 */
export function imageFilesFromClipboard(
  items: DataTransferItemList | null,
): File[] {
  if (items === null) return [];
  const accepted: readonly string[] = ATTACHMENT_MIME_TYPES;
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== "file" || !accepted.includes(item.type)) continue;
    const file = item.getAsFile();
    if (file !== null) files.push(file);
  }
  return files;
}

/**
 * Decide how many incoming images fit under the cap and whether any were dropped.
 */
export function reserveRoom(
  used: number,
  incoming: number,
): { kept: number; limitHit: boolean } {
  const room = Math.max(MAX_ATTACHMENTS - used, 0);
  return { kept: Math.min(incoming, room), limitHit: incoming > room };
}
