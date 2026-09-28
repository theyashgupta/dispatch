import { useEffect, useState } from "react";
import type { LinearWorkflow } from "../../shared/types.js";
import { getLinearWorkflow } from "../lib/api.js";

type WorkflowResult = Awaited<ReturnType<typeof getLinearWorkflow>>;

let pending: Promise<WorkflowResult> | null = null;

/**
 * Load the Linear workflow once per page load and share it between every caller.
 *
 * @remarks A failed load is not kept, so the next mount retries.
 */
export function useLinearWorkflow():
  | { status: "loading" }
  | { status: "ready"; workflow: LinearWorkflow }
  | { status: "error"; error: string } {
  const [result, setResult] = useState<WorkflowResult | null>(null);
  useEffect(() => {
    let live = true;
    pending ??= getLinearWorkflow().then((r) => {
      if (!r.ok) pending = null;
      return r;
    });
    void pending.then((r) => {
      if (live) setResult(r);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!result) return { status: "loading" };
  return result.ok
    ? { status: "ready", workflow: result.workflow }
    : { status: "error", error: result.error };
}
