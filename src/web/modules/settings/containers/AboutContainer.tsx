import { AboutSection } from "@/modules/settings/components/AboutSection";
import { SettingsPanelLayout } from "@/components/SettingsPanelLayout";
import { useUpdateStatusQuery } from "@/queries/update-queries";

export function AboutContainer() {
  const status = useUpdateStatusQuery();

  return (
    <SettingsPanelLayout>
      <AboutSection version={status.data?.current} />
    </SettingsPanelLayout>
  );
}
