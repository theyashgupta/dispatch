import { useState } from "react";
import { nowMs } from "../../../../shared/format-age.js";
import type { Page } from "../../../../shared/route.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import { Agenda } from "@/modules/today/components/Agenda";
import { CountChips } from "@/modules/today/components/CountChips";
import { Greeting } from "@/modules/today/components/Greeting";
import { useP0Preferences } from "@/modules/today/hooks/use-p0-preferences";
import { P0Card } from "@/modules/today/components/P0Card";
import { TodayList } from "@/modules/today/components/TodayList";
import { rankToday, type TodayEntry } from "@/modules/today/domain/p0";
import {
  buildTodayModel,
  entryTarget,
  greeting,
  longDate,
  visibleAgenda,
} from "@/modules/today/domain/today-view";

export interface TodayContainerProps {
  board: BoardSnapshot;
  items: Item[];
  onSelectCard: (id: string) => void;
  onNavigate: (page: Page, id?: string) => void;
}

export function TodayContainer({
  board,
  items,
  onSelectCard,
  onNavigate,
}: TodayContainerProps) {
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const { range, setRange, count, setCount } = useP0Preferences();

  const nowTs = nowMs();
  const now = new Date(nowTs);
  const pool = rankToday(board.cards, items, range, nowTs);
  const view = buildTodayModel(pool, count, filter, page);
  const events = visibleAgenda(board.enabledSources, items, now);

  function handleOpen(entry: TodayEntry) {
    const target = entryTarget(entry);
    if (target.kind === "card") onSelectCard(target.cardId);
    else onNavigate(target.page, target.id);
  }

  return (
    <>
      <Greeting greeting={greeting(now)} date={longDate(now)} />
      <P0Card
        entries={view.picks}
        poolSize={pool.length}
        range={range}
        onRangeChange={(next) => {
          if (next === range) return;
          setRange(next);
          setFilter(null);
          setPage(1);
        }}
        count={count}
        onCountChange={setCount}
        onOpen={handleOpen}
        now={nowTs}
      />
      <CountChips
        chips={view.chips}
        filter={view.filter}
        onFilterChange={(next) => {
          setFilter(next);
          setPage(1);
        }}
      />
      <Agenda events={events} />
      <TodayList
        list={view.list}
        onPageChange={setPage}
        onOpen={handleOpen}
        now={nowTs}
      />
    </>
  );
}
