import { boardLink } from "../../../../shared/board-key.js";

export type BoardIntent =
  | { kind: "create"; name: string }
  | { kind: "needs-name" }
  | { kind: "cancel" };

export const NAME_QUESTION = "What should the board be called?";
export const CANCELLED = "Cancelled.";

const NEEDS_NAME =
  /^(?:(?:create|make|add)\s+(?:me\s+)?(?:an?\s+)?(?:new\s+)?board(?:\s+for\s+me)?|new\s+board)$/i;
const CREATE =
  /^(?:(?:create|make|add)\s+(?:an?\s+)?(?:new\s+)?board\s+(?:called|named)|new\s+board(?:\s+(?:called|named))?)\s+(?!(?:called|named)$)(.+)$/i;
const CANCEL = /^(?:cancel|never\s?mind|stop)$/i;
const QUOTED = /^(["'“‘])(.*)(["'”’])$/;

function unquote(name: string): string {
  const quoted = QUOTED.exec(name);
  return quoted?.[2] === undefined ? name : quoted[2].trim();
}

/**
 * Read a chat message as a board request, or null when it is an ordinary message.
 *
 * @remarks
 * The match is anchored to the whole message, so a question such as "how do I create a board?" and
 * a request for another thing such as "create a ticket called X" fall through to the server.
 */
export function parseBoardIntent(text: string): BoardIntent | null {
  if (/\?\s*$/.test(text)) return null;
  const message = text
    .trim()
    .replace(/^please[,\s]+/i, "")
    .replace(/[.!\s]+$/, "")
    .replace(/[,\s]+please$/i, "")
    .replace(/[.!\s]+$/, "");
  if (CANCEL.test(message)) return { kind: "cancel" };
  if (NEEDS_NAME.test(message)) return { kind: "needs-name" };
  const name = unquote(CREATE.exec(message)?.[1]?.trim() ?? "");
  return name === "" ? null : { kind: "create", name };
}

/**
 * Pick the board intent of a message, given whether the last answer asked for a name.
 *
 * @remarks
 * While a name is awaited, a cancel, a create request or a needs-name message keeps its own meaning,
 * a message that ends with a question mark is an ordinary question, and any other text is the name.
 * Without a pending question a cancel is an ordinary message.
 */
export function resolveBoardIntent(
  text: string,
  awaitingName: boolean,
): BoardIntent | null {
  const intent = parseBoardIntent(text);
  if (!awaitingName) return intent?.kind === "cancel" ? null : intent;
  if (/\?\s*$/.test(text)) return null;
  if (intent !== null) return intent;
  const name = unquote(text.trim());
  return name === "" ? null : { kind: "create", name };
}

function escapeMarkdown(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\\`*_[\]<>~|:.@&!()#-]/g, "\\$&");
}

/**
 * Wrap a board name in an inline code span on one line.
 *
 * @remarks GFM links a bare URL after escapes are resolved, so escaping cannot stop a name such as
 * "https://evil.test" from becoming a link; a code span is never linked or styled.
 */
function codeSpan(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const longest = Math.max(
    0,
    ...(flat.match(/`+/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
  return `${fence}${pad}${flat}${pad}${fence}`;
}

export function createdAnswer(name: string, key: string): string {
  const safe = codeSpan(name);
  return `Created board ${safe} with key ${key}. [Open ${safe}](#${boardLink(key)})`;
}

export function refusedAnswer(error: string): string {
  return `Could not create the board: ${escapeMarkdown(error)}`;
}
