export interface ShortcutBinding {
  key: string;
  label: string;
  run: () => void;
}

export interface ShortcutEvent {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
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

export const INBOX_SHORTCUTS: readonly { key: string; label: string }[] = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open" },
  { key: "e", label: "Done" },
  { key: "s", label: "Snooze" },
  { key: "o", label: "Open link" },
  { key: "u", label: "Toggle read" },
];

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
 * @remarks Inert while the user types, outside the owning view, while a modal or a row menu is
 * open, and while any modifier is held; Enter and Space stay with a focused button or link so a
 * row binding never steals a click.
 */
export function resolveShortcut(
  event: ShortcutEvent,
  bindings: readonly ShortcutBinding[],
  context: ShortcutContext,
): ShortcutBinding | null {
  if (!context.inScope || context.modalOpen || context.menuOpen) return null;
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  if (isEditableTarget(event.target)) return null;
  if (
    (event.key === "Enter" || event.key === " ") &&
    isActivatable(event.target)
  ) {
    return null;
  }
  return bindings.find((b) => b.key === event.key) ?? null;
}
