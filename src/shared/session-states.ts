import type { SupervisorState } from "./types.js";

export const SESSION_STATES: Readonly<
  Record<
    SupervisorState,
    {
      label: string;
      tone: "neutral" | "muted" | "attention" | "success" | "error";
    }
  >
> = {
  working: { label: "Working", tone: "neutral" },
  idle: { label: "Idle", tone: "muted" },
  needs_input: { label: "Needs input", tone: "attention" },
  permission_prompt: { label: "Permission prompt", tone: "attention" },
  handoff_ready: { label: "Handing off", tone: "neutral" },
  roadmap_complete: { label: "Roadmap done", tone: "success" },
  usage_limit_dialog: { label: "Usage limit dialog", tone: "attention" },
  usage_limit_wait: { label: "Waiting for usage reset", tone: "muted" },
  api_error: { label: "API error", tone: "error" },
  stale: { label: "No progress", tone: "attention" },
  lost: { label: "Session lost", tone: "error" },
  shell_prompt: { label: "Claude exited", tone: "error" },
};
