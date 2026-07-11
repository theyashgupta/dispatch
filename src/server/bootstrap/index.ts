import express from "express";
import { checkBinaries, StartupError } from "./binary-check.js";
import { loadConfig } from "./config.js";
import { store } from "../store/board.store.js";
import { apiRouter } from "../routes/index.js";
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

async function main(): Promise<void> {
  await checkBinaries();
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
