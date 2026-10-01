import type { Card, Item, SlackThread } from "../../shared/types.js";
import type * as Api from "./api.js";
import { draftReplyPrompt } from "./slack-prompt.js";
import { askAboutQuestion, type AskAboutTarget } from "./ask.js";
import { SNOOZE_LABELS, snoozeUntil, type SnoozePreset } from "./snooze.js";

export interface InboxRowModel {
  kind: "item" | "card";
  id: string;
  source: string;
  title: string;
  snippet: string;
  priority: number;
  time: string;
  unread: boolean;
  url?: string;
  typeLabel?: string;
  project?: string;
  item?: Item;
  card?: Card;
}

export type InboxActionId =
  | "promote"
  | "snooze"
  | "done"
  | "toggleRead"
  | "open"
  | "copyLink"
  | "draftReply"
  | "ask";

export type ActionApi = Pick<
  typeof Api,
  | "promoteItem"
  | "setItemState"
  | "snoozeItem"
  | "moveCard"
  | "cleanupCard"
  | "switchSession"
  | "resumeCard"
  | "pollSource"
  | "getSlackThread"
>;

export interface ActionContext {
  api: ActionApi;
  showUndo: (label: string, undo: () => Promise<void>) => void;
  notice: (text: string) => void;
  openSnooze: (row: InboxRowModel) => void;
  openUrl: (url: string) => void;
  copyText: (text: string) => Promise<void>;
  startAgent: (
    target: { itemId: string },
    extraDirection: string,
  ) => Promise<void>;
  askAbout: (question: string) => void;
}

export type ActionServices = Omit<ActionContext, "openSnooze">;

type RowRef = Pick<InboxRowModel, "id" | "title" | "unread">;

export interface InboxAction {
  id: InboxActionId;
  label: string;
  key?: string;
  appliesTo: (row: InboxRowModel) => boolean;
  run: (ctx: ActionContext, row: InboxRowModel) => Promise<void>;
}

const isItem = (row: InboxRowModel) => row.kind === "item";
const priorState = (row: RowRef) => (row.unread ? "unread" : "read");

/**
 * True for an http or https url; anything else never reaches window.open or the clipboard.
 *
 * @remarks Connector urls are third-party input, so a javascript: or data: scheme would run in
 * the app's origin through the Open link action; the allow-list closes that at the action gate.
 */
export function isWebUrl(url: string | undefined): url is string {
  if (url == null) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const hasUrl = (row: InboxRowModel) => isWebUrl(row.url);

const isSlackItem = (row: InboxRowModel) =>
  row.kind === "item" && row.item?.source === "slack";
function askTarget(row: InboxRowModel): AskAboutTarget {
  return row.kind === "card" && row.card
    ? { kind: "card", identifier: row.card.identifier, title: row.title }
    : {
        kind: "item",
        source: row.source,
        typeLabel: row.typeLabel ?? "item",
        title: row.title,
      };
}

export const INBOX_ACTIONS: readonly InboxAction[] = [
  {
    id: "promote",
    label: "Promote",
    appliesTo: () => true,
    run: async (ctx, row) => {
      if (row.kind === "item") await ctx.api.promoteItem(row.id);
      else await ctx.api.moveCard(row.id, "todo");
    },
  },
  {
    id: "snooze",
    label: "Snooze",
    key: "s",
    appliesTo: isItem,
    run: (ctx, row) => {
      ctx.openSnooze(row);
      return Promise.resolve();
    },
  },
  {
    id: "done",
    label: "Done",
    key: "e",
    appliesTo: isItem,
    run: markDone,
  },
  {
    id: "toggleRead",
    label: "Toggle read",
    key: "u",
    appliesTo: isItem,
    run: (ctx, row) =>
      ctx.api.setItemState(row.id, row.unread ? "read" : "unread"),
  },
  {
    id: "open",
    label: "Open link",
    key: "o",
    appliesTo: hasUrl,
    run: (ctx, row) => {
      if (isWebUrl(row.url)) ctx.openUrl(row.url);
      return Promise.resolve();
    },
  },
  {
    id: "copyLink",
    label: "Copy link",
    appliesTo: hasUrl,
    run: async (ctx, row) => {
      if (!isWebUrl(row.url)) return;
      await ctx.copyText(row.url);
      ctx.notice("Link copied");
    },
  },
  {
    id: "draftReply",
    label: "Draft reply",
    appliesTo: isSlackItem,
    run: async (ctx, row) => {
      const item = row.item;
      if (!item) return;
      let thread: SlackThread | null | undefined;
      if (item.meta.threadTs) {
        const loaded = await ctx.api.getSlackThread(item.id);
        thread = loaded.ok ? loaded.thread : null;
      }
      await ctx.startAgent({ itemId: item.id }, draftReplyPrompt(item, thread));
    },
  },
  {
    id: "ask",
    label: "Ask about this",
    key: "a",
    appliesTo: () => true,
    run: (ctx, row) => {
      ctx.askAbout(askAboutQuestion(askTarget(row)));
      return Promise.resolve();
    },
  },
];

/** The actions a row's menu lists, in table order. */
export function actionsFor(row: InboxRowModel): InboxAction[] {
  return INBOX_ACTIONS.filter((a) => a.appliesTo(row));
}

/**
 * Run one action and resolve whether it ran and succeeded.
 *
 * @remarks A refusal or failure becomes a notice instead of an unhandled rejection.
 */
export function runAction(
  action: InboxAction,
  ctx: ActionContext,
  row: InboxRowModel,
): Promise<boolean> {
  if (!action.appliesTo(row)) return Promise.resolve(false);
  return action.run(ctx, row).then(
    () => true,
    (err: unknown) => {
      ctx.notice(err instanceof Error ? err.message : `${action.label} failed`);
      return false;
    },
  );
}

/** Mark an item done and offer Undo back to its prior read state. */
export async function markDone(
  ctx: ActionServices,
  row: RowRef,
): Promise<void> {
  await ctx.api.setItemState(row.id, "done");
  ctx.showUndo(`${row.title} marked done`, () =>
    ctx.api.setItemState(row.id, priorState(row)),
  );
}

/** Snooze an item to a preset and offer Undo back to its prior read state. */
export async function snoozeWithUndo(
  ctx: ActionServices,
  row: RowRef,
  preset: SnoozePreset,
  now: Date,
): Promise<void> {
  await ctx.api.snoozeItem(row.id, snoozeUntil(preset, now).toISOString());
  ctx.showUndo(`${row.title} snoozed for ${SNOOZE_LABELS[preset]}`, () =>
    ctx.api.setItemState(row.id, priorState(row)),
  );
}

/** Snooze an item row to a preset, offer Undo, and resolve whether it snoozed; a refusal becomes a notice. */
export function snoozeRow(
  ctx: ActionContext,
  row: InboxRowModel,
  preset: SnoozePreset,
  now: Date,
): Promise<boolean> {
  if (row.kind !== "item") return Promise.resolve(false);
  return Promise.resolve()
    .then(() => snoozeWithUndo(ctx, row, preset, now))
    .then(() => true)
    .catch((err: unknown) => {
      ctx.notice(err instanceof Error ? err.message : "Snooze failed");
      return false;
    });
}

export interface BulkTarget {
  cardId: string;
  identifier: string;
  sessionId: string;
  active?: boolean;
  restoreSessionId?: string;
}

export interface BulkOutcome {
  done: string[];
  failed: { identifier: string; error: string }[];
}

function distinctCards(rows: readonly BulkTarget[]): BulkTarget[] {
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.cardId) && seen.add(r.cardId));
}

