import { Router } from "express";
import { z } from "zod";
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
import {
  HttpError,
  InternalError,
  NotFoundError,
  UpstreamError,
  ValidationError,
  ConflictError,
} from "../services/domain/errors.js";
import { httpErrorHandler } from "./error-handler.js";
import { parseOrThrow } from "./parse-input.js";

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

/** Throw 404 for any source that stores no credential; answers the token source, or undefined for Linear. */
function requireSource(source: string): TokenSourceDef | undefined {
  const def = tokenSource(source);
  if (!def && source !== "linear") throw new NotFoundError("unknown source");
  return def;
}

function tokenSource(source: string): TokenSourceDef | undefined {
  return Object.hasOwn(TOKEN_SOURCES, source)
    ? TOKEN_SOURCES[source as ItemSourceId]
    : undefined;
}

const FAILURE_STATUS: Record<TokenFailure["error"], number> = {
  rejected: 400,
  "no-credential": 400,
  unreachable: 502,
  "sso-required": 403,
  superseded: 409,
  failed: 500,
};

/** Build the typed error for a token-source failure, with its status and error kind, never the token. */
function failureError(failure: TokenFailure): HttpError {
  if (failure.error === "failed") return new InternalError("save-failed");
  const { error, ...details } = failure;
  return new HttpError(FAILURE_STATUS[error], error, details);
}

/** The `PUT /sources/:source/key` body; the key comes out trimmed. */
const keyBodySchema = z.object(
  {
    apiKey: z
      .string("apiKey is required")
      .transform((raw) => raw.trim())
      .refine((key) => key !== "", "apiKey is required")
      .refine((key) => TOKEN_SHAPE.test(key), "rejected"),
  },
  "apiKey is required",
);

function reloadSources(): void {
  const config = getOrchestrationConfig();
  if (config) rebuildSources(config);
  startEnabledPollers();
}

connectionRouter.get("/sources/:source/connection", async (req, res) => {
  const def = requireSource(req.params.source);
  if (def) {
    res.status(200).json(await tokenConnection(def));
    return;
  }
  const key = getOrchestrationConfig()?.linearApiKey ?? "";
  let body: SourceConnection = { configured: false, connected: false };
  if (key !== "") {
    try {
      const viewer = await checkSourceKey(req.params.source, key);
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
  const def = requireSource(source);
  const { apiKey: key } = parseOrThrow(keyBodySchema, req.body);
  const generation = generationOf(source);
  if (def) {
    const saved = await saveTokenSourceKey(
      def,
      key,
      () => generation === generationOf(source),
    );
    if (!saved.ok) throw failureError(saved.failure);
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
    throw new UpstreamError("unreachable");
  }
  if (!viewer) throw new ValidationError("rejected");
  if (generation !== generationOf(source))
    throw new ConflictError("superseded");
  try {
    updateLinearApiKey(key);
  } catch {
    throw new InternalError("save-failed");
  }
  reloadSources();
  res.status(200).json(viewer);
});

connectionRouter.delete("/sources/:source/key", async (req, res) => {
  const { source } = req.params;
  const def = requireSource(source);
  if (def) {
    keyGenerations.set(source, generationOf(source) + 1);
    if (!(await disconnectTokenSource(def))) {
      throw new InternalError("save-failed");
    }
  } else {
    try {
      clearLinearApiKey();
    } catch {
      throw new InternalError("save-failed");
    }
    keyGenerations.set(source, generationOf(source) + 1);
  }
  reloadSources();
  res.status(204).end();
});

connectionRouter.post("/sources/:source/connect", async (req, res) => {
  const def = tokenSource(req.params.source);
  if (!def) throw new NotFoundError("unknown source");
  const generation = generationOf(req.params.source);
  const connected = await connectTokenSource(
    def,
    () => generation === generationOf(req.params.source),
  );
  if (!connected.ok) throw failureError(connected.failure);
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
  if (!def) throw new NotFoundError("unknown source");
  if (!disableTokenSource(def)) throw new InternalError("save-failed");
  keyGenerations.set(source, generationOf(source) + 1);
  reloadSources();
  res.status(204).end();
});

connectionRouter.use(httpErrorHandler);
