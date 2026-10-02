import { useSyncExternalStore } from "react";

const STANDALONE_QUERY = "(display-mode: standalone)";

function subscribe(onChange: () => void): () => void {
  const mql = window.matchMedia(STANDALONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function readStandalone(): boolean {
  return window.matchMedia(STANDALONE_QUERY).matches;
}

/** Report whether the app runs from the Home Screen, by the media query or the iOS flag. */
export function useStandaloneDisplay(): boolean {
  const media = useSyncExternalStore(subscribe, readStandalone);
  return (
    media ||
    ("standalone" in navigator &&
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  );
}
