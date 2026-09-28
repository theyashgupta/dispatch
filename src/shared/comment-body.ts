import { hasDispatchMarker } from "./marker-key.js";

export const COMMENT_BODY_MAX = 20_000;

/**
 * Why a Linear comment body must not be posted, or null when it may be.
 *
 * @remarks A body carrying the agent status marker is refused so a posted comment can never be
 * read back as an agent status line.
 */
export function validateCommentBody(body: unknown): string | null {
  if (typeof body !== "string" || body.trim() === "") {
    return "Comment is empty.";
  }
  if (body.length > COMMENT_BODY_MAX) {
    return `Comment is longer than ${COMMENT_BODY_MAX} characters.`;
  }
  if (hasDispatchMarker(body)) {
    return "Comment cannot contain DISPATCH_STATUS:.";
  }
  return null;
}
