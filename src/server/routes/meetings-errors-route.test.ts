import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isolateEnv } from "../test-support/fixtures.js";

const env = isolateEnv();
const stubDir = path.join(env.root, "stub");
fs.mkdirSync(stubDir);
process.env.STUB_DIR = stubDir;
const OK_OUTPUT = [
  "## Action item",
  "key: send-report",
  "title: Send the report",
  "",
  "> I will send the report",
  "## Action item",
  "key: fix-login",
  "title: Fix the login bug",
  "",
  "> Sam fixes login",
  "## Action item",
  "key: book-room",
  "title: Book the room",
  "",
  "> Sam books the room",
].join("\\n");
const DUP_OUTPUT = [
  "## Action item",
  "key: send-report",
  "title: Send the report",
  "meeting: Design review",
  "",
  "> first",
  "## Action item",
  "key: send-report",
  "title: Send the report again",
  "",
  "> second",
].join("\\n");
fs.writeFileSync(
  path.join(env.binDir, "claude"),
  [
    "#!/bin/sh",
    'echo $$ > "$STUB_DIR/claude.pid"',
    'printf "%s\\n" "$@" > "$STUB_DIR/argv.txt"',
    'cat > "$STUB_DIR/stdin.txt"',
    'mode=$(cat "$STUB_DIR/mode" 2>/dev/null || echo ok)',
    'case "$mode" in',
    `ok) printf '${OK_OUTPUT}\\n' ;;`,
    `dup) printf '${DUP_OUTPUT}\\n' ;;`,
    "none) echo NO_ACTION_ITEMS ;;",
    "garbage) echo 'I could not find anything.' ;;",
    "slow) exec sleep 120 ;;",
    "esac",
  ].join("\n"),
  { mode: 0o755 },
);

