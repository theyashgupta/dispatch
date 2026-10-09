import { z } from "zod";
import {
  CARD_ID_MAX,
  DECISION_ID_RE,
  DECISION_LABEL_MAX,
  DECISION_OPTION_ID_RE,
  DECISION_QUESTION_MAX,
  DIRECTION_MAX,
  isShipBranchName,
  ITEM_DESCRIPTION_MAX,
  ITEM_TITLE_MAX,
  MOVABLE_COLUMNS,
  ORCHESTRATOR_STATE_MAX_BYTES,
  SESSION_INPUT_MAX,
  SHIP_BODY_MAX,
  SHIP_TITLE_MAX,
} from "../../shared/orchestrator-limits.js";
import {
  DECISION_KINDS,
  ORCHESTRATION_EVENT_KINDS,
} from "../../shared/types.js";
import { hasDispatchMarker } from "../services/infra/playbooks.js";
import { distinctIds } from "./cards-schemas.js";
import {
  MARKER_ERROR,
  booleanFilter,
  boundedText,
  intText,
  unknownFieldError,
} from "./schema-primitives.js";

export const orchestratorIdSchema = z
  .string("invalid-orchestrator-id")
  .regex(/^[a-z0-9][a-z0-9-]{0,31}$/, "invalid-orchestrator-id");

export const orchestratorTokenHeaderSchema = z.string().min(1);

const cardId = (code: string) =>
  z.string(code).min(1, code).max(CARD_ID_MAX, code);

export const cardParamsSchema = z.object({ id: cardId("invalid-card-id") });

export const sessionCardParamsSchema = z.object({
  cardId: cardId("invalid-card-id"),
});

export const listCardsQuerySchema = z.object({
  column: z.enum(MOVABLE_COLUMNS, "invalid-column").optional(),
  source: z.string("invalid-source").min(1, "invalid-source").optional(),
  text: z.string("invalid-text").min(1, "invalid-text").optional(),
});

export const listSessionsQuerySchema = z.object({
  live: booleanFilter("invalid-live").optional(),
});

export const paneQuerySchema = z.object({
  lines: intText("invalid-lines")
    .refine((n) => n >= 1 && n <= 200, "invalid-lines")
    .default(50),
});

export const listEventsQuerySchema = z.object({
  since: intText("invalid-since").optional(),
  limit: intText("invalid-limit")
    .refine((n) => n >= 1 && n <= 200, "invalid-limit")
    .optional(),
});

export { commentBodySchema, moveBodySchema } from "./cards-schemas.js";

const markerFree = (text: string) => !hasDispatchMarker(text);

const ticketTitle = boundedText(ITEM_TITLE_MAX, "invalid-title").refine(
  markerFree,
  MARKER_ERROR,
);

const ticketDescription = boundedText(
  ITEM_DESCRIPTION_MAX,
  "invalid-description",
).refine(markerFree, MARKER_ERROR);

/**
 * The body of `create_ticket`: an approved proposal item id and the index of one ticket in it.
 *
 * @remarks
 * A title or description field is refused, because the ticket text comes from the proposal.
 */
export const createTicketBodySchema = z.strictObject(
  {
    proposalItemId: z
      .string("invalid-proposal-item")
      .regex(DECISION_ID_RE, "invalid-proposal-item"),
    index: z
      .number("invalid-index")
      .int("invalid-index")
      .min(0, "invalid-index"),
  },
  {
    error: unknownFieldError(),
  },
);

export const updateTicketBodySchema = z
  .object(
    {
      title: ticketTitle.optional(),
      description: ticketDescription.optional(),
    },
    "empty-ticket-patch",
  )
  .refine(
    (patch) => patch.title !== undefined || patch.description !== undefined,
    "empty-ticket-patch",
  );

export const baseBranchBodySchema = z.object(
  {
    repository: z.string("unknown-repository").min(1, "unknown-repository"),
    name: z.string("invalid-branch-name"),
    startPoint: z
      .string("unknown-start-point")
      .min(1, "unknown-start-point")
      .max(200, "unknown-start-point"),
  },
  "unknown-repository",
);

export const createGroupBodySchema = z.object(
  {
    title: ticketTitle,
    memberIds: distinctIds(Infinity, "invalid-member-ids"),
    repos: z
      .array(
        z.object({
          path: z.string("invalid-repos").min(1, "invalid-repos"),
          base: z.string("invalid-repos").min(1, "invalid-repos"),
        }),
        "invalid-repos",
      )
      .min(1, "invalid-repos")
      .optional(),
    playbook: z
      .string("invalid-playbook")
      .min(1, "invalid-playbook")
      .optional(),
    direction: z
      .string("invalid-direction")
      .max(DIRECTION_MAX, "invalid-direction")
      .refine(markerFree, MARKER_ERROR)
      .optional(),
    dependsOn: z
      .array(cardId("invalid-dependency"), "invalid-dependency")
      .max(50, "invalid-dependency")
      .optional(),
  },
  "invalid-title",
);

