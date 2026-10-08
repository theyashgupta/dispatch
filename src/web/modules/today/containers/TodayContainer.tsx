import { useMemo, useState } from "react";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { inboxFeed } from "../../../../shared/feed-items.js";
import { pinFromBoard } from "../../../../shared/pinned-card.js";
import { nowMs } from "../../../../shared/format-age.js";
import { routeHash, type Page } from "../../../../shared/route.js";
import type { BoardSnapshot, Item } from "../../../../shared/types.js";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useItems } from "@/components/ui/hooks/use-items";
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
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";

interface TodayPageProps {
  board: BoardSnapshot;
  items: Item[];
  onSelectCard: (id: string) => void;
  onNavigate: (page: Page, id?: string) => void;
}

export function TodayContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const router = useRouter();
  const board = useBoardSnapshot(
    useAppStore(appStore, (s) => s.board),
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const errorsInFeeds = useAppStore(appStore, (s) => s.errorsInFeeds);
  const items = useItems(board);
  const enabledSources = board?.enabledSources;
  const feed = useMemo(
    () => inboxFeed(items, errorsInFeeds, enabledSources ?? []),
    [items, errorsInFeeds, enabledSources],
  );
  if (board == null) return null;
  return (
    <TodayPage
      board={board}
      items={feed}
      onSelectCard={(id) =>
        appStore.selectCard(id, pinFromBoard(id, board.cards))
      }
      onNavigate={(page, id) =>
        void router.navigate({ href: routeHash({ page, id }).slice(1) })
      }
    />
  );
}

function TodayPage({ board, items, onSelectCard, onNavigate }: TodayPageProps) {
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
