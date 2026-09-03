import { useCallback, useEffect, useRef, useState } from "react";
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENTS } from "../../shared/types.js";

interface PastedImage {
  id: string;
  url: string;
  base64: string;
}

interface PastedImages {
  images: PastedImage[];
  limitHit: boolean;
  onPaste: (items: DataTransferItemList | null) => void;
  remove: (id: string) => void;
}

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

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.onload = () =>
      resolve(
        typeof reader.result === "string"
          ? (reader.result.split(",")[1] ?? "")
          : "",
      );
    reader.readAsDataURL(file);
  });
}

/**
 * Hold the images pasted into the new-ticket box until they are sent with the request.
 *
 * @remarks Object URLs back the thumbnails and are revoked on remove and on unmount. Room under
 * `MAX_ATTACHMENTS` counts held thumbnails plus reads still in flight, so two quick pastes cannot
 * overshoot; the overflow is flagged through `limitHit` instead of failing the request later.
 */
export function usePastedImages(): PastedImages {
  const [images, setImages] = useState<PastedImage[]>([]);
  const [limitHit, setLimitHit] = useState(false);
  const urls = useRef<string[]>([]);
  const held = useRef(0);
  const pending = useRef(0);

  useEffect(() => {
    held.current = images.length;
  }, [images]);

  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const onPaste = useCallback((items: DataTransferItemList | null) => {
    const files = imageFilesFromClipboard(items);
    if (files.length === 0) return;
    const { kept: room, limitHit: hit } = reserveRoom(
      held.current + pending.current,
      files.length,
    );
    setLimitHit(hit);
    const kept = files.slice(0, room);
    pending.current += kept.length;
    Promise.all(kept.map(readBase64))
      .then((encoded) => {
        const added = kept.map((file, i) => {
          const url = URL.createObjectURL(file);
          urls.current.push(url);
          return { id: crypto.randomUUID(), url, base64: encoded[i] };
        });
        setImages((prev) => [...prev, ...added]);
      })
      .catch(() => undefined)
      .finally(() => {
        pending.current -= kept.length;
      });
  }, []);

  const remove = useCallback((id: string) => {
    setLimitHit(false);
    setImages((prev) => {
      const gone = prev.find((img) => img.id === id);
      if (!gone) return prev;
      URL.revokeObjectURL(gone.url);
      urls.current = urls.current.filter((u) => u !== gone.url);
      return prev.filter((img) => img.id !== id);
    });
  }, []);

  return { images, limitHit, onPaste, remove };
}
