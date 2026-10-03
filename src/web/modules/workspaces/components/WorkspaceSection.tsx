import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface WorkspaceSectionProps {
  title: string;
  count: number;
  children: ReactNode;
}

export function WorkspaceSection({
  title,
  count,
  children,
}: WorkspaceSectionProps) {
  return (
    <Collapsible defaultOpen className="group/section">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1 rounded-md py-1 text-left text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform duration-(--motion-panel-open) ease-(--easing-enter) group-data-[state=open]/section:rotate-90"
        />
        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{title}</span>
        <Badge tone="neutral">{count}</Badge>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="grid transition-[grid-template-rows,visibility] duration-(--motion-panel-open) ease-(--easing-enter) data-[state=closed]:invisible data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
