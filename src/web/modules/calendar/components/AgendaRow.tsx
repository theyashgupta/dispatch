import type { Item } from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { LoadingButton } from "@/components/LoadingButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  soonLabel,
  timeRange,
} from "@/modules/calendar/domain/calendar-agenda";

interface AgendaRowProps {
  item: Item;
  now: Date;
  busy: boolean;
  onJoin: (url: string) => void;
  onPrepare: () => void;
}

export function AgendaRow({
  item,
  now,
  busy,
  onJoin,
  onPrepare,
}: AgendaRowProps) {
  const soon = soonLabel(item, now);
  const joinUrl = item.meta.joinUrl;
  const place = [item.meta.location, item.meta.calendar]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");
  return (
    <li>
      <Card className="min-w-0 flex-row flex-wrap items-center gap-2 p-2 shadow-none">
        <span className="shrink-0 text-sm whitespace-nowrap text-muted-foreground tabular-nums">
          {timeRange(item)}
        </span>
        <span className="grid min-w-0 flex-[1_1_200px] gap-0.5">
          <span className="text-base wrap-anywhere text-foreground">
            {item.title}
          </span>
          {place !== "" && (
            <span className="text-sm wrap-anywhere text-muted-foreground">
              {place}
            </span>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-1">
          {soon !== undefined && <Badge tone="warning">{soon}</Badge>}
          {isWebUrl(joinUrl) && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onJoin(joinUrl)}
            >
              Join
            </Button>
          )}
          <LoadingButton variant="secondary" loading={busy} onClick={onPrepare}>
            Prepare with agent
          </LoadingButton>
        </span>
      </Card>
    </li>
  );
}
