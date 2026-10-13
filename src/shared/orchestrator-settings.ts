import { routeHash } from "./route.js";

export const ORCHESTRATOR_SETTINGS_TABS = ["policy", "orchestrators"] as const;

export type OrchestratorSettingsTab =
  (typeof ORCHESTRATOR_SETTINGS_TABS)[number];

/**
 * Map an old `panel=orchestrator` link to a centre settings tab.
 *
 * @returns null for any other link.
 */
export function legacyPanelRedirect(search: {
  panel?: unknown;
  tab?: unknown;
}): { settings: OrchestratorSettingsTab | undefined } | null {
  if (search.panel !== "orchestrator") return null;
  return {
    settings: ORCHESTRATOR_SETTINGS_TABS.find((tab) => tab === search.tab),
  };
}

/** Build the hash that opens the settings sheet of a board on one tab. */
export function settingsHash(
  board: string,
  tab: OrchestratorSettingsTab,
): string {
  return `${routeHash({ page: "orchestrator", board })}?settings=${tab}`;
}
