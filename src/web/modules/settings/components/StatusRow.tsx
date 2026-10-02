import { Item, ItemContent, ItemMedia, ItemTitle } from "@/components/ui/item";
import { cn } from "@/lib/utils";

const DOT_TONE = {
  ok: "bg-(--status-ok)",
  stale: "bg-(--status-stale)",
  down: "bg-(--status-down)",
} as const;

interface StatusRowProps {
  tone: keyof typeof DOT_TONE;
  text: string;
}

export function StatusRow({ tone, text }: StatusRowProps) {
  return (
    <Item
      role="status"
      aria-live="polite"
      size="sm"
      className="flex-nowrap items-center gap-1 p-0"
    >
      <ItemMedia>
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", DOT_TONE[tone])}
        />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="w-auto text-sm font-semibold text-foreground">
          {text}
        </ItemTitle>
      </ItemContent>
    </Item>
  );
}
