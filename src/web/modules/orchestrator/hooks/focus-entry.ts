import {
  CENTRE_SETTINGS_BUTTON_ID,
  CENTRE_TERMINAL_BUTTON_ID,
  CENTRE_TERMINAL_CLOSE_ID,
} from "@/modules/orchestrator/domain/centre-page-state";

export const ENTRY_BUTTON_ID = "orchestrator-entry";

function focusOnNextFrame(id: string): void {
  requestAnimationFrame(() => {
    document.getElementById(id)?.focus();
  });
}

/** Move focus to the toolbar Settings button on the next frame. */
export function focusSettingsButton(): void {
  focusOnNextFrame(CENTRE_SETTINGS_BUTTON_ID);
}

/** Move focus to the toolbar Terminal button on the next frame. */
export function focusTerminalButton(): void {
  focusOnNextFrame(CENTRE_TERMINAL_BUTTON_ID);
}

/** Move focus to the Close terminal button of the pane on the next frame. */
export function focusTerminalClose(): void {
  focusOnNextFrame(CENTRE_TERMINAL_CLOSE_ID);
}
