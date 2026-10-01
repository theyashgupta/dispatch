import { createElement } from "react";
import { Badge } from "@/components/ui/badge";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";
import { sourceMark } from "./source-mark.js";
import { sourceName } from "./source-name.js";

interface SourceBadgeProps {
  source: string;
  label?: boolean;
}

export function SourceBadge({ source, label = false }: SourceBadgeProps) {
  const name = sourceName(source);
  const color = sourceAccent(source);
  const tile = (
    <Badge
      stateColor={color}
      className={
        color === NEUTRAL_ACCENT
          ? "size-4.5 justify-center border-border bg-transparent p-0 text-(--badge-state)"
          : "size-4.5 justify-center border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,transparent)] p-0 text-(--badge-state)"
      }
      {...(label
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": name, title: name })}
    >
      {createElement(sourceMark(source), { size: 12 })}
    </Badge>
  );
  if (!label) return tile;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
      {tile}
      <span className="text-sm font-semibold text-muted-foreground">
        {name}
      </span>
    </span>
  );
}
