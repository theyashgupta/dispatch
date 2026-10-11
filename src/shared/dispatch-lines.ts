export const DISPATCH_WAKE_PREFIX = "Dispatch wake:";
export const HANDOFF_REQUEST_TITLE = "Context handoff request";
export const HANDOFF_CANCEL_LINE =
  "Ignore the context handoff request above: the handoff is already done and this is the fresh session. Continue the loop.";

const DISPATCH_PREFIXES = [
  DISPATCH_WAKE_PREFIX,
  HANDOFF_REQUEST_TITLE,
  HANDOFF_CANCEL_LINE,
];

/** True when a session line starts the way the lines that Dispatch types into a session start. */
export function isDispatchLine(text: string): boolean {
  return DISPATCH_PREFIXES.some((prefix) => text.startsWith(prefix));
}
