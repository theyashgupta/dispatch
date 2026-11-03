import { routeHash } from "./route.js";

export const ORCHESTRATOR_SETTINGS_TABS = ["policy", "orchestrators"] as const;

export type OrchestratorSettingsTab =
  (typeof ORCHESTRATOR_SETTINGS_TABS)[number];

export const CENTRE_VIEWS = ["bands", "tree"] as const;

export type CentreView = (typeof CENTRE_VIEWS)[number];

/** Tell whether a value is a known centre view. */
export function isCentreView(value: unknown): value is CentreView {
  return CENTRE_VIEWS.some((view) => view === value);
}

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

export function settingsHash(
  board: string,
  tab: OrchestratorSettingsTab,
): string {
  return `${routeHash({ page: "orchestrator", board })}?settings=${tab}`;
}
