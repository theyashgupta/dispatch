import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { CardSearchResult } from "../../../../shared/search.js";
import type { BoardKey } from "../../../../shared/types.js";
import { SEARCH_QUERY_MIN } from "../../../../shared/search.js";
import { CAROUSEL_QUERY } from "../../../../shared/media-queries.js";
import { useMediaQuery } from "@/components/ui/hooks/use-media-query";
import {
  SearchField,
  type SearchStatus,
} from "@/modules/board/components/SearchField";
import { useAppStore } from "@/components/ui/hooks/use-app-store";
import { useBoardSnapshot } from "@/queries/board-snapshot-queries";
import { useSearchCardsQuery } from "@/queries/search-queries";

const DEBOUNCE_MS = 200;

interface Shown {
  board: BoardKey;
  status: SearchStatus;
  results: CardSearchResult[];
  total: number;
}

const idle = (board: BoardKey): Shown => ({
  board,
  status: "idle",
  results: [],
  total: 0,
});

export function SearchContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const boardKey = useAppStore(appStore, (s) => s.board);
  const board = useBoardSnapshot(
    boardKey,
    useAppStore(appStore, (s) => s.doneLimit),
  );
  const onSelectResult = (result: CardSearchResult) =>
    appStore.openSearchResult(
      result,
      board?.cards.some((card) => card.id === result.id) === true,
    );
  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    if (term.length < SEARCH_QUERY_MIN) return;
    const timer = setTimeout(() => setDebounced(term), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term]);

  const search = useSearchCardsQuery(
    boardKey,
    debounced,
    debounced.length >= SEARCH_QUERY_MIN,
  );

  const [shown, setShown] = useState<Shown>(() => idle(boardKey));
  const current = shown.board === boardKey ? shown : idle(boardKey);
  let next = current;
  if (search.isSuccess) {
    if (current.status !== "ready" || current.results !== search.data.results) {
      next = {
        board: boardKey,
        status: "ready",
        results: search.data.results,
        total: search.data.total,
      };
    }
  } else if (search.isError) {
    if (current.status !== "error") next = { ...current, status: "error" };
  } else if (search.isFetching && current.status === "idle") {
    next = { ...current, status: "loading" };
  }
  if (next !== shown) setShown(next);
  const { status, results, total } = next;

  return (
    <SearchField
      isCarousel={isCarousel}
      status={status}
      results={results}
      total={total}
      onTermChange={setTerm}
      onSelectResult={onSelectResult}
    />
  );
}