async function runPerCard(
  rows: readonly BulkTarget[],
  step: (row: BulkTarget) => Promise<void>,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { done: [], failed: [] };
  for (const row of distinctCards(rows)) {
    try {
      await step(row);
      outcome.done.push(row.identifier);
    } catch (err: unknown) {
      outcome.failed.push({
        identifier: row.identifier,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcome;
}

/** Clean up each selected card once, in order; a failure is recorded and the rest still run. */
export function runBulkCleanup(
  api: Pick<ActionApi, "cleanupCard">,
  rows: readonly BulkTarget[],
): Promise<BulkOutcome> {
  return runPerCard(rows, (row) => api.cleanupCard(row.cardId, false));
}

/**
 * Switch each selected card to its row's session when needed, then resume it.
 *
 * @remarks A refused resume switches the card back to the session that was active before, so a
 * failed resume never leaves the card pointed at a dead session; failures are recorded per card.
 */
export function runBulkResume(
  api: Pick<ActionApi, "switchSession" | "resumeCard">,
  rows: readonly BulkTarget[],
): Promise<BulkOutcome> {
  return runPerCard(rows, async (row) => {
    const switched = row.active !== true;
    if (switched) await api.switchSession(row.cardId, row.sessionId);
    const result = await api.resumeCard(row.cardId);
    if (result.ok) return;
    const restore = row.restoreSessionId;
    if (switched && restore != null && restore !== row.sessionId) {
      await api.switchSession(row.cardId, restore).catch(() => undefined);
    }
    throw new Error(`resume refused (${result.status ?? "network"})`);
  });
}

/** One line of toast copy for a bulk outcome. */
export function bulkOutcomeCopy(verb: string, outcome: BulkOutcome): string {
  const total = outcome.done.length + outcome.failed.length;
  const head = `${verb} ${outcome.done.length} of ${total}`;
  if (outcome.failed.length === 0) return head;
  return `${head}. Failed: ${outcome.failed.map((f) => `${f.identifier} (${f.error})`).join(", ")}`;
}

/**
 * Poll every enabled source now and say which ones were asked.
 *
 * @remarks With no enabled source nothing is posted; a refused source is named in the notice
 * instead of failing the rest.
 */
export async function syncSources(
  api: Pick<ActionApi, "pollSource">,
  enabled: readonly string[],
  notice: (text: string) => void,
): Promise<void> {
  if (enabled.length === 0) {
    notice("No source is enabled");
    return;
  }
  notice(`Syncing ${enabled.join(", ")}`);
  const results = await Promise.allSettled(
    enabled.map((id) => api.pollSource(id)),
  );
  const refused = enabled.filter((_, i) => results[i]?.status === "rejected");
  if (refused.length > 0) notice(`Sync refused: ${refused.join(", ")}`);
}
