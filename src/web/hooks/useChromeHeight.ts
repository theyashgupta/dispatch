import { useEffect, useState } from "react";

/**
 * Measures the rendered height of the header chrome (UpdateBanner + SyncStrip) so the docked
 * DetailPanel can anchor below the full stack via `--chrome-top`. Measured rather than derived
 * from banner state because the banner contributes a variable number of rows (hidden, update row,
 * success row, error row + alert block) that only it knows about.
 */
export function useChromeHeight(): {
  chromeRef: (el: HTMLDivElement | null) => void;
  chromeHeight: number | null;
} {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    if (el == null) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return { chromeRef: setEl, chromeHeight: height };
}
