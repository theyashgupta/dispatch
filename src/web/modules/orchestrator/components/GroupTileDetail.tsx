import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  GitPullRequest,
  Inbox,
  MessageCircleQuestionMark,
  Play,
  TriangleAlert,
} from "lucide-react";
import { ToneBadge } from "@/components/badges/ToneBadge";
import { GroupProgressBar } from "@/components/GroupProgressBar";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type {
  GroupDetail,
  MemberState,
} from "@/modules/orchestrator/domain/centre-graph";

const MEMBER_GLYPHS = {
  in_progress: Play,
  needs_input: MessageCircleQuestionMark,
  agent_done: CircleCheck,
  in_review: GitPullRequest,
  done: CircleCheck,
  todo: CircleDashed,
  parked: CirclePause,
  inbox: Inbox,
  attention: TriangleAlert,
} satisfies Record<MemberState, unknown>;

interface GroupTileDetailProps {
  group: GroupDetail;
  open: boolean;
  onToggle: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function triggerText(open: boolean, units: number, members: number): string {
  if (open) return "Hide units and tickets";
  const parts = [
    ...(units > 0 ? [plural(units, "unit")] : []),
    ...(members > 0 ? [plural(members, "ticket")] : []),
  ];
  return parts.length === 0
    ? "Show units and tickets"
    : `Show ${parts.join(" and ")}`;
}

export function GroupTileDetail({
  group: { units, members },
  open,
  onToggle,
}: GroupTileDetailProps) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className="border-t border-border"
    >
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-1 rounded-none text-sm font-semibold text-foreground hover:bg-transparent [&[data-state=open]>svg:first-child]:rotate-90"
        >
          <ChevronRight
            className="size-3.5 transition-transform duration-(--motion-panel-open) ease-(--easing-enter)"
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="min-w-0 text-left wrap-anywhere">
            {triggerText(open, units?.length ?? 0, members.length)}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        forceMount
        className="grid transition-[grid-template-rows] duration-(--motion-panel-open) ease-(--easing-enter) data-[state=closed]:grid-rows-[0fr] data-[state=open]:grid-rows-[1fr]"
      >
        <div inert={!open} className="min-h-0 min-w-0 overflow-y-clip">
          <div className="flex flex-col gap-(--space-sm) p-(--space-md)">
            {units === null || units.length === 0 ? (
              <p className="text-sm text-muted-foreground">No units yet</p>
            ) : (
              <GroupProgressBar nodes={units} orientation="vertical" />
            )}
            {members.length > 0 && (
              <ul
                aria-label="Tickets"
                className="m-0 flex list-none flex-col gap-(--space-sm) p-0"
              >
                {members.map((member) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center gap-(--space-sm)"
                  >
                    <span className="font-mono text-mono text-muted-foreground">
                      {member.identifier}
                    </span>
                    <span className="min-w-0 text-sm wrap-anywhere">
                      {member.title}
                    </span>
                    <ToneBadge
                      label={member.label}
                      tone={member.tone}
                      glyph={MEMBER_GLYPHS[member.state]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
