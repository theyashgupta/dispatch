import { useRef } from "react";
import {
  actionsFor,
  type InboxAction,
  type InboxRowModel,
} from "../../../../shared/item-actions.js";
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { useFocusFirstItem } from "@/modules/inbox/hooks/use-focus-first-item";

interface InboxMenuProps {
  row: InboxRowModel;
  onPick: (action: InboxAction) => void;
}

export function InboxMenu({ row, onPick }: InboxMenuProps) {
  const ref = useFocusFirstItem();
  const handedOff = useRef(false);
  return (
    <DropdownMenuContent
      align="end"
      aria-label="Row actions"
      aria-labelledby={undefined}
      className="min-w-50"
      ref={ref}
      onCloseAutoFocus={(event) => {
        if (handedOff.current) event.preventDefault();
      }}
    >
      {actionsFor(row).map((action) => (
        <DropdownMenuItem
          key={action.id}
          className="h-8 justify-between text-base"
          onSelect={(event) => {
            if (action.id === "snooze") {
              event.preventDefault();
              handedOff.current = true;
            }
            onPick(action);
          }}
        >
          <span>{action.label}</span>
          {action.key ? <Kbd>{action.key}</Kbd> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}
