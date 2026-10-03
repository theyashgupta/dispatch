import type { Card, Item } from "../../../../shared/types.js";
import { useSingleFlight } from "@/queries/single-flight";
import { AgendaRow } from "@/modules/calendar/components/AgendaRow";
import {
  preparePrompt,
  prepareTitle,
} from "@/modules/calendar/domain/calendar-agenda";
import { usePrepareTicketMutation } from "@/modules/calendar/queries/calendar-queries";

interface AgendaRowContainerProps {
  item: Item;
  now: Date;
  cards: Card[];
  onJoin: (url: string) => void;
  onNotice: (message: string) => void;
  onStartPromoted: (cardId: string) => void;
}

export function AgendaRowContainer({
  item,
  now,
  cards,
  onJoin,
  onNotice,
  onStartPromoted,
}: AgendaRowContainerProps) {
  const prepare = usePrepareTicketMutation((result) => {
    if (result.ok) onStartPromoted(result.card.id);
    else onNotice("Couldn't create the prepare ticket.");
  });
  const submit = useSingleFlight(prepare.mutate);

  return (
    <AgendaRow
      item={item}
      now={now}
      busy={prepare.isPending}
      onJoin={onJoin}
      onPrepare={() =>
        submit({
          title: prepareTitle(item),
          description: preparePrompt(item, cards),
        })
      }
    />
  );
}
