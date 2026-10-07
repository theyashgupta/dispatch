import type { Item as AgendaItem } from "../../../../shared/types.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { agendaTime, joinLink } from "@/modules/today/domain/today-view";

interface AgendaProps {
  events: AgendaItem[];
}

export function Agenda({ events }: AgendaProps) {
  if (events.length === 0) return null;
  return (
    <Card
      role="region"
      aria-label="Today's agenda"
      className="gap-0 rounded-md py-0"
    >
      <div className="px-(--space-lg) pt-(--space-lg)">
        <span className="font-semibold text-foreground">
          Today&apos;s agenda
        </span>
      </div>
      <div>
        {events.map((event) => {
          const link = joinLink(event);
          return (
            <Item
              key={event.id}
              size="sm"
              className="flex-nowrap gap-2 rounded-none border-0 border-t border-border px-4 py-2"
            >
              <ItemMedia className="text-sm leading-(--line-body) text-muted-foreground">
                {agendaTime(event.meta.start)}
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate text-base font-normal">
                  {event.title}
                </ItemTitle>
              </ItemContent>
              {link ? (
                <ItemActions>
                  <Button
                    variant="secondary-bordered"
                    size="sm"
                    onClick={() =>
                      window.open(link, "_blank", "noopener,noreferrer")
                    }
                  >
                    Join
                  </Button>
                </ItemActions>
              ) : null}
            </Item>
          );
        })}
      </div>
    </Card>
  );
}
