import type { TunnelState } from "../../../../shared/types.js";
import { RemoteSection } from "@/modules/settings/components/RemoteSection";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import {
  useDisableRemoteMutation,
  useEnableRemoteMutation,
} from "@/modules/settings/queries/settings-queries";

interface RemoteContainerProps {
  tunnelState: TunnelState;
}

export function RemoteContainer({ tunnelState }: RemoteContainerProps) {
  const enable = useEnableRemoteMutation();
  const disable = useDisableRemoteMutation();
  const pending = enable.isPending || disable.isPending;

  return (
    <SettingsPanelLayout>
      <RemoteSection
        tunnelState={tunnelState}
        pending={pending}
        onEnable={() => {
          if (!pending) enable.mutate();
        }}
        onDisable={() => {
          if (!pending) disable.mutate();
        }}
      />
    </SettingsPanelLayout>
  );
}
