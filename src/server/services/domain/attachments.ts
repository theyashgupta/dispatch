import { createHash, randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
} from "../../../shared/types.js";
import { ATTACHMENTS_DIR, attachmentsDir } from "../infra/paths.js";

export type ImageExt = "png" | "jpg" | "gif" | "webp";

export interface DecodedImage {
  bytes: Buffer;
  name: string;
  ext: ImageExt;
}

export const ATTACHMENT_NAME_RE = /^[a-f0-9]{16}\.(png|jpg|gif|webp)$/;
export const CARD_ID_RE = /^[A-Za-z0-9_-]+$/;

const ATTACHMENT_LINK_RE =
  /\]\(attachments\/([a-f0-9]{16}\.(?:png|jpg|gif|webp))\)/g;

/**
 * Detect the image format from the magic bytes, or return null for anything else.
 *
 * @remarks The client-declared MIME type is never trusted; only the bytes decide.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
export function imageExtension(bytes: Buffer): ImageExt | null {
  if (bytes.length < 12) return null;
  if (
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.subarray(0, 4).toString("latin1") === "GIF8") return "gif";
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  )
    return "webp";
  return null;
}

/**
 * Decode a request's base64 image list into validated bytes plus a content-hash filename.
 *
 * @see docs/ARCHITECTURE.md#security-threat-model
 *
 * @remarks Returns null on any violation (not an array of strings, over the count limit, an image
 * over the byte limit, or bytes that are not PNG, JPEG, GIF, or WebP) so the route can answer one
 * 400 without writing anything. The base64 length is checked before decoding so an oversize image
 * is never decoded into a Buffer. Byte-identical images collapse to one entry, since they share a
 * filename.
 */
export function decodeImages(raw: unknown): DecodedImage[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return null;
  const out: DecodedImage[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.length > MAX_ATTACHMENT_BYTES * 1.4)
      return null;
    const bytes = Buffer.from(item, "base64");
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) return null;
    const ext = imageExtension(bytes);
    if (ext === null) return null;
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const name = `${hash}.${ext}`;
    if (!out.some((img) => img.name === name)) out.push({ bytes, name, ext });
  }
  return out;
}

/**
 * Build the markdown block that links each stored image by its relative path.
 *
 * @remarks Empty string for no images, so callers can append unconditionally.
 */
export function screenshotsSection(names: readonly string[]): string {
  if (names.length === 0) return "";
  const links = names.map((n, i) => `![screenshot ${i + 1}](attachments/${n})`);
  return `\n\n## Screenshots\n\n${links.join("\n\n")}`;
}

/**
 * List the attachment filenames a description links, in order of appearance.
 */
export function attachmentLinks(description: string): string[] {
  return [...description.matchAll(ATTACHMENT_LINK_RE)].map((m) => m[1]);
}

/**
 * Rewrite every relative attachment link in a description to an absolute path under `dir`.
 */
export function withAbsoluteAttachments(
  description: string,
  dir: string,
): string {
  return description.replace(
    ATTACHMENT_LINK_RE,
    (_m, name: string) => `](${dir}/${name})`,
  );
}

/**
 * Write decoded images into a fresh staging folder and return its path, or null for no images.
 *
 * @remarks Runs before the card row is minted so a disk failure never leaves a card whose links
 * point at files that were never written. Same 0o700 folder and 0o600 file modes as the other
 * `~/.dispatch` artifacts.
 */
export async function stageAttachments(
  images: readonly DecodedImage[],
): Promise<string | null> {
  if (images.length === 0) return null;
  const dir = path.join(ATTACHMENTS_DIR, `.staging-${randomUUID()}`);
  await fsp.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const img of images) {
    await fsp.writeFile(path.join(dir, img.name), img.bytes, { mode: 0o600 });
  }
  return dir;
}

/**
 * Move a staged folder into place as the card's attachment folder.
 */
export async function commitAttachments(
  staged: string,
  cardId: string,
): Promise<void> {
  const dir = attachmentsDir(cardId);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(staged, dir);
}
