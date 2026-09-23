import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  initialHash,
  parseRoute,
  routeHash,
  type Page,
  type Route,
} from "../lib/route.js";

const ROUTE_KEY = "dsp.route";
const LEGACY_VIEW_KEY = "dsp.view";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function getHash(): string {
  return window.location.hash;
}

/**
 * Owns the hash route: parses `location.hash`, remembers the last route under `dsp.route`, and on
 * first load replaces an empty hash with the remembered one.
 */
export function useRoute(): {
  route: Route;
  navigate: (page: Page, id?: string, options?: { replace?: boolean }) => void;
} {
  const hash = useSyncExternalStore(subscribe, getHash);
  const route = parseRoute(hash);

  useEffect(() => {
    const next = initialHash(
      window.location.hash,
      readStorage(ROUTE_KEY),
      readStorage(LEGACY_VIEW_KEY),
    );
    if (next !== window.location.hash) window.location.replace(next);
  }, []);

  useEffect(() => {
    if (hash === "" || hash === "#" || hash === "#/") return;
    try {
      localStorage.setItem(ROUTE_KEY, routeHash(parseRoute(hash)));
    } catch {}
  }, [hash]);

  const navigate = useCallback(
    (page: Page, id?: string, options?: { replace?: boolean }) => {
      const hash = routeHash({ page, id });
      if (options?.replace) window.location.replace(hash);
      else window.location.hash = hash;
    },
    [],
  );

  return { route, navigate };
}
