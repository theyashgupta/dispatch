export const SETTINGS_TABS = [
  "filters",
  "models",
  "terminal",
  "workspaces",
  "remote",
  "notifications",
  "cleanup",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/**
 * Resolves a route detail to a settings tab, falling back to the first tab for unknown ids.
 * @remarks The retired playbooks, vault and accounts ids fall back too, so a saved legacy hash
 * lands on Sync filters instead of an empty pane.
 */
export function settingsTabFrom(id: string | undefined): SettingsTab {
  return (SETTINGS_TABS as readonly string[]).includes(id ?? "")
    ? (id as SettingsTab)
    : SETTINGS_TABS[0];
}
