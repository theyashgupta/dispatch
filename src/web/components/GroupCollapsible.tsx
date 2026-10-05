import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface GroupCollapsibleProps {
  label: string;
  count: number;
  children: ReactNode;
}

export function GroupCollapsible({
  label,
  count,
  children,
}: GroupCollapsibleProps) {
  const [open, setOpen] = useState(true);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          className="h-auto w-full justify-start gap-1 rounded-none px-0 py-1 text-sm font-semibold text-foreground hover:bg-transparent has-[>svg]:px-0 [&[data-state=open]>svg:first-child]:rotate-90"
        >
          <ChevronRight
            className="size-3.5 transition-transform duration-(--motion-panel-open) ease-(--easing-enter)"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="min-w-0 flex-auto text-left wrap-anywhere">
            {label}
          </span>
          <Badge tone="neutral">{count}</Badge>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="grid transition-[grid-template-rows] duration-(--motion-panel-open) ease-(--easing-enter) data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
      >
        <div inert={!open} className="min-h-0 overflow-y-clip">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
