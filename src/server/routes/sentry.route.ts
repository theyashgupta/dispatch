import { Router, type Response } from "express";
import {
  SentryAuthError,
  SentryRequestError,
  SourceRateLimited,
} from "../adapters/source-gateway.js";
import {
  getSentryIssue,
  resolveSentryIssueItem,
  SentryItemUnknown,
  SentryNotConnected,
} from "../services/domain/sentry.js";
import { store } from "../store/board.store.js";

/**
 * Sentry issue detail and resolve for the Errors page.
 *
 * @remarks The issue id is validated and its item looked up before any Sentry call, and a resolve
 * marks the item done only after Sentry answers success. Errors answer an error kind only, never
 * the token or a raw provider body.
 */
export const sentryRouter = Router();

const ISSUE_ID = /^[1-9][0-9]{0,19}$/;

/** The issue id segment, or null after answering 400 when it is not digits only. */
function issueId(params: Record<string, string>, res: Response): string | null {
  const id = params.id ?? "";
  if (!ISSUE_ID.test(id)) {
    res.status(400).json({ error: "invalid issue" });
    return null;
  }
  return id;
}

/** Map a Sentry failure to its status and error kind. */
function sendSentryError(res: Response, err: unknown): void {
  if (err instanceof SentryItemUnknown) {
    res.status(404).json({ error: "unknown item" });
  } else if (err instanceof SentryNotConnected) {
    res.status(401).json({ error: "no-credential" });
  } else if (err instanceof SentryAuthError) {
    res.status(401).json({ error: "rejected" });
  } else if (err instanceof SentryRequestError && err.status === 403) {
    res.status(403).json({ error: "forbidden" });
  } else if (err instanceof SourceRateLimited) {
    res.status(429).json({ error: "rate-limited" });
  } else if (err instanceof SentryRequestError && err.status === 404) {
    res.status(404).json({ error: "not-found" });
  } else {
    res.status(502).json({ error: "unreachable" });
  }
}

sentryRouter.get("/sentry/issue/:id", async (req, res) => {
  const id = issueId(req.params, res);
  if (!id) return;
  try {
    res.status(200).json(await getSentryIssue(id));
  } catch (err) {
    sendSentryError(res, err);
  }
});

sentryRouter.post("/sentry/issue/:id/resolve", async (req, res) => {
  const id = issueId(req.params, res);
  if (!id) return;
  let itemId: string;
  try {
    itemId = await resolveSentryIssueItem(id);
  } catch (err) {
    sendSentryError(res, err);
    return;
  }
  await store.setItemState(itemId, "done");
  res.status(204).end();
});
