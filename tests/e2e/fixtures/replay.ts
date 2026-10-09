import type { Step } from "./scenario-1/loop-files.js";

export const CALL_MS = 120_000;
export const WAIT_CALL_MS = 400_000;

/** Build one replay step that calls an orchestrator tool with the default call timeout. */
export const call = (
  tool: string,
  args: Record<string, unknown>,
  rest: Step = {},
): Step => ({ tool, args, timeoutMs: CALL_MS, ...rest });
