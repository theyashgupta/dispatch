import type { CSSProperties } from "react";
import {
  BOARD_SHORTCUTS,
  GLOBAL_SHORTCUTS,
  INBOX_SHORTCUTS,
  SESSIONS_SHORTCUTS,
  type ShortcutEntry,
} from "../../lib/shortcuts.js";
import { Kbd } from "../../primitives/Kbd.js";
import { Modal } from "../../primitives/Modal.js";

interface CheatSheetProps {
  onClose: () => void;
}

const TABLES: readonly { title: string; rows: readonly ShortcutEntry[] }[] = [
  { title: "Global", rows: GLOBAL_SHORTCUTS },
  { title: "Board", rows: BOARD_SHORTCUTS },
  { title: "Inbox", rows: INBOX_SHORTCUTS },
  { title: "Sessions", rows: SESSIONS_SHORTCUTS },
];

const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const headingStyle: CSSProperties = {
  margin: "0 0 var(--space-sm)",
  fontSize: "var(--font-label)",
  fontWeight: "var(--weight-semibold)",
  lineHeight: "var(--line-label)",
  color: "var(--text-muted)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "var(--space-sm)",
  minHeight: "24px",
  fontSize: "var(--font-body)",
  lineHeight: "var(--line-body)",
  color: "var(--text)",
};

export function CheatSheet({ onClose }: CheatSheetProps) {
  const rowCount = TABLES.reduce((sum, t) => sum + t.rows.length, 0);
  return (
    <Modal
      ariaLabel="Keyboard shortcuts"
      onClose={onClose}
      dialogStyle={{ width: "760px" }}
    >
      <Modal.Header>Keyboard shortcuts</Modal.Header>
      <Modal.Body>
        <div
          data-row-count={rowCount}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
            gap: "var(--space-xl)",
            padding: "var(--space-lg) var(--space-xl) 0",
            maxHeight: "70vh",
            overflowY: "auto",
          }}
        >
          {TABLES.map((table) => (
            <section key={table.title}>
              <h3 style={headingStyle}>{table.title}</h3>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: "var(--space-xs)",
                }}
              >
                {table.rows.map((row) => (
                  <li
                    key={`${row.meta === true ? "meta+" : ""}${row.key}`}
                    data-shortcut-row=""
                    style={rowStyle}
                  >
                    <span>{row.label}</span>
                    <span style={{ display: "inline-flex", gap: "2px" }}>
                      {row.meta === true && <Kbd>{MOD_KEY}</Kbd>}
                      <Kbd>
                        {row.meta === true ? row.key.toUpperCase() : row.key}
                      </Kbd>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </Modal.Body>
    </Modal>
  );
}
