import { createElement } from "react";
import { Badge } from "@/components/ui/badge";
import { NEUTRAL_ACCENT, sourceAccent } from "./source-accent.js";
import { sourceMark } from "./source-mark.js";

interface SourceIconProps {
  source: string;
}

export function SourceIcon({ source }: SourceIconProps) {
  const color = sourceAccent(source);
  return (
    <Badge
      aria-hidden="true"
      stateColor={color}
      className={
        color === NEUTRAL_ACCENT
          ? "size-8 justify-center rounded-md border-border bg-transparent p-0 text-(--badge-state) [&>svg]:size-4"
          : "size-8 justify-center rounded-md border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,transparent)] p-0 text-(--badge-state) [&>svg]:size-4"
      }
    >
      {createElement(sourceMark(source), { size: 16 })}
    </Badge>
  );
}
