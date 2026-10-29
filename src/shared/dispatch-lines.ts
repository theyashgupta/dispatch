export const DISPATCH_WAKE_PREFIX = "Dispatch wake:";
export const HANDOFF_REQUEST_TITLE = "Context handoff request";
export const HANDOFF_CANCEL_LINE =
  "Ignore the context handoff request above: the handoff is already done and this is the fresh session. Continue the loop.";
export const ORCHESTRATOR_RESUME_PREFIX = "Resume as the ";
export const ORCHESTRATOR_KICKOFF_LEAD = 'You are the orchestrator "';
export const CONTINUE_LEADS = {
  restart: "The loop stopped without a marker.",
  api_error: "The last turn ended on an API error.",
  sleep_cut: "The last turn was cut off while the machine slept.",
  resume: "The session was restarted.",
  usage_limit: "The usage limit has reset.",
} as const;
export const MEMORY_RESUME_LINE =
  "Dispatch resume check: the session continued after a memory pause. If you were working, continue. If you were waiting for input, write your last DISPATCH_STATUS line again and wait.";

const DISPATCH_PREFIXES = [
  DISPATCH_WAKE_PREFIX,
  HANDOFF_REQUEST_TITLE,
  HANDOFF_CANCEL_LINE,
  ORCHESTRATOR_RESUME_PREFIX,
  ...Object.values(CONTINUE_LEADS),
  MEMORY_RESUME_LINE,
];

/**
 * True when a session line is one that Dispatch typed: a wake, handoff, resume, continue or kickoff line.
 *
 * @remarks The kickoff starts with the editable playbook body, so it is found by the orchestrator
 * sentence inside it, not by its first characters.
 */
export function isDispatchLine(text: string): boolean {
  return (
    DISPATCH_PREFIXES.some((prefix) => text.startsWith(prefix)) ||
    text.includes(ORCHESTRATOR_KICKOFF_LEAD)
  );
}
