import { useLocation } from "@tanstack/react-router";
import {
  isCentreView,
  type CentreView,
} from "../../../../shared/orchestrator-settings.js";

/** Read the centre view requested in the location search, if it is a known view. */
export function useCentreView(): CentreView | undefined {
  return useLocation({
    select: (l) => (isCentreView(l.search.view) ? l.search.view : undefined),
  });
}
