import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { focusSettingsButton } from "@/modules/orchestrator/hooks/focus-entry";
import type { OrchestratorSettingsTab } from "../../../../shared/orchestrator-settings.js";

interface SettingsSheetProps {
  open: boolean;
  onClose: () => void;
  tab: OrchestratorSettingsTab;
  onTabChange: (tab: OrchestratorSettingsTab) => void;
  boardName: string;
  staleBadge: string | null;
  orchestratorsLabel: string;
  policy: ReactNode;
  orchestrators: ReactNode;
}

export function SettingsSheet({
  open,
  onClose,
  tab,
  onTabChange,
  boardName,
  staleBadge,
  orchestratorsLabel,
  policy,
  orchestrators,
}: SettingsSheetProps) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-(--panel-width) max-w-screen gap-0 sm:max-w-(--panel-width)"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          focusSettingsButton();
        }}
      >
        <SheetHeader>
          <SheetTitle>Orchestrator settings</SheetTitle>
          <SheetDescription className="sr-only">
            Policy and orchestrators of {boardName}.
          </SheetDescription>
          {staleBadge !== null && (
            <Badge tone="neutral" role="status">
              {staleBadge}
            </Badge>
          )}
        </SheetHeader>
        <Tabs
          value={tab}
          onValueChange={(next) => onTabChange(next as OrchestratorSettingsTab)}
          className="min-h-0 flex-1 gap-0"
        >
          <TabsList
            variant="line"
            className="h-auto w-full justify-start px-(--space-lg) pb-(--space-sm)"
          >
            <TabsTrigger value="policy" className="flex-none">
              Policy
            </TabsTrigger>
            <TabsTrigger value="orchestrators" className="flex-none">
              {orchestratorsLabel}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="policy"
            forceMount
            className="min-h-0 flex-1 overflow-y-auto p-(--space-lg) data-[state=inactive]:hidden"
          >
            {policy}
          </TabsContent>
          <TabsContent
            value="orchestrators"
            className="min-h-0 flex-1 overflow-y-auto p-(--space-lg)"
          >
            {orchestrators}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
