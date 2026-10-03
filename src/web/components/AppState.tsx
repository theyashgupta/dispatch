import { createContext, useContext, type ComponentProps } from "react";
import type { Board } from "@/features/board";
import type { OrcaView } from "@/features/orca";
import type { TodayPage } from "@/features/today";
import type { InboxView } from "@/features/inbox";
import type { TicketsView } from "@/modules/tickets";
import type { ActivityPage } from "@/features/activity";
import type { SessionsPage } from "@/features/sessions";
import type { VaultView } from "@/modules/vault";
import type { CalendarView } from "@/modules/calendar";
import type { PullRequestsView } from "@/modules/pull-requests";
import type { ErrorsView } from "@/modules/errors";
import type { SlackView } from "@/modules/slack";
import type { MeetingsView } from "@/modules/meetings";
import type { AskPage } from "@/features/ask";
import type { FlowPage } from "@/features/flow";
import type { SettingsView } from "@/modules/settings";
import type { ConnectionsView } from "@/modules/connections";
import type { ArchiveView } from "@/modules/archive";
import type { PlaybooksView } from "@/modules/playbooks";
import type { WorkspacesView } from "@/modules/workspaces";
import type { Page } from "../../shared/route.js";

export interface AppPages extends Record<Page, object> {
  workspace: ComponentProps<typeof OrcaView>;
  "pull-requests": Omit<ComponentProps<typeof PullRequestsView>, "selectedKey">;
  errors: Omit<ComponentProps<typeof ErrorsView>, "selectedKey">;
  today: ComponentProps<typeof TodayPage>;
  slack: Omit<ComponentProps<typeof SlackView>, "selectedId">;
  inbox: ComponentProps<typeof InboxView>;
  tickets: ComponentProps<typeof TicketsView>;
  settings: Omit<ComponentProps<typeof SettingsView>, "tabId" | "connections"> &
    ComponentProps<typeof ConnectionsView>;
  activity: ComponentProps<typeof ActivityPage>;
  sessions: ComponentProps<typeof SessionsPage>;
  archive: ComponentProps<typeof ArchiveView>;
  playbooks: ComponentProps<typeof PlaybooksView>;
  vault: ComponentProps<typeof VaultView>;
  calendar: ComponentProps<typeof CalendarView>;
  meetings: Omit<ComponentProps<typeof MeetingsView>, "selectedId">;
  workspaces: ComponentProps<typeof WorkspacesView>;
  ask: Omit<ComponentProps<typeof AskPage>, "prefill">;
  flow: ComponentProps<typeof FlowPage>;
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
