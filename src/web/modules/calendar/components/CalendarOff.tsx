import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface CalendarOffProps {
  notice: ReactNode;
  onOpenSettings: () => void;
}

export function CalendarOff({ notice, onOpenSettings }: CalendarOffProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-base text-muted-foreground">
      {notice}
      <span>Calendar is off. Connect it in Settings.</span>
      <Button type="button" onClick={onOpenSettings}>
        Open Settings
      </Button>
    </div>
  );
}
