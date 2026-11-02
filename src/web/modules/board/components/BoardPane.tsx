import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface BoardPaneProps {
  active: boolean;
  onActivate: () => void;
  header: ReactNode;
  children: ReactNode;
}

export function BoardPane({
  active,
  onActivate,
  header,
  children,
}: BoardPaneProps) {
  return (
    <div
      data-active={active}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col border-t-2",
        active ? "border-primary" : "border-transparent",
      )}
    >
      {header}
      {children}
    </div>
  );
}
