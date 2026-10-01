import { useEffect, useState } from "react";
import {
  SEARCH_QUERY_MIN,
  type CardSearchResult,
} from "../../../../shared/search.js";
import { CommandPalette } from "@/modules/shell/components/CommandPalette";
import type { Command } from "@/modules/shell/domain/commands";
import { useSearchCardsQuery } from "@/queries/search-queries";

const SEARCH_DEBOUNCE_MS = 150;

export interface CommandPaletteContainerProps {
  commands: readonly Command[];
  onClose: (ran: boolean) => void;
  onOpenCard: (result: CardSearchResult) => void;
}

export function CommandPaletteContainer({
  commands,
  onClose,
  onOpenCard,
}: CommandPaletteContainerProps) {
  const [typed, setTyped] = useState("");
  const [debounced, setDebounced] = useState("");
  const query = typed.trim();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const search = useSearchCardsQuery(
    debounced,
    debounced.length >= SEARCH_QUERY_MIN,
  );
  const current = debounced === query && debounced.length >= SEARCH_QUERY_MIN;

  return (
    <CommandPalette
      commands={commands}
      results={current ? (search.data?.results ?? []) : []}
      searchFailed={current && search.isError}
      onQueryChange={setTyped}
      onClose={onClose}
      onOpenCard={onOpenCard}
    />
  );
}
