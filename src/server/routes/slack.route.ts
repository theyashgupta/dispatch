import { Router, type Response } from "express";
import { isProviderCode } from "../../shared/credential.js";
import { pollNow } from "../adapters/poller.js";
import {
  isSlackChannel,
  normalizeSlackChannels,
  SLACK_CHANNEL_MAX,
} from "../adapters/source-gateway.js";
import {
  resolveSlackChannel,
  slackChannelOptions,
  slackThread,
  type SlackRefusal,
  type SlackThreadRefusal,
} from "../services/domain/slack.js";
import {
  getOrchestrationConfig,
  setSlackChannels,
} from "../services/infra/config-holder.js";

/**
 * Slack routes: list the channels to pick, resolve a pasted link, save the picked list, load a thread.
 *
 * @remarks Listing and resolving talk to Slack only while the Slack switch is on, and a save polls
 * Slack at once when the source is running. Errors answer an error kind and, for Slack's own
 * refusals, Slack's error code; never the token or a raw body.
 */
export const slackRouter = Router();

const REFUSAL_STATUS: Record<SlackRefusal["error"], number> = {
  "not-a-channel": 400,
  rejected: 400,
  "missing-scope": 403,
  disabled: 409,
  "no-credential": 409,
  unreachable: 502,
};

const THREAD_STATUS: Record<SlackThreadRefusal["error"], number> = {
  "not-found": 404,
  disabled: 409,
  "no-credential": 409,
  rejected: 401,
  "rate-limited": 429,
  unreachable: 502,
};

/** Answer a refusal from the Slack domain service with its status and error kind. */
function sendRefusal<E extends string>(
  res: Response,
  refusal: { error: E; code?: string },
  statuses: Record<E, number>,
): void {
  res.status(statuses[refusal.error]).json({
    error: refusal.error,
    ...(isProviderCode(refusal.code) ? { providerError: refusal.code } : {}),
  });
}

/** Run a Slack call, answering 502 unreachable for any transport failure or rate limit. */
async function guarded(res: Response, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    res.status(502).json({ error: "unreachable" });
  }
}

slackRouter.get("/slack/channels", (_req, res) =>
  guarded(res, async () => {
    const result = await slackChannelOptions();
    if ("error" in result) sendRefusal(res, result, REFUSAL_STATUS);
    else res.status(200).json(result);
  }),
);

slackRouter.post("/slack/channels/resolve", (req, res) => {
  const input = (req.body as { input?: unknown } | undefined)?.input;
  if (typeof input !== "string" || input.length > 500) {
    res.status(400).json({ error: "not-a-channel" });
    return;
  }
  return guarded(res, async () => {
    const result = await resolveSlackChannel(input);
    if ("error" in result) sendRefusal(res, result, REFUSAL_STATUS);
    else res.status(200).json(result);
  });
});

slackRouter.get("/sources/slack/channels", (_req, res) => {
  res.status(200).json({
    channels: getOrchestrationConfig()?.sources?.slack?.channels ?? [],
  });
});

slackRouter.put("/sources/slack/channels", (req, res) => {
  const channels = (req.body as { channels?: unknown } | undefined)?.channels;
  if (
    !Array.isArray(channels) ||
    channels.length > SLACK_CHANNEL_MAX ||
    !channels.every(isSlackChannel)
  ) {
    res.status(400).json({ error: "invalid-channels" });
    return;
  }
  const clean = normalizeSlackChannels(channels);
  try {
    setSlackChannels(clean);
  } catch {
    res.status(500).json({ error: "save-failed" });
    return;
  }
  pollNow("slack");
  res.status(200).json({ channels: clean });
});

slackRouter.get("/slack/thread/:itemId", (req, res) =>
  guarded(res, async () => {
    const result = await slackThread(req.params.itemId);
    if ("error" in result) sendRefusal(res, result, THREAD_STATUS);
    else res.status(200).json(result);
  }),
);
