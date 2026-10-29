import { useEffect, useLayoutEffect, useRef } from "react";
import type { PrRow } from "../../../../shared/pr-rows.js";
import {
  bindShortcuts,
  isEditableRole,
  resolveShortcut,
} from "../../../../shared/shortcuts.js";
import {
  PR_SHORTCUTS,
  nextCursorKey,
} from "@/modules/pull-requests/domain/pr-keys";

interface PrShortcutOptions {
  scopeId: string;
  rows: readonly PrRow[];
  cursor: PrRow | undefined;
  onCursorChange: (key: string) => void;
  onSelect: (row: PrRow) => void;
}

function rowElement(row: PrRow): HTMLElement | null {
  return document.getElementById(`pr-row-${row.key}`);
}

function isVisibleRow(row: PrRow): boolean {
  const el = rowElement(row);
  return el !== null && !el.closest("[inert]");
}

function moveCursor(
  { rows, cursor, onCursorChange }: PrShortcutOptions,
  step: 1 | -1,
): void {
  const reachable = new Set(rows.filter(isVisibleRow).map((row) => row.key));
  const key = nextCursorKey(
    rows.map((row) => row.key),
    reachable,
    cursor?.key ?? null,
    step,
  );
  if (key === null) return;
  onCursorChange(key);
  const el = document.getElementById(`pr-row-${key}`);
  el?.scrollIntoView({ block: "nearest" });
  el?.focus({ preventScroll: true });
}

function runsFor(options: PrShortcutOptions) {
  const { cursor, onSelect } = options;
  return {
    j: () => moveCursor(options, 1),
    k: () => moveCursor(options, -1),
    Enter: () => {
      if (cursor && isVisibleRow(cursor)) onSelect(cursor);
    },
  };
}

/**
 * Run the Pull requests page key handlers and the row cursor from one window listener.
 *
 * @remarks
 * The options live in a ref written in a layout effect, so a press right after a render sees the
 * new rows. A row element that is not in the DOM or sits in an inert group counts as hidden, and
 * `scopeId` names the element focus must sit in, body included.
 */
export function usePrShortcuts(options: PrShortcutOptions): void {
  const optionsRef = useRef(options);
  useLayoutEffect(() => {
    optionsRef.current = options;
  });
  const { scopeId } = options;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isEditableRole(target)) return;
      const scope = document.getElementById(scopeId);
      const binding = resolveShortcut(
        {
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          target,
        },
        bindShortcuts(PR_SHORTCUTS, runsFor(optionsRef.current)),
        {
          modalOpen:
            document.querySelector('[role="dialog"], [role="alertdialog"]') !==
            null,
          menuOpen: false,
          inScope:
            target == null ||
            target === document.body ||
            (scope?.contains(target) ?? false),
        },
      );
      if (binding == null) return;
      event.preventDefault();
      binding.run();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scopeId]);
}
