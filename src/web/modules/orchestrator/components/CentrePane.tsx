import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CentrePaneProps {
  value: string;
  onValueChange: (value: string) => void;
  conversation: ReactNode;
  terminal: ReactNode;
  alertSlot: (element: HTMLElement | null) => void;
}

export function CentrePane({
  value,
  onValueChange,
  conversation,
  terminal,
  alertSlot,
}: CentrePaneProps) {
  return (
    <Tabs
      value={value}
      onValueChange={onValueChange}
      className="min-h-0 flex-1 gap-0"
    >
      <TabsList
        variant="line"
        className="h-auto w-full justify-start px-(--space-lg) pb-(--space-sm)"
      >
        <TabsTrigger value="conversation" className="flex-none">
          Conversation
        </TabsTrigger>
        <TabsTrigger value="terminal" className="flex-none">
          Terminal
        </TabsTrigger>
      </TabsList>
      <div ref={alertSlot} />
      <TabsContent
        value="conversation"
        forceMount
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
      >
        {conversation}
      </TabsContent>
      <TabsContent
        value="terminal"
        forceMount
        className="flex min-h-0 flex-1 flex-col p-(--space-lg) data-[state=inactive]:hidden"
      >
        {terminal}
      </TabsContent>
    </Tabs>
  );
}
