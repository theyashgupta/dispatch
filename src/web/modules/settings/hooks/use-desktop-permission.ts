import { useCallback, useReducer } from "react";
import type { DesktopPermission } from "@/modules/settings/domain/push-row-state";

function readDesktopPermission(): DesktopPermission {
  return "Notification" in window ? Notification.permission : "unsupported";
}

/**
 * Read the live desktop notification permission on every render.
 *
 * @remarks
 * The permission can change inside a push attempt, so `refresh` re-renders the caller to read it
 * again. `request` prompts, and only a click handler may call it.
 */
export function useDesktopPermission(): {
  permission: DesktopPermission;
  request: () => void;
  refresh: () => void;
} {
  const [, bump] = useReducer((tick: number) => tick + 1, 0);
  const refresh = useCallback(() => bump(), []);
  const request = useCallback(() => {
    if (!("Notification" in window)) return;
    void Notification.requestPermission().then(refresh);
  }, [refresh]);
  return { permission: readDesktopPermission(), request, refresh };
}
