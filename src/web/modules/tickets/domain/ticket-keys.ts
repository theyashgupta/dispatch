import type { ShortcutEntry } from "../../../../shared/shortcuts.js";

export const TICKET_SHORTCUTS = [
  { key: "j", label: "Next row" },
  { key: "k", label: "Previous row" },
  { key: "Enter", label: "Open" },
  { key: "e", label: "Done" },
  { key: "o", label: "Open link" },
] as const satisfies readonly ShortcutEntry[];
