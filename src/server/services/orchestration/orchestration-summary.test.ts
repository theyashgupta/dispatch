import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { isolateEnv } from "../../test-support/fixtures.js";
import { fakeBoardRepository } from "../../test-support/fake-board-repository.js";
import type {
  BoardKey,
  Card,
  OrchestratorRecord,
} from "../../../shared/types.js";

isolateEnv();
const { store } = await import("../../store/board.store.js");
const { setBoardRepository } = await import("../../store/board-repository.js");
const { orchestrationSummary } = await import("./orchestration-summary.js");

afterEach(() => {
  setBoardRepository(store);
});

const BOARD = "ORCA" as BoardKey;

function card(id: string, extra: Partial<Card>): Card {
  return { id, identifier: `G-${id}`, column: "in_progress", ...extra } as Card;
}

function install(
  cards: Card[],
  policy: { concurrencyCap: number; budgetPerGroup: number | null } | null,
  orchestrators: OrchestratorRecord[] = [],
): void {
  setBoardRepository(
    fakeBoardRepository({
      getBoard: () =>
        policy === null
          ? undefined
          : ({ key: BOARD, policy, orchestrators } as never),
      getCard: () => undefined,
      listCards: () => cards,
      isStarting: () => false,
    }),
  );
}

test("orchestrationSummary lists the groups with loop progress or a session outside Done, with the board budget", () => {
  install(
    [
      card("loop", {
        source: "group",
        tmuxSession: "dsp-loop",
        sessions: [{ id: "s1", cost: 1.25 }] as never,
        loopProgress: {} as never,
      }),
      card("sessions-only", {
        source: "group",
        sessions: [{ id: "s2", cost: 0.5 }] as never,
      }),
      card("progress-only", { source: "group", loopProgress: {} as never }),
      card("queued", { source: "group" }),
      card("finished", {
        source: "group",
        column: "done",
        loopProgress: {} as never,
      }),
      card("plain", { sessions: [{ id: "s3", cost: 9 }] as never }),
    ],
    { concurrencyCap: 3, budgetPerGroup: 20 },
  );
  assert.deepEqual(orchestrationSummary(BOARD), {
    concurrencyCap: 3,
    runningLoops: 1,
    groups: [
      {
        cardId: "loop",
        groupId: "G-loop",
        cost: 1.25,
        budget: 20,
        budgetSource: "board",
        ownerName: null,
      },
      {
        cardId: "sessions-only",
        groupId: "G-sessions-only",
        cost: 0.5,
        budget: 20,
        budgetSource: "board",
        ownerName: null,
      },
      {
        cardId: "progress-only",
        groupId: "G-progress-only",
        cost: 0,
        budget: 20,
        budgetSource: "board",
        ownerName: null,
      },
    ],
  });
});

test("orchestrationSummary answers a null budget and cap when the board is gone", () => {
  install([card("g", { source: "group", loopProgress: {} as never })], null);
  const summary = orchestrationSummary(BOARD);
  assert.equal(summary.concurrencyCap, null);
  assert.equal(summary.runningLoops, 0);
  assert.equal(summary.groups[0]?.budget, null);
});

function record(
  id: string,
  role: "main" | "extra",
  budgetPerGroup: number | undefined,
  groupIds: string[] = [],
): OrchestratorRecord {
  return {
    id,
    name: `Orch ${id}`,
    role,
    scope: { groupIds, ticketIds: [] },
    policyOverride: budgetPerGroup === undefined ? {} : { budgetPerGroup },
    cardId: null,
    state: "running",
    createdAt: "2026-10-08T00:00:00Z",
  };
}

const GROUPS = [
  card("g1", { source: "group", loopProgress: {} as never }),
  card("g2", { source: "group", loopProgress: {} as never }),
];

test("orchestrationSummary takes a lower owner override and names the owner", () => {
  install(GROUPS, { concurrencyCap: 2, budgetPerGroup: 20 }, [
    record("main", "main", undefined),
    record("x1", "extra", 12, ["g1"]),
  ]);
  const [g1, g2] = orchestrationSummary(BOARD).groups;
  assert.deepEqual(
    [g1?.budget, g1?.budgetSource, g1?.ownerName],
    [12, "override", "Orch x1"],
  );
  assert.deepEqual(
    [g2?.budget, g2?.budgetSource, g2?.ownerName],
    [20, "board", null],
  );
});

test("orchestrationSummary ignores a higher owner override", () => {
  install(GROUPS, { concurrencyCap: 2, budgetPerGroup: 20 }, [
    record("x1", "extra", 50, ["g1"]),
  ]);
  const [g1] = orchestrationSummary(BOARD).groups;
  assert.deepEqual(
    [g1?.budget, g1?.budgetSource, g1?.ownerName],
    [20, "board", null],
  );
});

test("orchestrationSummary uses the board budget when no orchestrator owns the group", () => {
  install(GROUPS, { concurrencyCap: 2, budgetPerGroup: 20 });
  assert.deepEqual(
    orchestrationSummary(BOARD).groups.map((g) => [g.budget, g.ownerName]),
    [
      [20, null],
      [20, null],
    ],
  );
});
