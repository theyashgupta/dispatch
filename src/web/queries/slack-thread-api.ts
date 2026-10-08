import type { SlackThread } from "../../shared/types.js";
import { isProviderCode } from "../../shared/credential.js";
import { http, payload } from "@/lib/http";

/**
 * Load a Slack item's thread: GET /api/slack/thread/:itemId.
 *
 * @remarks
 * A rejected token carries Slack's code for the "Slack refused" line; every other failure,
 * including a network error or no answer within 120 s, reads as unreachable.
 */
export async function getSlackThread(
  itemId: string,
): Promise<
  | { ok: true; thread: SlackThread }
  | { ok: false; reason: "rejected" | "unreachable"; providerError?: string }
> {
  try {
    const result = await http<unknown>(
      `/api/slack/thread/${encodeURIComponent(itemId)}`,
      { signal: AbortSignal.timeout(120_000) },
    );
    const body = (payload(result) ?? {}) as Partial<SlackThread> & {
      error?: unknown;
      providerError?: unknown;
    };
    if (result.ok && Array.isArray(body.messages)) {
      return {
        ok: true,
        thread: { messages: body.messages, truncated: body.truncated === true },
      };
    }
    if (body.error === "rejected") {
      return {
        ok: false,
        reason: "rejected",
        ...(isProviderCode(body.providerError)
          ? { providerError: body.providerError }
          : {}),
      };
    }
    return { ok: false, reason: "unreachable" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
