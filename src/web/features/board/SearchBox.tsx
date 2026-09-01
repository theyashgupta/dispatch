import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import type { CardSearchResult } from "../../../shared/search.js";
import {
  SEARCH_QUERY_MAX,
  SEARCH_QUERY_MIN,
  SEARCH_RESULT_LIMIT,
} from "../../../shared/search.js";
import { searchCards } from "../../lib/api.js";
import { CAROUSEL_QUERY, useMediaQuery } from "../../hooks/useMediaQuery.js";
import { Field } from "../../primitives/Field.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { IconButton } from "../../primitives/IconButton.js";
import { COLUMN_ACCENT, COLUMN_LABELS } from "./column-meta.js";

const SEARCH_MIN_WIDTH = 280;
const SEARCH_MAX_WIDTH = 360;
const ROW_HEIGHT = 44;
const DEBOUNCE_MS = 200;
const GAP = 4;

type SearchStatus = "idle" | "loading" | "ready" | "error";

interface SearchBoxProps {
  onSelectResult: (result: CardSearchResult) => void;
  overlayAboveContent?: boolean;
}

export function SearchBox({
  onSelectResult,
  overlayAboveContent,
}: SearchBoxProps) {
  const isCarousel = useMediaQuery(CAROUSEL_QUERY);
  const [query, setQuery] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const [results, setResults] = useState<CardSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<SearchStatus>("idle");
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedRef = useRef(false);

  const trimmedQuery = query.trim();
  const open = trimmedQuery.length >= SEARCH_QUERY_MIN && !dismissed;

  useEffect(() => {
    if (trimmedQuery.length < SEARCH_QUERY_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      if (!hasLoadedRef.current) setStatus("loading");
      searchCards(trimmedQuery, controller.signal)
        .then((body) => {
          hasLoadedRef.current = true;
          setResults(body.results);
          setTotal(body.total);
          setStatus("ready");
          setActiveIndex(null);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStatus("error");
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [trimmedQuery]);

  useEffect(() => {
    if (!open && !overlayOpen) return;
    function onDismiss() {
      setDismissed(true);
      setOverlayOpen(false);
      setActiveIndex(null);
    }
    window.addEventListener("resize", onDismiss);
    window.addEventListener("orientationchange", onDismiss);
    return () => {
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("orientationchange", onDismiss);
    };
  }, [open, overlayOpen]);

  useEffect(() => {
    if (!open || isCarousel) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setDismissed(true);
      setActiveIndex(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, isCarousel]);

  useEffect(() => {
    if (!overlayOpen) return;
    inputRef.current?.focus();
  }, [overlayOpen]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (overlayAboveContent) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (isCarousel) {
          setOverlayOpen(true);
        } else {
          inputRef.current?.focus();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlayAboveContent, isCarousel]);

  function closePanel() {
    setDismissed(true);
    setActiveIndex(null);
    if (isCarousel) {
      setOverlayOpen(false);
      triggerRef.current?.querySelector("button")?.focus();
    }
  }

  function selectResult(result: CardSearchResult) {
    closePanel();
    onSelectResult(result);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((prev) =>
        prev == null ? 0 : Math.min(prev + 1, results.length - 1),
      );
    } else if (event.key === "ArrowUp") {
      if (results.length === 0) return;
      event.preventDefault();
      setActiveIndex((prev) => (prev == null ? prev : Math.max(prev - 1, 0)));
    } else if (event.key === "Enter") {
      if (!open) return;
      const result = results[activeIndex ?? 0];
      if (!result) return;
      event.preventDefault();
      selectResult(result);
    } else if (event.key === "Escape") {
      if (!open && !overlayOpen) return;
      event.preventDefault();
      closePanel();
    }
  }

  const panelWidth = Math.min(
    SEARCH_MAX_WIDTH,
    Math.max(SEARCH_MIN_WIDTH, window.innerWidth * 0.6),
  );
  const panelTop = anchorRect ? anchorRect.bottom + GAP : 0;
  const panelLeft = anchorRect
    ? Math.max(
        GAP,
        Math.min(anchorRect.left, window.innerWidth - panelWidth - GAP),
      )
    : 0;

  const activeId =
    activeIndex != null && results[activeIndex]
      ? `search-result-${results[activeIndex].id}`
      : undefined;

  const inputStyle = {
    width: "100%",
    height: "32px",
    padding: "0 var(--space-sm) 0 26px",
    background: "var(--surface-card)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    color: "var(--text)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--font-label)",
    lineHeight: "var(--line-label)",
    outline: "none",
    ...focusRing(inputFocused),
  } as const;

  const inputField = (
    <div
      style={{ position: "relative", display: "flex", alignItems: "center" }}
    >
      <Search
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "var(--space-sm)",
          color: "var(--text-muted)",
        }}
      />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="Search tickets"
        aria-expanded={open}
        aria-controls="search-results-listbox"
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        placeholder="Search tickets… (⌘K)"
        maxLength={SEARCH_QUERY_MAX}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setDismissed(false);
        }}
        onKeyDown={handleKeyDown}
        onFocus={(event) => {
          setInputFocused(event.currentTarget.matches(":focus-visible"));
          setDismissed(false);
          setAnchorRect(event.currentTarget.getBoundingClientRect());
        }}
        onBlur={() => setInputFocused(false)}
        style={inputStyle}
      />
    </div>
  );

  function renderStateRow(text: string) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: `${ROW_HEIGHT}px`,
          padding: "0 var(--space-lg)",
          color: "var(--text-muted)",
          fontSize: "var(--font-label)",
        }}
      >
        {text}
      </div>
    );
  }

  function renderRow(result: CardSearchResult, index: number) {
    const isActive = index === activeIndex;
    return (
      <div
        key={result.id}
        role="option"
        id={`search-result-${result.id}`}
        aria-selected={isActive}
        onClick={() => selectResult(result)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-sm)",
          height: `${ROW_HEIGHT}px`,
          padding: "0 var(--space-lg)",
          cursor: "pointer",
          borderLeft: isActive
            ? "2px solid var(--accent)"
            : "2px solid transparent",
          background: isActive ? "var(--surface-card-hover)" : "transparent",
        }}
      >
        <Field mono>{result.identifier}</Field>
        <span
          style={{
            flex: "1 1 auto",
            minWidth: 0,
            fontSize: "var(--font-body)",
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {result.title}
        </span>
        <span
          style={{
            flex: "0 0 auto",
            background: `color-mix(in srgb, ${COLUMN_ACCENT[result.column]} 16%, var(--surface-column))`,
            color: COLUMN_ACCENT[result.column],
            borderRadius: "var(--radius-sm)",
            padding: "0 var(--space-xs)",
            fontSize: "var(--font-label)",
            whiteSpace: "nowrap",
          }}
        >
          {COLUMN_LABELS[result.column]}
        </span>
      </div>
    );
  }

  const listbox = (
    <div
      ref={panelRef}
      role="listbox"
      id="search-results-listbox"
      className="scroll-stable-y"
      style={{
        width: "100%",
        maxHeight: "360px",
        overflowY: "auto",
        background: "var(--surface-card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-float)",
      }}
    >
      {status === "loading" ? (
        renderStateRow("Searching…")
      ) : status === "error" ? (
        renderStateRow("Couldn't search right now. Try again.")
      ) : results.length === 0 ? (
        renderStateRow(`No tickets match "${trimmedQuery}".`)
      ) : (
        <>
          {results.map((result, index) => renderRow(result, index))}
          {total > results.length &&
            renderStateRow(
              `Showing top ${SEARCH_RESULT_LIMIT} of ${total}. Refine your search to narrow results.`,
            )}
        </>
      )}
    </div>
  );

  return (
    <>
      {!isCarousel ? (
        <div ref={containerRef}>
          {inputField}
          {open && (
            <div
              style={{
                position: "fixed",
                top: panelTop,
                left: panelLeft,
                zIndex: 16,
                width: `${panelWidth}px`,
              }}
            >
              {listbox}
            </div>
          )}
        </div>
      ) : (
        <span ref={triggerRef} style={{ display: "inline-flex" }}>
          <IconButton
            aria-label="Search tickets (⌘K)"
            title="Search tickets (⌘K)"
            onClick={() => setOverlayOpen(true)}
          >
            <Search size={16} aria-hidden="true" />
          </IconButton>
        </span>
      )}
      {isCarousel && overlayOpen && (
        <>
          <div
            aria-hidden="true"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              closePanel();
            }}
            style={{
              position: "fixed",
              inset: 0,
              background: "transparent",
              zIndex: 15,
            }}
          />
          <div
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: "fixed",
              top: panelTop,
              left: panelLeft,
              zIndex: 16,
              width: `${panelWidth}px`,
              background: "var(--surface-card)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              boxShadow: "var(--shadow-float)",
              padding: `${GAP}px 0`,
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-xs)",
            }}
          >
            <div style={{ padding: "0 var(--space-sm)" }}>{inputField}</div>
            {open && listbox}
          </div>
        </>
      )}
    </>
  );
}