const { store } = await import("../store/board.store.js");
const express = (await import("express")).default;
const { meetingsRouter } = await import("./meetings.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
await store.load();

const app = express();
app.use("/api", express.json({ limit: "1mb" }), meetingsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

const { MEETINGS_DIR } = await import("../services/infra/paths.js");
assert.ok(
  MEETINGS_DIR.startsWith(env.root),
  "MEETINGS_DIR escaped the temp root",
);
const { transcriptPath } =
  await import("../services/orchestration/meeting-transcripts.js");
const configFile = path.join(env.dispatchDir, "config.json");

function setMode(mode: string): void {
  fs.writeFileSync(path.join(stubDir, "mode"), mode);
  for (const f of ["argv.txt", "stdin.txt", "claude.pid"]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return { status: res.status, text: await res.text() };
}

async function expectBody(
  method: string,
  route: string,
  body: unknown,
  status: number,
  text: string,
): Promise<void> {
  const res = await call(method, route, body);
  assert.equal(
    res.status,
    status,
    `${method} ${route} ${JSON.stringify(body)}`,
  );
  assert.equal(res.text, text);
}

const err = (error: string) => JSON.stringify({ error });

async function waitFor(check: () => boolean, ms = 7000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

function stubPid(): number {
  try {
    return Number(fs.readFileSync(path.join(stubDir, "claude.pid"), "utf8"));
  } catch {
    return 0;
  }
}

const drafts = [
  { key: "send-report", title: "Send the report", description: "> quote a" },
  { key: "fix-login", title: "Fix the login bug", description: "> quote b" },
];
const MARKER = "DISPATCH_STATUS: done";

test("draft-many answers 400 for each bad field, in field order, before spawning claude", async () => {
  setMode("ok");
  const cases: [unknown, string][] = [
    [undefined, "invalid-meeting"],
    [[], "invalid-meeting"],
    [{}, "invalid-meeting"],
    [{ notes: "n" }, "invalid-meeting"],
    [{ meeting: 5, notes: "n" }, "invalid-meeting"],
    [{ meeting: "   ", notes: "n" }, "invalid-meeting"],
    [{ meeting: "x".repeat(201), notes: "n" }, "invalid-meeting"],
    [{ meeting: `Sync ${MARKER}`, notes: "n" }, "invalid-meeting"],
    [{ meeting: "M" }, "invalid-notes"],
    [{ meeting: "M", notes: 5 }, "invalid-notes"],
    [{ meeting: "M", notes: null }, "invalid-notes"],
    [{ meeting: "M", notes: "   " }, "invalid-notes"],
    [{ meeting: "M", notes: "x".repeat(100_001) }, "invalid-notes"],
    [{ meeting: "M", notes: "n", me: "x".repeat(101) }, "invalid-me"],
    [{ meeting: "M", notes: "n", me: 7 }, "invalid-me"],
    [{ meeting: "M", notes: "n", me: null }, "invalid-me"],
    [{ meeting: " ", notes: " ", me: 7 }, "invalid-meeting"],
    [{ meeting: "M", notes: " ", me: 7 }, "invalid-notes"],
  ];
  for (const [body, error] of cases) {
    await expectBody("POST", "/cards/draft-many", body, 400, err(error));
  }
  assert.equal(fs.existsSync(path.join(stubDir, "argv.txt")), false);
});

test("draft-many answers 502 generate-failed when the model output holds no action item", async () => {
  setMode("garbage");
  await expectBody(
    "POST",
    "/cards/draft-many",
    { meeting: "M", notes: "n" },
    502,
    err("generate-failed"),
  );
});

test("draft-many answers 409 generate-in-progress while a run holds the slot, after validating the body", async () => {
  setMode("slow");
  const controller = new AbortController();
  const first = call(
    "POST",
    "/cards/draft-many",
    { meeting: "M", notes: "n" },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => stubPid() > 0));
  await expectBody(
    "POST",
    "/cards/draft-many",
    { meeting: "M", notes: "n" },
    409,
    err("generate-in-progress"),
  );
  await expectBody(
    "POST",
    "/cards/draft-many",
    { notes: "n" },
    400,
    err("invalid-meeting"),
  );
  controller.abort();
  await first;
  await waitFor(() => {
    try {
      process.kill(stubPid(), 0);
      return false;
    } catch {
      return true;
    }
  });
  setMode("none");
  for (let i = 0; i < 60; i += 1) {
    const res = await call("POST", "/cards/draft-many", {
      meeting: "M",
      notes: "n",
    });
    if (res.status !== 409) break;
    await new Promise((r) => setTimeout(r, 50));
  }
});

test("create answers 400 for each bad field, in field order", async () => {
  const many = Array.from({ length: 16 }, (_, i) => ({
    ...drafts[0],
    key: `k${i}`,
  }));
  const cases: [unknown, string][] = [
    [undefined, "invalid-meeting"],
    [[], "invalid-meeting"],
    [{ drafts }, "invalid-meeting"],
    [{ meeting: 5, drafts }, "invalid-meeting"],
    [{ meeting: " ", drafts }, "invalid-meeting"],
    [{ meeting: "m".repeat(201), drafts }, "invalid-meeting"],
    [{ meeting: "M", drafts, notes: 5 }, "invalid-notes"],
    [{ meeting: "M", drafts, notes: null }, "invalid-notes"],
    [{ meeting: "M", drafts, notes: "  " }, "invalid-notes"],
    [{ meeting: "M", drafts, notes: "n".repeat(100_001) }, "invalid-notes"],
    [{ meeting: "M" }, "invalid-drafts"],
    [{ meeting: "M", drafts: [] }, "invalid-drafts"],
    [{ meeting: "M", drafts: "x" }, "invalid-drafts"],
    [{ meeting: "M", drafts: {} }, "invalid-drafts"],
    [{ meeting: "M", drafts: many }, "invalid-drafts"],
    [{ meeting: "M", drafts: [null] }, "invalid-drafts"],
    [{ meeting: "M", drafts: [[]] }, "invalid-drafts"],
    [{ meeting: "M", drafts: ["x"] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ ...drafts[0], key: "Bad Key" }] },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [{ ...drafts[0], key: 5 }] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ ...drafts[0], key: "k".repeat(49) }] },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ title: "T", description: "d" }] },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], title: "   " }] },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [{ ...drafts[0], title: 5 }] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ ...drafts[0], title: "x".repeat(301) }] },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], description: "" }] },
      "invalid-drafts",
    ],
    [
      {
        meeting: "M",
        drafts: [{ ...drafts[0], description: "x".repeat(20_001) }],
      },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [drafts[0], null] }, "invalid-drafts"],
    [{ meeting: MARKER, drafts: [] }, "invalid-drafts"],
    [{ meeting: "M", notes: " ", drafts: [] }, "invalid-notes"],
    [{ meeting: " ", notes: " ", drafts: [] }, "invalid-meeting"],
    [{ meeting: "M", drafts: [drafts[0], drafts[0]] }, "duplicate-key"],
    [
      { meeting: MARKER, drafts: [drafts[0], drafts[0]] },
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      { meeting: MARKER, drafts },
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], title: MARKER }] },
      "content contains the DISPATCH_STATUS marker",
    ],
    [
      {
        meeting: "M",
        drafts: [drafts[0], { ...drafts[1], description: `x ${MARKER}` }],
      },
      "content contains the DISPATCH_STATUS marker",
    ],
  ];
  const before = store.listItems().length;
  for (const [body, error] of cases) {
    await expectBody("POST", "/meetings/items", body, 400, err(error));
  }
  assert.equal(store.listItems().length, before);
});

