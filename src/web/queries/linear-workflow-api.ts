import type { LinearWorkflow } from "../../shared/types.js";
import { http } from "@/lib/http";

/**
 * The viewer and the Linear teams with their states: GET /api/sources/linear/workflow.
 *
 * @remarks
 * A refusal or a network failure resolves `{ ok: false, error }` with renderable copy, so the
 * caller never has to catch.
 */
export async function getLinearWorkflow(): Promise<
  { ok: true; workflow: LinearWorkflow } | { ok: false; error: string }
> {
  try {
    const result = await http<LinearWorkflow>("/api/sources/linear/workflow");
    if (result.ok) {
      return { ok: true, workflow: result.data };
    }
    return { ok: false, error: result.error ?? "Could not load Linear teams." };
  } catch {
    return { ok: false, error: "Could not reach Dispatch. Try again." };
  }
}
