import { Router, type Request, type Response } from "express";
import {
  buildMeetingItems,
  localDate,
} from "../services/orchestration/meeting-actions.js";
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
import type { MeetingSourceConfig } from "../../shared/types.js";
import { boardRepository as store } from "../store/board-repository.js";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  UpstreamError,
} from "../services/domain/errors.js";
import { firstLine, httpErrorHandler, orFail } from "./error-handler.js";
import {
  createItemsBodySchema,
  draftManyBodySchema,
  granolaBodySchema,
  meetingIdSchema,
} from "./meetings-schemas.js";
import { parseOrThrow } from "./parse-input.js";

export const meetingsRouter = Router();

let draftManyInFlight = false;

/**
 * Draft action items from pasted notes, one run at a time, killing the run when the client leaves.
 *
 * @remarks The abort listens on `res`, not `req`: `req` closes as soon as the body is read, which
 * would abort every run at once (the cards.route.ts draft precedent).
 */
async function draftManyHandler(req: Request, res: Response): Promise<void> {
  const { meeting, notes, me } = parseOrThrow(draftManyBodySchema, req.body);
  if (draftManyInFlight) throw new ConflictError("generate-in-progress");

  draftManyInFlight = true;
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const drafts = await generateMeetingDrafts(
      { meeting, notes, me },
      controller.signal,
    );
    if (controller.signal.aborted) return;
    res.status(200).json({
      drafts: drafts.map(({ key, title, description }) => ({
        key,
        title,
        description,
      })),
    });
  } catch (err) {
    if (controller.signal.aborted) return;
    console.warn("[meetings/draft-many] generation failed:", firstLine(err));
    throw new UpstreamError("generate-failed");
  } finally {
    draftManyInFlight = false;
  }
}

/**
 * Create the kept drafts as meeting items, validating every draft before any write.
 *
 * @remarks The item id is built from the meeting, the day and the key, so repeating a paste
 * updates its rows instead of adding new ones. The notes are stored only after the items are, and
 * a failed store leaves the items in place because they are useful without it.
 */
async function createItemsHandler(req: Request, res: Response): Promise<void> {
  const {
    meeting,
    notes,
    drafts: valid,
  } = parseOrThrow(createItemsBodySchema, req.body);

  const { items, counts } = await orFail(
    "create-failed",
    async () => {
      const now = new Date();
      const items = buildMeetingItems({
        feed: "paste",
        meeting,
        meetingDate: localDate(now),
        drafts: valid,
        now: now.toISOString(),
        ...(notes !== undefined ? { transcript: "paste" as const } : {}),
      });
      const counts = await store.upsertItems("meeting", items, {
        kind: "append",
      });
      return { items, counts };
    },
    "[meetings/items] create failed:",
  );
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
      throw new InternalError("transcript-write-failed", result);
    }
  }
  res.status(201).json(result);
}

meetingsRouter.post("/cards/draft-many", draftManyHandler);
meetingsRouter.post("/meetings/items", createItemsHandler);

async function readTranscriptHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const id = parseOrThrow(meetingIdSchema, req.query.meetingId);
  const text = await orFail(
    "transcript-read-failed",
    () => readTranscript(id),
    "[meetings/transcript] read failed:",
  );
  if (text === null) throw new NotFoundError("not-found");
  res.json({ text });
}

meetingsRouter.get("/meetings/transcript", readTranscriptHandler);

/**
 * Save the Granola settings and apply them to the round.
 *
 * @remarks Validated before the write, so a bad body never reaches config.json.
 */
async function putGranolaHandler(req: Request, res: Response): Promise<void> {
  const { enabled, windowHours } = parseOrThrow(granolaBodySchema, req.body);
  const patch: MeetingSourceConfig = {};
  if (enabled !== undefined) patch.enabled = enabled;
  if (windowHours !== undefined) patch.windowHours = windowHours;
  const status = await orFail(
    "settings-failed",
    async () => {
      const previous = granolaSettings();
      patchSourceConfig("meeting", patch);
      await applyGranolaSettings(previous);
      return granolaStatus();
    },
    "[meetings/granola] settings failed:",
  );
  res.json(status);
}

meetingsRouter.get("/meetings/granola", (_req, res) => {
  res.json(granolaStatus());
});
meetingsRouter.put("/meetings/granola", putGranolaHandler);
meetingsRouter.post("/meetings/granola/check", async (_req, res) => {
  const check = await orFail(
    "check-failed",
    checkGranolaConnection,
    "[meetings/granola] check failed:",
  );
  res.json(check);
});
meetingsRouter.post("/meetings/granola/run", (_req, res) => {
  const result = runGranolaNow();
  if (result !== "started") throw new ConflictError(result);
  res.status(202).json({ running: true });
});

meetingsRouter.use(httpErrorHandler);
