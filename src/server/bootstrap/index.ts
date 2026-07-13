import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { StartupError } from "./binary-check.js";
import { loadConfig } from "./config.js";
import { store } from "../store/board.store.js";
import { apiRouter } from "../routes/index.js";
import { probePrerequisites } from "../services/prerequisites.js";
import {
  setHooksRuntime,
  setOrchestrationConfig,
} from "../services/config-holder.js";
import { checkHooksCapability, installHookArtifacts } from "./hook-setup.js";
import { unregisterHookToken } from "../services/hook-tokens.js";
import { reapActivityThrottle } from "../services/hook-events.js";
import { seedPlaybooks } from "../services/playbooks.js";
import { startPoller } from "../adapters/poller.js";
import { buildRegistry, getLinearSource } from "../sources/registry.js";
import { startMarkerWatcher } from "../adapters/markers/watcher.js";
import { reconcileSessions } from "./reconcile.js";
import { resolveEditors } from "../adapters/editors.js";

const DEFAULT_PORT = 4700;
const DEFAULT_POLL_INTERVAL_MS = 60_000;

/**
 * Absolute path to the built SPA, resolved relative to this module so it is
 * `dist/web` when running the emitted `dist/server/bootstrap/index.js` and `src/web`
 * in dev — the sibling `../../web` shape is identical in both layouts and independent of cwd.
 */
const webRoot = fileURLToPath(new URL("../../web", import.meta.url));

/**
 * Serve the built SPA's index.html for client-routed deep links in production. Registered after
 * the API router and guarded on GET + non-`/api/` paths so it never shadows `/api/*` or the SSE
 * stream: an unknown `/api/*` still gets Express's default 404 rather than HTML. Sent no-cache so
 * a rebuilt asset graph is always re-fetched (hashed assets under assets/ stay immutable).
 */
const spaFallback: express.RequestHandler = (req, res, next) => {
  if (req.method !== "GET") {
    next();
    return;
  }
  if (req.path === "/api" || req.path.startsWith("/api/")) {
    next();
    return;
  }
  res.set("Cache-Control", "no-cache");
  res.sendFile(path.join(webRoot, "index.html"));
};

/**
 * Turn a body-parser JSON failure into a clean JSON 400 so a malformed request body returns
 * `{ error }` instead of Express's default HTML error page (which also leaks a SyntaxError, and
 * fires before a route's own auth check). Registered after the router so it only catches parse
 * errors that fell through the API.
 */
const jsonBodyErrorHandler: express.ErrorRequestHandler = (
  err,
  _req,
  res,
  next,
) => {
  if (
    err instanceof SyntaxError &&
    (err as unknown as { type?: unknown }).type === "entity.parse.failed"
  ) {
    res.status(400).json({ error: "invalid JSON body" });
    return;
  }
  next(err);
};

async function main(): Promise<void> {
  const missing = (await probePrerequisites()).filter((p) => !p.present);
  if (missing.length > 0) {
    console.warn(
      `[preflight] missing tools (sessions needing them fail at use-time): ${missing
        .map((p) => `${p.name} (${p.hint ?? "install and add to PATH"})`)
        .join(", ")}`,
    );
  }
  const config = loadConfig();
  setOrchestrationConfig(config);
  buildRegistry(config);

  const port = config.port ?? DEFAULT_PORT;
  const statusChannel = config.statusChannel ?? "auto";
  await installHookArtifacts();
  const { capable, version } = await checkHooksCapability();
  if (statusChannel === "hooks" && !capable) {
    console.warn(
      `[hooks] statusChannel is "hooks" but ${
        version ? `claude ${version}` : "the claude CLI"
      } lacks hook support — status routing is disabled: sessions launch ` +
        "without hooks and the watcher never scans, so no card will move " +
        "or flip this run",
    );
  }
  setHooksRuntime({ capable, port, statusChannel });
  store.setHookTokenReleaser((token, cardId) => {
    unregisterHookToken(token);
    reapActivityThrottle(cardId);
  });

  await seedPlaybooks();

  await store.load();

  store.setPollInterval(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  await reconcileSessions();

  const editors = await resolveEditors();
  store.setEditors(editors);

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api", apiRouter);

  if (process.env.NODE_ENV === "production") {
    app.use(
      express.static(webRoot, {
        index: false,
        maxAge: "1y",
        immutable: true,
        setHeaders: (res, filePath) => {
          if (path.basename(filePath) === "index.html") {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.use(spaFallback);
  }

  app.use(jsonBodyErrorHandler);

  app.listen(port, "127.0.0.1", () => {
    console.log(
      `[server] Dispatch backend listening on http://127.0.0.1:${port}`,
    );

    startPoller(config, getLinearSource());

    startMarkerWatcher(statusChannel);
  });
}

main().catch((err: unknown) => {
  if (err instanceof StartupError) {
    process.stderr.write(`\n${err.message}\n`);
  } else {
    process.stderr.write(
      `\nStartup failed: ${(err as Error).stack ?? String(err)}\n`,
    );
  }
  process.exit(1);
});
