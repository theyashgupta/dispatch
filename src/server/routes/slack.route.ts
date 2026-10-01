import { Router } from "express";
import { z } from "zod";
import { isProviderCode } from "../../shared/credential.js";
import type { SlackChannel } from "../../shared/types.js";
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
} from "../services/orchestration/slack.js";
import {
  getOrchestrationConfig,
  setSlackChannels,
} from "../services/infra/config-holder.js";
import {
  HttpError,
  InternalError,
  UpstreamError,
} from "../services/domain/errors.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

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

/** Build the typed error for a refusal from the Slack domain service, with its status and error kind. */
function refusalError<E extends string>(
  refusal: { error: E; code?: string },
  statuses: Record<E, number>,
): HttpError {
  return new HttpError(
    statuses[refusal.error],
    refusal.error,
    isProviderCode(refusal.code) ? { providerError: refusal.code } : undefined,
  );
}

/** Run a Slack call, turning any transport failure or rate limit into a 502 unreachable. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch {
    throw new UpstreamError("unreachable");
  }
}

const resolveBodySchema = z.object(
  {
    input: z
      .string("not-a-channel")
      .refine((input) => input.length <= 500, "not-a-channel"),
  },
  "not-a-channel",
);

const saveBodySchema = z.object(
  {
    channels: z
      .array(z.unknown(), "invalid-channels")
      .refine(
        (channels) => channels.length <= SLACK_CHANNEL_MAX,
        "invalid-channels",
      )
      .refine(
        (channels): channels is SlackChannel[] =>
          channels.every(isSlackChannel),
        "invalid-channels",
      ),
  },
  "invalid-channels",
);

slackRouter.get("/slack/channels", async (_req, res) => {
  const result = await guarded(slackChannelOptions);
  if ("error" in result) throw refusalError(result, REFUSAL_STATUS);
  res.status(200).json(result);
});

slackRouter.post("/slack/channels/resolve", async (req, res) => {
  const { input } = parseOrThrow(resolveBodySchema, req.body);
  const result = await guarded(() => resolveSlackChannel(input));
  if ("error" in result) throw refusalError(result, REFUSAL_STATUS);
  res.status(200).json(result);
});

slackRouter.get("/sources/slack/channels", (_req, res) => {
  res.status(200).json({
    channels: getOrchestrationConfig()?.sources?.slack?.channels ?? [],
  });
});

slackRouter.put("/sources/slack/channels", (req, res) => {
  const { channels } = parseOrThrow(saveBodySchema, req.body);
  const clean = normalizeSlackChannels(channels);
  try {
    setSlackChannels(clean);
  } catch {
    throw new InternalError("save-failed");
  }
  pollNow("slack");
  res.status(200).json({ channels: clean });
});

slackRouter.get("/slack/thread/:itemId", async (req, res) => {
  const result = await guarded(() => slackThread(req.params.itemId));
  if ("error" in result) throw refusalError(result, THREAD_STATUS);
  res.status(200).json(result);
});

slackRouter.use(httpErrorHandler);
