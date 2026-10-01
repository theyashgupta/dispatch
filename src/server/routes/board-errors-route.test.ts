import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, afterEach, test } from "node:test";
import type { Server } from "node:http";
import { isolateEnv } from "../test-support/fixtures.js";
import {
  queueLinearFetch,
  restoreFetch,
} from "../test-support/linear-fetch.js";
import { DEFAULT_TERMINAL_APPEARANCE } from "../../shared/terminal-appearance.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { rebuildSources } = await import("../adapters/source-gateway.js");
const { stopPollers } = await import("../adapters/poller.js");
const { setOrchestrationConfig } =
  await import("../services/infra/config-holder.js");
const express = (await import("express")).default;
const { boardRouter } = await import("./board.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
setOrchestrationConfig({ linearApiKey: "k" });
await store.load();

const app = express();
app.use("/api", express.json(), boardRouter);
app.use(httpErrorHandler);
const server: Server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;

after(() => {
  stopPollers();
  server.close();
  env.cleanup();
});
afterEach(() => {
  restoreFetch();
});

const linearOn = () =>
  rebuildSources({ linearApiKey: "k", sources: { linear: { apiKey: "k" } } });

interface Reply {
  status: number;
  text: string;
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  raw?: string,
): Promise<Reply> {
  const res = await fetch(`${base}${route}`, {
    method,
    headers:
      body === undefined && raw === undefined
        ? {}
        : { "Content-Type": "application/json" },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, text: await res.text() };
}

async function expectReply(
  reply: Promise<Reply>,
  status: number,
  text: string,
  label = "",
): Promise<void> {
  const got = await reply;
  assert.equal(got.status, status, label);
  assert.equal(got.text, text, label);
}

const validFilters = {
  assignees: ["u1"],
  projects: [],
  teams: ["t1"],
  currentCycle: false,
  includeActive: true,
};

test("GET /board answers 400 for an invalid doneLimit", async () => {
  const text =
    '{"error":"doneLimit must be a whole number between 1 and 5000"}';
  for (const query of [
    "?doneLimit=",
    "?doneLimit=%20",
    "?doneLimit=0",
    "?doneLimit=-1",
    "?doneLimit=1.5",
    "?doneLimit=5001",
    "?doneLimit=abc",
    "?doneLimit=1&doneLimit=2",
  ]) {
    await expectReply(call("GET", `/board${query}`), 400, text, query);
  }
});

test("GET /board answers 200 for an absent or valid doneLimit", async () => {
  for (const query of [
    "",
    "?doneLimit=1",
    "?doneLimit=5000",
    "?doneLimit=1e3",
  ]) {
    const got = await call("GET", `/board${query}`);
    assert.equal(got.status, 200, query);
  }
});

test("GET /search answers 400 q is required for a missing or repeated q", async () => {
  const text = '{"error":"q is required"}';
  for (const query of ["", "?x=1", "?q=ab&q=cd", "?q[a]=ab"]) {
    await expectReply(call("GET", `/search${query}`), 400, text, query);
  }
});

test("GET /search answers 400 for a q outside the length bounds after trimming", async () => {
  const text = '{"error":"q must be between 2 and 100 characters"}';
  for (const q of ["", "a", "  a  ", "a".repeat(101), "\u{1F600}".repeat(51)]) {
    await expectReply(
      call("GET", `/search?q=${encodeURIComponent(q)}`),
      400,
      text,
      JSON.stringify(q),
    );
  }
});

test("GET /search answers 200 at the bounds, counting UTF-16 units", async () => {
  for (const q of [
    " ab ",
    "a".repeat(100),
    "\u{1F600}",
    "\u{1F600}".repeat(50),
  ]) {
    const got = await call("GET", `/search?q=${encodeURIComponent(q)}`);
    assert.equal(got.status, 200, JSON.stringify(q));
  }
});

test("POST /workspace-folders answers 400 path is required for a missing, blank or wrong-type path", async () => {
  const text = '{"error":"path is required"}';
  await expectReply(call("POST", "/workspace-folders"), 400, text, "no body");
  for (const body of [
    {},
    [],
    { path: "" },
    { path: "   " },
    { path: 1 },
    { path: ["/a"] },
    { path: null },
  ]) {
    await expectReply(
      call("POST", "/workspace-folders", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("POST /workspace-folders answers 400 for a missing folder, a file, and a folder with no repos", async () => {
  const file = path.join(env.root, "plain-file");
  fs.writeFileSync(file, "x");
  const empty = path.join(env.root, "empty-folder");
  fs.mkdirSync(empty, { recursive: true });
  await expectReply(
    call("POST", "/workspace-folders", { path: path.join(env.root, "nope") }),
    400,
    '{"error":"Folder doesn\'t exist"}',
  );
  await expectReply(
    call("POST", "/workspace-folders", { path: file }),
    400,
    '{"error":"Not a folder"}',
  );
  await expectReply(
    call("POST", "/workspace-folders", { path: empty }),
    400,
    '{"error":"No git repositories found in this folder"}',
  );
});

test("GET /workspace-folders/discover answers 400 path is required for a missing, blank or repeated path", async () => {
  const text = '{"error":"path is required"}';
  for (const query of ["", "?path=", "?path=%20%20", "?path=a&path=b"]) {
    await expectReply(
      call("GET", `/workspace-folders/discover${query}`),
      400,
      text,
      query,
    );
  }
});

test("GET /fs/dirs answers 400 invalid path for a repeated path", async () => {
  await expectReply(
    call("GET", "/fs/dirs?path=a&path=b"),
    400,
    '{"error":"invalid path"}',
  );
});

test("GET /fs/dirs answers 400 for a folder outside HOME", async () => {
  for (const p of ["/", "/etc"]) {
    await expectReply(
      call("GET", `/fs/dirs?path=${encodeURIComponent(p)}`),
      400,
      '{"error":"Outside allowed directory"}',
      p,
    );
  }
});

test("DELETE /workspace-folders answers 400 path is required for a missing, blank or wrong-type path", async () => {
  const text = '{"error":"path is required"}';
  await expectReply(call("DELETE", "/workspace-folders"), 400, text, "no body");
  for (const body of [{}, [], { path: "" }, { path: " " }, { path: 7 }]) {
    await expectReply(
      call("DELETE", "/workspace-folders", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("GET /sources/:source/filters answers 404 for an unknown source", async () => {
  linearOn();
  await expectReply(
    call("GET", "/sources/nope/filters"),
    404,
    '{"error":"unknown source"}',
  );
});

test("GET /sources/:source/options answers 400 invalid dimension before the source lookup", async () => {
  linearOn();
  const text = '{"error":"invalid dimension"}';
  for (const route of [
    "/sources/linear/options",
    "/sources/linear/options?dimension=cycle",
    "/sources/linear/options?dimension=Teams",
    "/sources/linear/options?dimension=teams&dimension=projects",
    "/sources/nope/options?dimension=bad",
  ]) {
    await expectReply(call("GET", route), 400, text, route);
  }
});

test("GET /sources/:source/options answers 404 for an unknown source", async () => {
  linearOn();
  await expectReply(
    call("GET", "/sources/nope/options?dimension=teams"),
    404,
    '{"error":"unknown source"}',
  );
});

test("GET /sources/:source/options answers 502 when Linear fails", async () => {
  linearOn();
  queueLinearFetch([[500, {}]]);
  await expectReply(
    call("GET", "/sources/linear/options?dimension=teams"),
    502,
    '{"error":"source options unavailable"}',
  );
});

test("POST /sources/:source/preview answers 400 invalid filters before the source lookup", async () => {
  linearOn();
  const text = '{"error":"invalid filters"}';
  await expectReply(
    call("POST", "/sources/linear/preview"),
    400,
    text,
    "no body",
  );
  for (const body of [
    {},
    [],
    { filters: null },
    { filters: [] },
    { filters: { ...validFilters, extra: true } },
    { filters: { ...validFilters, teams: [1] } },
    { filters: { ...validFilters, currentCycle: "no" } },
    {
      filters: { assignees: [], projects: [], teams: [], currentCycle: false },
    },
  ]) {
    await expectReply(
      call("POST", "/sources/linear/preview", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call("POST", "/sources/nope/preview", { filters: 1 }),
    400,
    text,
    "unknown source with bad filters",
  );
});

test("POST /sources/:source/preview answers 404 for an unknown source", async () => {
  linearOn();
  await expectReply(
    call("POST", "/sources/nope/preview", { filters: validFilters }),
    404,
    '{"error":"unknown source"}',
  );
});

test("POST /sources/:source/preview answers 502 when Linear fails", async () => {
  linearOn();
  queueLinearFetch([[500, {}]]);
  await expectReply(
    call("POST", "/sources/linear/preview", { filters: validFilters }),
    502,
    '{"error":"preview unavailable"}',
  );
});

test("POST /sources/:source/poll answers 404, then 409 disabled, then 409 not polling", async () => {
  linearOn();
  await expectReply(
    call("POST", "/sources/nope/poll"),
    404,
    '{"error":"unknown source"}',
  );
  rebuildSources({
    linearApiKey: "k",
    sources: { linear: { apiKey: "k", enabled: false } },
  });
  await expectReply(
    call("POST", "/sources/linear/poll"),
    409,
    '{"error":"source disabled"}',
  );
  linearOn();
  stopPollers();
  await expectReply(
    call("POST", "/sources/linear/poll"),
    409,
    '{"error":"source not polling"}',
  );
});

test("PUT /sources/:source/filters answers 404 for an unknown source before the body check", async () => {
  linearOn();
  const text = '{"error":"unknown source"}';
  await expectReply(call("PUT", "/sources/nope/filters"), 404, text, "no body");
  await expectReply(
    call("PUT", "/sources/nope/filters", { filters: 1 }),
    404,
    text,
    "bad filters",
  );
});

test("PUT /sources/:source/filters answers 400 invalid filters", async () => {
  linearOn();
  const text = '{"error":"invalid filters"}';
  await expectReply(
    call("PUT", "/sources/linear/filters"),
    400,
    text,
    "no body",
  );
  for (const body of [
    {},
    [],
    { filters: "x" },
    { filters: { ...validFilters, includeActive: 1 } },
    { filters: { ...validFilters, assignees: "u1" } },
  ]) {
    await expectReply(
      call("PUT", "/sources/linear/filters", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("PUT /sources/:source/filters echoes the filters in the client's key order", async () => {
  linearOn();
  stopPollers();
  const raw =
    '{"filters":{"includeActive":true,"teams":["t1"],"currentCycle":false,"projects":[],"assignees":["u1"]}}';
  await expectReply(
    call("PUT", "/sources/linear/filters", undefined, raw),
    200,
    raw,
  );
});

test("PUT /config/cleanup-delay answers 400 for anything but a whole number of days in 0 to 90", async () => {
  const text =
    '{"error":"cleanup delay must be a whole number of days between 0 and 90"}';
  await expectReply(call("PUT", "/config/cleanup-delay"), 400, text, "no body");
  for (const body of [
    {},
    [],
    { cleanupDelayDays: "5" },
    { cleanupDelayDays: -1 },
    { cleanupDelayDays: 91 },
    { cleanupDelayDays: 1.5 },
    { cleanupDelayDays: null },
  ]) {
    await expectReply(
      call("PUT", "/config/cleanup-delay", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
  await expectReply(
    call(
      "PUT",
      "/config/cleanup-delay",
      undefined,
      '{"cleanupDelayDays":1e999}',
    ),
    400,
    text,
    "Infinity",
  );
});

test("PUT /config/cleanup-delay answers 200 at the bounds", async () => {
  await expectReply(
    call(
      "PUT",
      "/config/cleanup-delay",
      undefined,
      '{"cleanupDelayDays":90.0}',
    ),
    200,
    '{"cleanupDelayDays":90}',
  );
  await expectReply(
    call("PUT", "/config/cleanup-delay", undefined, '{"cleanupDelayDays":-0}'),
    200,
    '{"cleanupDelayDays":0}',
  );
});

test("PUT /config/archive-retention answers 400 for anything but a whole number of days in 0 to 365", async () => {
  const text =
    '{"error":"archive retention must be a whole number of days between 0 and 365"}';
  await expectReply(
    call("PUT", "/config/archive-retention"),
    400,
    text,
    "no body",
  );
  for (const body of [
    {},
    [],
    { archiveRetentionDays: "30" },
    { archiveRetentionDays: -1 },
    { archiveRetentionDays: 366 },
    { archiveRetentionDays: 0.5 },
  ]) {
    await expectReply(
      call("PUT", "/config/archive-retention", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("PUT /config/archive-retention answers 200 at the upper bound", async () => {
  await expectReply(
    call("PUT", "/config/archive-retention", { archiveRetentionDays: 365 }),
    200,
    '{"archiveRetentionDays":365}',
  );
});

test("PUT /config/terminal answers 400 with the first failing field's message", async () => {
  const good = DEFAULT_TERMINAL_APPEARANCE;
  const objectText = '{"error":"terminal appearance must be an object"}';
  await expectReply(
    call("PUT", "/config/terminal"),
    400,
    objectText,
    "no body",
  );
  await expectReply(
    call("PUT", "/config/terminal", []),
    400,
    objectText,
    "array",
  );
  const cases: [unknown, string][] = [
    [{}, '{"error":"background must be a #rrggbb color"}'],
    [
      { ...good, background: "red", foreground: "red" },
      '{"error":"background must be a #rrggbb color"}',
    ],
    [
      { ...good, foreground: "#12345", cursor: 1 },
      '{"error":"foreground must be a #rrggbb color"}',
    ],
    [{ ...good, cursor: null }, '{"error":"cursor must be a #rrggbb color"}'],
    [
      { ...good, fontSize: 7, fontFamily: "Comic" },
      '{"error":"fontSize must be a whole number between 8 and 32"}',
    ],
    [
      { ...good, fontSize: 12.5 },
      '{"error":"fontSize must be a whole number between 8 and 32"}',
    ],
    [
      { ...good, fontFamily: "Comic" },
      '{"error":"fontFamily must be one of the offered fonts"}',
    ],
  ];
  for (const [body, text] of cases) {
    await expectReply(
      call("PUT", "/config/terminal", body),
      400,
      text,
      JSON.stringify(body),
    );
  }
});

test("PUT /config/terminal answers 200 with the normalized appearance in fixed key order", async () => {
  const { fontFamily, fontSize } = DEFAULT_TERMINAL_APPEARANCE;
  const body = {
    fontSize,
    fontFamily,
    cursor: "#AABBCC",
    foreground: "#DDEEFF",
    background: "#112233",
    extra: 1,
  };
  await expectReply(
    call("PUT", "/config/terminal", body),
    200,
    JSON.stringify({
      background: "#112233",
      foreground: "#ddeeff",
      cursor: "#aabbcc",
      fontFamily,
      fontSize,
    }),
  );
});

test("PUT /config/claude-args answers 400 for a non-string, an over-long string or a control byte", async () => {
  const text =
    '{"error":"claude arguments must be a string of 4000 characters or fewer with no control characters"}';
  await expectReply(call("PUT", "/config/claude-args"), 400, text, "no body");
  for (const body of [
    {},
    [],
    { claudeArgs: 1 },
    { claudeArgs: null },
    { claudeArgs: ["-x"] },
    { claudeArgs: "a".repeat(4001) },
    { claudeArgs: "\u{1F600}".repeat(2001) },
    { claudeArgs: "a\tb" },
    { claudeArgs: "a\x7f" },
  ]) {
    await expectReply(
      call("PUT", "/config/claude-args", body),
      400,
      text,
      JSON.stringify(body).slice(0, 40),
    );
  }
});

test("PUT /config/claude-args answers 200 at the length bound, counting UTF-16 units", async () => {
  for (const claudeArgs of [
    "",
    "a\nb",
    "a".repeat(4000),
    "\u{1F600}".repeat(2000),
  ]) {
    await expectReply(
      call("PUT", "/config/claude-args", { claudeArgs }),
      200,
      JSON.stringify({ claudeArgs }),
      claudeArgs.slice(0, 10),
    );
  }
});
