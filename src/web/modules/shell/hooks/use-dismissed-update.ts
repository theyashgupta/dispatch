import { useCallback, useState } from "react";

const DISMISS_KEY = "dispatch:update-dismissed-version";

function readDismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

/**
 * Remember the update version the user dismissed under one `localStorage` key.
 *
 * @remarks A storage failure leaves the dismissal in memory only, so the notice still closes.
 */
export function useDismissedUpdate(): {
  dismissedVersion: string | null;
  dismiss: (version: string) => void;
} {
  const [dismissedVersion, setDismissedVersion] =
    useState(readDismissedVersion);
  const dismiss = useCallback((version: string) => {
    try {
      localStorage.setItem(DISMISS_KEY, version);
    } catch {}
    setDismissedVersion(version);
  }, []);
  return { dismissedVersion, dismiss };
}
