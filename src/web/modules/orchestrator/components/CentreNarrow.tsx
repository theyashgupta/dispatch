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
  page: "branches" | "conversation";
  onPageChange: (page: string) => void;
  branches: ReactNode;
  pane: ReactNode;
}

export function CentreNarrow({
  controls,
  centre,
  nodeRef,
  onNodeKeyDown,
  reason,
  page,
  onPageChange,
  branches,
  pane,
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
      <Tabs
        value={page}
        onValueChange={onPageChange}
        className="gap-(--space-md)"
      >
        <TabsList variant="line" className="h-auto w-full justify-start">
          <TabsTrigger value="branches" className="flex-none">
            Branches
          </TabsTrigger>
          <TabsTrigger value="conversation" className="flex-none">
            Conversation
          </TabsTrigger>
        </TabsList>
        <TabsContent value="branches">{branches}</TabsContent>
        <TabsContent
          value="conversation"
          forceMount
          className="flex h-120 min-h-0 flex-none flex-col data-[state=inactive]:hidden"
        >
          {pane}
        </TabsContent>
      </Tabs>
    </div>
  );
}