test("create answers 500 create-failed when the store throws", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(store, "upsertItems", () => Promise.reject(new Error("boom")));
  await expectBody(
    "POST",
    "/meetings/items",
    { meeting: "Store down", drafts },
    500,
    err("create-failed"),
  );
});

test("create answers 500 transcript-write-failed with the counts and keeps the items", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const first = await call("POST", "/meetings/items", {
    meeting: "Unwritable notes",
    drafts,
    notes: "first",
  });
  assert.equal(first.status, 201);
  const { ids } = JSON.parse(first.text) as { ids: string[] };
  const file = transcriptPath(store.getItem(ids[0])?.meta.meetingId ?? "");
  fs.rmSync(file);
  fs.mkdirSync(file);
  try {
    await expectBody(
      "POST",
      "/meetings/items",
      { meeting: "Unwritable notes", drafts, notes: "second" },
      500,
      JSON.stringify({
        error: "transcript-write-failed",
        created: 0,
        updated: ids.length,
        ids,
      }),
    );
    await expectBody(
      "GET",
      `/meetings/transcript?meetingId=${encodeURIComponent(store.getItem(ids[0])?.meta.meetingId ?? "")}`,
      undefined,
      500,
      err("transcript-read-failed"),
    );
  } finally {
    fs.rmdirSync(file);
  }
});

test("transcript read answers 400 invalid-meeting-id and 404 not-found", async () => {
  const bad = [
    "",
    "bad",
    "paste:2026-13",
    "granola:2026-01-01-",
    "other:2026-01-01-x",
    "paste:2026-01-01-UPPER",
    `paste:2026-01-01-${"a".repeat(41)}`,
  ];
  for (const id of bad) {
    await expectBody(
      "GET",
      `/meetings/transcript?meetingId=${encodeURIComponent(id)}`,
      undefined,
      400,
      err("invalid-meeting-id"),
    );
  }
  await expectBody(
    "GET",
    "/meetings/transcript",
    undefined,
    400,
    err("invalid-meeting-id"),
  );
  await expectBody(
    "GET",
    "/meetings/transcript?meetingId=paste:2026-01-01-a&meetingId=paste:2026-01-01-b",
    undefined,
    400,
    err("invalid-meeting-id"),
  );
  await expectBody(
    "GET",
    "/meetings/transcript?meetingId=paste:2026-01-01-nothing-stored",
    undefined,
    404,
    err("not-found"),
  );
});

test("the Granola settings route answers 400 for a bad enabled or window, enabled first", async () => {
  const before = fs.readFileSync(configFile, "utf8");
  const cases: [unknown, string][] = [
    [{ enabled: "yes" }, "invalid-enabled"],
    [{ enabled: 1 }, "invalid-enabled"],
    [{ enabled: null }, "invalid-enabled"],
    [{ windowHours: 50 }, "invalid-window"],
    [{ windowHours: "48" }, "invalid-window"],
    [{ windowHours: null }, "invalid-window"],
    [{ windowHours: 0 }, "invalid-window"],
    [{ enabled: "yes", windowHours: 50 }, "invalid-enabled"],
    [{ enabled: false, windowHours: 50 }, "invalid-window"],
  ];
  for (const [body, error] of cases) {
    await expectBody("PUT", "/meetings/granola", body, 400, err(error));
  }
  assert.equal(fs.readFileSync(configFile, "utf8"), before);
});

test("the Granola settings route takes an empty or array body as no change", async () => {
  for (const body of [undefined, [], {}]) {
    const res = await call("PUT", "/meetings/granola", body);
    assert.equal(res.status, 200);
  }
});

test("the Granola settings route answers 500 settings-failed when the config cannot be read", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const good = fs.readFileSync(configFile);
  fs.writeFileSync(configFile, "{ not json");
  try {
    await expectBody(
      "PUT",
      "/meetings/granola",
      { windowHours: 24 },
      500,
      err("settings-failed"),
    );
  } finally {
    fs.writeFileSync(configFile, good);
  }
});

test("Analyze now answers 409 disabled while off and 409 running while a round runs", async () => {
  setMode("ok");
  assert.equal(
    (await call("PUT", "/meetings/granola", { enabled: false })).status,
    200,
  );
  await expectBody("POST", "/meetings/granola/run", {}, 409, err("disabled"));
  setMode("slow");
  assert.equal(
    (await call("PUT", "/meetings/granola", { enabled: true })).status,
    200,
  );
  try {
    await expectBody("POST", "/meetings/granola/run", {}, 409, err("running"));
  } finally {
    await call("PUT", "/meetings/granola", { enabled: false });
  }
});
