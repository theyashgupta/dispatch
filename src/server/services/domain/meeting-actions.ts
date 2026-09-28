import { createHash } from "node:crypto";
import type { Item } from "../../../shared/types.js";
import { ITEM_DESCRIPTION_MAX, ITEM_TITLE_MAX } from "../../store/items.js";
import { hasDispatchMarker, slugify } from "./playbooks.js";

export type MeetingFeed = "paste" | "granola";

export interface ActionDraft {
  key: string;
  title: string;
  description: string;
  meeting?: string;
  date?: string;
  link?: string;
}

const ACTION_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ACTION_KEY_MAX = 48;
export const MAX_ACTION_ITEMS = 15;

const SECTION_HEADER = "## Action item";
const NO_ACTION_ITEMS = "NO_ACTION_ITEMS";
const SLUG_MAX = 32;
const NAME_HASH_LENGTH = 7;
const SIBLINGS_MAX = 14;
const MEETING_PRIORITY = 76;
const FIELD_RE = /^(key|title|meeting|date|link):\s*(.*)$/i;
const FENCE_RE = /^`{3,}[\w-]*$/;

/**
 * Build the paste-flow prompt that asks for the user's own action items as delimited sections.
 */
export function buildPastePrompt(
  meeting: string,
  notes: string,
  me?: string,
): string {
  const identity =
    me !== undefined && me.trim() !== ""
      ? `The user appears in these notes as: ${me.trim()}.`
      : "The user is the person who took these notes. Treat first-person lines (I, me, my) and unassigned follow-ups as the user's.";
  return [
    "You are extracting action items from meeting notes for Dispatch, a local task board.",
    "List only the action items that belong to the user: commitments the user made, questions directed at the user, and decisions the user must act on. Skip items owned by other people.",
    identity,
    "",
    "Output rules (follow exactly):",
    "- Output only repeated sections, at most 15, with no preamble, no closing remarks and no code fence.",
    `- Each section starts with the literal line: ${SECTION_HEADER}`,
    "- Then the line key: <a short kebab-case slug of the action's subject, lowercase letters, digits and hyphens only, at most 48 characters>",
    "- Then the line title: <one plain-text line under 120 characters that starts with a verb>",
    `- Then a blank line and a markdown description that names the meeting "${meeting}" and quotes the relevant lines from the notes as a blockquote.`,
    `- If the notes hold no action item for the user, output exactly: ${NO_ACTION_ITEMS}`,
    '- Never emit the literal text "DISPATCH_STATUS:" anywhere in your output.',
    "",
    `Meeting: ${meeting}`,
    "Notes:",
    notes,
  ].join("\n");
}

/**
 * True for a kebab-case action key of at most 48 characters.
 */
export function isActionKey(key: string): boolean {
  return ACTION_KEY_RE.test(key) && key.length <= ACTION_KEY_MAX;
}

/**
 * Parse one section body into a draft, or null when any rule rejects it.
 */
function parseSection(body: string): ActionDraft | null {
  const lines = body.split("\n");
  const fields: Record<string, string> = {};
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") index += 1;
  while (index < lines.length) {
    const match = FIELD_RE.exec(lines[index].trim());
    if (match === null) break;
    fields[match[1].toLowerCase()] = match[2].trim();
    index += 1;
  }
  const description = lines
    .slice(index)
    .join("\n")
    .trim()
    .slice(0, ITEM_DESCRIPTION_MAX);
  const key = fields.key ?? "";
  const title = fields.title ?? "";
  if (!isActionKey(key)) return null;
  if (title === "" || title.length > ITEM_TITLE_MAX) return null;
  if (description === "") return null;
  const draft: ActionDraft = { key, title, description };
  for (const name of ["meeting", "date", "link"] as const) {
    if (fields[name] !== undefined && fields[name] !== "") {
      draft[name] = fields[name];
    }
  }
  const texts = [
    draft.title,
    draft.description,
    draft.meeting,
    draft.date,
    draft.link,
  ];
  if (texts.some((t) => t !== undefined && hasDispatchMarker(t))) return null;
  return draft;
}

/**
 * Parse model output into action drafts.
 *
 * @remarks Invalid sections are dropped rather than failing the whole run, so one malformed item
 * never costs the user the rest; the run fails only when nothing valid is left. A duplicate is the
 * same key in the same meeting on the same date, so a recurring meeting keeps both weeks' items. A section carrying
 * the status marker is dropped here, and the create route refuses it again at accept time.
 */
export function parseActionItems(
  stdout: string,
  { max = MAX_ACTION_ITEMS }: { max?: number } = {},
): ActionDraft[] {
  const lines = stdout.replace(/\r\n/g, "\n").split("\n");
  const unfenced = lines.filter((line) => !FENCE_RE.test(line.trim()));
  if (unfenced.join("\n").trim() === NO_ACTION_ITEMS) return [];
  const bodies: string[][] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase() === SECTION_HEADER.toLowerCase()) bodies.push([]);
    else if (FENCE_RE.test(trimmed)) continue;
    else if (bodies.length > 0) bodies[bodies.length - 1].push(line);
  }
  if (bodies.length === 0) {
    throw new Error("no action item sections in the output");
  }
  const drafts: ActionDraft[] = [];
  const seen = new Set<string>();
  for (const body of bodies) {
    const draft = parseSection(body.join("\n"));
    if (draft === null) continue;
    const meeting = draft.meeting?.trim().toLowerCase() ?? "";
    const identity = `${meeting}\n${draft.date ?? ""}\n${draft.key}`;
    if (seen.has(identity)) continue;
    seen.add(identity);
    drafts.push(draft);
  }
  if (drafts.length === 0) {
    throw new Error("every action item section was invalid");
  }
  return drafts.slice(0, max);
}

/**
 * Slug of a meeting name for ids: a readable prefix plus a short hash of the full name.
 *
 * @remarks The hash keeps two meetings distinct when their slugs match, such as names with no
 * ASCII letters (all slugify to "meeting") or names sharing a long prefix.
 */
export function meetingSlug(name: string): string {
  const prefix = slugify(name, "meeting").slice(0, SLUG_MAX).replace(/-+$/, "");
  const hash = createHash("sha1")
    .update(name.trim().toLowerCase())
    .digest("hex")
    .slice(0, NAME_HASH_LENGTH);
  return `${prefix}-${hash}`;
}

/**
 * The per-meeting id shared by every action item of that meeting on that day.
 */
export function meetingId(
  feed: MeetingFeed,
  meetingDate: string,
  meeting: string,
): string {
  return `${feed}:${meetingDate}-${meetingSlug(meeting)}`;
}

/**
 * Local calendar date of `date` as YYYY-MM-DD.
 */
export function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The link as an item url when it is an https URL, else undefined.
 *
 * @remarks The link comes from model output, so anything but a plain https URL (javascript:, http:,
 * a bare word, or credentials that disguise the real host) never reaches a clickable Source line.
 */
function httpsUrl(link: string | undefined): string | undefined {
  if (link === undefined) return undefined;
  try {
    const url = new URL(link);
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === ""
      ? link
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Turn one meeting's drafts into meeting items, each listing its siblings.
 *
 * @remarks The meeting date is part of the id, so a recurring meeting's repeated action becomes a
 * new item each time instead of landing on last week's row, which may already be done.
 */
export function buildMeetingItems(input: {
  feed: MeetingFeed;
  meeting: string;
  meetingDate: string;
  drafts: readonly ActionDraft[];
  now: string;
}): Item[] {
  const id = meetingId(input.feed, input.meetingDate, input.meeting);
  return input.drafts.map((draft) => {
    const siblings = input.drafts
      .filter((other) => other.key !== draft.key)
      .map((other) => other.title)
      .slice(0, SIBLINGS_MAX);
    const snippet =
      `From ${input.meeting} on ${input.meetingDate}.\n\n${draft.description}`.slice(
        0,
        ITEM_DESCRIPTION_MAX,
      );
    const url = httpsUrl(draft.link);
    return {
      id: `meeting:${id}:${draft.key}`,
      source: "meeting",
      type: "action_item",
      title: draft.title.slice(0, ITEM_TITLE_MAX),
      snippet,
      ...(url !== undefined ? { url } : {}),
      createdAt: input.now,
      priority: MEETING_PRIORITY,
      state: "unread",
      meta: {
        feed: input.feed,
        meeting: input.meeting,
        meetingDate: input.meetingDate,
        meetingId: id,
        key: draft.key,
        siblings: JSON.stringify(siblings),
      },
    };
  });
}
