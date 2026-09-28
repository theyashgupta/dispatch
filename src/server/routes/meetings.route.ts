import { Router, type Request, type Response } from "express";
import { hasDispatchMarker } from "../services/domain/playbooks.js";
import {
  MAX_ACTION_ITEMS,
  buildMeetingItems,
  isActionKey,
  localDate,
  type ActionDraft,
} from "../services/domain/meeting-actions.js";
import { generateMeetingDrafts } from "../services/orchestration/meeting-draft.js";
import { store } from "../store/board.store.js";
import { ITEM_DESCRIPTION_MAX, ITEM_TITLE_MAX } from "../store/items.js";

export const meetingsRouter = Router();

const MEETING_MAX = 200;
const NOTES_MAX = 100_000;
const ME_MAX = 100;
const MARKER_ERROR = "content contains the DISPATCH_STATUS marker";

/**
 * The first line of an error message, which never carries request text, for a log line.
 */
function firstLine(err: unknown): string {
  return err instanceof Error ? err.message.split("\n")[0] : "unknown error";
}

/**
 * Trimmed text when `value` is a string whose trimmed length is 1 to `max`, else null.
 */
function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" || text.length > max ? null : text;
}

/**
 * A draft from the request body with every field bounded, or null when any field is out of range.
 */
function toDraft(value: unknown): ActionDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!isActionKey(key)) return null;
  const title = boundedText(raw.title, ITEM_TITLE_MAX);
  const description = boundedText(raw.description, ITEM_DESCRIPTION_MAX);
  if (title === null || description === null) return null;
  return { key, title, description };
}

let draftManyInFlight = false;

/**
 * Draft action items from pasted notes, one run at a time, killing the run when the client leaves.
 *
 * @remarks The abort listens on `res`, not `req`: `req` closes as soon as the body is read, which
 * would abort every run at once (the cards.route.ts draft precedent).
 */
function draftManyHandler(req: Request, res: Response): void {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const meeting = boundedText(body.meeting, MEETING_MAX);
  if (meeting === null || hasDispatchMarker(meeting)) {
    res.status(400).json({ error: "invalid-meeting" });
    return;
  }
  const notes = body.notes;
  if (
    typeof notes !== "string" ||
    notes.trim() === "" ||
    notes.length > NOTES_MAX
  ) {
    res.status(400).json({ error: "invalid-notes" });
    return;
  }
  const me = body.me;
  if (me !== undefined && (typeof me !== "string" || me.length > ME_MAX)) {
    res.status(400).json({ error: "invalid-me" });
    return;
  }
  if (draftManyInFlight) {
    res.status(409).json({ error: "generate-in-progress" });
    return;
  }

  draftManyInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  generateMeetingDrafts({ meeting, notes, me }, controller.signal)
    .then((drafts) => {
      if (controller.signal.aborted) return;
      res.status(200).json({
        drafts: drafts.map(({ key, title, description }) => ({
          key,
          title,
          description,
        })),
      });
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      console.warn("[meetings/draft-many] generation failed:", firstLine(err));
      res.status(502).json({ error: "generate-failed" });
    })
    .finally(() => {
      draftManyInFlight = false;
    });
}

/**
 * Create the kept drafts as meeting items, validating every draft before any write.
 *
 * @remarks The item id is built from the meeting, the day and the key, so repeating a paste
 * updates its rows instead of adding new ones.
 */
async function createItemsHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const meeting = boundedText(body.meeting, MEETING_MAX);
  if (meeting === null) {
    res.status(400).json({ error: "invalid-meeting" });
    return;
  }
  const rawDrafts = body.drafts;
  if (
    !Array.isArray(rawDrafts) ||
    rawDrafts.length === 0 ||
    rawDrafts.length > MAX_ACTION_ITEMS
  ) {
    res.status(400).json({ error: "invalid-drafts" });
    return;
  }
  const drafts = rawDrafts.map(toDraft);
  if (drafts.some((d) => d === null)) {
    res.status(400).json({ error: "invalid-drafts" });
    return;
  }
  const valid = drafts as ActionDraft[];
  if (
    hasDispatchMarker(meeting) ||
    valid.some(
      (d) => hasDispatchMarker(d.title) || hasDispatchMarker(d.description),
    )
  ) {
    res.status(400).json({ error: MARKER_ERROR });
    return;
  }
  if (new Set(valid.map((d) => d.key)).size !== valid.length) {
    res.status(400).json({ error: "duplicate-key" });
    return;
  }

  const now = new Date();
  const items = buildMeetingItems({
    feed: "paste",
    meeting,
    meetingDate: localDate(now),
    drafts: valid,
    now: now.toISOString(),
  });
  const counts = await store.upsertItems("meeting", items, { kind: "append" });
  res.status(201).json({
    created: counts.inserted,
    updated: counts.updated,
    ids: items.map((i) => i.id),
  });
}

meetingsRouter.post("/cards/draft-many", draftManyHandler);
meetingsRouter.post("/meetings/items", (req, res) => {
  void createItemsHandler(req, res).catch((err: unknown) => {
    console.warn("[meetings/items] create failed:", firstLine(err));
    if (!res.headersSent) res.status(500).json({ error: "create-failed" });
  });
});
