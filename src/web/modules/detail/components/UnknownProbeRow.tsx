import { HelpCircle } from "lucide-react";
import type { ProbeFailureCategory } from "../../../../shared/types.js";
import { unknownProbeCopy } from "@/components/badges/unknown-probe-copy";
import { Item } from "@/components/ui/item";

interface UnknownProbeRowProps {
  category: ProbeFailureCategory;
  partial?: boolean;
}

export function UnknownProbeRow({ category, partial }: UnknownProbeRowProps) {
  const { label, detail } = unknownProbeCopy("preview", category, partial);
  return (
    <Item
      size="sm"
      className="flex-nowrap gap-(--space-sm) rounded-none border-0 p-0"
    >
      <HelpCircle
        className="size-3.5 flex-none text-muted-foreground"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-auto flex-col">
        <span className="truncate text-base font-semibold text-muted-foreground">
          {label}
        </span>
        <span className="text-sm font-normal text-muted-foreground">
          {detail}
        </span>
      </div>
    </Item>
  );
}
