import type { Item, SlackThread } from "../../shared/types.js";
import { fenceUntrusted, inlineUntrusted } from "../../shared/untrusted.js";

const MESSAGE_MAX = 3000;

const THREAD_MAX = 6000;

function placeOf(item: Item): string {
  if (item.meta.conversation === "im") return "a DM";
  if (item.meta.conversation === "mpim") return "a group DM";
  return `#${inlineUntrusted(item.meta.channelName ?? "")}`;
}

/**
 * The Start dialog text for a Slack draft reply: the ask, the no-post rule, the message and the thread.
 *
 * @remarks The message and the thread are fenced and the names outside the fences are flattened, so
 * no Slack text can close a fence or start a live status line. `thread` undefined means no thread
 * was asked for; null means the load failed and the prompt says so.
 */
export function draftReplyPrompt(
  item: Item,
  thread?: SlackThread | null,
): string {
  const author = inlineUntrusted(item.meta.author ?? "") || "someone";
  const lines = [
    `Draft a reply to this Slack message from ${author} in ${placeOf(item)} (${inlineUntrusted(item.url ?? "")}).`,
    "Write the reply in my voice: plain, direct and short. Print only the reply text here.",
    "Do not post, reply, react or send anything to Slack or anywhere else.",
    `Channel: #${inlineUntrusted(item.meta.channelName ?? "")}`,
    "Message:",
    fenceUntrusted(item.snippet, MESSAGE_MAX),
  ];
  if (thread === null) {
    lines.push("The thread could not be loaded.");
  } else if (thread !== undefined) {
    lines.push(
      "Thread (oldest first):",
      fenceUntrusted(
        thread.messages
          .map((m) => `${m.author} (${m.time}): ${m.text}`)
          .join("\n"),
        THREAD_MAX,
      ),
    );
  }
  return lines.join("\n");
}
