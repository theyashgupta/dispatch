import { useCallback, useEffect, useRef, useState } from "react";
import { COLUMNS } from "../../../../shared/types.js";
import type { Column as ColumnId } from "../../../../shared/types.js";
import {
  ACTIVE_RATIO,
  pickActiveColumn,
} from "@/modules/board/domain/carousel-column";

/**
 * Track which board column the carousel row shows and scroll a chosen column into view.
 *
 * @remarks
 * The observer runs only while `isCarousel` is true and the active column resets to null when it
 * is not. A pill select scrolls smoothly even under reduced motion, as the legacy board did.
 */
export function useCarouselColumn(isCarousel: boolean) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [activeColumn, setActiveColumn] = useState<ColumnId | null>(null);

  useEffect(() => {
    const root = rowRef.current;
    if (!isCarousel || root == null) {
      setActiveColumn(null);
      return;
    }
    setActiveColumn((prev) => prev ?? COLUMNS[0]);
    const ratios = new Map<ColumnId, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const col = (entry.target as HTMLElement).dataset.column as
            ColumnId | undefined;
          if (col == null) continue;
          ratios.set(col, entry.intersectionRatio);
        }
        const entriesByColumn = COLUMNS.map((column) => ({
          column,
          ratio: ratios.get(column) ?? 0,
        }));
        setActiveColumn((prev) => pickActiveColumn(entriesByColumn, prev));
      },
      { root, threshold: ACTIVE_RATIO },
    );
    for (const el of root.querySelectorAll("[data-column]")) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [isCarousel]);

  const selectColumn = useCallback((column: ColumnId) => {
    rowRef.current?.querySelector(`[data-column="${column}"]`)?.scrollIntoView({
      behavior: "smooth",
      inline: "start",
      block: "nearest",
    });
  }, []);

  return { rowRef, activeColumn, selectColumn };
}
