/**
 * SSE fan-out latency harness (PERF-01c, dev/ops tooling, NOT test code): boots the production
 * build in a sandbox, opens N concurrent raw-HTTP readers against `GET /api/stream`, fires ONE
 * local-only board mutation (`POST /api/cards/:id/move` between `todo` and `done` — never a move
 * that starts a session, matching cards.route.ts's own guards), and times each client's next board
 * `data:` frame arrival (named `ping`/`activity` frames are skipped; only the board snapshot frame,
 * which carries no `event:` line, counts).
 *
 * sse.route.ts already serializes each snapshot ONCE per broadcast (`const payload = frame(snapshot)`
 * outside the client loop) — this harness's job is to measure whether N-client fan-out itself costs
 * anything, not to find an obvious "serialize once" fix that's already present.
 *
 * Card seeding: a fresh sandbox board starts empty, so a real (but read-only) Linear sync is used to
 * populate one card — only `apiKey`/`filters` are lifted from the real `~/.dispatch/config.json`
 * into the sandbox config; `board.db` is NEVER copied. The synced card lands in `inbox` and is
 * promoted to `todo` for the duration of the run, then demoted back to `inbox` at teardown.
 *
 * Usage:
 *   node scripts/perf-sse.mjs
 *
 * Prints, for each N in {1, 4, 16}:
 *   PERF-SSE n=<N> median_ms=<x> max_ms=<x>
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = join(REPO_ROOT, "dist", "server", "bootstrap", "index.js");
const PORT = 4858;
const POLL_INTERVAL_MS = 25;
const READY_TIMEOUT_MS = 30_000;
const SYNC_TIMEOUT_MS = 30_000;
const KILL_TIMEOUT_MS = 5_000;
const CLIENT_COUNTS = [1, 4, 16];

/** Read only `sources.linear.apiKey`/`filters` from the real config — never `board.db`. */
function readRealLinearSource() {
  const realConfigPath = join(homedir(), ".dispatch", "config.json");
  if (!existsSync(realConfigPath)) {
    throw new Error(
      `${realConfigPath} not found — perf-sse.mjs needs a real Linear apiKey to seed one card ` +
        "(only apiKey/filters are read, board.db is never touched).",
    );
  }
  const parsed = JSON.parse(readFileSync(realConfigPath, "utf8"));
  const linear = parsed?.sources?.linear;
  const apiKey = typeof linear?.apiKey === "string" ? linear.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error(
      `${realConfigPath} has no sources.linear.apiKey — perf-sse.mjs needs one to seed a card via a real sync.`,
    );
  }
  return { apiKey, filters: linear.filters };
}

/** Sandbox HOME with a fresh board.db and the real (read-only) Linear apiKey/filters lifted in — never board.db. */
function makeSandboxHome() {
  const home = join(tmpdir(), `dispatch-perf-sse-${process.pid}`);
  const dispatchDir = join(home, ".dispatch");
  mkdirSync(dispatchDir, { recursive: true });
  const { apiKey, filters } = readRealLinearSource();
  writeFileSync(
    join(dispatchDir, "config.json"),
    JSON.stringify(
      {
        port: PORT,
        workspaceRoot: join(home, "workspaces"),
        statusChannel: "auto",
        updateCheck: false,
        sources: { linear: { apiKey, filters } },
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  return home;
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/api/board`);
      await res.body?.cancel();
      if (res.status === 200) return;
    } catch {
      // server not listening yet — keep polling
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `server did not answer 200 on /api/board within ${READY_TIMEOUT_MS}ms`,
  );
}

/** Poll `/api/board` until the real Linear sync has populated at least one card, returning its id. */
async function waitForSeededCard() {
  const deadline = Date.now() + SYNC_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/board`);
    const snapshot = await res.json();
    if (Array.isArray(snapshot.cards) && snapshot.cards.length > 0) {
      return snapshot.cards[0];
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `no card appeared on the sandbox board within ${SYNC_TIMEOUT_MS}ms — Linear sync did not populate`,
  );
}

async function moveCard(id, column) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/cards/${id}/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ column }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`move ${id} -> ${column} failed (${res.status}): ${body}`);
  }
  await res.json();
}

/** Wrap one SSE connection's readable body: `nextBoardFrame()` resolves on the next un-named `data:` frame, skipping `event: ping`/`event: activity` frames. */
function makeFrameReader(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  return {
    async nextBoardFrame() {
      for (;;) {
        const boundary = buf.indexOf("\n\n");
        if (boundary !== -1) {
          const raw = buf.slice(0, boundary);
          buf = buf.slice(boundary + 2);
          if (raw.startsWith("data:")) return performance.now();
          continue;
        }
        const { value, done } = await reader.read();
        if (done) throw new Error("SSE stream closed unexpectedly");
        buf += decoder.decode(value, { stream: true });
      }
    },
    async close() {
      await reader.cancel().catch(() => {});
    },
  };
}

async function measureFanOut(n, cardId) {
  const responses = await Promise.all(
    Array.from({ length: n }, () =>
      fetch(`http://127.0.0.1:${PORT}/api/stream`),
    ),
  );
  const readers = responses.map(makeFrameReader);
  await Promise.all(readers.map((r) => r.nextBoardFrame()));

  const t0 = performance.now();
  await moveCard(cardId, "done");
  const arrivals = await Promise.all(
    readers.map((r) => r.nextBoardFrame().then((t) => t - t0)),
  );
  await Promise.all(readers.map((r) => r.close()));
  await moveCard(cardId, "todo");

  const sorted = [...arrivals].sort((a, b) => a - b);
  const median = sorted[Math.floor((sorted.length - 1) * 0.5)];
  const max = sorted[sorted.length - 1];
  return { median, max };
}

function fmt(ms) {
  return ms.toFixed(1);
}

function killAndWait(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const escalate = setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(escalate);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function main() {
  if (!existsSync(DIST_ENTRY)) {
    console.error(`Missing ${DIST_ENTRY} — run \`npm run build\` first.`);
    process.exit(1);
  }

  const home = makeSandboxHome();
  const child = spawn("node", [DIST_ENTRY], {
    env: { ...process.env, NODE_ENV: "production", HOME: home },
    stdio: ["ignore", "ignore", "ignore"],
  });

  try {
    await waitForReady();
    const card = await waitForSeededCard();
    console.log(
      `seeded card ${card.identifier} (${card.id}), column=${card.column}`,
    );

    await moveCard(card.id, "todo");

    for (const n of CLIENT_COUNTS) {
      const { median, max } = await measureFanOut(n, card.id);
      console.log(
        `PERF-SSE n=${n} median_ms=${fmt(median)} max_ms=${fmt(max)}`,
      );
    }

    await moveCard(card.id, "inbox");
  } finally {
    await killAndWait(child);
    rmSync(home, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`perf-sse failed: ${err.stack ?? err.message}`);
  process.exit(1);
});
