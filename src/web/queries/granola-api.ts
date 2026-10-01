import type {
  GranolaCheckResult,
  GranolaStatus,
  MeetingSourceConfig,
} from "../../shared/types.js";
import { http } from "@/lib/http";

/** Read the Granola round status: GET /api/meetings/granola. */
export async function getGranola(): Promise<GranolaStatus> {
  const result = await http<GranolaStatus>("/api/meetings/granola");
  if (!result.ok) throw new Error(`getGranola failed: ${result.status}`);
  return result.data;
}

/** Save Granola settings: PUT /api/meetings/granola; answers the status after the change. */
export async function putGranola(
  patch: MeetingSourceConfig,
): Promise<GranolaStatus> {
  const result = await http<GranolaStatus>("/api/meetings/granola", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!result.ok) throw new Error(`putGranola failed: ${result.status}`);
  return result.data;
}

/** Check connection: POST /api/meetings/granola/check runs a fresh claude mcp list. */
export async function checkGranola(): Promise<GranolaCheckResult> {
  const result = await http<GranolaCheckResult>("/api/meetings/granola/check", {
    method: "POST",
  });
  if (!result.ok) throw new Error(`checkGranola failed: ${result.status}`);
  return result.data;
}

/**
 * Analyze now: POST /api/meetings/granola/run.
 *
 * @remarks
 * A 409 (running or off) needs no message of its own, because the status read that follows shows
 * the round running or the card Off.
 */
export async function runGranola(): Promise<void> {
  await http("/api/meetings/granola/run", { method: "POST" });
}
