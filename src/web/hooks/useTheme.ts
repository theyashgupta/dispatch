import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  LIGHT_SCHEME_QUERY,
  THEME_STORAGE_KEY,
  parseThemePreference,
  resolveTheme,
  type Theme,
  type ThemePreference,
} from "../lib/theme.js";
import { useMediaQuery } from "./useMediaQuery.js";

const SWITCHING_ATTRIBUTE = "data-theme-switching";

interface ThemeState {
  preference: ThemePreference;
  theme: Theme;
  setPreference: (preference: ThemePreference) => void;
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

function setMeta(name: string, content: string): void {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (meta === null) {
    meta = document.createElement("meta");
    meta.name = name;
    document.head.append(meta);
  }
  meta.content = content;
}

/**
 * Keeps the html element on the resolved theme and returns the preference with its setter.
 *
 * @remarks Transitions are locked for two frames during a switch so no element lags behind its
 * neighbours.
 * @see docs/ARCHITECTURE.md#theme-engine
 */
export function useTheme(): ThemeState {
  const [preference, setStored] = useState(readStoredPreference);
  const systemIsLight = useMediaQuery(LIGHT_SCHEME_QUERY);
  const theme = resolveTheme(preference, systemIsLight);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const switching = root.getAttribute("data-theme") !== theme;
    if (switching) root.setAttribute(SWITCHING_ATTRIBUTE, "");
    root.setAttribute("data-theme", theme);
    setMeta("color-scheme", theme);
    setMeta(
      "theme-color",
      getComputedStyle(root).getPropertyValue("--bg").trim(),
    );
    if (!switching) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        root.removeAttribute(SWITCHING_ATTRIBUTE);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      root.removeAttribute(SWITCHING_ATTRIBUTE);
    };
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        setStored(readStoredPreference());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setStored(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {}
  }, []);

  return { preference, theme, setPreference };
}
