import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { ChevronDown } from "lucide-react";
import type { FilterOption } from "../../../shared/types.js";

const focusRing = (on: boolean): string =>
  on ? "0 0 0 2px var(--accent)" : "none";

interface OptionRowProps {
  option: FilterOption;
  checked: boolean;
  onToggle: () => void;
  highlighted?: boolean;
}

function OptionRow({ option, checked, onToggle, highlighted }: OptionRowProps) {
  const [hover, setHover] = useState(false);
  const [checkFocus, setCheckFocus] = useState(false);
  return (
    <label
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-sm)",
        borderRadius: "var(--radius)",
        background:
          hover || highlighted ? "var(--surface-card-hover)" : "transparent",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onFocus={(e) =>
          setCheckFocus(e.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setCheckFocus(false)}
        style={{
          accentColor: "var(--accent)",
          borderRadius: "var(--radius)",
          outline: "none",
          boxShadow: focusRing(checkFocus),
          flex: "0 0 auto",
        }}
      />
      <span
        style={{
          fontFamily: "var(--font-ui)",
          fontSize: "var(--font-body)",
          lineHeight: "var(--line-body)",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {option.label}
      </span>
    </label>
  );
}

interface MultiSelectProps {
  label: string;
  placeholder: string;
  options: FilterOption[];
  selected: string[];
  loading: boolean;
  loadError: boolean;
  emptyText: string;
  onChange: (next: string[]) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function MultiSelect({
  label,
  placeholder,
  options,
  selected,
  loading,
  loadError,
  emptyText,
  onChange,
  triggerRef,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [triggerFocus, setTriggerFocus] = useState(false);
  const [search, setSearch] = useState("");
  const [searchFocus, setSearchFocus] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [open, search]);

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : [...selected, id],
    );
  };

  const hasSelection = selected.length > 0;
  const showEmpty = !loading && (options.length === 0 || loadError);
  const filteredOptions = options.filter((o) =>
    o.label.toLowerCase().includes(search.toLowerCase()),
  );
  const noMatches =
    !loading &&
    !loadError &&
    options.length > 0 &&
    filteredOptions.length === 0;

  return (
    <div
      ref={rootRef}
      onKeyDown={(e) => {
        if (!open) return;
        if (e.key === "Escape") {
          e.preventDefault();
          if (search !== "") {
            setSearch("");
            return;
          }
          setOpen(false);
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlightedIndex((i) =>
            Math.min(i + 1, filteredOptions.length - 1),
          );
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlightedIndex((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < filteredOptions.length
          ) {
            toggle(filteredOptions[highlightedIndex].id);
          }
        }
      }}
      style={{ position: "relative" }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onFocus={(e) =>
          setTriggerFocus(e.currentTarget.matches(":focus-visible"))
        }
        onBlur={() => setTriggerFocus(false)}
        style={{
          width: "100%",
          height: "32px",
          padding: "0 var(--space-sm)",
          background: "var(--surface-card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          color: "var(--text)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-sm)",
          cursor: "pointer",
          outline: "none",
          boxShadow: focusRing(triggerFocus),
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--font-label)",
            fontWeight: "var(--weight-semibold)",
            lineHeight: "var(--line-label)",
            color: hasSelection ? "var(--text)" : "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          {hasSelection ? `${selected.length} selected` : placeholder}
        </span>
        <ChevronDown
          size={12}
          strokeWidth={2}
          aria-hidden="true"
          style={{ color: "var(--text-muted)", flex: "0 0 auto" }}
        />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "var(--space-xs)",
            zIndex: 1,
            background: "var(--surface-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ padding: "var(--space-sm)" }}>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onFocus={() => setSearchFocus(true)}
              onBlur={() => setSearchFocus(false)}
              placeholder="Search…"
              aria-label="Search options"
              style={{
                height: "28px",
                width: "100%",
                boxSizing: "border-box",
                padding: "0 var(--space-sm)",
                background: "var(--surface-card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                color: "var(--text)",
                fontFamily: "var(--font-ui)",
                fontSize: "var(--font-body)",
                lineHeight: 1.5,
                outline: "none",
                boxShadow: focusRing(searchFocus),
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              maxHeight: "240px",
              overflowY: "auto",
            }}
          >
            {loading && (
              <span
                style={{
                  padding: "var(--space-sm)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text-muted)",
                }}
              >
                Loading…
              </span>
            )}
            {showEmpty && (
              <span
                style={{
                  padding: "var(--space-sm)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text-muted)",
                }}
              >
                {loadError ? "Couldn't load options" : emptyText}
              </span>
            )}
            {noMatches && (
              <span
                style={{
                  padding: "var(--space-sm)",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--font-body)",
                  lineHeight: "var(--line-body)",
                  color: "var(--text-muted)",
                }}
              >
                No matches
              </span>
            )}
            {!loading &&
              !loadError &&
              filteredOptions.map((option, index) => (
                <div
                  key={option.id}
                  ref={(node) => {
                    if (node && index === highlightedIndex) {
                      node.scrollIntoView({ block: "nearest" });
                    }
                  }}
                >
                  <OptionRow
                    option={option}
                    checked={selected.includes(option.id)}
                    onToggle={() => toggle(option.id)}
                    highlighted={index === highlightedIndex}
                  />
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
