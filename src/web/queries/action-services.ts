import {
  startAgentFor,
  type ActionApi,
  type ActionServices,
} from "../../shared/item-actions.js";
import type { StartRequest } from "../../shared/start-request.js";
import { isWebUrl } from "../../shared/web-url.js";
import {
  cleanupCard,
  moveCard,
  resumeCard,
  switchSession,
} from "./cards-api.js";
import { promoteItem, setItemState, snoozeItem } from "./item-actions-api.js";
import { getSlackThread } from "./slack-thread-api.js";
import { pollSource } from "./source-poll-api.js";

export const ACTION_API: ActionApi = {
  promoteItem,
  setItemState,
  snoozeItem,
  moveCard,
  cleanupCard,
  switchSession,
  resumeCard,
  pollSource,
  getSlackThread,
};

/** Copy text to the clipboard, refusing where the page has no clipboard (plain http). */
export function copyText(text: string): Promise<void> {
  return navigator.clipboard
    ? navigator.clipboard.writeText(text)
    : Promise.reject(new Error("Clipboard unavailable over http"));
}

/**
 * Build the services an item action runs with: the API calls plus the shell's toast, start and ask hooks.
 *
 * @remarks One builder serves the Inbox, Sessions and Calendar pages, so every page runs an action
 * with the same calls and copy.
 */
export function actionServices(deps: {
  showUndo: (label: string, undo: () => Promise<void>) => void;
  notice: (text: string) => void;
  openStart: (request: StartRequest) => void;
  askAbout: (question: string) => void;
}): ActionServices {
  return {
    api: ACTION_API,
    showUndo: deps.showUndo,
    notice: deps.notice,
    openUrl: (url) => {
      if (isWebUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
    },
    copyText,
    startAgent: (target, extraDirection) =>
      startAgentFor(
        { ...ACTION_API, openStart: deps.openStart, notice: deps.notice },
        target,
        extraDirection,
      ),
    askAbout: deps.askAbout,
  };
}
