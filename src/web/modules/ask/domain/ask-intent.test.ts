import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NAME_QUESTION,
  awaitingBoardName,
  createdAnswer,
  parseBoardIntent,
  refusedAnswer,
  resolveBoardIntent,
} from "./ask-intent.js";

const create = (name: string) => ({ kind: "create", name });

test("create phrases give the board name", () => {
  const rows: [string, string][] = [
    ["create a board called Payments", "Payments"],
    ["Create a new board called Payments", "Payments"],
    ["create a board named Payments", "Payments"],
    ["Create a new board named Ops.", "Ops"],
    ["please create a board called 'Ops'", "Ops"],
    ["new board called Payments", "Payments"],
    ["new board named Payments", "Payments"],
    ["make a board named Payments", "Payments"],
    ["new board Payments", "Payments"],
    ["add a board called Payments", "Payments"],
    ["CREATE A BOARD CALLED Payments", "Payments"],
    ["  create a board called Payments  ", "Payments"],
    ["please create a board called Payments", "Payments"],
    ["create a board called Payments please", "Payments"],
    ["create a board called Payments, please.", "Payments"],
    ["create a board called Payments!", "Payments"],
    ["create a board called Payments.", "Payments"],
    ['create a board called "Payments Team"', "Payments Team"],
    ["create a board called 'Payments Team'", "Payments Team"],
    ["create a board called Billing and Invoices", "Billing and Invoices"],
  ];
  for (const [text, name] of rows) {
    assert.deepEqual(parseBoardIntent(text), create(name), text);
  }
});

test("a quoted name keeps its own period", () => {
  assert.deepEqual(
    parseBoardIntent('create a board called "Acme Inc."'),
    create("Acme Inc."),
  );
});

test("phrases without a name ask for one", () => {
  for (const text of [
    "create a board",
    "Create a new board",
    "create a new board for me",
    "make me a board",
    "new board",
    "create a board please",
    "Please create a board.",
  ]) {
    assert.deepEqual(parseBoardIntent(text), { kind: "needs-name" }, text);
  }
});

test("cancel words give cancel", () => {
  for (const text of ["cancel", "Never mind", "nevermind", "stop", "stop."]) {
    assert.deepEqual(parseBoardIntent(text), { kind: "cancel" }, text);
  }
});

test("ordinary messages, questions and other objects give null", () => {
  for (const text of [
    "",
    "   ",
    "how do I create a board?",
    "can you create a board called X?",
    "what is a board",
    "create a ticket called X",
    "create a boards page",
    "list my boards",
    "I want to create a board called X",
    "cancel my ticket",
    "stop the session on LOCAL-1",
    "create a board called",
    'create a board called ""',
    "create board Payments",
    "create a board for Payments",
    "add a board to track payments",
    "make board columns narrower",
    "new board called",
  ]) {
    assert.equal(parseBoardIntent(text), null, text);
  }
});

test("a name is awaited only while the last turn is the name question from the assistant", () => {
  const asked = { role: "assistant", text: NAME_QUESTION } as const;
  assert.equal(awaitingBoardName([]), false);
  assert.equal(awaitingBoardName([asked]), true);
  assert.equal(
    awaitingBoardName([asked, { role: "user", text: "summarize my day" }]),
    false,
  );
  assert.equal(
    awaitingBoardName([{ role: "user", text: NAME_QUESTION }]),
    false,
  );
});

test("while a name is awaited any message but a cancel, a create or a question is the name", () => {
  assert.deepEqual(resolveBoardIntent("Ops", true), create("Ops"));
  assert.deepEqual(resolveBoardIntent("  Ops Team ", true), create("Ops Team"));
  assert.deepEqual(resolveBoardIntent("'Ops Team'", true), create("Ops Team"));
  assert.deepEqual(resolveBoardIntent("“Ops”", true), create("Ops"));
  assert.deepEqual(
    resolveBoardIntent("create a board called Ops", true),
    create("Ops"),
  );
  assert.deepEqual(resolveBoardIntent("never mind", true), { kind: "cancel" });
  assert.equal(resolveBoardIntent("   ", true), null);
});

test("while a name is awaited a needs-name message asks again", () => {
  for (const text of [
    "create a board",
    "new board",
    "Please make me a board.",
  ]) {
    assert.deepEqual(
      resolveBoardIntent(text, true),
      { kind: "needs-name" },
      text,
    );
  }
});

test("while a name is awaited a question is an ordinary message", () => {
  for (const text of [
    "what boards exist?",
    "how do I name it? ",
    "create a board?",
  ]) {
    assert.equal(resolveBoardIntent(text, true), null, text);
  }
});

test("with no name awaited a cancel is an ordinary message", () => {
  assert.equal(resolveBoardIntent("cancel", false), null);
  assert.deepEqual(resolveBoardIntent("new board", false), {
    kind: "needs-name",
  });
  assert.equal(resolveBoardIntent("hello", false), null);
});

test("the answers carry the key, an in-app link and the name as code", () => {
  assert.equal(
    createdAnswer("Billing", "BILLIN"),
    "Created board `Billing` with key BILLIN. [Open `Billing`](#/boards/BILLIN)",
  );
  assert.equal(
    createdAnswer("a`b", "AB"),
    "Created board ``a`b`` with key AB. [Open ``a`b``](#/boards/AB)",
  );
  assert.equal(
    createdAnswer("x\n\n[x](https://evil.example)", "OPS").split(
      " with key ",
    )[0],
    "Created board `x [x](https://evil.example)`",
  );
  assert.equal(
    refusedAnswer("Key is taken."),
    "Could not create the board: Key is taken\\.",
  );
});
