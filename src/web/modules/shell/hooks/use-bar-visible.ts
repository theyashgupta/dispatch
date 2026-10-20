import { useEffect, useRef, useState } from "react";
import type { Page } from "../../../../shared/route.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import { nextBarState } from "@/modules/shell/domain/bottom-bar";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Return whether the bottom bar shows, hiding it on scroll down and showing it on scroll up.
 *
 * @remarks The listener runs in the capture phase because each page owns its own scroll container and scroll events do not bubble.
 */
export function useBarVisible(column: HTMLElement | null, page: Page): boolean {
  const reducedMotion = useMediaQuery(REDUCED_MOTION);
  const inactive = column === null;
  const resetKey = `${page}|${reducedMotion}|${inactive}`;
  const [visible, setVisible] = useState(true);
  const [shownKey, setShownKey] = useState(resetKey);
  const visibleRef = useRef(true);
  const anchors = useRef(new WeakMap<Element, number>());

  if (shownKey !== resetKey) {
    setShownKey(resetKey);
    setVisible(true);
  }

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    anchors.current = new WeakMap();
  }, [page, reducedMotion, inactive]);

  useEffect(() => {
    if (column === null || reducedMotion) return;
    function onScroll(event: Event) {
      const el = event.target;
      if (!(el instanceof Element)) return;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        return;
      }
      const top = el.scrollTop;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      const anchor = anchors.current.get(el) ?? top;
      const next = nextBarState(
        { visible: visibleRef.current, anchor },
        top,
        atBottom,
      );
      anchors.current.set(el, next.anchor);
      visibleRef.current = next.visible;
      setVisible(next.visible);
    }
    column.addEventListener("scroll", onScroll, {
      capture: true,
      passive: true,
    });
    return () => column.removeEventListener("scroll", onScroll, true);
  }, [column, reducedMotion]);

  return reducedMotion || inactive ? true : visible;
}
