import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PanelModel } from "@/modules/orchestrator/domain/panel-model";

export type PanelTab = "terminal" | "decisions" | "policy" | "orchestrators";

interface PanelTabsProps {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  labels: PanelModel["tabs"];
  terminal: ReactNode;
  decisions: ReactNode;
  policy: ReactNode;
  orchestrators: ReactNode;
}

export function PanelTabs({
  tab,
  onTabChange,
  labels,
  terminal,
  decisions,
  policy,
  orchestrators,
}: PanelTabsProps) {
  return (
    <Tabs
      value={tab}
      onValueChange={(next) => onTabChange(next as PanelTab)}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="h-auto w-full justify-start px-(--space-lg) pb-(--space-sm)"
      >
        <TabsTrigger value="terminal" className="flex-none">
          {labels.terminal}
        </TabsTrigger>
        <TabsTrigger value="decisions" className="flex-none">
          {labels.decisions}
        </TabsTrigger>
        <TabsTrigger value="policy" className="flex-none">
          {labels.policy}
        </TabsTrigger>
        <TabsTrigger value="orchestrators" className="flex-none">
          {labels.orchestrators}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="terminal"
        forceMount
        className="flex min-h-0 flex-1 flex-col p-(--space-lg) data-[state=inactive]:hidden"
      >
        {terminal}
      </TabsContent>
      <TabsContent
        value="decisions"
        className="min-h-0 flex-1 overflow-y-auto p-(--space-lg)"
      >
        {decisions}
      </TabsContent>
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
  );
}
