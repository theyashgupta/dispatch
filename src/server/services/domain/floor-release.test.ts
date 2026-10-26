import test from "node:test";
import assert from "node:assert/strict";
import type {
  Card,
  Column,
  LoopEngine,
  Session,
} from "../../../shared/types.js";
import { floorReleasable } from "./floor-release.js";

interface CardOptions {
  column?: Column;
  engine?: Pick<LoopEngine, "active" | "closed"> | null;
  shipState?: "running" | "stopped" | "done";
  paused?: boolean;
  source?: string;
}

function makeCard(options: CardOptions = {}): Card {
  return {
    id: "card-1",
    column: options.column ?? "agent_done",
    source: options.source,
    loopProgress:
      options.engine === undefined || options.engine === null
        ? undefined
        : { engine: options.engine },
    shipFlow:
      options.shipState === undefined
        ? undefined
        : { state: options.shipState },
    paused: options.paused
      ? { at: "2026-10-26T00:00:00.000Z", by: "memory", reason: "x" }
      : undefined,
  } as unknown as Card;
}

function makeSession(over: Partial<Session> = {}): Session {
  return { id: "session-1", tmuxSession: "dsp-1", ...over } as Session;
}

void test("a card in agent_done is releasable", () => {
  assert.equal(floorReleasable(makeCard(), makeSession(), false), true);
});

void test("a card in done is releasable", () => {
  assert.equal(
    floorReleasable(makeCard({ column: "done" }), makeSession(), false),
    true,
  );
});

void test("a card in progress with a closed engine is releasable", () => {
  const card = makeCard({
    column: "in_progress",
    engine: { active: true, closed: true },
  });
  assert.equal(floorReleasable(card, makeSession(), false), true);
});

void test("a card in progress with an inactive engine is releasable", () => {
  const card = makeCard({
    column: "in_progress",
    engine: { active: false, closed: false },
  });
  assert.equal(floorReleasable(card, makeSession(), false), true);
});

void test("a card in progress with no engine is not releasable", () => {
  const card = makeCard({ column: "in_progress" });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("an open engine keeps the session in agent_done", () => {
  const card = makeCard({
    column: "agent_done",
    engine: { active: true, closed: false },
  });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("an open engine keeps the session in done", () => {
  const card = makeCard({
    column: "done",
    engine: { active: true, closed: false },
  });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("a running ship flow keeps the session", () => {
  const card = makeCard({ shipState: "running" });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("a stopped ship flow keeps the session", () => {
  const card = makeCard({ shipState: "stopped" });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("a done ship flow does not keep the session", () => {
  const card = makeCard({ shipState: "done" });
  assert.equal(floorReleasable(card, makeSession(), false), true);
});

void test("a paused card is not releasable", () => {
  const card = makeCard({ paused: true });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});

void test("a card that is starting is not releasable", () => {
  assert.equal(floorReleasable(makeCard(), makeSession(), true), false);
});

void test("a session with no tmux session is not releasable", () => {
  const session = makeSession({ tmuxSession: undefined });
  assert.equal(floorReleasable(makeCard(), session, false), false);
});

void test("a session already released is not releasable", () => {
  const session = makeSession({ state: "released" });
  assert.equal(floorReleasable(makeCard(), session, false), false);
});

void test("a session waiting at needs_input is not releasable", () => {
  const session = makeSession({ state: "needs_input" });
  assert.equal(floorReleasable(makeCard(), session, false), false);
});

void test("a hidden orchestrator card is not releasable", () => {
  const card = makeCard({ source: "orchestrator" });
  assert.equal(floorReleasable(card, makeSession(), false), false);
});
