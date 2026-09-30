import { z } from "zod";
import { GRANOLA_WINDOW_HOURS } from "../../shared/types.js";
import {
  MAX_ACTION_ITEMS,
  isActionKey,
  isMeetingId,
  type ActionDraft,
} from "../services/domain/meeting-actions.js";
import { hasDispatchMarker } from "../services/domain/playbooks.js";
import { ITEM_DESCRIPTION_MAX, ITEM_TITLE_MAX } from "../store/items.js";
import { MARKER_ERROR, boundedText, fieldsOf } from "./schema-primitives.js";

const MEETING_MAX = 200;
const NOTES_MAX = 100_000;
const ME_MAX = 100;

const meetingSchema = boundedText(MEETING_MAX, "invalid-meeting");
const titleSchema = boundedText(ITEM_TITLE_MAX, "invalid-drafts");
const descriptionSchema = boundedText(ITEM_DESCRIPTION_MAX, "invalid-drafts");

/** Pasted notes: non-blank text of at most 100000 characters, kept untrimmed. */
const notesSchema = z
  .string("invalid-notes")
  .refine(
    (text) => text.trim() !== "" && text.length <= NOTES_MAX,
    "invalid-notes",
  );

/** A draft with every field bounded, or null when any field is out of range. */
function toDraft(value: unknown): ActionDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!isActionKey(key)) return null;
  const title = titleSchema.safeParse(raw.title);
  const description = descriptionSchema.safeParse(raw.description);
  if (!title.success || !description.success) return null;
  return { key, title: title.data, description: description.data };
}

/** One to fifteen drafts, each bounded; the list comes out as `ActionDraft[]`. */
const draftsSchema = z
  .array(z.unknown(), "invalid-drafts")
  .refine(
    (list) => list.length > 0 && list.length <= MAX_ACTION_ITEMS,
    "invalid-drafts",
  )
  .transform((list, ctx) => {
    const drafts: ActionDraft[] = [];
    for (const item of list) {
      const draft = toDraft(item);
      if (draft === null) {
        ctx.addIssue({ code: "custom", message: "invalid-drafts" });
        return z.NEVER;
      }
      drafts.push(draft);
    }
    return drafts;
  });

/** The `POST /cards/draft-many` body; a meeting that carries the status marker is invalid. */
export const draftManyBodySchema = z.object(
  {
    meeting: meetingSchema.refine(
      (meeting) => !hasDispatchMarker(meeting),
      "invalid-meeting",
    ),
    notes: notesSchema,
    me: z
      .string("invalid-me")
      .refine((me) => me.length <= ME_MAX, "invalid-me")
      .optional(),
  },
  "invalid-meeting",
);

/**
 * The `POST /meetings/items` body, checked in field order with the cross-field checks last.
 *
 * @remarks The cross-field checks run in a transform, which zod skips when a field already failed,
 * so a field code always wins over the marker or duplicate code.
 */
export const createItemsBodySchema = z
  .object(
    {
      meeting: meetingSchema,
      notes: notesSchema.optional(),
      drafts: draftsSchema,
    },
    "invalid-meeting",
  )
  .transform((body, ctx) => {
    if (
      hasDispatchMarker(body.meeting) ||
      body.drafts.some(
        (d) => hasDispatchMarker(d.title) || hasDispatchMarker(d.description),
      )
    ) {
      ctx.addIssue({ code: "custom", message: MARKER_ERROR });
      return z.NEVER;
    }
    if (new Set(body.drafts.map((d) => d.key)).size !== body.drafts.length) {
      ctx.addIssue({ code: "custom", message: "duplicate-key" });
      return z.NEVER;
    }
    return body;
  });

/** The `GET /meetings/transcript` `meetingId` query value. */
export const meetingIdSchema = z
  .string("invalid-meeting-id")
  .refine((id) => isMeetingId(id), "invalid-meeting-id");

/** The `PUT /meetings/granola` body, where a missing or array body means no change. */
export const granolaBodySchema = z.preprocess(
  fieldsOf,
  z.object(
    {
      enabled: z.boolean("invalid-enabled").optional(),
      windowHours: z.literal(GRANOLA_WINDOW_HOURS, "invalid-window").optional(),
    },
    "invalid-enabled",
  ),
);
