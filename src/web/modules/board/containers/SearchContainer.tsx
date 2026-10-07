import { useEffect, useState } from "react";
import { useRouteContext } from "@tanstack/react-router";
import type { CardSearchResult } from "../../../../shared/search.js";
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

const IDLE: Shown = { status: "idle", results: [], total: 0 };

interface Shown {
  status: SearchStatus;
  results: CardSearchResult[];
  total: number;
}

export function SearchContainer() {
  const { appStore } = useRouteContext({ from: "__root__" });
  const board = useBoardSnapshot(useAppStore(appStore, (s) => s.doneLimit));
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
    debounced,
    debounced.length >= SEARCH_QUERY_MIN,
  );

  const [shown, setShown] = useState<Shown>(IDLE);
  let next = shown;
  if (search.isSuccess) {
    if (shown.status !== "ready" || shown.results !== search.data.results) {
      next = {
        status: "ready",
        results: search.data.results,
        total: search.data.total,
      };
    }
  } else if (search.isError) {
    if (shown.status !== "error") next = { ...shown, status: "error" };
  } else if (search.isFetching && shown.status === "idle") {
    next = { ...shown, status: "loading" };
  }
  if (next !== shown) setShown(next);
  const { status, results, total } = shown;

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
