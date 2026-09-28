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
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
setOrchestrationConfig({ linearApiKey: "" });
await store.load();

const app = express();
app.use("/api", express.json({ limit: "1mb" }), meetingsRouter);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
after(() => {
  server.close();
  env.cleanup();
});

function setMode(mode: string): void {
  fs.writeFileSync(path.join(stubDir, "mode"), mode);
  for (const f of ["argv.txt", "stdin.txt", "claude.pid"]) {
    fs.rmSync(path.join(stubDir, f), { force: true });
  }
}

function post(
  route: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

async function waitFor(check: () => boolean, ms = 7000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return check();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * The stub's pid, or 0 while its pid file is missing or not yet written.
 *
 * @remarks The stub writes the file with a shell redirect, so it can exist empty for a moment;
 * `Number("")` is 0, and `process.kill(0, 0)` probes the whole process group and always succeeds.
 */
function stubPid(): number {
  try {
    return Number(fs.readFileSync(path.join(stubDir, "claude.pid"), "utf8"));
  } catch {
    return 0;
  }
}

const meetingItems = () =>
  store.listItems().filter((i) => i.source === "meeting");

test("draft-many refuses bad fields before spawning claude", async () => {
  setMode("ok");
  const cases: [unknown, string][] = [
    [{ notes: "n" }, "invalid-meeting"],
    [{ meeting: "x".repeat(201), notes: "n" }, "invalid-meeting"],
    [{ meeting: "Sync DISPATCH_STATUS: done", notes: "n" }, "invalid-meeting"],
    [{ meeting: "M", notes: "   " }, "invalid-notes"],
    [{ meeting: "M", notes: "x".repeat(100_001) }, "invalid-notes"],
    [{ meeting: "M", notes: "n", me: "x".repeat(101) }, "invalid-me"],
    [{ meeting: "M", notes: "n", me: 7 }, "invalid-me"],
  ];
  for (const [body, error] of cases) {
    const res = await post("/cards/draft-many", body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
  }
  assert.equal(fs.existsSync(path.join(stubDir, "argv.txt")), false);
});

test("draft-many runs claude with the fixed flags and the prompt on stdin", async () => {
  setMode("ok");
  const res = await post("/cards/draft-many", {
    meeting: "Design review",
    notes: "zebra-canary-7 notes body",
    me: "Sam",
  });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { drafts: { key: string }[] };
  assert.deepEqual(
    body.drafts.map((d) => d.key),
    ["send-report", "fix-login", "book-room"],
  );
  assert.deepEqual(body.drafts[0], {
    key: "send-report",
    title: "Send the report",
    description: "> I will send the report",
  });
  const argv = fs
    .readFileSync(path.join(stubDir, "argv.txt"), "utf8")
    .split("\n")
    .slice(0, -1);
  assert.deepEqual(argv, [
    "-p",
    "--output-format",
    "text",
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
  ]);
  const stdin = fs.readFileSync(path.join(stubDir, "stdin.txt"), "utf8");
  assert.ok(stdin.includes("zebra-canary-7 notes body"));
  assert.ok(stdin.includes("The user appears in these notes as: Sam."));
});

test("draft-many accepts every field at its exact maximum", async () => {
  setMode("none");
  const res = await post("/cards/draft-many", {
    meeting: "m".repeat(200),
    notes: "n".repeat(100_000),
    me: "s".repeat(100),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { drafts: [] });
});

test("draft-many keeps the first draft of a key and drops echoed meeting lines", async () => {
  setMode("dup");
  const res = await post("/cards/draft-many", { meeting: "M", notes: "n" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {
    drafts: [
      { key: "send-report", title: "Send the report", description: "> first" },
    ],
  });
});

test("draft-many answers an empty list for NO_ACTION_ITEMS and 502 for prose", async () => {
  setMode("none");
  const none = await post("/cards/draft-many", { meeting: "M", notes: "n" });
  assert.equal(none.status, 200);
  assert.deepEqual(await none.json(), { drafts: [] });
  setMode("garbage");
  const bad = await post("/cards/draft-many", { meeting: "M", notes: "n" });
  assert.equal(bad.status, 502);
  assert.deepEqual(await bad.json(), { error: "generate-failed" });
});

test("a second draft-many while one runs answers 409, and a client abort kills the child", async () => {
  setMode("slow");
  const controller = new AbortController();
  const first = post(
    "/cards/draft-many",
    { meeting: "M", notes: "n" },
    controller.signal,
  ).catch(() => null);
  assert.ok(await waitFor(() => stubPid() > 0));
  const pid = stubPid();
  assert.ok(alive(pid));
  const second = await post("/cards/draft-many", { meeting: "M", notes: "n" });
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: "generate-in-progress" });
  controller.abort();
  await first;
  assert.ok(await waitFor(() => !alive(pid)), "the stub is still running");
  setMode("none");
  const third = await (async () => {
    for (let i = 0; i < 40; i += 1) {
      const res = await post("/cards/draft-many", { meeting: "M", notes: "n" });
      if (res.status !== 409) return res;
      await new Promise((r) => setTimeout(r, 50));
    }
    return post("/cards/draft-many", { meeting: "M", notes: "n" });
  })();
  assert.equal(third.status, 200);
});

const drafts = [
  { key: "send-report", title: "Send the report", description: "> quote a" },
  { key: "fix-login", title: "Fix the login bug", description: "> quote b" },
];

test("create writes append items with the meeting ids and siblings", async () => {
  const res = await post("/meetings/items", {
    meeting: "Design review",
    drafts,
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as {
    created: number;
    updated: number;
    ids: string[];
  };
  assert.equal(body.created, 2);
  assert.equal(body.updated, 0);
  for (const id of body.ids) {
    assert.match(
      id,
      /^meeting:paste:\d{4}-\d{2}-\d{2}-design-review-[0-9a-f]{7}:(send-report|fix-login)$/,
    );
  }
  const stored = meetingItems().filter((i) => body.ids.includes(i.id));
  assert.equal(stored.length, 2);
  const report = stored.find((i) => i.meta.key === "send-report");
  assert.ok(report);
  assert.equal(report.meta.feed, "paste");
  assert.equal(report.meta.meeting, "Design review");
  assert.deepEqual(JSON.parse(report.meta.siblings), ["Fix the login bug"]);
  assert.ok(report.snippet.startsWith("From Design review on "));
});

test("create refuses the marker in the meeting, a title or a description and writes nothing", async () => {
  const before = meetingItems().length;
  const bodies = [
    { meeting: "DISPATCH_STATUS: done", drafts },
    {
      meeting: "Marker",
      drafts: [{ ...drafts[0], title: "DISPATCH_STATUS: done" }],
    },
    {
      meeting: "Marker",
      drafts: [{ ...drafts[0], description: "x DISPATCH_STATUS: needs" }],
    },
  ];
  for (const body of bodies) {
    const res = await post("/meetings/items", body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: "content contains the DISPATCH_STATUS marker",
    });
  }
  assert.equal(meetingItems().length, before);
});

test("create refuses bad counts, bad keys, oversize fields and duplicate keys", async () => {
  const before = meetingItems().length;
  const cases: [unknown, string][] = [
    [{ meeting: "M", drafts: [] }, "invalid-drafts"],
    [{ meeting: "M", drafts: "x" }, "invalid-drafts"],
    [
      {
        meeting: "M",
        drafts: Array.from({ length: 16 }, (_, i) => ({
          ...drafts[0],
          key: `k${i}`,
        })),
      },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], key: "Bad Key" }] },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], title: "x".repeat(301) }] },
      "invalid-drafts",
    ],
    [
      {
        meeting: "M",
        drafts: [{ ...drafts[0], description: "x".repeat(20_001) }],
      },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [null] }, "invalid-drafts"],
    [
      { meeting: "M", drafts: [{ title: "T", description: "d" }] },
      "invalid-drafts",
    ],
    [
      { meeting: "M", drafts: [{ ...drafts[0], title: "   " }] },
      "invalid-drafts",
    ],
    [{ meeting: "M", drafts: [drafts[0], drafts[0]] }, "duplicate-key"],
    [{ meeting: " ", drafts }, "invalid-meeting"],
  ];
  for (const [body, error] of cases) {
    const res = await post("/meetings/items", body);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
  }
  assert.equal(meetingItems().length, before);
});

