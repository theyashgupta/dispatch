import { isLinearUploadUrl } from "./linear-asset-url.js";

const ATTACHMENT_PREFIX = "attachments/";
const ATTACHMENT_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Pick the URL an inline markdown image loads from, or null when the source renders as a link.
 *
 * @remarks
 * An `attachments/` path loads from the attachment base when one is given and the rest is one plain
 * file name, so dot segments cannot resolve to another route. A Linear upload loads
 * through the same-origin image proxy, because the upload host needs the server's credentials.
 */
export function markdownImageSource(
  src: string,
  attachmentBase?: string,
): string | null {
  if (attachmentBase !== undefined && src.startsWith(ATTACHMENT_PREFIX)) {
    const name = src.slice(ATTACHMENT_PREFIX.length);
    if (!ATTACHMENT_NAME.test(name) || name === "." || name === "..") {
      return null;
    }
    return `${attachmentBase}/${encodeURIComponent(name)}`;
  }
  if (isLinearUploadUrl(src)) {
    return `/api/images?url=${encodeURIComponent(src)}`;
  }
  return null;
}
