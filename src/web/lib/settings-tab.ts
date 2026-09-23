export const SETTINGS_TABS = [
  "filters",
  "models",
  "terminal",
  "workspaces",
  "playbooks",
  "vault",
  "accounts",
  "remote",
  "notifications",
  "cleanup",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Resolves a route detail to a settings tab, falling back to the first tab for unknown ids. */
export function settingsTabFrom(id: string | undefined): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(id ?? "")
    ? (id as SettingsTab)
    : SETTINGS_TABS[0];
}
