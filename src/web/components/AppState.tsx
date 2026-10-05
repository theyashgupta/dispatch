import { createContext, useContext, type ComponentProps } from "react";
import type { Board } from "@/features/board";
import type { OrcaView } from "@/features/orca";
import type { PullRequestsPage } from "@/features/pull-requests";
import type { ErrorsPage } from "@/features/errors";
import type { TodayView } from "@/modules/today";
import type { SlackPage } from "@/features/slack/SlackPage";
import type { InboxView } from "@/modules/inbox";
import type { TicketsPage } from "@/features/tickets";
import type { ActivityView } from "@/modules/activity";
import type { AccountsPage } from "@/features/accounts";
import type { SessionsPage } from "@/features/sessions";
import type { ArchivePage } from "@/features/archive";
import type { PlaybooksPage } from "@/features/playbooks";
import type { VaultPage } from "@/features/vault";
import type { CalendarPage } from "@/features/calendar";
import type { MeetingsPage } from "@/features/meetings";
import type { WorkspacesPage } from "@/features/workspaces";
import type { SettingsView } from "@/modules/settings";
import type { ConnectionsView } from "@/modules/connections";
import type { AskView } from "@/modules/ask";
import type { FlowView } from "@/modules/flow";
import type { Page } from "../../shared/route.js";

export interface AppPages extends Record<Page, object> {
  workspace: ComponentProps<typeof OrcaView>;
  "pull-requests": Omit<ComponentProps<typeof PullRequestsPage>, "selectedKey">;
  errors: Omit<ComponentProps<typeof ErrorsPage>, "selectedKey">;
  today: ComponentProps<typeof TodayView>;
  slack: Omit<ComponentProps<typeof SlackPage>, "selectedId">;
  inbox: Omit<ComponentProps<typeof InboxView>, "renderSlackThread">;
  tickets: ComponentProps<typeof TicketsPage>;
  settings: Omit<ComponentProps<typeof SettingsView>, "tabId" | "connections"> &
    ComponentProps<typeof ConnectionsView>;
  activity: ComponentProps<typeof ActivityView>;
  accounts: ComponentProps<typeof AccountsPage>;
  sessions: ComponentProps<typeof SessionsPage>;
  archive: ComponentProps<typeof ArchivePage>;
  playbooks: ComponentProps<typeof PlaybooksPage>;
  vault: ComponentProps<typeof VaultPage>;
  calendar: ComponentProps<typeof CalendarPage>;
  meetings: Omit<ComponentProps<typeof MeetingsPage>, "selectedId">;
  workspaces: ComponentProps<typeof WorkspacesPage>;
  ask: Omit<ComponentProps<typeof AskView>, "prefill">;
  flow: ComponentProps<typeof FlowView>;
  board: ComponentProps<typeof Board>;
}

const AppStateContext = createContext<AppPages | null>(null);

export const AppStateProvider = AppStateContext.Provider;

export function useAppState(): AppPages {
  const value = useContext(AppStateContext);
  if (value === null) {
    throw new Error("useAppState must be used inside AppStateProvider");
  }
  return value;
}
