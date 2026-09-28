import { Router, type Request, type Response } from "express";
import { hasDispatchMarker } from "../services/domain/playbooks.js";
import {
  MAX_ACTION_ITEMS,
  buildMeetingItems,
  isActionKey,
  isMeetingId,
  localDate,
  type ActionDraft,
} from "../services/domain/meeting-actions.js";
import { generateMeetingDrafts } from "../services/orchestration/meeting-draft.js";
import {
  applyGranolaSettings,
  checkGranolaConnection,
  granolaSettings,
  granolaStatus,
  runGranolaNow,
} from "../services/orchestration/granola-round.js";
import { patchSourceConfig } from "../services/infra/config-holder.js";
import {
  readTranscript,
  writeTranscript,
} from "../services/orchestration/meeting-transcripts.js";
import {
  GRANOLA_WINDOW_HOURS,
  type MeetingSourceConfig,
} from "../../shared/types.js";
import { store } from "../store/board.store.js";
import { ITEM_DESCRIPTION_MAX, ITEM_TITLE_MAX } from "../store/items.js";

export const meetingsRouter = Router();

const MEETING_MAX = 200;
const NOTES_MAX = 100_000;

/** True for pasted notes the routes accept: non-blank text of at most NOTES_MAX characters. */
function isNotes(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= NOTES_MAX
  );
}
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
  if (!isNotes(notes)) {
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
 * updates its rows instead of adding new ones. The notes are stored only after the items are, and
 * a failed store leaves the items in place because they are useful without it.
 */
async function createItemsHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const meeting = boundedText(body.meeting, MEETING_MAX);
  if (meeting === null) {
    res.status(400).json({ error: "invalid-meeting" });
    return;
  }
  const notes = body.notes;
  if (notes !== undefined && !isNotes(notes)) {
    res.status(400).json({ error: "invalid-notes" });
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
    ...(notes !== undefined ? { transcript: "paste" as const } : {}),
  });
  const counts = await store.upsertItems("meeting", items, { kind: "append" });
  const result = {
    created: counts.inserted,
    updated: counts.updated,
    ids: items.map((i) => i.id),
  };
  if (notes !== undefined) {
    try {
      await writeTranscript(items[0].meta.meetingId, notes);
    } catch (err) {
      console.warn("[meetings/items] transcript write failed:", firstLine(err));
      res.status(500).json({ error: "transcript-write-failed", ...result });
      return;
    }
  }
  res.status(201).json(result);
}

meetingsRouter.post("/cards/draft-many", draftManyHandler);
meetingsRouter.post("/meetings/items", (req, res) => {
  void createItemsHandler(req, res).catch((err: unknown) => {
    console.warn("[meetings/items] create failed:", firstLine(err));
    if (!res.headersSent) res.status(500).json({ error: "create-failed" });
  });
});

/** Answer a meeting's stored notes after checking the id has the meetingId shape. */
async function readTranscriptHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = req.query.meetingId;
  if (!isMeetingId(id)) {
    res.status(400).json({ error: "invalid-meeting-id" });
    return;
  }
  const text = await readTranscript(id);
  if (text === null) res.status(404).json({ error: "not-found" });
  else res.json({ text });
}

meetingsRouter.get("/meetings/transcript", (req, res) => {
  void readTranscriptHandler(req, res).catch((err: unknown) => {
    console.warn("[meetings/transcript] read failed:", firstLine(err));
    if (!res.headersSent) {
      res.status(500).json({ error: "transcript-read-failed" });
    }
  });
});

/**
 * Save the Granola settings and apply them to the round.
 *
 * @remarks Validated before the write, so a bad body never reaches config.json.
 */
async function putGranolaHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: MeetingSourceConfig = {};
  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "invalid-enabled" });
      return;
    }
    patch.enabled = body.enabled;
  }
  if (body.windowHours !== undefined) {
    const hours = GRANOLA_WINDOW_HOURS.find((h) => h === body.windowHours);
    if (hours === undefined) {
      res.status(400).json({ error: "invalid-window" });
      return;
    }
    patch.windowHours = hours;
  }
  const previous = granolaSettings();
  patchSourceConfig("meeting", patch);
  await applyGranolaSettings(previous);
  res.json(granolaStatus());
}

meetingsRouter.get("/meetings/granola", (_req, res) => {
  res.json(granolaStatus());
});
meetingsRouter.put("/meetings/granola", (req, res) => {
  void putGranolaHandler(req, res).catch((err: unknown) => {
    console.warn("[meetings/granola] settings failed:", firstLine(err));
    if (!res.headersSent) res.status(500).json({ error: "settings-failed" });
  });
});
meetingsRouter.post("/meetings/granola/check", (_req, res) => {
  void checkGranolaConnection()
    .then((check) => res.json(check))
    .catch((err: unknown) => {
      console.warn("[meetings/granola] check failed:", firstLine(err));
      if (!res.headersSent) res.status(500).json({ error: "check-failed" });
    });
});
meetingsRouter.post("/meetings/granola/run", (_req, res) => {
  const result = runGranolaNow();
  if (result === "started") res.status(202).json({ running: true });
  else res.status(409).json({ error: result });
});
