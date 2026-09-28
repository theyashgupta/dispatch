import { Router, type Response } from "express";
import {
  clearLinearApiKey,
  getOrchestrationConfig,
  updateLinearApiKey,
} from "../services/infra/config-holder.js";
import { checkSourceKey, rebuildSources } from "../adapters/source-gateway.js";
import { startEnabledPollers } from "../adapters/poller.js";
import type { ItemSourceId, SourceConnection } from "../../shared/types.js";
import { TOKEN_SHAPE } from "../../shared/credential.js";
import {
  connectTokenSource,
  disableTokenSource,
  disconnectTokenSource,
  saveTokenSourceKey,
  tokenConnection,
  TOKEN_SOURCES,
  type TokenFailure,
  type TokenSourceDef,
} from "../services/domain/token-connection.js";

/**
 * Source connection surface: status with the account behind the stored key, replace key, disable, disconnect.
 *
 * @remarks Replace is test-before-persist, so a rejected or unreachable key never reaches disk, and
 * a disconnect that lands while a replace is still checking its key wins. Linear keeps its key in
 * config.json while the token sources (GitHub, Sentry) use the Vault, GitHub also the gh login. A key
 * is never echoed, logged or placed in an error body.
 */
export const connectionRouter = Router();

const keyGenerations = new Map<string, number>();

const generationOf = (source: string): number =>
  keyGenerations.get(source) ?? 0;

/** Answers 404 and returns true for any source that stores no credential. */
function refuseUnknown(source: string, res: Response): boolean {
  if (source === "linear" || tokenSource(source)) return false;
  res.status(404).json({ error: "unknown source" });
  return true;
}

function tokenSource(source: string): TokenSourceDef | undefined {
  return Object.hasOwn(TOKEN_SOURCES, source)
    ? TOKEN_SOURCES[source as ItemSourceId]
    : undefined;
}

/** Answer a token-source failure with its status and error kind, never the token. */
function sendFailure(res: Response, failure: TokenFailure): void {
  const status = {
    rejected: 400,
    "no-credential": 400,
    unreachable: 502,
    "sso-required": 403,
    superseded: 409,
    failed: 500,
  }[failure.error];
  if (failure.error === "failed") {
    res.status(status).json({ error: "save-failed" });
    return;
  }
  res.status(status).json(failure);
}

function reloadSources(): void {
  const config = getOrchestrationConfig();
  if (config) rebuildSources(config);
  startEnabledPollers();
}

connectionRouter.get("/sources/:source/connection", async (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  const def = tokenSource(source);
  if (def) {
    res.status(200).json(await tokenConnection(def));
    return;
  }
  const key = getOrchestrationConfig()?.linearApiKey ?? "";
  let body: SourceConnection = { configured: false, connected: false };
  if (key !== "") {
    try {
      const viewer = await checkSourceKey(source, key);
      body = viewer
        ? { configured: true, connected: true, ...viewer }
        : { configured: true, connected: false, error: "rejected" };
    } catch {
      body = { configured: true, connected: false, error: "unreachable" };
    }
  }
  res.status(200).json(body);
});

connectionRouter.put("/sources/:source/key", async (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  const apiKey = (req.body as { apiKey?: unknown } | undefined)?.apiKey;
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }
  const key = apiKey.trim();
  if (!TOKEN_SHAPE.test(key)) {
    res.status(400).json({ error: "rejected" });
    return;
  }
  const generation = generationOf(source);
  const def = tokenSource(source);
  if (def) {
    const saved = await saveTokenSourceKey(
      def,
      key,
      () => generation === generationOf(source),
    );
    if (!saved.ok) {
      sendFailure(res, saved.failure);
      return;
    }
    reloadSources();
    res
      .status(200)
      .json(
        saved.account
          ? { account: saved.account, via: "vault" }
          : { via: "vault" },
      );
    return;
  }
  let viewer: { account?: string } | null;
  try {
    viewer = await checkSourceKey(source, key);
  } catch {
    res.status(502).json({ error: "unreachable" });
    return;
  }
  if (!viewer) {
    res.status(400).json({ error: "rejected" });
    return;
  }
  if (generation !== generationOf(source)) {
    res.status(409).json({ error: "superseded" });
    return;
  }
  try {
    updateLinearApiKey(key);
  } catch {
    res.status(500).json({ error: "save-failed" });
    return;
  }
  reloadSources();
  res.status(200).json(viewer);
});

connectionRouter.delete("/sources/:source/key", async (req, res) => {
  const { source } = req.params;
  if (refuseUnknown(source, res)) return;
  const def = tokenSource(source);
  if (def) {
    keyGenerations.set(source, generationOf(source) + 1);
    if (!(await disconnectTokenSource(def))) {
      res.status(500).json({ error: "save-failed" });
      return;
    }
  } else {
    try {
      clearLinearApiKey();
    } catch {
      res.status(500).json({ error: "save-failed" });
      return;
    }
    keyGenerations.set(source, generationOf(source) + 1);
  }
  reloadSources();
  res.status(204).end();
});

connectionRouter.post("/sources/:source/connect", async (req, res) => {
  const def = tokenSource(req.params.source);
  if (!def) {
    res.status(404).json({ error: "unknown source" });
    return;
  }
  const generation = generationOf(req.params.source);
  const connected = await connectTokenSource(
    def,
    () => generation === generationOf(req.params.source),
  );
  if (!connected.ok) {
    sendFailure(res, connected.failure);
    return;
  }
  reloadSources();
  res
    .status(200)
    .json(
      connected.account
        ? { account: connected.account, via: connected.via }
        : { via: connected.via },
    );
});

connectionRouter.post("/sources/:source/disable", (req, res) => {
  const { source } = req.params;
  const def = tokenSource(source);
  if (!def) {
    res.status(404).json({ error: "unknown source" });
    return;
  }
  if (!disableTokenSource(def)) {
    res.status(500).json({ error: "save-failed" });
    return;
  }
  keyGenerations.set(source, generationOf(source) + 1);
  reloadSources();
  res.status(204).end();
});
