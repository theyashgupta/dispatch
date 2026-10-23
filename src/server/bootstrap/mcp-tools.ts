import { z } from "zod";
import { COMMENT_BODY_MAX } from "../../shared/comment-body.js";
import {
  ACCOUNT_ID_MAX,
  BOARD_NAME_MAX,
  BLOCKED_BY_MAX,
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
  PLAN_ENTRIES_MAX,
  PLAN_PLAYBOOK_MAX,
  PLAN_REF_MAX,
  RELEASE_BUMPS,
  RELEASE_FEATURE_MAX,
  RELEASE_FEATURES_MAX,
  RELEASE_PRS_MAX,
  SESSION_INPUT_MAX,
  SHIP_BODY_MAX,
  SHIP_TITLE_MAX,
} from "../../shared/orchestrator-limits.js";
import {
  DECISION_KINDS,
  ORCHESTRATION_EVENT_KINDS,
  PLAN_SIZES,
} from "../../shared/types.js";

export interface McpTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  method: "GET" | "POST" | "PATCH" | "PUT";
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

const reposField = z
  .array(z.object({ path: z.string().min(1), base: z.string().min(1) }))
  .min(1)
  .optional();

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
      "List the cards on your board. You can filter by column, source or text. For a feature orchestrator, the list has only the cards assigned to you.",
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
    name: "get_card_progress",
    description:
      "Get the progress of one ticket card that start_card started: the phases from its PRD, the gate state of each phase, the loop engine state and the last status marker. A group card or a card that start_card did not start is refused. This tool changes nothing.",
    input: idParam,
    method: "GET",
    path: "/cards/:id/progress",
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
    name: "get_board_workspace",
    description:
      "Read the board workspace: the folder, the repositories with their base branch and check command, the playbook names and the group playbook. It also lists all boards with their key, name, archived flag and link. This tool changes nothing.",
    input: {},
    method: "GET",
    path: "/board-workspace",
  },
  {
    name: "create_board",
    description:
      "Create a board from a name. The key comes from the name. When you give no folder, the folder is made below the workspaces root. The answer holds the board, with its key, and the link. A blank name is refused.",
    input: {
      name: z.string().min(1).max(BOARD_NAME_MAX),
      folder: z.string().min(1).optional(),
      repositories: z.array(z.string().min(1)).optional(),
    },
    method: "POST",
    path: "/boards",
  },
  {
    name: "create_ticket",
    description:
      "Create a local ticket from one entry of a ticket proposal that the user approved. A proposal that is open, rejected or unknown, and an entry that is already used, are refused. Pass blockedBy with card ids on this board to start the ticket on its own when every blocker reaches Done; a cycle is refused.",
    input: {
      proposalItemId: z.string().regex(DECISION_ID_RE),
      index: z.number().int().min(0),
      blockedBy: z.array(looseId).max(BLOCKED_BY_MAX).optional(),
    },
    method: "POST",
    path: "/tickets",
  },
  {
    name: "release_prep",
    description:
      "Prepare a release: read the version in package.json of the repository on its base branch from origin, compute the next version from bump (patch for fixes to released features, minor for a new feature area, major only when the user names it), and create a To Do card titled Release v<version> with the features, the pull requests and the board ship rights. Omit repository to use the first board repository with a base branch. The tool does not start the card; start it with start_card and the Release playbook. An open card with the same title is refused with release-exists, a version that is not x.y.z with invalid-version, and a failed fetch of the base with fetch-failed.",
    input: {
      repository: z.string().min(1).optional(),
      bump: z.enum(RELEASE_BUMPS),
      features: z
        .array(
          z
            .string()
            .min(1)
            .max(RELEASE_FEATURE_MAX)
            .refine((f) => !/[\r\n]/.test(f)),
        )
        .min(1)
        .max(RELEASE_FEATURES_MAX),
      prs: z.array(z.number().int().positive()).max(RELEASE_PRS_MAX),
    },
    method: "POST",
    path: "/releases",
  },
  {
    name: "update_ticket",
    description:
      "Change the title or the description of a local ticket, or set blockedBy (card ids on this board, an empty list clears it) on any ticket. Text that holds the status marker is refused.",
    input: {
      ...idParam,
      title: titleField.optional(),
      description: descriptionField.optional(),
      blockedBy: z.array(looseId).max(BLOCKED_BY_MAX).optional(),
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
      "Create a group card from 2 or more cards. Omit repos to use the board repositories with their base branch; get_board_workspace lists them. A repository with no base branch is refused with missing-base; then pass repos with a base. Omit playbook to use the board group playbook; get_policy lists the playbook names. Text that holds the status marker is refused.",
    input: {
      title: titleField,
      memberIds: z.array(z.string()).min(2),
      repos: reposField,
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
      "Start the session of a group card. A group that is already started is refused. While memory is low the reply carries waitingForMemory and the start waits up to 30 minutes for memory, with the card at Waiting for memory.",
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
    name: "resume_session",
    description:
      "Resume a card whose session is lost after a restart or a reboot, the way the Resume button does. The resumed session gets no kickoff prompt; send a continue line with send_input after it is live. Refused with session-live, no-lost-session, start-in-flight, invalid-identifier, memory-low, or the cap refusal of resume_loop.",
    input: cardIdParam,
    method: "POST",
    path: "/sessions/:cardId/resume-lost",
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
    name: "pause_card",
    description:
      "Pause the loop of a card: stop its processes in place. The server never resumes it; call resume_card.",
    input: cardIdParam,
    method: "POST",
    path: "/sessions/:cardId/pause",
  },
  {
    name: "resume_card",
    description:
      "Resume a paused loop. While memory is low the call answers 202 with waitingForMemory and the card shows Waiting for memory; the loop resumes when memory frees, else the card shows Resume failed with the reason after 30 minutes.",
    input: cardIdParam,
    method: "POST",
    path: "/sessions/:cardId/unpause",
  },
  {
    name: "start_ship",
    description:
      "Start the ship steps of a finished group card, or of a finished single card, whoever started it, for its branches in stack order. A single card ships its session branch from Agent done. A board with no ship rights is refused. A card in Done, or a card whose ship flow is done, is refused with already-shipped.",
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
      "Create a decision item for a person to answer. Give 2 to 8 options with distinct ids. For the kind ticket_proposal, give 1 to 20 tickets, each with a title and a description. For the kind plan, give plan.entries: 1 to 20 entries, each with ref (a card id or a group title, unique), playbook, order (1 to 20, unique) and size (small, medium or large). A plan gets the options approve and reject.",
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
      tickets: z
        .array(z.object({ title: titleField, description: descriptionField }))
        .min(1)
        .max(20)
        .optional(),
      plan: z
        .object({
          entries: z
            .array(
              z.object({
                ref: z.string().min(1).max(PLAN_REF_MAX),
                playbook: z.string().min(1).max(PLAN_PLAYBOOK_MAX),
                order: z.number().int().min(1).max(PLAN_ENTRIES_MAX),
                size: z.enum(PLAN_SIZES),
              }),
            )
            .min(1)
            .max(PLAN_ENTRIES_MAX),
        })
        .optional(),
    },
    method: "POST",
    path: "/decisions",
  },
  {
    name: "wait_for_event",
    description:
      "Wait for the next board event after an event id. The wait is at most 55 seconds, and the default is 55. If no event comes, call it again to keep waiting.",
    input: {
      since: eventId,
      kinds: z
        .array(z.enum(ORCHESTRATION_EVENT_KINDS))
        .min(1)
        .max(20)
        .optional(),
      cardIds: z.array(looseId).min(1).max(50).optional(),
      timeoutSeconds: z.number().int().min(1).max(55).default(55),
    },
    method: "POST",
    path: "/events/wait",
  },
  {
    name: "read_state",
    description:
      "Read your saved state: the markdown, the time it was written and the handoff flag. Call it first, before any action.",
    input: {},
    method: "GET",
    path: "/state",
  },
  {
    name: "write_state",
    description:
      "Save your state as markdown, 64 KiB at most. It replaces the earlier state. Set handoffReady to true only when you hand off.",
    input: {
      markdown: z.string().max(ORCHESTRATOR_STATE_MAX_BYTES),
      handoffReady: z.boolean().optional(),
    },
    method: "PUT",
    path: "/state",
  },
  {
    name: "list_playbooks",
    description:
      "List the playbooks with the name, the when line and the source, seeded or user. Choose a playbook by its when line. This tool changes nothing.",
    input: {},
    method: "GET",
    path: "/playbooks",
  },
  {
    name: "list_accounts",
    description:
      "List the Claude accounts with the active id: for each account the id, the default flag, the plan, the chain state, the in use flag, the chain position, the limit end and the usage windows with their percent and reset time. Choose the account with the most weekly headroom for a long loop and pass it to start_card. This tool changes nothing.",
    input: {},
    method: "GET",
    path: "/accounts",
  },
  {
    name: "get_rulebook",
    description:
      "Read the orchestration rule book. Call it after read_state at the start and after each handoff, and follow it. This tool changes nothing.",
    input: {},
    method: "GET",
    path: "/rulebook",
  },
  {
    name: "start_card",
    description:
      "Start the session of one ticket card with a playbook and a direction, the way the start dialog does. Omit repos to use the stored workspace of the card, else the board repositories with their base branch. A stored workspace with no repository counts as none, and a board with no repository answers no-repositories. A group card, a running card, a card in Done or Inbox, the Board Orchestrator playbook and a start at the concurrency cap are refused. While memory is low the reply carries waitingForMemory and the start waits up to 30 minutes for memory, with the card at Waiting for memory. Pass account, an account id from list_accounts or default, to start on that account; an unknown account is refused with unknown-account. Omit it to use the active account. A feature orchestrator can start only its assigned cards; a card that is not assigned to it is refused with out-of-scope.",
    input: {
      ...cardIdParam,
      playbook: z.string().min(1).max(200),
      direction: z.string().max(DIRECTION_MAX).optional(),
      folder: z.string().min(1).optional(),
      repos: reposField,
      account: z.string().min(1).max(ACCOUNT_ID_MAX).optional(),
    },
    method: "POST",
    path: "/cards/:cardId/start",
  },
  {
    name: "assign_card",
    description:
      "Assign one card to you. Use it only when a direction that the user typed in your terminal names the card. Only a feature orchestrator can use it, and only for a card that the main orchestrator owns. A card of another feature orchestrator is refused with other-owner, a member of a group with group-member, and a call from the board orchestrator with not-feature-orchestrator. Only a card in To Do is accepted; another column is refused with not-todo.",
    input: { ...cardIdParam },
    method: "POST",
    path: "/cards/:cardId/assign",
  },
];
