export { SlackThread } from "./SlackThread.js";

/**
 * Load the Slack page on demand.
 *
 * @remarks The Inbox imports SlackThread from this barrel eagerly, so a plain SlackPage re-export
 * would pull the page into the Inbox chunk; the dynamic import keeps the page in its own chunk.
 */
export const loadSlackPage = () =>
  import("./SlackPage.js").then((m) => ({ default: m.SlackPage }));
