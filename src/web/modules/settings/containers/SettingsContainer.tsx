import type { ReactNode } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { routeHash, type Page } from "../../../../shared/route.js";
import { useThemeState } from "@/components/ThemeProvider";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { playChime } from "@/components/ui/hooks/chime";
import { SettingsFrame } from "@/modules/settings/components/SettingsFrame";
import { SettingsPanel } from "@/modules/settings/components/SettingsPanel";
import { AboutContainer } from "@/modules/settings/containers/AboutContainer";
import { AboutYouContainer } from "@/modules/settings/containers/AboutYouContainer";
import { AppearanceContainer } from "@/modules/settings/containers/AppearanceContainer";
import { BoardContainer } from "@/modules/settings/containers/BoardContainer";
import { NotificationsContainer } from "@/modules/settings/containers/NotificationsContainer";
import { RemoteContainer } from "@/modules/settings/containers/RemoteContainer";
import { UpdatesContainer } from "@/modules/settings/containers/UpdatesContainer";
import { WorkspacesContainer } from "@/modules/settings/containers/WorkspacesContainer";

interface SettingsContainerProps {
  tabId: string | undefined;
  connections: ReactNode;
}

export function SettingsContainer({
  tabId,
  connections,
}: SettingsContainerProps) {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const tunnelState = useAppStore(appStore, (s) => s.tunnelState);
  const soundEnabled = useAppStore(appStore, (s) => s.soundEnabled);
  const { preference, setPreference } = useThemeState();
  const navigate = (page: Page, id?: string, replace?: boolean) =>
    void router.navigate({ href: routeHash({ page, id }).slice(1), replace });
  const onSaved = () => appStore.notice("Settings saved.");

  return (
    <SettingsFrame
      tabId={tabId}
      onTabChange={(tab) => navigate("settings", tab, true)}
      onOpenPage={(page) => navigate(page)}
    >
      <SettingsPanel tab="connections">{connections}</SettingsPanel>
      <SettingsPanel tab="board">
        <BoardContainer onSaved={onSaved} />
      </SettingsPanel>
      <SettingsPanel tab="appearance">
        <AppearanceContainer
          themePreference={preference}
          onThemePreferenceChange={setPreference}
          onSaved={onSaved}
        />
      </SettingsPanel>
      <SettingsPanel tab="notifications">
        <NotificationsContainer
          soundEnabled={soundEnabled}
          onToggleSound={appStore.setSoundEnabled}
          onPlayChime={playChime}
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
