import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AccountChipFrameProps {
  collapsed: boolean;
  children: ReactNode;
}

export function AccountChipFrame({
  collapsed,
  children,
}: AccountChipFrameProps) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1",
        collapsed && "justify-center",
      )}
    >
      {children}
    </div>
  );
}
