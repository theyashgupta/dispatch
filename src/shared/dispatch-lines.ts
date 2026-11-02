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
export const RESUME_PROBE_LINE =
  "Dispatch resume check: the session continued after a pause. If you were working, continue. If you were waiting for input, write your last DISPATCH_STATUS line again and wait.";
