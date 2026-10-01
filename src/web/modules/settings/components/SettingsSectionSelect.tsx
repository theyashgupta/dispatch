import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SETTINGS_SECTIONS } from "@/modules/settings/components/SettingsSidebar";
import type { SettingsTab } from "@/modules/settings/domain/settings-tab";

interface SettingsSectionSelectProps {
  tab: SettingsTab;
  onTabChange: (value: string) => void;
}

export function SettingsSectionSelect({
  tab,
  onTabChange,
}: SettingsSectionSelectProps) {
  return (
    <div className="shrink-0 px-4 pt-4">
      <Select value={tab} onValueChange={onTabChange}>
        <SelectTrigger aria-label="Settings section" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SETTINGS_SECTIONS.map((section) => (
            <SelectItem key={section.id} value={section.id}>
              {section.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
