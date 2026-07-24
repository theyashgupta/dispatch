import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import express from "express";
import { StartupError } from "./binary-check.js";
import { loadConfig } from "./config.js";
import { store } from "../store/board.store.js";
import { apiRouter } from "../routes/index.js";
import {
  isRequestAllowed,
  remoteAuthRouter,
} from "../routes/remote-auth-gate.js";
import { sweepStrayTunnels } from "../adapters/cloudflared.js";
import { disableTunnel } from "../services/orchestration/tunnel.js";
import { terminalProxyRouter } from "../routes/terminal-proxy.route.js";
import {
  rejectUpgrade,
  terminalProxyUpgrade,
} from "../adapters/terminal-proxy.js";
import { probePreflight } from "../services/infra/preflight.js";
import {
  setHooksRuntime,
  setOrchestrationConfig,
} from "../services/infra/config-holder.js";
import { checkHooksCapability, installHookArtifacts } from "./hook-setup.js";
import { provisionTtydIndex } from "./ttyd-index-setup.js";
import { ensureHyperlinksTerminalFeature } from "../adapters/tmux.js";
import { unregisterHookToken } from "../services/domain/hook-tokens.js";
import {
  reapActivityThrottle,
  reapMismatchThrottle,
} from "../services/domain/hook-events.js";
import { seedPlaybooks } from "../services/domain/playbooks.js";
import { startPoller } from "../adapters/poller.js";
import { buildRegistry, getLinearSource } from "../sources/registry.js";
import { startMarkerWatcher } from "../adapters/markers/watcher.js";
import { reconcileSessions } from "./reconcile.js";
import { resolveEditors } from "../adapters/editors.js";
import { startUpdateCheckLoop } from "../services/orchestration/update.js";

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
 * a rebuilt asset graph is always re-fetched (hashed assets under assets/ stay immutable). Served
 * via the `root` option (never a joined absolute path): send's dotfile policy inspects every
 * segment of a bare absolute path, so an npx install under `~/.npm/_npx/...` (or nvm's
 * `~/.nvm/...`) 404s on the `.npm` segment; with `root` set, only the relative `index.html` is
 * inspected.
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
  res.sendFile("index.html", { root: webRoot });
};

/**
 * Anti-clickjacking headers on every response, set as the FIRST middleware so it covers the gate
 * page, the board UI, and the terminal proxy alike. `SAMEORIGIN` / `frame-ancestors 'self'` (not
 * `DENY`/`'none'`) is deliberate: the app frames its OWN same-origin terminal at
 * `/sessions/<id>/terminal/`, so a same-origin allowance must survive while every third-party
 * origin is refused — the relevant threat once Phase 74 makes the app publicly reachable.
 */
const frameGuardHeaders: express.RequestHandler = (_req, res, next) => {
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");
  next();
};

/**
 * Turn ANY body-parser failure into a clean JSON error so a malformed or oversized request body
 * returns `{ error }` instead of Express's default HTML error page (which leaks a stack). Matches on
 * the body-parser error shape (an `entity.*` `type` string) rather than `SyntaxError` alone, so it
 * also normalizes the `express.urlencoded` failures on the unauthenticated `/__remote/verify` route
 * — e.g. a `PayloadTooLargeError` (`entity.too.large`, 413) from a body over its 1KB limit — which a
 * `SyntaxError`-only guard would fall through to the default handler. Registered after the router so
 * it only catches parse errors that fell through the API.
 */
