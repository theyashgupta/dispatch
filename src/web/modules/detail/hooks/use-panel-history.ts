import { useCallback, useEffect, useRef } from "react";
import {
  INITIAL_PANEL_HISTORY,
  panelHistoryLeft,
  panelHistoryPopped,
  panelHistoryPushed,
} from "@/modules/detail/domain/panel-history";

/**
 * Give the takeover panel a `dspPanel` history entry so the back button closes it, and return the
 * close request every other close path uses.
 *
 * @remarks
 * A `dspPanel` entry left by a reload is replaced on mount, so a stale entry never needs a second
 * back. Every back the panel calls itself is counted, so its popstate echo never closes a card.
 */
export function usePanelHistory(
  active: boolean,
  onClose: () => void,
): () => void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const stateRef = useRef(INITIAL_PANEL_HISTORY);

  useEffect(() => {
    const { dspPanel, ...rest } = (window.history.state ?? {}) as {
      dspPanel?: boolean;
    };
    if (dspPanel === true) {
      window.history.replaceState(rest, "");
    }
    const onPop = () => {
      const next = panelHistoryPopped(stateRef.current);
      stateRef.current = next.state;
      if (next.close) onCloseRef.current();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!active) return;
    window.history.pushState(
      { ...(window.history.state as object | null), dspPanel: true },
      "",
    );
    stateRef.current = panelHistoryPushed(stateRef.current);
    return () => {
      const next = panelHistoryLeft(stateRef.current);
      stateRef.current = next.state;
      if (next.back) window.history.back();
    };
  }, [active]);

  return useCallback(() => {
    const next = panelHistoryLeft(stateRef.current);
    stateRef.current = next.state;
    if (next.back) window.history.back();
    onCloseRef.current();
  }, []);
}
