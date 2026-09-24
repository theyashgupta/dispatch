import { COLUMNS } from "../../shared/types.js";
import { COLUMN_LABELS } from "./event-copy.js";

export interface ShortcutEntry {
  key: string;
  label: string;
  meta?: boolean;
}

export interface ShortcutBinding extends ShortcutEntry {
  run: () => void;
}

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
  target: {
    tagName?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  } | null;
}

interface ShortcutContext {
  modalOpen: boolean;
  menuOpen: boolean;
  inScope: boolean;
}

export const GLOBAL_SHORTCUTS: readonly ShortcutEntry[] = [
  { key: "k", label: "Command palette", meta: true },
  { key: "n", label: "New ticket" },
  { key: "?", label: "Keyboard shortcuts" },
];

export const BOARD_SHORTCUTS: readonly ShortcutEntry[] = [
  { key: "j", label: "Next card" },
  { key: "k", label: "Previous card" },
  { key: "h", label: "Previous column" },
  { key: "l", label: "Next column" },
  { key: "Enter", label: "Open card" },
  ...COLUMNS.map((column, index) => ({
    key: String(index + 1),
    label: `Move to ${COLUMN_LABELS[column]}`,
  })),
];

export const INBOX_SHORTCUTS: readonly ShortcutEntry[] = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open" },
  { key: "e", label: "Done" },
  { key: "s", label: "Snooze" },
  { key: "o", label: "Open link" },
  { key: "u", label: "Toggle read" },
];

export const SESSIONS_SHORTCUTS: readonly ShortcutEntry[] = [
  { key: "j", label: "Next session" },
  { key: "k", label: "Previous session" },
  { key: "Enter", label: "Open" },
];

/**
 * Attach handlers to a shortcut table, dropping entries without one.
 *
 * @remarks Runs are keyed by the entry key with a "meta+" prefix for meta entries, so a plain and a
 * meta binding on the same key never share a handler.
 */
export function bindShortcuts(
  entries: readonly ShortcutEntry[],
  runs: Partial<Record<string, () => void>>,
): ShortcutBinding[] {
  return entries.flatMap((entry) => {
    const run = runs[`${entry.meta === true ? "meta+" : ""}${entry.key}`];
    return run ? [{ ...entry, run }] : [];
  });
}

const EDITABLE_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const ACTIVATABLE_TAGS = new Set(["BUTTON", "A", "SUMMARY"]);
const ACTIVATABLE_ROLES = new Set([
  "button",
  "link",
  "menuitem",
  "option",
  "tab",
]);

function isEditableTarget(target: ShortcutEvent["target"]): boolean {
  if (target == null) return false;
  return (
    EDITABLE_TAGS.has(target.tagName ?? "") || target.isContentEditable === true
  );
}

function isActivatable(target: ShortcutEvent["target"]): boolean {
  if (target == null) return false;
  const role = target.getAttribute?.("role") ?? "";
  return (
    ACTIVATABLE_TAGS.has(target.tagName ?? "") || ACTIVATABLE_ROLES.has(role)
  );
}

/**
 * Pick the binding a key event fires, or null.
 *
 * @remarks Inert outside the owning view and while a modal or a row menu is open. A plain binding
 * never fires with a modifier held or while the user types; a meta binding fires only with Cmd or
 * Ctrl held, even from an input. Enter and Space stay with a focused button or link.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  bindings: readonly ShortcutBinding[],
  context: ShortcutContext,
): ShortcutBinding | null {
  if (!context.inScope || context.modalOpen || context.menuOpen) return null;
  if (event.altKey) return null;
  if (event.metaKey || event.ctrlKey) {
    if (event.shiftKey) return null;
    const key = event.key.toLowerCase();
    return bindings.find((b) => b.meta === true && b.key === key) ?? null;
  }
  if (isEditableTarget(event.target)) return null;
  if (
    (event.key === "Enter" || event.key === " ") &&
    isActivatable(event.target)
  ) {
    return null;
  }
  return bindings.find((b) => b.meta !== true && b.key === event.key) ?? null;
}
