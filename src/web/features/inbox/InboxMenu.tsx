import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { focusRing } from "../../primitives/focus-ring.js";
import { Kbd } from "../../primitives/Kbd.js";

export interface InboxMenuItem {
  id: string;
  label: string;
  hint?: string;
  onPick: () => void;
}

interface InboxMenuProps {
  anchor: DOMRect;
  label: string;
  items: InboxMenuItem[];
  onClose: () => void;
}

const ITEM_HEIGHT = 32;
const MENU_MIN_WIDTH = 200;
const MENU_GAP = 4;
const MENU_PADDING = 8;

const menuStyle: CSSProperties = {
  position: "fixed",
  zIndex: 18,
  minWidth: `${MENU_MIN_WIDTH}px`,
  padding: "var(--space-xs)",
  background: "var(--surface-card)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-float)",
  display: "flex",
  flexDirection: "column",
};

const itemStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
  height: `${ITEM_HEIGHT}px`,
  padding: "0 var(--space-sm)",
  background: "transparent",
  border: "none",
  borderRadius: "var(--radius)",
  color: "var(--text)",
  fontFamily: "var(--font-ui)",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  textAlign: "left",
  cursor: "pointer",
  outline: "none",
  transition: "var(--hover-transition)",
};

interface MenuItemButtonProps {
  item: InboxMenuItem;
  autoFocus: boolean;
  onPick: () => void;
}

function MenuItemButton({ item, autoFocus, onPick }: MenuItemButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      role="menuitem"
      autoFocus={autoFocus}
      onClick={onPick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={(event) =>
        setFocused(event.currentTarget.matches(":focus-visible"))
      }
      onBlur={() => setFocused(false)}
      style={{
        ...itemStyle,
        background: hovered ? "var(--surface-card-hover)" : "transparent",
        ...focusRing(focused, true),
      }}
    >
      <span>{item.label}</span>
      {item.hint ? <Kbd>{item.hint}</Kbd> : null}
    </button>
  );
}

export function InboxMenu({ anchor, label, items, onClose }: InboxMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[aria-haspopup="menu"]')) return;
      if (target == null || !rootRef.current?.contains(target)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      const buttons = [
        ...(rootRef.current?.querySelectorAll<HTMLButtonElement>(
          "[role=menuitem]",
        ) ?? []),
      ];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.findIndex((b) => b === document.activeElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = (index + step + buttons.length) % buttons.length;
      buttons[next]?.focus();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [onClose]);

  const height = items.length * ITEM_HEIGHT + MENU_PADDING;
  const top =
    anchor.bottom + MENU_GAP + height > window.innerHeight
      ? Math.max(MENU_PADDING, anchor.top - MENU_GAP - height)
      : anchor.bottom + MENU_GAP;
  const right = Math.max(
    MENU_PADDING,
    Math.min(
      window.innerWidth - anchor.right,
      window.innerWidth - MENU_MIN_WIDTH - MENU_PADDING,
    ),
  );

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      aria-label={label}
      style={{ ...menuStyle, top, right }}
    >
      {items.map((item, i) => (
        <MenuItemButton
          key={item.id}
          item={item}
          autoFocus={i === 0}
          onPick={() => {
            onClose();
            item.onPick();
          }}
        />
      ))}
    </div>,
    document.body,
  );
}