export const sendInputBodySchema = z.object(
  {
    text: z
      .string("invalid-text")
      .max(SESSION_INPUT_MAX, "invalid-text")
      .refine((text) => text.trim().length > 0, "invalid-text"),
  },
  "invalid-text",
);

export const writeStateBodySchema = z.object(
  {
    markdown: z
      .string("invalid-markdown")
      .refine(
        (text) => Buffer.byteLength(text) <= ORCHESTRATOR_STATE_MAX_BYTES,
        "state-too-large",
      ),
    handoffReady: z.boolean("invalid-handoff-ready").optional(),
  },
  "invalid-markdown",
);

export const approveBodySchema = z.object(
  {
    decisionIds: z
      .array(
        z
          .string("invalid-decision-ids")
          .regex(DECISION_ID_RE, "invalid-decision-ids"),
        "invalid-decision-ids",
      )
      .min(1, "invalid-decision-ids")
      .max(50, "invalid-decision-ids"),
  },
  "invalid-decision-ids",
);

export const handoffBodySchema = z
  .object({ hard: z.boolean("invalid-hard").optional() }, "invalid-hard")
  .default({});

const optionId = (code: string) =>
  z.string(code).regex(DECISION_OPTION_ID_RE, code);

const decisionBodyShape = z.object(
  {
    cardId: cardId("invalid-card-id").nullable().optional(),
    kind: z.enum(DECISION_KINDS, "invalid-kind"),
    question: z
      .string("invalid-question")
      .min(1, "invalid-question")
      .max(DECISION_QUESTION_MAX, "invalid-question"),
    options: z
      .array(
        z.object(
          {
            id: optionId("invalid-options"),
            label: z
              .string("invalid-options")
              .min(1, "invalid-options")
              .max(DECISION_LABEL_MAX, "invalid-options"),
          },
          "invalid-options",
        ),
        "invalid-options",
      )
      .min(2, "invalid-options")
      .max(8, "invalid-options")
      .refine(
        (options) => new Set(options.map((o) => o.id)).size === options.length,
        "invalid-options",
      ),
    recommendedOptionId: optionId("invalid-recommended-option").optional(),
    tickets: z
      .array(
        z.object(
          { title: ticketTitle, description: ticketDescription },
          "invalid-tickets",
        ),
        "invalid-tickets",
      )
      .min(1, "invalid-tickets")
      .max(20, "invalid-tickets")
      .optional(),
  },
  "invalid-kind",
);

export const createDecisionBodySchema = decisionBodyShape.refine(
  (body) => (body.kind === "ticket_proposal") === (body.tickets !== undefined),
  "invalid-tickets",
);

export const waitBodySchema = z.object(
  {
    since: z
      .number("invalid-since")
      .int("invalid-since")
      .min(0, "invalid-since"),
    kinds: z
      .array(
        z.enum(ORCHESTRATION_EVENT_KINDS, "invalid-kinds"),
        "invalid-kinds",
      )
      .min(1, "invalid-kinds")
      .max(20, "invalid-kinds")
      .optional(),
    cardIds: z
      .array(cardId("invalid-card-ids"), "invalid-card-ids")
      .min(1, "invalid-card-ids")
      .max(50, "invalid-card-ids")
      .optional(),
    timeoutSeconds: z
      .number("invalid-timeout")
      .int("invalid-timeout")
      .min(1, "invalid-timeout")
      .max(540, "invalid-timeout")
      .default(240),
  },
  "invalid-since",
);

export const shipBodySchema = z.object(
  {
    repository: z.string("unknown-repository").min(1, "unknown-repository"),
    branches: z
      .array(
        z.object(
          {
            name: z
              .string("invalid-branch-name")
              .refine(isShipBranchName, "invalid-branch-name"),
            title: boundedText(SHIP_TITLE_MAX, "invalid-title").refine(
              markerFree,
              MARKER_ERROR,
            ),
            body: boundedText(SHIP_BODY_MAX, "invalid-body").refine(
              markerFree,
              MARKER_ERROR,
            ),
          },
          "invalid-branches",
        ),
        "invalid-branches",
      )
      .min(1, "invalid-branches")
      .max(10, "invalid-branches")
      .refine(
        (branches) =>
          new Set(branches.map((b) => b.name)).size === branches.length,
        "invalid-branches",
      ),
  },
  "unknown-repository",
);
