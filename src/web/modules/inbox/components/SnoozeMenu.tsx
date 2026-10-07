import {
  SNOOZE_LABELS,
  SNOOZE_PRESETS,
  type SnoozePreset,
} from "../../../../shared/snooze.js";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useFocusFirstItem } from "@/modules/inbox/hooks/use-focus-first-item";

interface SnoozeMenuProps {
  onPick: (preset: SnoozePreset) => void;
}

export function SnoozeMenu({ onPick }: SnoozeMenuProps) {
  const ref = useFocusFirstItem();
  return (
    <DropdownMenuContent
      align="end"
      aria-label="Snooze until"
      aria-labelledby={undefined}
      className="min-w-50"
      ref={ref}
    >
      {SNOOZE_PRESETS.map((preset) => (
        <DropdownMenuItem
          key={preset}
          className="h-8 text-base"
          onSelect={() => onPick(preset)}
        >
          {SNOOZE_LABELS[preset]}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}