test("create accepts fifteen drafts with a title and description at their maximums", async () => {
  const full = Array.from({ length: 15 }, (_, i) => ({
    key: `max-${i}`,
    title: i === 0 ? "t".repeat(300) : `Title ${i}`,
    description: i === 0 ? "d".repeat(20_000) : `> quote ${i}`,
  }));
  const res = await post("/meetings/items", {
    meeting: "Limits",
    drafts: full,
  });
  assert.equal(res.status, 201);
  const body = (await res.json()) as { created: number; ids: string[] };
  assert.equal(body.created, 15);
  const first = store.getItem(body.ids[0]);
  assert.equal(first?.title.length, 300);
});

test("a repeat create updates the same rows and keeps a done item done", async () => {
  const first = await post("/meetings/items", { meeting: "Repeat", drafts });
  const { ids } = (await first.json()) as { ids: string[] };
  await store.setItemState(ids[0], "done");
  const count = meetingItems().length;
  const again = await post("/meetings/items", {
    meeting: "Repeat",
    drafts: [{ ...drafts[0], title: "Send the report today" }, drafts[1]],
  });
  assert.equal(again.status, 201);
  assert.deepEqual(
    ((await again.json()) as { created: number; updated: number }).created,
    0,
  );
  assert.equal(meetingItems().length, count);
  const row = store.getItem(ids[0]);
  assert.equal(row?.state, "done");
  assert.equal(row?.title, "Send the report today");
});

