import {
  CENTRE_SETTINGS_BUTTON_ID,
  COMMENT_BOX_ID,
} from "@/modules/orchestrator/domain/centre-page-state";

export const ENTRY_BUTTON_ID = "orchestrator-entry";

/** Move focus to the comment box of the command centre, on the next frame. */
export function focusCommentBox(): void {
  requestAnimationFrame(() => {
    document.getElementById(COMMENT_BOX_ID)?.focus();
  });
}

export function focusSettingsButton(): void {
  requestAnimationFrame(() => {
    document.getElementById(CENTRE_SETTINGS_BUTTON_ID)?.focus();
  });
}
