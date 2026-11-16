import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { UsageDot } from "./UsageDot";
import type { UsageTone } from "@/modules/accounts/domain/usage-format";

interface UsageChipProps {
  email: string;
  summary: string;
  label: string;
  compactLabel: string;
  compact: boolean;
  tone: UsageTone | "muted";
  open: boolean;
  triggerRef: Ref<HTMLButtonElement>;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function UsageChip({
  email,
  summary,
  label,
  compactLabel,
  compact,
  tone,
  open,
  triggerRef,
  onOpenChange,
  children,
}: UsageChipProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "relative flex",
          compact ? "shrink-0" : "min-w-0 flex-[0_1_auto]",
        )}
      >
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id="usage-chip"
            variant="outline"
            size={compact ? "icon" : "sm"}
            aria-label={`Claude account ${email}, ${summary}`}
            title={`${email}: ${summary}`}
            className={cn(
              "bg-(--surface-card) font-medium text-foreground shadow-none hover:bg-(--surface-card-hover) dark:border-border dark:bg-(--surface-card) dark:hover:bg-(--surface-card-hover)",
              compact
                ? "gap-0.5 px-0 text-xs tabular-nums"
                : "h-7 min-w-0 gap-1 overflow-hidden px-2 text-sm",
            )}
          >
            <UsageDot tone={tone} />
            {compact && compactLabel === "" ? null : (
              <span
                data-testid="usage-chip-summary"
                className={compact ? undefined : "min-w-0 truncate"}
              >
                {compact ? compactLabel : label}
              </span>
            )}
          </Button>
        </PopoverTrigger>
      </div>
      {children}
    </Popover>
  );
}