test("the Granola settings route refuses a bad enabled or an unlisted window and writes nothing", async () => {
  const configFile = path.join(env.dispatchDir, "config.json");
  const before = fs.readFileSync(configFile, "utf8");
  for (const [body, error] of [
    [{ enabled: "yes" }, "invalid-enabled"],
    [{ windowHours: 50 }, "invalid-window"],
    [{ windowHours: "48" }, "invalid-window"],
  ] as const) {
    const res = await fetch(`${base}/meetings/granola`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error });
  }
  assert.equal(fs.readFileSync(configFile, "utf8"), before);
});

test("a valid window is saved while off, and Analyze now answers 409 disabled without a spawn", async () => {
  setMode("ok");
  const res = await fetch(`${base}/meetings/granola`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, windowHours: 72 }),
  });
  assert.equal(res.status, 200);
  const status = (await res.json()) as Record<string, unknown>;
  assert.equal(status.enabled, false);
  assert.equal(status.windowHours, 72);
  assert.equal(status.running, false);
  const onDisk = JSON.parse(
    fs.readFileSync(path.join(env.dispatchDir, "config.json"), "utf8"),
  ) as { sources: { meeting: unknown } };
  assert.deepEqual(onDisk.sources.meeting, { enabled: false, windowHours: 72 });
  const run = await post("/meetings/granola/run", {});
  assert.equal(run.status, 409);
  assert.deepEqual(await run.json(), { error: "disabled" });
  const get = await fetch(`${base}/meetings/granola`);
  assert.equal(((await get.json()) as { windowHours: number }).windowHours, 72);
  assert.equal(fs.existsSync(path.join(stubDir, "argv.txt")), false);
});

const { MEETINGS_DIR } = await import("../services/infra/paths.js");
const { localDate, meetingId } =
  await import("../services/domain/meeting-actions.js");
const { transcriptPath: transcriptFile } =
  await import("../services/orchestration/meeting-transcripts.js");

function readTranscriptRoute(id: string): Promise<Response> {
  return fetch(
    `${base}/meetings/transcript?meetingId=${encodeURIComponent(id)}`,
  );
}

