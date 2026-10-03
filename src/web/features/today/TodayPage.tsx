import { useEffect, useState, type CSSProperties } from "react";
import type { BoardSnapshot, Item } from "../../../shared/types.js";
import { nowMs } from "../../../shared/format-age.js";
import {
  clampCount,
  rankToday,
  type TodayEntry,
  type TodayWindow,
} from "../../lib/p0.js";
import type { Page } from "../../../shared/route.js";
import { PageBody } from "../../primitives/PageBody.js";
import { Agenda } from "./Agenda.js";
import { CountChips } from "./CountChips.js";
import { P0Card } from "./P0Card.js";
import { TodayList } from "./TodayList.js";
import {
  buildTodayView,
  entryTarget,
  parseRange,
  greeting,
  longDate,
  visibleAgenda,
} from "./today-view.js";

interface TodayPageProps {
  board: BoardSnapshot;
  items: Item[];
  onSelectCard: (id: string) => void;
  onNavigate: (page: Page, id?: string) => void;
}

const greetingStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-display)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-display)",
  color: "var(--text)",
};

const dateStyle: CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text-muted)",
};

export function TodayPage({
  board,
  items,
  onSelectCard,
  onNavigate,
}: TodayPageProps) {
  const [filter, setFilter] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [range, setRange] = useState<TodayWindow>(() => {
    try {
      return parseRange(localStorage.getItem("dsp.p0Window"));
    } catch {
      return "today";
    }
  });

  const [count, setCount] = useState<number>(() => {
    try {
      return clampCount(Number(localStorage.getItem("dsp.p0Count")));
    } catch {
      return 3;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("dsp.p0Window", range);
    } catch {}
  }, [range]);

  useEffect(() => {
    try {
      localStorage.setItem("dsp.p0Count", String(count));
    } catch {}
  }, [count]);

  const nowTs = nowMs();
  const now = new Date(nowTs);
  const pool = rankToday(board.cards, items, range, nowTs);
  const view = buildTodayView(pool, count, filter, page);
  const events = visibleAgenda(board.enabledSources, items, now);

  function handleOpen(entry: TodayEntry) {
    const target = entryTarget(entry);
    if (target.kind === "card") onSelectCard(target.cardId);
    else onNavigate(target.page, target.id);
  }

  return (
    <PageBody>
      <div>
        <p style={greetingStyle}>{greeting(now)}</p>
        <p style={dateStyle}>{longDate(now)}</p>
      </div>
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
    </PageBody>
  );
}
