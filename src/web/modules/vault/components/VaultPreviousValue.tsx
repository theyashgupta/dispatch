import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MASKED_VALUE = "•".repeat(12);

interface VaultPreviousValueProps {
  name: string;
  revealed: string | null;
  error: boolean;
  pending: boolean;
  onToggle: () => void;
}

export function VaultPreviousValue({
  name,
  revealed,
  error,
  pending,
  onToggle,
}: VaultPreviousValueProps) {
  return (
    <div
      data-testid={`vault-previous-${name}`}
      className="flex min-w-0 items-center gap-1"
    >
      <span className="shrink-0 text-xs font-semibold text-muted-foreground">
        Previous
      </span>
      <span
        data-revealed={revealed !== null ? "true" : "false"}
        className={cn(
          "min-w-0 flex-1 font-mono text-sm break-all",
          revealed !== null
            ? "text-foreground select-text"
            : "text-muted-foreground select-none",
        )}
      >
        {error
          ? "Couldn't load previous value, try again."
          : (revealed ?? MASKED_VALUE)}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={
          revealed !== null
            ? `Hide previous value for ${name}`
            : `Show previous value for ${name}`
        }
        aria-pressed={revealed !== null}
        disabled={pending}
        onClick={onToggle}
      >
        {revealed !== null ? (
          <EyeOff aria-hidden="true" />
        ) : (
          <Eye aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
