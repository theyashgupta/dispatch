import type {
  PrerequisiteStatus,
  SetupStatus,
} from "../../../../shared/types.js";
import { http, httpError } from "@/lib/http";

/**
 * Read setup status: GET /api/setup.
 *
 * @remarks
 * The Linear key never crosses this boundary. Throws on any non-2xx so the caller can render the
 * app with no wizard.
 */
export async function getSetup(): Promise<SetupStatus> {
  const result = await http<SetupStatus>("/api/setup");
  if (!result.ok) {
    throw httpError("getSetup", result);
  }
  return result.data;
}

/**
 * Mark the setup wizard done: POST /api/setup/onboarding-done.
 *
 * @remarks
 * Throws on any non-2xx so the caller can log it, and the wizard closes either way.
 */
export async function markOnboardingDone(): Promise<void> {
  const result = await http("/api/setup/onboarding-done", { method: "POST" });
  if (!result.ok) {
    throw httpError("markOnboardingDone", result);
  }
}

/**
 * Run the guided install for one prerequisite: POST /api/setup/install { target }.
 *
 * @remarks
 * The server whitelists `target` to tmux, ttyd and git, and the Linear key never crosses this
 * boundary. Resolves `{ ok, command, status }` with the re-probed status on 2xx and throws on any
 * non-2xx so the component renders its failure state.
 */
export async function runPrerequisiteInstall(target: string): Promise<{
  ok: boolean;
  command: string;
  status: PrerequisiteStatus;
}> {
  const result = await http<{
    ok: boolean;
    command: string;
    status: PrerequisiteStatus;
  }>("/api/setup/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!result.ok) {
    throw httpError("runPrerequisiteInstall", result);
  }
  return result.data;
}
