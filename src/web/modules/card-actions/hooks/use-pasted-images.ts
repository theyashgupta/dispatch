import { useCallback, useEffect, useRef, useState } from "react";
import {
  imageFilesFromClipboard,
  reserveRoom,
} from "@/modules/card-actions/domain/pasted-images";

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
