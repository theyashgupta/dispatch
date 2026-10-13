import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface CentrePaneProps {
  terminal: ReactNode;
}

export function CentrePane({ terminal }: CentrePaneProps) {
  return (
    <Tabs value="terminal" className="min-h-0 flex-1 gap-0">
      <TabsList
        variant="line"
        className="h-auto w-full justify-start px-(--space-lg) pb-(--space-sm)"
      >
        <TabsTrigger value="terminal" className="flex-none">
          Terminal
        </TabsTrigger>
      </TabsList>
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
