import { z } from "zod";
import { MOVABLE_COLUMNS } from "../../shared/orchestrator-limits.js";
import { validateCommentBody } from "../../shared/comment-body.js";
import { hasDispatchMarker } from "../services/infra/playbooks.js";
import {
  ATTACHMENT_NAME_RE,
  CARD_ID_RE,
  decodeImages,
  screenshotsSection,
} from "../services/infra/attachments.js";
import { ITEM_DESCRIPTION_MAX, ITEM_TITLE_MAX } from "../store/items.js";
import {
  MARKER_ERROR,
  booleanFilter,
  boundedText,
  fieldsOf,
  fromResult,
} from "./schema-primitives.js";

const MAX_DIRECTION_LEN = 10000;
const MAX_GROUP_TITLE_MEMBERS = 50;
const STATE_ID_CODE = "stateId must be a string of 1 to 200 characters";
const MEMBER_IDS_CODE = "memberIds must be an array of >=2 distinct card ids";
const COLUMN_CODE = `invalid column; must be one of: ${MOVABLE_COLUMNS.join(", ")}`;
const EDITOR_CODE = "invalid editor; must be one of: code, cursor";

const optionalString = z.string().optional().catch(undefined);

const optionalNonEmpty = z
  .string()
  .refine((s) => s !== "")
  .optional()
  .catch(undefined);

/** At least two distinct string ids, and at most `max`, with `code` as the issue. */
export const distinctIds = (max: number, code: string) =>
  z
    .array(z.string(code), code)
    .refine(
      (ids) =>
        ids.length >= 2 &&
        ids.length <= max &&
        new Set(ids).size === ids.length,
      code,
    );

/** Pasted images decoded, where an absent list means none. */
const imagesSchema = z
  .unknown()
  .optional()
  .transform((raw, ctx) => {
    const images = raw === undefined ? [] : decodeImages(raw);
    if (images === null) {
      ctx.addIssue({ code: "custom", message: "invalid-images" });
      return z.NEVER;
    }
    return images;
  });

/** A workspace payload: a folder and at least one repo, each with a string path and base. */
const workspaceSchema = z.object({
  folder: z.string(),
  repos: z.array(z.object({ path: z.string(), base: z.string() })).min(1),
});

/** Replace the raw `folder` and `repos` fields with the workspace they form, or undefined. */
function withWorkspace<T extends { folder?: unknown; repos?: unknown }>({
  folder,
  repos,
  ...rest
}: T) {
  return {
    ...rest,
    workspace: workspaceSchema.safeParse({ folder, repos }).data,
  };
}

/** The `POST /cards/:id/comment` body, checked by the shared comment validator. */
export const commentBodySchema = z.object(
  {
    body: fromResult((body) => {
      const error = validateCommentBody(body);
      return error == null
        ? { ok: true, value: body as string }
        : { ok: false, error };
    }),
  },
  "Comment is empty.",
);

/** The `POST /cards/:id/linear-state` body. */
export const linearStateBodySchema = z.object(
  {
    stateId: z
      .string(STATE_ID_CODE)
      .refine((id) => id !== "" && id.length <= 200, STATE_ID_CODE),
  },
  STATE_ID_CODE,
);

/**
 * The `POST /cards/:id/move` body.
 *
 * @remarks The Inbox is a move target (promote, demote) but never a board column, so the list is
 * `COLUMNS` plus the Inbox.
 */
export const moveBodySchema = z.object(
  { column: z.enum(MOVABLE_COLUMNS, COLUMN_CODE) },
  COLUMN_CODE,
);

/** The `POST /cards/:id/start` body; every field is optional and a wrong type reads as absent. */
export const startBodySchema = z
  .preprocess(
    fieldsOf,
    z.object({
      extraDirection: z.string().catch(""),
      folder: z.unknown().optional(),
      repos: z.unknown().optional(),
      playbook: optionalString,
      newSession: z
        .unknown()
        .optional()
        .transform((v) => v === true),
      inheritFrom: optionalString,
    }),
  )
  .transform(withWorkspace);

export const sessionBodySchema = z.object(
  {
    sessionId: z
      .string("invalid sessionId")
      .refine((id) => id !== "", "invalid sessionId"),
  },
  "invalid sessionId",
);

