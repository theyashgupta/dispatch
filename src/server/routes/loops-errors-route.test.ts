import test, { after } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../test-support/fixtures.js";
import { fakeBoardRepository } from "../test-support/fake-board-repository.js";
import { DEFAULT_BOARD_KEY } from "../../shared/board-key.js";

const env = isolateEnv();
const { store } = await import("../store/board.store.js");
const { setBoardRepository } = await import("../store/board-repository.js");
const { registerHookToken } =
  await import("../services/orchestration/hook-tokens.js");
const { loopsRouter } = await import("./loops.route.js");
const { httpErrorHandler } = await import("./error-handler.js");
const express = (await import("express")).default;

await store.load();
const members = [
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loops-err-member-a", ""),
  await store.createLocalCard(DEFAULT_BOARD_KEY, "loops-err-member-b", ""),
];
const grouped = await store.createGroupCard(
  DEFAULT_BOARD_KEY,
  "loops-err-group",
  members.map((m) => m.id),
);
assert.ok(grouped.ok);
await store.completeStart(grouped.card.id, undefined, {
  workspacePath: "/tmp/ws-loops-err-group",
  tmuxSession: "dsp-loops-err-group-none",
  branch: "loops-err-group",
});
const groupCard = store.getCard(grouped.card.id)!;
const GROUP_TOKEN = "loops-err-group-token-0123456789";
registerHookToken(GROUP_TOKEN, groupCard.id, groupCard.activeSessionId!);

const ticket = await store.createLocalCard(
  DEFAULT_BOARD_KEY,
  "loops-err-ticket",
  "",
);
await store.completeStart(ticket.id, undefined, {
  workspacePath: "/tmp/ws-loops-err-ticket",
  tmuxSession: "dsp-loops-err-ticket-none",
  branch: "loops-err-ticket",
});
const TICKET_TOKEN = "loops-err-ticket-token-0123456789";
registerHookToken(
  TICKET_TOKEN,
  ticket.id,
  store.getCard(ticket.id)!.activeSessionId!,
);

const app = express();
app.use("/api", express.json(), loopsRouter);
app.use(httpErrorHandler);
const server = await new Promise<import("node:http").Server>((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/loops/report`;
after(() => {
  server.close();
  env.cleanup();
});

function post(token: string | undefined, body: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token !== undefined) headers["x-dispatch-token"] = token;
  return fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
}

function rows() {
  return store.listOrchestrationEvents(DEFAULT_BOARD_KEY, 0, 100);
}

const GOOD = { kind: "phase", unit: 2, phase: 5, result: "pass", note: "ok" };

void test("a missing token header answers 401 and writes nothing", async () => {
  const before = rows().length;

  const res = await post(undefined, GOOD);

  assert.equal(res.status, 401);
  assert.equal(rows().length, before);
});

void test("an empty token header answers 401 and writes nothing", async () => {
  const before = rows().length;

  const res = await post("", GOOD);

  assert.equal(res.status, 401);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, "invalid hook token");
  assert.equal(rows().length, before);
});

void test("an unknown token answers 401 and writes nothing", async () => {
  const before = rows().length;

  const res = await post("loops-unknown-token-0123456789", GOOD);

  assert.equal(res.status, 401);
  assert.equal(rows().length, before);
});

void test("a wrong token with a body that fails the schema answers 401, not 400", async () => {
  const before = rows().length;

  const res = await post("loops-unknown-token-0123456789", { unit: 0 });

  assert.equal(res.status, 401);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, "invalid hook token");
  assert.equal(rows().length, before);
});

void test("a token of a non group card answers 400 and writes nothing", async () => {
  const before = rows().length;

  const res = await post(TICKET_TOKEN, GOOD);

  assert.equal(res.status, 400);
  const payload = (await res.json()) as { error: string };
  assert.equal(payload.error, "not-group-card");
  assert.equal(rows().length, before);
});

void test("a failing event append answers 500 loop-report-failed and writes no row", async () => {
  const before = rows().length;
  const warn = console.warn;
  console.warn = (): void => undefined;
  setBoardRepository(
    fakeBoardRepository({
      getCard: (id) => store.getCard(id),
      appendOrchestrationEvent: () => {
        throw new Error("disk full");
      },
    }),
  );
  try {
    const res = await post(GROUP_TOKEN, GOOD);

    assert.equal(res.status, 500);
    const payload = (await res.json()) as { error: string };
    assert.equal(payload.error, "loop-report-failed");
  } finally {
    setBoardRepository(store);
    console.warn = warn;
  }
  assert.equal(rows().length, before);
});

const BAD_BODIES: [string, unknown, string][] = [
  [
    "kind phase without phase",
    { kind: "phase", unit: 1, result: "pass" },
    "phase-required",
  ],
  ["extra cardId key", { ...GOOD, cardId: "other" }, "unknown-field"],
  ["unit 0", { ...GOOD, unit: 0 }, "invalid-unit"],
  [
    "note of 501 characters",
    { ...GOOD, note: "x".repeat(501) },
    "invalid-note",
  ],
  ["result maybe", { ...GOOD, result: "maybe" }, "invalid-result"],
  ["kind step", { ...GOOD, kind: "step" }, "invalid-kind"],
  ["a phase above 99", { ...GOOD, phase: 100 }, "invalid-phase"],
];

for (const [name, body, code] of BAD_BODIES) {
  void test(`a body with ${name} answers 400 ${code} and writes nothing`, async () => {
    const before = rows().length;

    const res = await post(GROUP_TOKEN, body);

    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: string };
    assert.equal(payload.error, code);
    assert.equal(rows().length, before);
  });
}
