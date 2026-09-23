import { useCallback, useState } from "react";

const NAV_KEY = "dsp.nav";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_KEY) === "collapsed";
  } catch {
    return false;
  }
}

/** The sidebar's remembered collapsed state under `dsp.nav`, expanded by default. */
export function useNavState(): { collapsed: boolean; toggle: () => void } {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(NAV_KEY, next ? "collapsed" : "expanded");
      } catch {}
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
