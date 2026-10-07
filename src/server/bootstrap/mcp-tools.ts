import { z } from "zod";
import { COMMENT_BODY_MAX } from "../../shared/comment-body.js";
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
  SESSION_INPUT_MAX,
  SHIP_BODY_MAX,
  SHIP_TITLE_MAX,
} from "../../shared/orchestrator-limits.js";
import {
  DECISION_KINDS,
  ORCHESTRATION_EVENT_KINDS,
} from "../../shared/types.js";

export interface McpTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  method: "GET" | "POST" | "PATCH";
  path: string;
}

const looseId = z.string().min(1).max(CARD_ID_MAX);
const idParam = { id: looseId };
const cardIdParam = { cardId: looseId };

const columnField = z.enum(MOVABLE_COLUMNS);
const titleField = z.string().min(1).max(ITEM_TITLE_MAX);
const descriptionField = z.string().min(1).max(ITEM_DESCRIPTION_MAX);
const eventId = z.number().int().min(0);
const limitField = z.number().int().min(1).max(200);
const optionId = z.string().regex(DECISION_OPTION_ID_RE);

const seg = (value: unknown) => encodeURIComponent(String(value));

/**
 * Fill the `:name` slots of the tool path and split the rest of the input off.
 *
 * @remarks `sendsRest` follows the tool shape, not the input, so a tool whose only keys are in the
 * path sends no body and `update_ticket` with only an id still sends `{}`.
 */
export function splitInput(tool: McpTool, input: Record<string, unknown>) {
  const named = new Set<string>();
  const path = tool.path.replace(/:(\w+)/g, (_, name: string) => {
    named.add(name);
    return seg(input[name]);
  });
  const rest = Object.fromEntries(
    Object.entries(input).filter(([key]) => !named.has(key)),
  );
  const sendsRest = Object.keys(tool.input).some((key) => !named.has(key));
  return { path, rest, sendsRest };
}

