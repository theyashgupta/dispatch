import {
  ArrowRight,
  ArrowRightLeft,
  Check,
  CircleAlert,
  CircleCheck,
  Download,
  FilePlus,
  Play,
  RotateCw,
  TriangleAlert,
  Trash2,
  Unplug,
  Upload,
  Users,
  Undo2,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import type { EventType } from "../../shared/types.js";
import { Item } from "@/components/ui/item";
import { cn } from "@/lib/utils";

const EVENT_GLYPH: Record<EventType, LucideIcon> = {
  sync_in: Download,
  move_manual: ArrowRight,
  move_auto: ArrowRightLeft,
  status_needs_input: CircleAlert,
  status_agent_done: CircleCheck,
  status_done: Check,
  session_start: Play,
  session_resume: RotateCw,
  session_lost: Unplug,
  session_failed: TriangleAlert,
  resume_failed: TriangleAlert,
  cleanup: Trash2,
  local_created: FilePlus,
  sync_out: Upload,
  group_created: Users,
  group_unwound: Undo2,
  group_restored: RotateCcw,
  archive_deleted: Trash2,
  session_reset: RotateCcw,
  item_promoted: FilePlus,
  linear_state_pushed: Upload,
};

const EVENT_TINT: Record<EventType, string> = {
  sync_in: "text-muted-foreground",
  move_manual: "text-muted-foreground",
  move_auto: "text-muted-foreground",
  status_needs_input: "text-(--status-stale)",
  status_agent_done: "text-(--status-ok)",
  status_done: "text-muted-foreground",
  session_start: "text-muted-foreground",
  session_resume: "text-muted-foreground",
  session_lost: "text-(--destructive)",
  session_failed: "text-(--destructive)",
  resume_failed: "text-(--destructive)",
  cleanup: "text-muted-foreground",
  local_created: "text-muted-foreground",
  sync_out: "text-muted-foreground",
  group_created: "text-muted-foreground",
  group_unwound: "text-muted-foreground",
  group_restored: "text-muted-foreground",
  archive_deleted: "text-muted-foreground",
  session_reset: "text-muted-foreground",
  item_promoted: "text-muted-foreground",
  linear_state_pushed: "text-muted-foreground",
};

const GLYPH_LOOKUP: Partial<Record<string, LucideIcon>> = EVENT_GLYPH;

const TINT_LOOKUP: Partial<Record<string, string>> = EVENT_TINT;

interface ActivityRowProps {
  type: EventType;
  cardId?: string;
  description: string;
  age: string;
  identifiers?: Record<string, string>;
  onSelect?: (cardId: string) => void;
}

export function ActivityRow({
  type,
  cardId,
  description,
  age,
  identifiers,
  onSelect,
}: ActivityRowProps) {
  const Icon = GLYPH_LOOKUP[type] ?? CircleAlert;
  const interactive = onSelect != null && cardId != null;
  const label = cardId != null ? (identifiers?.[cardId] ?? cardId) : null;

  const content = (
    <>
      <Icon
        className={cn(
          "mt-px size-3 flex-none",
          TINT_LOOKUP[type] ?? "text-muted-foreground",
        )}
        strokeWidth={2}
        aria-hidden
      />
      <span className="text-sm leading-(--line-label) [word-break:break-word]">
        {label != null && (
          <span className="font-(family-name:--font-mono) font-semibold text-foreground">
            {label}{" "}
          </span>
        )}
        <span className="font-normal text-foreground">{description}</span>
        {age !== "" && (
          <span className="text-muted-foreground">{` · ${age}`}</span>
        )}
      </span>
    </>
  );

  const className =
    "w-full flex-nowrap items-start gap-(--space-xs) rounded-none border-0 p-0 text-left text-foreground transition-none";

  if (interactive) {
    return (
      <Item asChild className={cn(className, "cursor-pointer hover:bg-accent")}>
        <button type="button" onClick={() => onSelect(cardId)}>
          {content}
        </button>
      </Item>
    );
  }

  return <Item className={className}>{content}</Item>;
}
