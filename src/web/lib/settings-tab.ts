export const SETTINGS_TABS = [
  "connections",
  "board",
  "appearance",
  "notifications",
  "remote",
  "workspaces",
  "about-you",
  "updates",
  "about",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

const LEGACY_TAB_ALIASES: Readonly<Record<string, SettingsTab>> = {
  filters: "connections",
  playbooks: "connections",
  vault: "connections",
  accounts: "connections",
  models: "board",
  cleanup: "board",
  terminal: "appearance",
};

/**
 * Resolves a route detail to a settings tab, falling back to the first tab for unknown ids.
 * @remarks Legacy ids map to the tab that now holds their controls, so a saved hash such as
 * `#/settings/filters` renders Connections without rewriting the URL.
 */
export function settingsTabFrom(id: string | undefined): SettingsTab {
  if ((SETTINGS_TABS as readonly string[]).includes(id ?? "")) {
    return id as SettingsTab;
  }
  if (id !== undefined && Object.hasOwn(LEGACY_TAB_ALIASES, id)) {
    return LEGACY_TAB_ALIASES[id];
  }
  return SETTINGS_TABS[0];
}
