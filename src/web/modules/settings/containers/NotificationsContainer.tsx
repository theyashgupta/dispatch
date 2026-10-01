import { NotificationsSection } from "@/modules/settings/components/NotificationsSection";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import {
  pushEnableError,
  pushRowState,
  type PushError,
} from "@/modules/settings/domain/push-row-state";
import { useDesktopPermission } from "@/modules/settings/hooks/use-desktop-permission";
import { useStandaloneDisplay } from "@/modules/settings/hooks/use-standalone-display";
import {
  readPushEnvironment,
  useDisablePushMutation,
  useEnablePushMutation,
  usePushSubscriptionQuery,
} from "@/modules/settings/queries/settings-queries";

interface NotificationsContainerProps {
  soundEnabled: boolean;
  onToggleSound: (enabled: boolean) => void;
  onPlayChime: () => void;
}

export function NotificationsContainer({
  soundEnabled,
  onToggleSound,
  onPlayChime,
}: NotificationsContainerProps) {
  const { permission, request } = useDesktopPermission();
  const subscription = usePushSubscriptionQuery();
  const enable = useEnablePushMutation();
  const disable = useDisablePushMutation();
  const standalone = useStandaloneDisplay();

  let pending: "enabling" | "disabling" | null = null;
  if (enable.isPending) pending = "enabling";
  else if (disable.isPending) pending = "disabling";

  let pushError: PushError | null = null;
  if (enable.isError || (disable.isSuccess && !disable.data)) {
    pushError = "generic";
  } else if (enable.isSuccess) {
    pushError = pushEnableError(enable.data, permission);
  }

  return (
    <SettingsPanelLayout>
      <NotificationsSection
        desktopPermission={permission}
        pushState={pushRowState({
          ...readPushEnvironment(),
          standalone,
          pending,
          permission,
          hasSubscription: subscription.data ?? null,
        })}
        pushError={pushError}
        soundEnabled={soundEnabled}
        onRequestDesktop={request}
        onToggleSound={onToggleSound}
        onPlayChime={onPlayChime}
        onEnablePush={() => {
          disable.reset();
          enable.mutate();
        }}
        onDisablePush={() => {
          enable.reset();
          disable.mutate();
        }}
      />
    </SettingsPanelLayout>
  );
}
