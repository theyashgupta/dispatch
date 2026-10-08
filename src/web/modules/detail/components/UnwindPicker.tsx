import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import type { UnwindDestination } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface UnwindPickerProps {
  identifier: string;
  label: string | null;
  ariaLabel?: string;
  title: string;
  onSelect: (to: UnwindDestination) => void;
}

const ROWS: { to: UnwindDestination; label: string; hint: string }[] = [
  { to: "todo", label: "To Do", hint: "Members go back to the board" },
  { to: "inbox", label: "Inbox", hint: "Members leave the board" },
];

export function UnwindPicker({
  identifier,
  label,
  ariaLabel,
  title,
  onSelect,
}: UnwindPickerProps) {
  const [open, setOpen] = useState(false);
  const focusFirstItem = useRef(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("resize", close);
    window.addEventListener("orientationchange", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("orientationchange", close);
    };
  }, [open]);

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        focusFirstItem.current = next;
        setOpen(next);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label={ariaLabel}
          title={title}
        >
          <Undo2 className="size-3" aria-hidden="true" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label={`Unwind ${identifier}, send members to`}
        align="end"
        onFocus={(event) => {
          if (event.target !== event.currentTarget || !focusFirstItem.current)
            return;
          focusFirstItem.current = false;
          event.currentTarget
            .querySelector<HTMLElement>('[role="menuitem"]')
            ?.focus();
        }}
        className="w-60 rounded-(--radius-lg) px-0 py-1 shadow-(--shadow-float)"
      >
        {ROWS.map((row) => (
          <DropdownMenuItem
            key={row.to}
            className="min-h-12 flex-col items-start justify-center gap-0 rounded-none px-(--space-lg) py-0 text-base text-foreground"
            onSelect={() => onSelect(row.to)}
          >
            <span className="font-semibold">{row.label}</span>
            <span className="text-sm text-muted-foreground">{row.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