export const MCP_TOOLS: readonly McpTool[] = [
  {
    name: "list_cards",
    description:
      "List the cards on your board. You can filter by column, source or text.",
    input: {
      column: columnField.optional(),
      source: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
    },
    method: "GET",
    path: "/cards",
  },
  {
    name: "get_card",
    description:
      "Get one card with its members. A card outside your board is refused.",
    input: idParam,
    method: "GET",
    path: "/cards/:id",
  },
  {
    name: "list_sessions",
    description:
      "List the sessions on your board. Set live to true to list only the running sessions.",
    input: { live: z.boolean().optional() },
    method: "GET",
    path: "/sessions",
  },
  {
    name: "get_group_progress",
    description:
      "Get the progress of one group card. A card outside your board is refused.",
    input: idParam,
    method: "GET",
    path: "/groups/:id/progress",
  },
  {
    name: "read_pane_tail",
    description:
      "Read the last lines of the terminal of a session. The line count is 1 to 200, and the default is 50.",
    input: { ...cardIdParam, lines: limitField.optional() },
    method: "GET",
    path: "/sessions/:cardId/pane",
  },
  {
    name: "list_events",
    description:
      "List the events of your board after an event id. The limit is 1 to 200.",
    input: { since: eventId.optional(), limit: limitField.optional() },
    method: "GET",
    path: "/events",
  },
  {
    name: "get_policy",
    description:
      "Read the board limits and the count of running loops. This tool changes nothing.",
    input: {},
    method: "GET",
    path: "/policy",
  },
  {
    name: "create_ticket",
    description:
      "Create a local ticket on your board. Text that holds the status marker is refused.",
    input: { title: titleField, description: descriptionField },
    method: "POST",
    path: "/tickets",
  },
  {
    name: "update_ticket",
    description:
      "Change the title or the description of a ticket. Text that holds the status marker is refused.",
    input: {
      ...idParam,
      title: titleField.optional(),
      description: descriptionField.optional(),
    },
    method: "PATCH",
    path: "/tickets/:id",
  },
  {
    name: "move_card",
    description:
      "Move a card to a column. A move that the board rules do not allow is refused.",
    input: { ...idParam, column: columnField },
    method: "POST",
    path: "/tickets/:id/move",
  },
  {
    name: "add_comment",
    description:
      "Add a comment to a card. A comment that is empty or holds the status marker is refused.",
    input: { ...idParam, body: z.string().min(1).max(COMMENT_BODY_MAX) },
    method: "POST",
    path: "/tickets/:id/comments",
  },
  {
    name: "create_base_branch",
    description:
      "Create a base branch in a repository from a start point. A repository that is not known is refused.",
    input: {
      repository: z.string().min(1),
      name: z.string(),
      startPoint: z.string().min(1).max(200),
    },
    method: "POST",
    path: "/base-branches",
  },
  {
    name: "create_group",
    description:
      "Create a group card from 2 or more cards. Text that holds the status marker is refused.",
    input: {
      title: titleField,
      memberIds: z.array(z.string()).min(2),
      repos: z
        .array(z.object({ path: z.string().min(1), base: z.string().min(1) }))
        .min(1),
      playbook: z.string().min(1).optional(),
      direction: z.string().max(DIRECTION_MAX).optional(),
      dependsOn: z.array(looseId).max(50).optional(),
    },
    method: "POST",
    path: "/groups",
  },
  {
    name: "start_group",
    description:
      "Start the session of a group card. A group that is already started is refused.",
    input: idParam,
    method: "POST",
    path: "/groups/:id/start",
  },
  {
    name: "send_input",
    description:
      "Type text into a running session. A session that stopped on budget or usage is refused.",
    input: { ...cardIdParam, text: z.string().min(1).max(SESSION_INPUT_MAX) },
    method: "POST",
    path: "/sessions/:cardId/input",
  },
  {
    name: "approve_roadmap",
    description:
      "Approve the plan of a group card. When the board asks the user to approve, decisionIds must name an answered approve item of this group, else the request is refused.",
    input: {
      ...cardIdParam,
      decisionIds: z.array(z.string().regex(DECISION_ID_RE)).min(1).max(50),
    },
    method: "POST",
    path: "/groups/:cardId/approve-roadmap",
  },
  {
    name: "request_handoff",
    description:
      "Ask a session to write a handoff. Set hard to true for a hard handoff.",
    input: { ...cardIdParam, hard: z.boolean().optional() },
    method: "POST",
    path: "/sessions/:cardId/handoff",
  },
  {
    name: "resume_loop",
    description:
      "Resume the loop of a session that stopped. A session that stopped on budget or usage is refused.",
    input: cardIdParam,
    method: "POST",
    path: "/sessions/:cardId/resume",
  },
  {
    name: "stop_session",
    description:
      "Stop the session of a card. A card outside your board is refused.",
    input: cardIdParam,
    method: "POST",
    path: "/sessions/:cardId/stop",
  },
  {
    name: "start_ship",
    description:
      "Start the ship steps of a finished group card for its branches in stack order. A board with no ship rights is refused.",
    input: {
      ...cardIdParam,
      repository: z.string().min(1),
      branches: z
        .array(
          z.object({
            name: z.string().refine(isShipBranchName),
            title: z.string().min(1).max(SHIP_TITLE_MAX),
            body: z.string().min(1).max(SHIP_BODY_MAX),
          }),
        )
        .min(1)
        .max(10),
    },
    method: "POST",
    path: "/groups/:cardId/ship",
  },
  {
    name: "get_ship_state",
    description:
      "Get the state of the ship steps of a group card. A card outside your board is refused.",
    input: cardIdParam,
    method: "GET",
    path: "/groups/:cardId/ship",
  },
  {
    name: "create_decision_item",
    description:
      "Create a decision item for a person to answer. Give 2 to 8 options with distinct ids.",
    input: {
      cardId: looseId.nullable().optional(),
      kind: z.enum(DECISION_KINDS),
      question: z.string().min(1).max(DECISION_QUESTION_MAX),
      options: z
        .array(
          z.object({
            id: optionId,
            label: z.string().min(1).max(DECISION_LABEL_MAX),
          }),
        )
        .min(2)
        .max(8),
      recommendedOptionId: optionId.optional(),
    },
    method: "POST",
    path: "/decisions",
  },
  {
    name: "wait_for_event",
    description:
      "Wait for the next board event after an event id. The wait is 1 to 540 seconds, and the default is 240.",
    input: {
      since: eventId,
      kinds: z
        .array(z.enum(ORCHESTRATION_EVENT_KINDS))
        .min(1)
        .max(20)
        .optional(),
      cardIds: z.array(looseId).min(1).max(50).optional(),
      timeoutSeconds: z.number().int().min(1).max(540).optional(),
    },
    method: "POST",
    path: "/events/wait",
  },
];
