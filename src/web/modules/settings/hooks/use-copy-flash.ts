import { useEffect, useState } from "react";

const FLASH_MS = 1500;

/**
 * Copy text to the clipboard and report `true` for a moment so the button can say Copied.
 *
 * @remarks
 * A missing clipboard (a non-secure origin) or a refused write leaves the button unchanged instead of throwing.
 */
export function useCopyFlash(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), FLASH_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = (text: string) => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
      } catch {}
    })();
  };
  return [copied, copy];
}
