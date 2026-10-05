import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface CollapsibleSectionProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}

export function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  className,
  testId,
  children,
}: CollapsibleSectionProps) {
  return (
    <Collapsible
      defaultOpen={defaultOpen}
      className={className}
      data-testid={testId}
    >
      <CollapsibleTrigger className="flex w-full items-center gap-1 py-1 text-left text-sm leading-snug font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&[data-state=open]>svg]:rotate-90">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform"
        />
        <span className="min-w-0 flex-1 wrap-anywhere">{title}</span>
        {badge}
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}