export const openEditorBodySchema = z.object(
  { editor: z.enum(["code", "cursor"], EDITOR_CODE) },
  EDITOR_CODE,
);

/**
 * The `POST /cards/group` body: the title, then the member ids, fail in that order.
 *
 * @remarks The workspace is not required here, because the route checks eligibility, config and
 * the playbook before it answers a missing workspace.
 */
export const createGroupBodySchema = z
  .object(
    {
      title: boundedText(ITEM_TITLE_MAX, "invalid-title").refine(
        (title) => !hasDispatchMarker(title),
        MARKER_ERROR,
      ),
      memberIds: distinctIds(Infinity, MEMBER_IDS_CODE),
      folder: z.unknown().optional(),
      repos: z.unknown().optional(),
      playbook: optionalString,
      extraDirection: z.string().catch(""),
    },
    "invalid-title",
  )
  .transform(withWorkspace);

/** The `POST /cards/:id/unwind` body; an absent destination means To Do. */
export const unwindBodySchema = z.preprocess(
  fieldsOf,
  z.object({
    to: z.enum(["todo", "inbox"], "to must be todo or inbox").default("todo"),
  }),
);

export const draftBodySchema = z.object(
  {
    direction: boundedText(MAX_DIRECTION_LEN, "invalid-direction"),
    images: imagesSchema,
  },
  "invalid-direction",
);

export const groupTitleBodySchema = z.object(
  { memberIds: distinctIds(MAX_GROUP_TITLE_MEMBERS, "invalid-member-ids") },
  "invalid-member-ids",
);

/**
 * The `POST /cards` body, with the description returned as `fullDescription` plus screenshot links.
 *
 * @remarks The marker, image and full-length checks run in a transform, which zod skips when a
 * field already failed, so the title and description codes always win.
 */
export const createCardBodySchema = z
  .object(
    {
      title: boundedText(ITEM_TITLE_MAX, "invalid-title"),
      description: boundedText(ITEM_DESCRIPTION_MAX, "invalid-description"),
      images: z.unknown().optional(),
    },
    "invalid-title",
  )
  .transform(({ title, description, images: raw }, ctx) => {
    if (hasDispatchMarker(title) || hasDispatchMarker(description)) {
      ctx.addIssue({ code: "custom", message: MARKER_ERROR });
      return z.NEVER;
    }
    const images = imagesSchema.safeParse(raw);
    if (!images.success) {
      ctx.addIssue({ code: "custom", message: "invalid-images" });
      return z.NEVER;
    }
    const fullDescription =
      description + screenshotsSection(images.data.map((i) => i.name));
    if (fullDescription.length > ITEM_DESCRIPTION_MAX) {
      ctx.addIssue({ code: "custom", message: "invalid-description" });
      return z.NEVER;
    }
    return { title, fullDescription, images: images.data };
  });

/** The `GET /cards/:id/attachments/:name` params. */
export const attachmentParamsSchema = z.object(
  {
    id: z.string("invalid-attachment").regex(CARD_ID_RE, "invalid-attachment"),
    name: z
      .string("invalid-attachment")
      .regex(ATTACHMENT_NAME_RE, "invalid-attachment"),
  },
  "invalid-attachment",
);

/**
 * The `POST /cards/:id/sync-linear` body as the direct-path target, or undefined without a teamId.
 *
 * @remarks A `stateId` is kept only when it is a non-empty string.
 */
export const syncBodySchema = z
  .preprocess(
    fieldsOf,
    z.object({ teamId: optionalNonEmpty, stateId: optionalNonEmpty }),
  )
  .transform(({ teamId, stateId }) =>
    teamId === undefined
      ? undefined
      : { teamId, ...(stateId === undefined ? {} : { stateId }) },
  );

/**
 * The `GET /cards` filters, each optional; a repeated or unknown value fails with its own code.
 *
 * @remarks The `board` parameter is parsed apart by `parseBoardParam`. A `source` is any text, so
 * an unknown source returns an empty list rather than an error.
 */
export const cardListQuerySchema = z.object(
  {
    column: z.enum(MOVABLE_COLUMNS, COLUMN_CODE).optional(),
    source: z.string("invalid source").min(1, "invalid source").optional(),
    hasSession: booleanFilter("invalid hasSession").optional(),
  },
  COLUMN_CODE,
);
