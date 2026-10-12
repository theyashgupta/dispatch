const ACK_STARTS = [
  "thanks",
  "thank you",
  "ty",
  "ok",
  "okay",
  "got it",
  "sounds good",
  "lgtm",
  "nice",
  "great",
  "cool",
  "noted",
  "done",
];

const GREETING_STARTS = ["hi", "hello", "hey", "good morning", "gm"];

const BROADCAST_STARTS = ["fyi", "heads up", "psa", "announcement"];

const DIGEST_WORDS = ["digest", "daily summary", "weekly summary"];

const REQUEST_PHRASES = [
  "can you",
  "could you",
  "would you",
  "please",
  "pls",
  "need you to",
  "can someone",
];

const ACTION_VERBS = new Set([
  "check",
  "review",
  "fix",
  "look",
  "investigate",
  "deploy",
  "update",
  "merge",
  "approve",
  "test",
  "debug",
  "run",
  "add",
  "remove",
]);

const MAX_SHORT_WORDS = 6;

const USER_MENTION = /<@[^<>|]+(?:\|[^<>]*)?>/g;
const BROADCAST_TOKEN_SOURCE = "<!(?:channel|here|everyone)(?:\\|[^<>]*)?>";
const BROADCAST_TOKEN = new RegExp(BROADCAST_TOKEN_SOURCE);
const SHORTCODE = /:[a-z0-9_+-]+:/gi;
const UNICODE_EMOJI =
  /\p{Extended_Pictographic}|\p{Emoji_Modifier}|\u200D|\uFE0F/gu;
const ONLY_FILLER = /^[\s\p{P}\p{S}]*$/u;
const TRAILING_PUNCTUATION_CHAR = /[\s\p{P}]/u;
const LINK_TOKEN = /<[^<>]*>/g;
const MAX_TEXT_LENGTH = 4000;
const BULLET_LINE = /^(?:[-*•◦▪‣·]|\d+\.)\s/;

const WORD_END = "(?![\\p{L}\\p{N}])";

const leadingWord = (words: readonly string[]): RegExp =>
  new RegExp(`^(?:${words.join("|")})${WORD_END}`, "u");

const containedWord = (words: readonly string[]): RegExp =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.join("|")})${WORD_END}`, "u");

const ACK_START = leadingWord(ACK_STARTS);
const GREETING_START = leadingWord(GREETING_STARTS);
const BROADCAST_START = leadingWord(BROADCAST_STARTS);
const DIGEST_WORD = containedWord(DIGEST_WORDS);
const REQUEST_PATTERNS = REQUEST_PHRASES.map((phrase) => ({
  phrase,
  pattern: containedWord([phrase]),
}));

const LEADING_OPENER = new RegExp(
  `^(?:(?:${BROADCAST_TOKEN_SOURCE}|(?:${[...ACK_STARTS, ...GREETING_STARTS, ...BROADCAST_STARTS].join("|")})${WORD_END})[\\s\\p{P}]*)+`,
  "u",
);

/**
 * Return the request phrase or leading action verb in the text, lowercase, or undefined.
 *
 * @remarks Leading acknowledgement, greeting and broadcast tokens or words are skipped before the verb check so "hey look" and "<!here> deploy it" are still requests.
 */
const requestMatch = (text: string): string | undefined => {
  const spaced = text.toLowerCase().replace(/\s+/g, " ").trim();
  const phrase = REQUEST_PATTERNS.find(({ pattern }) => pattern.test(spaced));
  if (phrase) return phrase.phrase;
  const firstWord = spaced
    .replace(LEADING_OPENER, "")
    .split(" ")[0]
    ?.replace(/[^\p{L}]/gu, "");
  return firstWord && ACTION_VERBS.has(firstWord) ? firstWord : undefined;
};

/**
 * Remove trailing whitespace and punctuation in one linear pass.
 *
 * @remarks A `[\s\p{P}]+$` regex is quadratic on a long punctuation run that ends in a letter.
 */
const trimTrailingPunctuation = (text: string): string => {
  let end = text.length;
  while (end > 0 && TRAILING_PUNCTUATION_CHAR.test(text[end - 1])) end -= 1;
  return text.slice(0, end);
};

const wordCount = (text: string): number => text.split(/\s+/).length;

/**
 * Decide from a Slack message's raw markup whether it needs a session, with a one-line reason.
 *
 * @remarks Rules are ordered and the first match wins. There is no model pass (R-11).
 */
export function slackRelevance(input: {
  text: string;
  subtype?: string | undefined;
  botId?: string | undefined;
}): { needsSession: boolean; reason: string } {
  const noise = (reason: string) => ({ needsSession: false, reason });
  const { subtype, botId } = input;
  const text = input.text.slice(0, MAX_TEXT_LENGTH);

  if (botId || subtype?.startsWith("bot")) return noise("Bot or app message");

  const withoutMentions = text.replace(USER_MENTION, " ");
  const withoutEmoji = withoutMentions
    .replace(SHORTCODE, " ")
    .replace(UNICODE_EMOJI, " ");
  if (ONLY_FILLER.test(withoutEmoji)) return noise("Reaction or emoji only");

  const hasQuestion = text.replace(LINK_TOKEN, " ").includes("?");
  const request = requestMatch(withoutEmoji);
  const normalized = trimTrailingPunctuation(
    withoutEmoji.toLowerCase().replace(/\s+/g, " ").trim(),
  );
  const isShort = wordCount(normalized) <= MAX_SHORT_WORDS;

  const quiet = isShort && !hasQuestion && !request;
  if (quiet && ACK_START.test(normalized)) {
    return noise("Acknowledgement");
  }
  if (quiet && GREETING_START.test(normalized)) {
    return noise("Greeting");
  }
  if (
    !hasQuestion &&
    !request &&
    (BROADCAST_START.test(normalized) || BROADCAST_TOKEN.test(text))
  ) {
    return noise("FYI or broadcast");
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => BULLET_LINE.test(line)).length;
  if (
    !hasQuestion &&
    !request &&
    ((lines.length >= 5 && bullets >= 3) || DIGEST_WORD.test(normalized))
  ) {
    return noise("Digest");
  }

  if (hasQuestion) return { needsSession: true, reason: "Direct question" };

  if (request) {
    return {
      needsSession: true,
      reason: `Request with an action verb: ${request}`,
    };
  }
  return noise("No question or request");
}