test("create with notes stamps the transcript, stores it at 0600 and the read route returns it", async () => {
  const res = await post("/meetings/items", {
    meeting: "Transcript sync",
    drafts,
    notes: "First notes zebra-canary-7",
  });
  assert.equal(res.status, 201);
  const { ids } = (await res.json()) as { ids: string[] };
  const rows = ids.map((id) => store.getItem(id));
  assert.ok(rows.every((row) => row?.meta.transcript === "paste"));
  const id = rows[0]?.meta.meetingId ?? "";
  const file = transcriptFile(id);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(MEETINGS_DIR).mode & 0o777, 0o700);
  assert.equal(fs.readFileSync(file, "utf8"), "First notes zebra-canary-7");
  const read = await readTranscriptRoute(id);
  assert.equal(read.status, 200);
  assert.deepEqual(await read.json(), { text: "First notes zebra-canary-7" });

  const again = await post("/meetings/items", {
    meeting: "Transcript sync",
    drafts,
    notes: "Second notes",
  });
  assert.equal(again.status, 201);
  assert.deepEqual(await (await readTranscriptRoute(id)).json(), {
    text: "Second notes",
  });
});

test("a transcript write failure answers 500 with the counts and keeps the items", async () => {
  const first = await post("/meetings/items", {
    meeting: "Unwritable notes",
    drafts,
    notes: "first",
  });
  const { ids } = (await first.json()) as { ids: string[] };
  const file = transcriptFile(store.getItem(ids[0])?.meta.meetingId ?? "");
  fs.rmSync(file);
  fs.mkdirSync(file);
  try {
    const res = await post("/meetings/items", {
      meeting: "Unwritable notes",
      drafts,
      notes: "second",
    });
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), {
      error: "transcript-write-failed",
      created: 0,
      updated: ids.length,
      ids,
    });
    assert.ok(
      ids.every((id) => store.getItem(id)?.meta.transcript === "paste"),
    );
    const read = await readTranscriptRoute(
      store.getItem(ids[0])?.meta.meetingId ?? "",
    );
    assert.equal(read.status, 500);
    assert.deepEqual(await read.json(), { error: "transcript-read-failed" });
  } finally {
    fs.rmdirSync(file);
  }
});

test("a create with notes tightens an existing meetings folder to 0700", async () => {
  fs.mkdirSync(MEETINGS_DIR, { recursive: true });
  fs.chmodSync(MEETINGS_DIR, 0o755);
  const res = await post("/meetings/items", {
    meeting: "Loose folder",
    drafts,
    notes: "notes",
  });
  assert.equal(res.status, 201);
  assert.equal(fs.statSync(MEETINGS_DIR).mode & 0o777, 0o700);
});

test("the transcript file name is a sha256 hex inside the meetings folder", () => {
  const file = transcriptFile("paste:2026-01-01-../../etc/passwd");
  assert.equal(path.dirname(file), MEETINGS_DIR);
  assert.match(path.basename(file), /^[0-9a-f]{64}\.txt$/);
});

test("create without notes stamps no transcript and stores no file", async () => {
  const res = await post("/meetings/items", { meeting: "No notes", drafts });
  const { ids } = (await res.json()) as { ids: string[] };
  const row = store.getItem(ids[0]);
  assert.equal(row?.meta.transcript, undefined);
  assert.equal(fs.existsSync(transcriptFile(row?.meta.meetingId ?? "")), false);
  assert.equal(
    (await readTranscriptRoute(row?.meta.meetingId ?? "")).status,
    404,
  );
});

test("notes that are too long, blank or not text answer 400 and write nothing", async () => {
  const before = meetingItems().length;
  for (const notes of ["x".repeat(100_001), "   ", 42]) {
    const res = await post("/meetings/items", {
      meeting: "Oversize notes",
      drafts,
      notes,
    });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid-notes" });
  }
  assert.equal(meetingItems().length, before);
  assert.equal(
    fs.existsSync(
      transcriptFile(
        meetingId("paste", localDate(new Date()), "Oversize notes"),
      ),
    ),
    false,
  );
});

test("the transcript route refuses an id outside the meeting id shape and answers 404 for an unknown one", async () => {
  for (const id of [
    "../../config",
    "paste:2026-09-28-../../x",
    "calendar:2026-09-28-x",
    "",
  ]) {
    const res = await readTranscriptRoute(id);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "invalid-meeting-id" });
  }
  const missing = await fetch(`${base}/meetings/transcript`);
  assert.equal(missing.status, 400);
  const unknown = await readTranscriptRoute("paste:2026-01-01-never-pasted");
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: "not-found" });
});
