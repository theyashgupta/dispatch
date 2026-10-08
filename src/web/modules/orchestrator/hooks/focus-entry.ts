export const ENTRY_BUTTON_ID = "orchestrator-entry";

/** Move focus back to the header entry button after the panel closes, on the next frame. */
export function focusEntryButton(): void {
  requestAnimationFrame(() => {
    document.getElementById(ENTRY_BUTTON_ID)?.focus();
  });
}
