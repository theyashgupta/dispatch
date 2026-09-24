import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { CardSearchResult } from "../../../shared/search.js";
import { SEARCH_QUERY_MAX, SEARCH_QUERY_MIN } from "../../../shared/search.js";
import { searchCards } from "../../lib/api.js";
import { filterCommands, type Command } from "../../lib/commands.js";
import { COLUMN_LABELS } from "../../lib/event-copy.js";
import { focusRing } from "../../primitives/focus-ring.js";
import { Kbd } from "../../primitives/Kbd.js";
import { Modal, type ModalControl } from "../../primitives/Modal.js";
import { INITIAL_PALETTE, paletteReducer, rowAt } from "./palette-state.js";

interface CommandPaletteProps {
  commands: readonly Command[];
  onClose: (ran: boolean) => void;
  onOpenCard: (result: CardSearchResult) => void;
}

const SEARCH_DEBOUNCE_MS = 150;

const inputStyle: CSSProperties = {
  width: "100%",
  height: "36px",
  boxSizing: "border-box",
  padding: "0 var(--space-sm)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  outline: "none",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  maxHeight: "50vh",
  overflowY: "auto",
  display: "flex",
  flexDirection: "column",
  gap: "2px",
};

const sectionLabelStyle: CSSProperties = {
  padding: "var(--space-sm) var(--space-sm) var(--space-xs)",
  fontSize: "var(--font-micro)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

function rowStyle(active: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    minHeight: "32px",
    padding: "0 var(--space-sm)",
    borderRadius: "var(--radius)",
    cursor: "pointer",
    fontSize: "var(--font-body)",
    lineHeight: "var(--line-body)",
    color: active ? "var(--accent)" : "var(--text)",
    background: active
      ? "color-mix(in srgb, var(--accent) 16%, var(--surface-column))"
      : "transparent",
  };
}

export function CommandPalette({
  commands,
  onClose,
  onOpenCard,
}: CommandPaletteProps) {
  const [state, dispatch] = useReducer(paletteReducer, INITIAL_PALETTE);
  const [found, setFound] = useState<{
    query: string;
    results: CardSearchResult[];
    failed?: boolean;
  }>({ query: "", results: [] });
  const [inputFocus, setInputFocus] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<ModalControl>(null);
  const ranRef = useRef<"command" | "card" | null>(null);
  const query = state.query.trim();

  useEffect(() => {
    if (query.length < SEARCH_QUERY_MIN) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchCards(query, controller.signal)
        .then(({ results }) => setFound({ query, results }))
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setFound({ query, results: [], failed: true });
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const shown = filterCommands(commands, state.query);
  const results = found.query === query ? found.results : [];
  const count = shown.length + results.length;
  const highlight = Math.min(state.highlight, count - 1);

  useEffect(() => {
    document
      .getElementById(`palette-row-${highlight}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function runAt(index: number) {
    const row = rowAt(shown, results, index);
    if (row == null || ranRef.current != null) return;
    ranRef.current = row.kind;
    modalRef.current?.requestClose();
    if (row.kind === "command") void row.command.run();
    else onOpenCard(row.result);
  }

  return (
    <Modal
      ariaLabel="Command palette"
      onClose={() => onClose(ranRef.current === "command")}
      controlRef={modalRef}
      initialFocusRef={inputRef}
      dialogStyle={{
        width: "560px",
        alignSelf: "flex-start",
        marginTop: "15vh",
      }}
    >
      <Modal.Header>Command palette</Modal.Header>
      <Modal.Body>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
            padding: "var(--space-lg) var(--space-xl) 0",
          }}
        >
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search commands and tickets"
            aria-expanded="true"
            aria-controls="palette-rows"
            aria-activedescendant={
              highlight >= 0 ? `palette-row-${highlight}` : undefined
            }
            placeholder="Type a command or a ticket…"
            maxLength={SEARCH_QUERY_MAX}
            value={state.query}
            onChange={(e) => dispatch({ type: "query", query: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                dispatch({
                  type: "move",
                  delta: e.key === "ArrowDown" ? 1 : -1,
                  count,
                });
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                runAt(highlight);
              }
            }}
            onFocus={(e) =>
              setInputFocus(e.currentTarget.matches(":focus-visible"))
            }
            onBlur={() => setInputFocus(false)}
            style={{ ...inputStyle, ...focusRing(inputFocus) }}
          />
          <ul
            id="palette-rows"
            role="listbox"
            onMouseDown={(e) => e.preventDefault()}
            style={listStyle}
          >
            {shown.map((command, index) => (
              <li
                key={command.id}
                id={`palette-row-${index}`}
                role="option"
                aria-selected={index === highlight}
                onClick={() => runAt(index)}
                style={rowStyle(index === highlight)}
              >
                <span style={{ flex: "1 1 auto" }}>{command.label}</span>
                {command.key && <Kbd>{command.key}</Kbd>}
              </li>
            ))}
            {results.length > 0 && (
              <li role="presentation" style={sectionLabelStyle}>
                Tickets
              </li>
            )}
            {results.map((result, i) => {
              const index = shown.length + i;
              return (
                <li
                  key={result.id}
                  id={`palette-row-${index}`}
                  role="option"
                  aria-selected={index === highlight}
                  onClick={() => runAt(index)}
                  style={rowStyle(index === highlight)}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-micro)",
                      color: "var(--text-muted)",
                      flex: "0 0 auto",
                    }}
                  >
                    {result.identifier}
                  </span>
                  <span
                    style={{
                      flex: "1 1 auto",
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {result.title}
                  </span>
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontSize: "var(--font-micro)",
                      color: "var(--text-muted)",
                    }}
                  >
                    {COLUMN_LABELS[result.column]}
                  </span>
                </li>
              );
            })}
          </ul>
          <p role="status" style={{ ...sectionLabelStyle, margin: 0 }}>
            {found.failed === true && found.query === query
              ? "Ticket search failed"
              : count === 0
                ? "No matching commands or tickets"
                : ""}
          </p>
        </div>
      </Modal.Body>
    </Modal>
  );
}
