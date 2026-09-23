import type { CSSProperties } from "react";
import { Menu } from "lucide-react";
import { Glyph } from "../../primitives/Glyph.js";
import { IconButton } from "../../primitives/IconButton.js";

interface TopBarProps {
  title: string;
  menuOpen: boolean;
  onOpenMenu: () => void;
}

const barStyle: CSSProperties = {
  flex: "0 0 var(--page-header-height)",
  height: "var(--page-header-height)",
  display: "flex",
  alignItems: "center",
  gap: "var(--space-sm)",
  padding: "0 var(--space-lg)",
  borderBottom: "1px solid var(--border)",
  background: "var(--surface-column)",
  userSelect: "none",
};

const titleStyle: CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

export function TopBar({ title, menuOpen, onOpenMenu }: TopBarProps) {
  return (
    <div style={barStyle}>
      <Glyph size={16} title="Dispatch" />
      <span style={titleStyle}>{title}</span>
      <IconButton
        id="nav-menu"
        aria-label="Open navigation"
        aria-expanded={menuOpen}
        aria-controls="nav-sheet"
        onClick={onOpenMenu}
      >
        <Menu size={16} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </div>
  );
}
