import express from "express";
import { checkBinaries, StartupError } from "./binaryCheck.js";
import { loadConfig } from "./config.js";
import { store } from "../store/boardStore.js";
import { apiRouter } from "../routes/routes.js";
import { setOrchestrationConfig } from "../services/config-holder.js";
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

  await seedPlaybooks();

  await store.load();

  store.setPollInterval(config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  await reconcileSessions();

  const editors = await resolveEditors();
  store.setEditors(editors);

  const app = express();
  app.use(express.json());
  app.use("/api", apiRouter);

  const port = config.port ?? DEFAULT_PORT;
  app.listen(port, "127.0.0.1", () => {
    console.log(
      `[server] Dispatch backend listening on http://127.0.0.1:${port}`,
    );

    startPoller(config, getLinearSource());

    startMarkerWatcher();
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