const jsonBodyErrorHandler: express.ErrorRequestHandler = (
  err,
  _req,
  res,
  next,
) => {
  const shaped = err as {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  if (typeof shaped.type === "string" && shaped.type.startsWith("entity.")) {
    const status =
      typeof shaped.status === "number"
        ? shaped.status
        : typeof shaped.statusCode === "number"
          ? shaped.statusCode
          : 400;
    res.status(status).json({ error: "invalid request body" });
    return;
  }
  next(err);
};

/**
 * The single named target for Node's raw `'upgrade'` event — Express never routes it (WS upgrades
 * are Node-level, not Express-level), so this is the one place a terminal WebSocket handshake can
 * be intercepted. The auth gate now runs FIRST, ahead of the path check: `isRequestAllowed` is the
 * same predicate the hoisted `remoteAuthRouter` uses, so a loopback or valid-session request is
 * unaffected and an unauthenticated non-loopback upgrade is rejected before it ever reaches
 * `terminalProxyUpgrade`/ttyd (T-72-05, T-73-02). Destroys the socket for any path outside
 * `/sessions/*` since that prefix is the only upgrade surface this phase creates.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  if (!isRequestAllowed(req)) {
    rejectUpgrade(socket, "401 Unauthorized");
    return;
  }
  if (!req.url?.startsWith("/sessions/")) {
    rejectUpgrade(socket, "404 Not Found");
    return;
  }
  terminalProxyUpgrade(req, socket, head);
}

/**
 * The FIRST `process.on("SIGINT"/"SIGTERM", ...)` handler in this codebase — every other
 * subprocess (ttyd, tmux, git) is either deliberately detached-to-survive or short-lived-and-
 * awaited, so nothing else needed a "clean up before I die" hook until cloudflared. Scoped
 * NARROWLY to `disableTunnel()` (kills cloudflared + clears the token) — it does NOT tear down
 * ttyd/tmux sessions, which intentionally survive a backend restart.
 * @remarks T-74-03: `disableTunnel()`'s `clearToken()` call is synchronous, so the token stops
 * validating immediately even though cloudflared's own default 30s grace period means the OS
 * process can take longer to fully exit; the sentinel Host rewrite (T-74-01) also gates any
 * straggler request that reaches a still-draining cloudflared in that window.
 * @see docs/ARCHITECTURE.md#security-threat-model
 */
function shutdown(signal: NodeJS.Signals): void {
  console.log(`[shutdown] ${signal} received — tearing down remote access`);
  disableTunnel();
  process.exit(0);
}

/** Options for {@link main}; `desiredPort` overrides the configured port (the CLI's `--port`). */
export interface MainOptions {
  desiredPort?: number;
}

/**
 * Listen on `desiredPort`, falling back to an OS-assigned free port on EADDRINUSE, and resolve the
 * REAL bound port from `server.address()`. Both the primary and fallback bind loopback only so the
 * port-selection change never widens exposure; using the real socket avoids the TOCTOU race a
 * separate free-port probe would introduce.
 */
function listenWithFallback(
  app: express.Express,
  desiredPort: number,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const attempt = (candidate: number, isRetry: boolean): void => {
      const server = app.listen(candidate, "127.0.0.1");
      server.once("listening", () => {
        const addr = server.address();
        resolve({
          server,
          port: typeof addr === "object" && addr ? addr.port : candidate,
        });
      });
      server.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && !isRetry && candidate !== 0) {
          attempt(0, true);
        } else {
          reject(err);
        }
      });
    };
    attempt(desiredPort, false);
  });
}

export async function main(opts: MainOptions = {}): Promise<{ port: number }> {
  const preflight = await probePreflight();
  if (preflight.node.ok) {
    console.log(
      `[preflight] Node ${preflight.node.version} (floor ${preflight.node.floor})`,
    );
  } else {
    console.warn(
      `[preflight] Node ${preflight.node.version} is below the supported floor (${preflight.node.floor}) — continuing; upgrade Node if you hit issues`,
    );
  }
  if (preflight.storage.ok) {
    console.log(`[preflight] storage OK — ${preflight.storage.path}`);
  } else {
    console.warn(
      `[preflight] storage check FAILED — ${preflight.storage.path} did not open cleanly (continuing; the store recovers on load)`,
    );
  }
  const missing = preflight.binaries.filter((p) => !p.present);
  if (missing.length > 0) {
    console.warn(
      `[preflight] missing tools (sessions needing them fail at use-time): ${missing
        .map(
          (p) =>
            `${p.name} (${p.command ?? p.hint ?? "install and add to PATH"})`,
        )
        .join(", ")}`,
    );
  }
  const config = loadConfig();
  setOrchestrationConfig(config);
  buildRegistry(config);

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
  store.setHookTokenReleaser((token, cardId) => {
    unregisterHookToken(token);
    reapActivityThrottle(cardId);
    reapMismatchThrottle(cardId);
  });

  await seedPlaybooks();

  await store.load();

  store.setPollInterval(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  await ensureHyperlinksTerminalFeature();
  await reconcileSessions();
  void provisionTtydIndex().catch((err: unknown) => {
    console.warn(
      `[ttyd-index] provisioning rejected unexpectedly: ${(err as Error).message}`,
    );
  });
  await sweepStrayTunnels().catch((err: unknown) => {
    console.warn(
      `[cloudflared] boot orphan sweep rejected unexpectedly: ${(err as Error).message}`,
    );
  });

  const editors = await resolveEditors();
  store.setEditors(editors);

  const app = express();
  app.use(frameGuardHeaders);
  app.use(remoteAuthRouter);
  app.use("/api", express.json({ limit: "1mb" }), apiRouter);
  app.use("/sessions", terminalProxyRouter);

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

  const desiredPort = opts.desiredPort ?? config.port ?? DEFAULT_PORT;
  const { server, port } = await listenWithFallback(app, desiredPort);
  console.log(
    `[server] Dispatch backend listening on http://127.0.0.1:${port}`,
  );

  server.on("upgrade", handleUpgrade);

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  setHooksRuntime({ capable, port, statusChannel });
  if (config.linearApiKey) {
    startPoller(config, getLinearSource());
  }
  startMarkerWatcher(statusChannel);
  if (config.updateCheck !== false) startUpdateCheckLoop(config);
  return { port };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
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
}
