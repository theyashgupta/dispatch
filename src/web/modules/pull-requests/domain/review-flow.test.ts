import assert from "node:assert/strict";
import { test } from "node:test";
import type { BoardKey, Column, PrDetail } from "../../../../shared/types.js";
import type { StartRequest } from "../../../../shared/start-request.js";
import {
  reviewPullRequestWithAgent,
  type ReviewFlowDeps,
} from "./review-flow.js";

const target = { owner: "o", name: "r", repo: "o/r", number: 7 };
const detail = {
  title: "Fix race",
  body: "Body",
  head: "fix/race",
  base: "main",
  files: [],
  checks: [],
} as unknown as PrDetail;

const LOCAL = "LOCAL" as BoardKey;
const ACME = "ACME" as BoardKey;

function setup(
  column: Column,
  overrides: Partial<ReviewFlowDeps> = {},
  cardBoard: BoardKey = LOCAL,
) {
  const log: string[] = [];
  const starts: StartRequest[] = [];
  const deps: ReviewFlowDeps = {
    currentBoard: LOCAL,
    switchBoard: async (board) => {
      log.push(`switch ${board}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      log.push(`switched ${board}`);
    },
    loadDetail: () => {
      log.push("load");
      return Promise.resolve({ ok: true, detail });
    },
    openReviewCard: () => {
      log.push("card");
      return Promise.resolve({
        ok: true,
        cardId: "LOCAL-5",
        created: true,
        column,
        boardKey: cardBoard,
      });
    },
    moveToTodo: (id, board) => {
      log.push(`move ${id} on ${board}`);
      return Promise.resolve();
    },
    openStart: (request) => {
      log.push("start");
      starts.push(request);
    },
    openCard: (id) => log.push(`open ${id}`),
    notice: (text) => log.push(`notice ${text}`),
    ...overrides,
  };
  return { deps, log, starts };
}

test("an Inbox card moves to To Do, then opens the Start dialog with the review tag and playbook", async () => {
  const { deps, log, starts } = setup("inbox");
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, ["load", "card", "move LOCAL-5 on LOCAL", "start"]);
  assert.equal(starts[0]?.cardId, "LOCAL-5");
  assert.equal(starts[0]?.playbookTag, "review");
  assert.equal(starts[0]?.playbook, "Review a pull request");
  assert.match(starts[0]?.extraDirection ?? "", /o\/r/);
});

test("a To Do card opens the Start dialog without a move", async () => {
  const { deps, log } = setup("todo");
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, ["load", "card", "start"]);
});

test("a card past To Do opens the card and starts no second session", async () => {
  const { deps, log } = setup("in_progress");
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, ["load", "card", "open LOCAL-5"]);
});

test("a card on another board switches to that board before it moves and opens the Start dialog", async () => {
  const { deps, log } = setup("inbox", {}, ACME);
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, [
    "load",
    "card",
    "switch ACME",
    "switched ACME",
    "move LOCAL-5 on ACME",
    "start",
  ]);
});

test("a card past To Do on another board switches to it before the card opens", async () => {
  const { deps, log } = setup("in_progress", {}, ACME);
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, [
    "load",
    "card",
    "switch ACME",
    "switched ACME",
    "open LOCAL-5",
  ]);
});

test("a detail failure shows a notice and makes no card", async () => {
  const { deps, log } = setup("inbox", {
    loadDetail: () => Promise.resolve({ ok: false, error: "not-found" }),
  });
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, ["notice GitHub could not find this pull request."]);
});

test("a refused card route shows its notice and opens no dialog", async () => {
  const { deps, log } = setup("inbox", {
    openReviewCard: () => Promise.resolve({ ok: false, error: "no-workspace" }),
  });
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, [
    "load",
    "notice No board repository matches this pull request.",
  ]);
});

test("a failed move shows one notice and opens no dialog", async () => {
  const { deps, log } = setup("inbox", {
    moveToTodo: () => Promise.reject(new Error("boom")),
  });
  await reviewPullRequestWithAgent(deps, target);
  assert.deepEqual(log, [
    "load",
    "card",
    "notice Couldn't start the review. Try again.",
  ]);
});
