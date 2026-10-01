import { useCallback, useState } from "react";
import {
  parseNavPreference,
  type NavPreference,
} from "@/modules/shell/domain/nav-open";

const NAV_KEY = "dsp.nav";

function readPreference(): NavPreference {
  try {
    return parseNavPreference(localStorage.getItem(NAV_KEY));
  } catch {
    return "expanded";
  }
}

/**
 * Read and store the sidebar's expanded or collapsed choice under `dsp.nav`, expanded by default.
 */
export function useNavPreference(): {
  preference: NavPreference;
  setPreference: (next: NavPreference) => void;
} {
  const [preference, setPreferenceState] = useState(readPreference);
  const setPreference = useCallback((next: NavPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(NAV_KEY, next);
    } catch {}
  }, []);
  return { preference, setPreference };
}
