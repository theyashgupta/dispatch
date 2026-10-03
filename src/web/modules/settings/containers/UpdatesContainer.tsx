import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { UpdatesSection } from "@/modules/settings/components/UpdatesSection";
import { runPhaseFrom } from "@/modules/settings/domain/update-run";
import {
  useRunUpdateMutation,
  useUpdateStatusQuery,
} from "@/queries/update-queries";

export function UpdatesContainer() {
  const status = useUpdateStatusQuery();
  const run = useRunUpdateMutation();

  return (
    <SettingsPanelLayout>
      <UpdatesSection
        status={status.data}
        loadError={status.isError}
        phase={runPhaseFrom({
          pending: run.isPending,
          failed: run.isError,
          result: run.data,
        })}
        onRunUpdate={() => run.mutate()}
      />
    </SettingsPanelLayout>
  );
}
