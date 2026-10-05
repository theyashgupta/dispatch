import type {
  ShortcutEntry,
  ShortcutEvent,
} from "../../../../shared/shortcuts.js";

export const TICKET_SHORTCUTS = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open" },
  { key: "e", label: "Done" },
  { key: "o", label: "Open link" },
] as const satisfies readonly ShortcutEntry[];

const EDITABLE_ROLES = new Set(["combobox", "listbox"]);

/**
 * Tell whether a focused element is a combobox or listbox.
 *
 * @remarks
 * The shared resolver treats only fields as editable, but a Radix Select trigger is a button with
 * the combobox role, so a key typed there must not act on the cursor row.
 */
export function isEditableRole(target: ShortcutEvent["target"]): boolean {
  return EDITABLE_ROLES.has(target?.getAttribute?.("role") ?? "");
}
