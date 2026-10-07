import { useEffect, useLayoutEffect, useRef } from "react";
import {
  bindShortcuts,
  resolveShortcut,
} from "../../../../shared/shortcuts.js";
import type { Card } from "../../../../shared/types.js";
import { isWebUrl } from "../../../../shared/web-url.js";
import { ticketActionsFor } from "@/modules/tickets/domain/ticket-actions";
import {
  isEditableRole,
  TICKET_SHORTCUTS,
} from "@/modules/tickets/domain/ticket-keys";

interface TicketShortcutOptions {
  scopeId: string;
  rows: readonly Card[];
  cursor: Card | undefined;
  onCursorChange: (id: string) => void;
  onSelect: (card: Card) => void;
  onDone: (card: Card) => void;
}

function rowElement(card: Card): HTMLElement | null {
  return document.getElementById(`ticket-row-${card.id}`);
}

function isVisibleRow(card: Card): boolean {
  const el = rowElement(card);
  return el !== null && !el.closest("[inert]");
}

function moveCursor(
  { rows, cursor, onCursorChange }: TicketShortcutOptions,
  step: number,
): void {
  const reachable = rows.filter(isVisibleRow);
  if (reachable.length === 0) return;
  const from = reachable.findIndex((row) => row.id === cursor?.id);
  const next = Math.max(
    0,
    Math.min(reachable.length - 1, from < 0 ? 0 : from + step),
  );
  const target = reachable[next];
  if (!target) return;
  onCursorChange(target.id);
  const el = rowElement(target);
  el?.scrollIntoView({ block: "nearest" });
  el?.focus({ preventScroll: true });
}

function runsFor(options: TicketShortcutOptions) {
  const { cursor, onSelect, onDone } = options;
  const onVisibleCursor = (fn: (card: Card) => void) => () => {
    if (cursor && isVisibleRow(cursor)) fn(cursor);
  };
  return {
    j: () => moveCursor(options, 1),
    k: () => moveCursor(options, -1),
    Enter: onVisibleCursor(onSelect),
    e: onVisibleCursor((card) => {
      if (ticketActionsFor(card).includes("done")) onDone(card);
    }),
    o: onVisibleCursor((card) => {
      if (isWebUrl(card.url) && ticketActionsFor(card).includes("open"))
        window.open(card.url, "_blank", "noopener,noreferrer");
    }),
  };
}

/**
 * Run the Tickets page key handlers and the row cursor from one window listener.
 *
 * @remarks
 * The options live in a ref written in a layout effect, so a press right after a render sees the
 * new rows. A row element that is not in the DOM or sits in an inert group counts as hidden, and
 * `scopeId` names the element focus must sit in, body included.
 */
export function useTicketShortcuts(options: TicketShortcutOptions): void {
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
        bindShortcuts(TICKET_SHORTCUTS, runsFor(optionsRef.current)),
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
