import { NARROW_QUERY } from "../../../../shared/media-queries.js";
import { useLocalStorage } from "@/components/ui/hooks/use-local-storage";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  CENTRE_EXPANDED_KEY,
  centrePaneMode,
  parseCentreExpanded,
} from "@/modules/orchestrator/domain/centre-pane";
import { useCentrePane } from "./use-centre-pane";

/**
 * Compute the effective mode of the terminal pane from the shared open choice, the stored expanded flag, the screen width and the terminal state.
 *
 * @remarks The toolbar and the pane container both call this, so the Terminal button shows exactly when the pane is closed. The caller passes `terminalReady` because the terminal state comes from the selection, which a hook cannot import.
 */
export function useCentrePaneMode(terminalReady: boolean) {
  const { open, setOpen } = useCentrePane();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [expanded, setExpanded] = useLocalStorage(
    CENTRE_EXPANDED_KEY,
    parseCentreExpanded,
  );
  const paneMode = centrePaneMode({ open, expanded, narrow, terminalReady });
  return { paneMode, expanded, setExpanded, setOpen };
}
