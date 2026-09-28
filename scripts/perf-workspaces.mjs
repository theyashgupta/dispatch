import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^-+/, "").split("=");
    return [k, v ?? "1"];
  }),
);
const PORT = Number(args.port ?? 47952);
const ROOT =
  args.dir ?? join(tmpdir(), `dispatch-perf-workspaces-${process.pid}`);
const FILES_PER_WORKSPACE = Number(args.files ?? 20000);
const WORKSPACES = 12;
const IDLE_SAMPLES = 10;
const MIN_BUSY_SAMPLES = 5;
const BUDGET_MS = 50;
const BASE = `http://127.0.0.1:${PORT}`;

function writeConfig(dataDir) {
  writeFileSync(
    join(dataDir, "config.json"),
    JSON.stringify(
      {
        port: PORT,
        workspaceRoot: join(ROOT, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: {
          linear: { apiKey: "g8-fake-key-never-real", enabled: false },
        },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
}

function fillWorkspace(dir) {
  const perDir = 500;
  for (let i = 0; i < FILES_PER_WORKSPACE; i++) {
    const sub = join(dir, `d${Math.floor(i / perDir)}`);
    if (i % perDir === 0) mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `f${i}.txt`), "x".repeat(64));
  }
}

function cardRow(id, title, column, extra = {}) {
  return JSON.stringify({
    id,
    issueId: id,
    identifier: id,
    title,
    description: null,
    priority: 0,
    column,
    updatedAt: new Date().toISOString(),
    source: "local",
    ...extra,
  });
}

function seedCards(dataDir) {
  const db = new DatabaseSync(join(dataDir, "board.db"));
  const insert = db.prepare(
    "INSERT OR REPLACE INTO cards (id, data) VALUES (?, ?)",
  );
  const now = new Date().toISOString();
  for (let n = 1; n <= WORKSPACES; n++) {
    const id = `LOCAL-${800 + n}`;
    const workspacePath = join(ROOT, "workspaces", id);
    fillWorkspace(join(workspacePath, "app"));
    const workspace = {
      folder: join(ROOT, "repos"),
      repos: [{ path: join(ROOT, "repos", "app"), base: "main" }],
    };
    const session = {
      id: `perf-s-${n}`,
      createdAt: now,
      updatedAt: now,
      workspacePath,
      workspace,
      branch: id,
    };
    insert.run(
      id,
      cardRow(id, `Perf workspace ${n}`, "in_progress", {
        sessions: [session],
        activeSessionId: session.id,
        workspacePath,
        workspace,
        branch: id,
      }),
    );
  }
  insert.run("LOCAL-899", cardRow("LOCAL-899", "Perf move target", "todo"));
  db.close();
}

async function waitForReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/board`).catch(() => null);
    await res?.body?.cancel();
    if (res?.status === 200) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("server did not answer 200 on /api/board within 30s");
}

function boot(dataDir) {
  return spawn("node", [DIST_ENTRY], {
    env: { ...process.env, NODE_ENV: "production", DISPATCH_DIR: dataDir },
    stdio: ["ignore", "ignore", "ignore"],
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

function frameReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return {
    async next() {
      for (;;) {
        const boundary = buf.indexOf("\n\n");
        if (boundary !== -1) {
          const raw = buf.slice(0, boundary);
          buf = buf.slice(boundary + 2);
          if (raw.startsWith("data:")) return performance.now();
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE stream closed");
        buf += decoder.decode(value, { stream: true });
      }
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

let column = "todo";
async function timedMove(reader) {
  column = column === "todo" ? "done" : "todo";
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/cards/LOCAL-899/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (!res.ok) throw new Error(`move failed ${res.status}`);
  await res.body?.cancel();
  return (await reader.next()) - t0;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)];
}

function assertSandboxSafe() {
  const root = resolve(ROOT);
  const allowed = [resolve(tmpdir()), "/tmp", "/private/tmp"];
  if (!allowed.some((base) => root.startsWith(base + sep))) {
    throw new Error(
      `dir=${root} is outside a temp directory; refusing to delete it`,
    );
  }
  if (PORT === 4700 || PORT === 4710) {
    throw new Error(`port ${PORT} belongs to a live Dispatch; pick another`);
  }
}

async function main() {
  assertSandboxSafe();
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY}; run the build first.`);
    process.exit(1);
  }
  const dataDir = join(ROOT, "dispatch-data");
  rmSync(ROOT, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  writeConfig(dataDir);

  let child = boot(dataDir);
  await waitForReady();
  await stop(child);
  seedCards(dataDir);
  child = boot(dataDir);
  let exitCode = 1;
  try {
    await waitForReady();
    const reader = frameReader(await fetch(`${BASE}/api/stream`));
    await reader.next();

    const idle = [];
    for (let i = 0; i < IDLE_SAMPLES; i++) idle.push(await timedMove(reader));

    const busy = [];
    const t0 = performance.now();
    let inventoryMs = 0;
    let done = false;
    let failure = null;
    const inventory = fetch(`${BASE}/api/workspaces?fresh=1`)
      .then((r) => {
        if (!r.ok) throw new Error(`inventory answered ${r.status}`);
        return r.json();
      })
      .then(
        () => {
          inventoryMs = performance.now() - t0;
          done = true;
        },
        (err) => {
          failure = err;
          done = true;
        },
      );
    while (!done) busy.push(await timedMove(reader));
    await inventory;
    if (failure) throw failure;
    await reader.close();
    if (busy.length < MIN_BUSY_SAMPLES) {
      throw new Error(
        `only ${busy.length} moves landed during the inventory build (${inventoryMs.toFixed(0)} ms); raise files=`,
      );
    }

    const idleMedian = median(idle);
    const busyMedian = median(busy);
    const pass = busyMedian - idleMedian <= BUDGET_MS;
    console.log(
      `PERF-WORKSPACES idle_median_ms=${idleMedian.toFixed(1)} busy_median_ms=${busyMedian.toFixed(1)} busy_max_ms=${Math.max(...busy).toFixed(1)} inventory_ms=${inventoryMs.toFixed(0)} busy_samples=${busy.length} result=${pass ? "pass" : "fail"}`,
    );
    exitCode = pass ? 0 : 1;
  } finally {
    await stop(child);
    rmSync(ROOT, { recursive: true, force: true });
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`perf-workspaces failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
