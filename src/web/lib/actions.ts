import type { Card, Item } from "../../shared/types.js";
import type * as Api from "./api.js";
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
  "promote" | "snooze" | "done" | "toggleRead" | "open" | "copyLink";

export type ActionApi = Pick<
  typeof Api,
  "promoteItem" | "setItemState" | "snoozeItem" | "moveCard"
>;

export interface ActionContext {
  api: ActionApi;
  showUndo: (label: string, undo: () => Promise<void>) => void;
  notice: (text: string) => void;
  openSnooze: (row: InboxRowModel) => void;
  openUrl: (url: string) => void;
  copyText: (text: string) => Promise<void>;
}

export type ActionServices = Omit<ActionContext, "openSnooze">;

export interface InboxAction {
  id: InboxActionId;
  label: string;
  key?: string;
  appliesTo: (row: InboxRowModel) => boolean;
  run: (ctx: ActionContext, row: InboxRowModel) => Promise<void>;
}

const isItem = (row: InboxRowModel) => row.kind === "item";
const priorState = (row: InboxRowModel) => (row.unread ? "unread" : "read");

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
    run: async (ctx, row) => {
      await ctx.api.setItemState(row.id, "done");
      ctx.showUndo(`${row.title} marked done`, () =>
        ctx.api.setItemState(row.id, priorState(row)),
      );
    },
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
];

/** The actions a row's menu lists, in table order. */
export function actionsFor(row: InboxRowModel): InboxAction[] {
  return INBOX_ACTIONS.filter((a) => a.appliesTo(row));
}

/** Run one action; a refusal or failure becomes a notice instead of an unhandled rejection. */
export function runAction(
  action: InboxAction,
  ctx: ActionContext,
  row: InboxRowModel,
): Promise<void> {
  if (!action.appliesTo(row)) return Promise.resolve();
  return action.run(ctx, row).catch((err: unknown) => {
    ctx.notice(err instanceof Error ? err.message : `${action.label} failed`);
  });
}

/** Snooze an item row to a preset and offer Undo; a refusal becomes a notice. */
export function snoozeRow(
  ctx: ActionContext,
  row: InboxRowModel,
  preset: SnoozePreset,
  now: Date,
): Promise<void> {
  if (row.kind !== "item") return Promise.resolve();
  return Promise.resolve()
    .then(() =>
      ctx.api.snoozeItem(row.id, snoozeUntil(preset, now).toISOString()),
    )
    .then(() =>
      ctx.showUndo(`${row.title} snoozed for ${SNOOZE_LABELS[preset]}`, () =>
        ctx.api.setItemState(row.id, priorState(row)),
      ),
    )
    .catch((err: unknown) => {
      ctx.notice(err instanceof Error ? err.message : "Snooze failed");
    });
}
