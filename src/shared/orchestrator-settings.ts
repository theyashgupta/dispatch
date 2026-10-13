import { routeHash } from "./route.js";

export const SETTINGS_TABS = ["policy", "orchestrators"] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Map an old board link with `panel=orchestrator` to the centre settings tab, or null for any other link. */
export function legacyPanelRedirect(search: {
  panel?: unknown;
  tab?: unknown;
}): { settings: SettingsTab | undefined } | null {
  if (search.panel !== "orchestrator") return null;
  return { settings: SETTINGS_TABS.find((tab) => tab === search.tab) };
}

/** Build the hash that opens the settings sheet of a board on one tab. */
export function settingsHash(board: string, tab: SettingsTab): string {
  return `${routeHash({ page: "orchestrator", board })}?settings=${tab}`;
}
