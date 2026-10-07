import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { CardSearchResult } from "../../../../shared/search.js";
import {
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  SEARCH_RESULT_LIMIT,
} from "../../../../shared/search.js";
import {
  COLUMN_ACCENT,
  COLUMN_LABELS,
} from "@/components/badges/column-accent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SearchStatus = "idle" | "loading" | "ready" | "error";

interface SearchFieldProps {
  isCarousel: boolean;
  status: SearchStatus;
  results: CardSearchResult[];
  total: number;
  onTermChange: (trimmed: string) => void;
  onSelectResult: (result: CardSearchResult) => void;
}

const COMMAND_CLASS = "h-auto overflow-visible rounded-none bg-transparent";
const INPUT_BOX_CLASS =
  "flex h-8 items-center gap-2 rounded-md border border-border bg-card px-(--space-sm) has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-ring";
const INPUT_CLASS =
  "h-full rounded-md border-0 bg-transparent px-0 py-0 text-sm shadow-none md:text-sm dark:bg-transparent focus-visible:outline-none";
const PANEL_CLASS =
  "w-[clamp(280px,60vw,360px)] rounded-(--radius-lg) p-0 shadow-(--shadow-float)";
const STATE_ROW_CLASS =
  "flex h-11 items-center px-(--space-lg) text-sm text-muted-foreground";

interface SearchInputProps {
  open: boolean;
  list: HTMLElement | null;
  value: string;
  onValueChange: (value: string) => void;
  onFocus: () => void;
}

function SearchInput({
  open,
  list,
  value,
  onValueChange,
  onFocus,
}: SearchInputProps) {
  const [highlightRowId, setHighlightRowId] = useState<string>();

  useEffect(() => {
    if (!open || list == null) return;
    const sync = () =>
      setHighlightRowId(
        list.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
          ?.id || undefined,
      );
    const observer = new MutationObserver(sync);
    observer.observe(list, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
    const frame = requestAnimationFrame(sync);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [open, list]);

  const activeId = open ? highlightRowId : undefined;
  return (
    <Input
      type="text"
      role="combobox"
      aria-label="Search tickets"
      aria-expanded={open}
      aria-controls={list?.id}
      aria-autocomplete="list"
      aria-activedescendant={activeId}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      placeholder="Search tickets…"
      maxLength={SEARCH_QUERY_MAX}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
      onFocus={onFocus}
      onKeyDown={(event) => {
        if (event.key === "Home" || event.key === "End") {
          event.stopPropagation();
        }
      }}
      className={INPUT_CLASS}
    />
  );
}

export function SearchField({
  isCarousel,
  status,
  results,
  total,
  onTermChange,
  onSelectResult,
}: SearchFieldProps) {
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [listElement, setListElement] = useState<HTMLElement | null>(null);
  const [highlight, setHighlight] = useState("");
  const [loadedResults, setLoadedResults] = useState(results);
  if (loadedResults !== results) {
    setLoadedResults(results);
    setHighlight(results[0]?.id ?? "");
  }
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const overlayTriggerRef = useRef<HTMLButtonElement | null>(null);

  const trimmedQuery = query.trim();
  const open = trimmedQuery.length >= SEARCH_QUERY_MIN && !dismissed;

  useEffect(() => {
    if (!open && !overlayOpen) return;
    function dismiss() {
      setHighlight("");
      setDismissed(true);
      setOverlayOpen(false);
    }
    window.addEventListener("resize", dismiss);
    window.addEventListener("orientationchange", dismiss);
    return () => {
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("orientationchange", dismiss);
    };
  }, [open, overlayOpen]);

  function closePanel() {
    setHighlight("");
    setDismissed(true);
    if (isCarousel) setOverlayOpen(false);
  }

  function selectResult(result: CardSearchResult) {
    closePanel();
    onSelectResult(result);
  }

  const input = (
    <div className={INPUT_BOX_CLASS}>
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <SearchInput
        open={open}
        list={listElement}
        value={query}
        onValueChange={(value) => {
          setQuery(value);
          setDismissed(false);
          onTermChange(value.trim());
        }}
        onFocus={() => setDismissed(false)}
      />
    </div>
  );

  const list = (
    <CommandList
      ref={(element) => {
        if (element) setListElement(element);
      }}
      className="scroll-stable-y max-h-[360px]"
    >
      {status === "loading" ? (
        <div className={STATE_ROW_CLASS}>Searching…</div>
      ) : status === "error" ? (
        <div className={STATE_ROW_CLASS}>
          {"Couldn't search right now. Try again."}
        </div>
      ) : results.length === 0 ? (
        <div className={STATE_ROW_CLASS}>
          {`No tickets match "${trimmedQuery}".`}
        </div>
      ) : (
        <>
          {results.map((result) => (
            <CommandItem
              key={result.id}
              value={result.id}
              data-result-id={result.id}
              onSelect={() => selectResult(result)}
              className="h-11 gap-(--space-sm) rounded-none border-l-2 border-transparent px-(--space-lg) py-0 data-[selected=true]:border-(--accent) data-[selected=true]:bg-(--surface-card-hover)"
            >
              <span className="font-mono text-xs leading-(--line-label) font-semibold text-muted-foreground">
                {result.identifier}
              </span>
              <span className="min-w-0 flex-auto truncate text-base text-foreground">
                {result.title}
              </span>
              <Badge
                stateColor={COLUMN_ACCENT[result.column]}
                className="h-auto flex-none rounded-sm border-0 bg-[color-mix(in_srgb,var(--badge-state)_16%,var(--surface-column))] px-(--space-xs) text-sm font-normal text-[color-mix(in_srgb,var(--badge-state)_35%,var(--text))]"
              >
                {COLUMN_LABELS[result.column]}
              </Badge>
            </CommandItem>
          ))}
          {total > results.length && (
            <div className={STATE_ROW_CLASS}>
              {`Showing top ${SEARCH_RESULT_LIMIT} of ${total}. Refine your search to narrow results.`}
            </div>
          )}
        </>
      )}
    </CommandList>
  );

  if (isCarousel) {
    return (
      <Popover
        open={overlayOpen}
        onOpenChange={(next) => (next ? setOverlayOpen(true) : closePanel())}
      >
        <PopoverTrigger asChild>
          <Button
            ref={overlayTriggerRef}
            variant="ghost"
            size="icon-md"
            aria-label="Search tickets"
            title="Search tickets"
          >
            <Search className="size-4" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          ref={overlayRef}
          className={cn(PANEL_CLASS, "py-1")}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const field = overlayRef.current?.querySelector("input");
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            overlayTriggerRef.current?.focus();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <Command
            shouldFilter={false}
            value={highlight}
            onValueChange={setHighlight}
            vimBindings={false}
            className={cn(COMMAND_CLASS, "gap-(--space-xs)")}
          >
            <div className="px-(--space-sm)">{input}</div>
            {open && list}
          </Command>
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Command
      shouldFilter={false}
      value={highlight}
      onValueChange={setHighlight}
      vimBindings={false}
      className={COMMAND_CLASS}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (!next) closePanel();
        }}
      >
        <PopoverAnchor ref={anchorRef}>{input}</PopoverAnchor>
        <PopoverContent
          align="start"
          className={PANEL_CLASS}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (anchorRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
        >
          {list}
        </PopoverContent>
      </Popover>
    </Command>
  );
}
