import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { CollapsibleSection } from "./CollapsibleSection";
import { ItemGroup } from "@/components/ui/item";

interface ListGroupProps {
  title: string;
  count: number;
  testId?: string;
  meta?: ReactNode;
  children: ReactNode;
}

interface RowTimeProps {
  children: ReactNode;
}

export function ListGroup({
  title,
  count,
  testId,
  meta,
  children,
}: ListGroupProps) {
  return (
    <CollapsibleSection
      title={title}
      badge={<Badge tone="neutral">{count}</Badge>}
      defaultOpen
      className="px-4"
      testId={testId}
    >
      {meta && (
        <div className="flex items-center gap-2 pb-1 text-sm text-muted-foreground">
          {meta}
        </div>
      )}
      <ItemGroup className="-mx-4">{children}</ItemGroup>
    </CollapsibleSection>
  );
}

export function RowTime({ children }: RowTimeProps) {
  return (
    <span className="w-12 shrink-0 text-right text-sm text-muted-foreground">
      {children}
    </span>
  );
}
