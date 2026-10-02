import { cn } from "@/lib/utils";
import type { UsageTone } from "@/modules/accounts/domain/usage-format";

const TONE_CLASS: Record<UsageTone | "muted", string> = {
  ok: "bg-(--status-ok)",
  stale: "bg-(--status-stale)",
  down: "bg-(--status-down)",
  muted: "bg-muted-foreground",
};

interface UsageDotProps {
  tone: UsageTone | "muted";
  className?: string;
}

export function UsageDot({ tone, className }: UsageDotProps) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        TONE_CLASS[tone],
        className,
      )}
    />
  );
}
