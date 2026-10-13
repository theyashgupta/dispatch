import type { KeyboardEventHandler, ReactNode, Ref } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CentreNode } from "@/modules/orchestrator/components/CentreNode";
import type { CentreNode as CentreNodeModel } from "@/modules/orchestrator/domain/centre-graph";

interface CentreNarrowProps {
  controls: ReactNode;
  centre: CentreNodeModel | null;
  nodeRef: Ref<HTMLElement>;
  onNodeKeyDown: KeyboardEventHandler<HTMLElement>;
  reason: ReactNode;
  branches: ReactNode;
  terminal: ReactNode;
}

export function CentreNarrow({
  controls,
  centre,
  nodeRef,
  onNodeKeyDown,
  reason,
  branches,
  terminal,
}: CentreNarrowProps) {
  return (
    <div className="flex flex-col gap-(--space-md) p-(--space-lg)">
      {controls}
      {centre !== null && (
        <CentreNode
          node={centre}
          compact
          nodeRef={nodeRef}
          onKeyDown={onNodeKeyDown}
        />
      )}
      {reason}
      <Tabs defaultValue="branches" className="gap-(--space-md)">
        <TabsList variant="line" className="h-auto w-full justify-start">
          <TabsTrigger value="branches" className="flex-none">
            Branches
          </TabsTrigger>
          <TabsTrigger value="terminal" className="flex-none">
            Terminal
          </TabsTrigger>
        </TabsList>
        <TabsContent value="branches">{branches}</TabsContent>
        <TabsContent
          value="terminal"
          forceMount
          className="flex min-h-0 flex-col data-[state=inactive]:hidden"
        >
          {terminal}
        </TabsContent>
      </Tabs>
    </div>
  );
}
