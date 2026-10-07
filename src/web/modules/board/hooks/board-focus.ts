import { MODAL_SELECTOR } from "@/components/ui/hooks/use-shortcuts";
import { CARD_DOM_PREFIX } from "@/modules/board/domain/board-keys";

/** The card id behind the focused board card element, read back from its DOM id. */
export function focusedCardId(): string | null {
  const id = document.activeElement?.id ?? "";
  return id.startsWith(CARD_DOM_PREFIX)
    ? id.slice(CARD_DOM_PREFIX.length)
    : null;
}

/** Give a board card DOM focus and scroll it fully into view so its focus outline shows. */
export function focusCard(id: string | null): void {
  if (id == null) return;
  const el = document.getElementById(`${CARD_DOM_PREFIX}${id}`);
  el?.focus();
  el?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

/** Focus a board card on the next frame, unless a dialog opened in the meantime. */
export function refocusCard(id: string): void {
  requestAnimationFrame(() => {
    if (document.querySelector(MODAL_SELECTOR) == null) focusCard(id);
  });
}
