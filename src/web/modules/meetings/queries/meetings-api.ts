import { http, payload } from "@/lib/http";
import type { MeetingDraft } from "@/modules/meetings/domain/draft-rows";

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

/**
 * Draft the user's action items from meeting notes: POST /api/cards/draft-many.
 *
 * @remarks
 * Non-OK statuses resolve `{ ok: false, error }` with the server's error code; an abort
 * or a network failure rejects, left for the caller's catch.
 */
export async function draftMeetingItems(
  meeting: string,
  notes: string,
  me: string,
  signal: AbortSignal,
): Promise<
  { ok: true; drafts: MeetingDraft[] } | { ok: false; error: string | null }
> {
  const result = await http<{ drafts: MeetingDraft[] }>(
    "/api/cards/draft-many",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting, notes, me }),
      signal,
    },
  );
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, drafts: result.data.drafts };
}
