import { cn } from "@/lib/utils";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-(length:--font-display) font-semibold tracking-[0.18em]",
        className,
      )}
    >
      DISPATCH
    </span>
  );
}
