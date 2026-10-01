import type { ProbeFailureCategory } from "../../../shared/types.js";
import { Badge } from "@/components/ui/badge";
import { unknownProbeCopy } from "./unknown-probe-copy.js";

export function UnknownProbeBadge({
  signal,
  category,
  partial,
}: {
  signal: "pr" | "preview";
  category: ProbeFailureCategory;
  partial?: boolean;
}) {
  const { label, detail } = unknownProbeCopy(signal, category, partial);
  return (
    <Badge tone="neutral" className="h-auto text-sm" title={detail}>
      {label}
    </Badge>
  );
}
