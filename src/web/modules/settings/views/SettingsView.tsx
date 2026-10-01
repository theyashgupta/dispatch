import type { ReactNode } from "react";
import type { ThemePreference } from "../../../../shared/theme.js";
import type { TunnelState } from "../../../../shared/types.js";
import {
  SettingsFrame,
  type SettingsFrameProps,
} from "@/modules/settings/components/SettingsFrame";
import { SettingsPanel } from "@/modules/settings/components/SettingsPanel";
import { AboutContainer } from "@/modules/settings/containers/AboutContainer";
import { AboutYouContainer } from "@/modules/settings/containers/AboutYouContainer";
import { AppearanceContainer } from "@/modules/settings/containers/AppearanceContainer";
import { BoardContainer } from "@/modules/settings/containers/BoardContainer";
import { NotificationsContainer } from "@/modules/settings/containers/NotificationsContainer";
import { RemoteContainer } from "@/modules/settings/containers/RemoteContainer";
import { UpdatesContainer } from "@/modules/settings/containers/UpdatesContainer";
import { WorkspacesContainer } from "@/modules/settings/containers/WorkspacesContainer";

interface SettingsViewProps extends Omit<SettingsFrameProps, "children"> {
  onSaved: () => void;
  tunnelState: TunnelState;
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  themePreference: ThemePreference;
  onThemePreferenceChange: (preference: ThemePreference) => void;
  onPlayChime: () => void;
  connections: ReactNode;
}

export function SettingsView({
  tabId,
  onTabChange,
  onOpenPage,
  onSaved,
  tunnelState,
  soundEnabled,
  onToggleSound,
  themePreference,
  onThemePreferenceChange,
  onPlayChime,
  connections,
}: SettingsViewProps) {
  return (
    <SettingsFrame
      tabId={tabId}
      onTabChange={onTabChange}
      onOpenPage={onOpenPage}
    >
      <SettingsPanel tab="connections">{connections}</SettingsPanel>
      <SettingsPanel tab="board">
        <BoardContainer onSaved={onSaved} />
      </SettingsPanel>
      <SettingsPanel tab="appearance">
        <AppearanceContainer
          themePreference={themePreference}
          onThemePreferenceChange={onThemePreferenceChange}
          onSaved={onSaved}
        />
      </SettingsPanel>
      <SettingsPanel tab="notifications">
        <NotificationsContainer
          soundEnabled={soundEnabled}
          onToggleSound={onToggleSound}
          onPlayChime={onPlayChime}
        />
      </SettingsPanel>
      <SettingsPanel tab="remote">
        <RemoteContainer tunnelState={tunnelState} />
      </SettingsPanel>
      <SettingsPanel tab="workspaces">
        <WorkspacesContainer />
      </SettingsPanel>
      <SettingsPanel tab="about-you">
        <AboutYouContainer onSaved={onSaved} />
      </SettingsPanel>
      <SettingsPanel tab="updates">
        <UpdatesContainer />
      </SettingsPanel>
      <SettingsPanel tab="about">
        <AboutContainer />
      </SettingsPanel>
    </SettingsFrame>
  );
}
