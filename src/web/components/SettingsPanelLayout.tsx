import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const GAPS = {
  compact: "gap-2",
  default: "gap-4",
  wide: "gap-6",
};

interface SettingsPanelLayoutProps {
  header?: ReactNode;
  footer?: ReactNode;
  gap?: keyof typeof GAPS;
  children: ReactNode;
}

export function SettingsPanelLayout({
  header,
  footer,
  gap = "default",
  children,
}: SettingsPanelLayoutProps) {
  return (
    <>
      <div className="flex min-h-0 w-full max-w-160 flex-1 flex-col gap-4 px-8 py-6">
        <div
          className={cn(
            "flex min-h-0 flex-1 [scrollbar-gutter:stable] flex-col overflow-y-auto p-1",
            GAPS[gap],
          )}
        >
          {header}
          {children}
        </div>
      </div>
      {footer && (
        <div className="flex shrink-0 justify-end border-t border-border px-8 py-4">
          {footer}
        </div>
      )}
    </>
  );
}
