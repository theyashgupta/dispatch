import type {
  GranolaCheckResult,
  GranolaStatus,
  MeetingSourceConfig,
} from "../../../../shared/types.js";
import { http, payload } from "@/lib/http";

export interface MeetingDraft {
  key: string;
  title: string;
  description: string;
}

/**
 * Create the checked meeting drafts and store the notes: POST /api/meetings/items.
 *
 * @remarks
 * Never throws. A 500 transcript-write-failed still created the items, so it resolves ok with
 * notesSaved false.
 */
export async function createMeetingItems(
  meeting: string,
  drafts: readonly MeetingDraft[],
  notes?: string,
): Promise<
  | { ok: true; created: number; updated: number; notesSaved: boolean }
  | { ok: false; error: string | null }
> {
  try {
    const result = await http<unknown>("/api/meetings/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting, drafts, notes }),
    });
    const body = (payload(result) ?? {}) as {
      error?: string;
      created?: number;
      updated?: number;
    };
    const { created, updated } = body;
    if (typeof created !== "number" || typeof updated !== "number") {
      return { ok: false, error: body.error ?? null };
    }
    if (result.ok || body.error === "transcript-write-failed") {
      return { ok: true, created, updated, notesSaved: result.ok };
    }
    return { ok: false, error: body.error ?? null };
  } catch {
    return { ok: false, error: null };
  }
}

/**
 * Read a meeting's stored transcript: GET /api/meetings/transcript.
 *
 * @remarks
 * Throws on any non-2xx.
 */
export async function getMeetingTranscript(meetingId: string): Promise<string> {
  const result = await http<{ text: string }>(
    `/api/meetings/transcript?meetingId=${encodeURIComponent(meetingId)}`,
  );
  if (!result.ok) {
    throw new Error(`getMeetingTranscript failed: ${result.status}`);
  }
  return result.data.text;
}

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
