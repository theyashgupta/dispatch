import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-(length:--font-display) font-semibold tracking-(--tracking-display)",
        className,
      )}
    >
      DISPATCH
    </span>
  );
}
