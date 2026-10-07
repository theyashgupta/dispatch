import type { ReactNode, Ref } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UsageDot } from "./UsageDot";
import type { UsageTone } from "@/modules/accounts/domain/usage-format";

interface UsageChipProps {
  email: string;
  summary: string;
  label: string;
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
  tone,
  open,
  triggerRef,
  onOpenChange,
  children,
}: UsageChipProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="relative flex min-w-0 flex-[0_1_auto]">
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            id="usage-chip"
            variant="outline"
            size="sm"
            aria-label={`Claude account ${email}, ${summary}`}
            title={`${email}: ${summary}`}
            className="h-7 min-w-0 gap-1 overflow-hidden bg-(--surface-card) px-2 text-sm font-medium text-foreground shadow-none hover:bg-(--surface-card-hover) dark:border-border dark:bg-(--surface-card) dark:hover:bg-(--surface-card-hover)"
          >
            <UsageDot tone={tone} />
            <span data-testid="usage-chip-summary" className="min-w-0 truncate">
              {label}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverAnchor className="pointer-events-none fixed inset-x-2 bottom-2" />
      </div>
      {children}
    </Popover>
  );
}
