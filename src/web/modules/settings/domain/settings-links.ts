import type { Page } from "../../../../shared/route.js";

export interface SettingsPageLink {
  page: Page;
  label: string;
}

export const SETTINGS_PAGE_LINKS: readonly SettingsPageLink[] = [
  { page: "accounts", label: "Accounts and Usage" },
  { page: "playbooks", label: "Playbooks" },
  { page: "vault", label: "Vault" },
  { page: "archive", label: "Archive" },
  { page: "workspaces", label: "Workspaces" },
  { page: "flow", label: "Flow" },
];
