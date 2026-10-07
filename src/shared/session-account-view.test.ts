import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MOVE_FAILED_NOTE,
  accountName,
  moveNote,
  pendingNote,
  sessionAccountView,
} from "./session-account-view.js";
import type { AccountSessionEntry, ClaudeAccountSummary } from "./types.js";

function account(
  patch: Pick<ClaudeAccountSummary, "id" | "email"> &
    Partial<ClaudeAccountSummary>,
): ClaudeAccountSummary {
  return {
    orgName: "",
    subscriptionType: "",
    isDefault: false,
    usage: { status: "ok", windows: [], fetchedAt: null },
    position: 0,
    state: "available",
    buckets: [],
    limitedUntil: null,
    inUse: false,
    ...patch,
  };
}

const accounts = [
  account({ id: "default", email: "me@home.test", isDefault: true }),
  account({ id: "acc-1", email: "work@corp.test" }),
];

function entry(patch: Partial<AccountSessionEntry> = {}): AccountSessionEntry {
  return {
    cardId: "C-1",
    sessionId: "s-1",
    cardTitle: "A card",
    accountId: "acc-1",
    turn: "idle",
    stale: false,
    pinned: false,
    ...patch,
  };
}

test("the Default account shows as Default, an added one as its email", () => {
  assert.equal(accountName(accounts, "default"), "Default");
  assert.equal(accountName(accounts, "acc-1"), "work@corp.test");
});

test("an account missing from the list shows as its id", () => {
  assert.equal(accountName(accounts, "gone"), "gone");
});

test("an added account reads as its email", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry()],
  });
  assert.deepEqual(view, {
    accountId: "acc-1",
    name: "work@corp.test",
    stale: false,
  });
});

test("the Default account is named Default, also when the list is empty", () => {
  const sessions = [entry({ accountId: "default" })];
  assert.equal(
    sessionAccountView({
      sessionId: "s-1",
      accountId: null,
      accounts,
      sessions,
    })?.name,
    "Default",
  );
  assert.equal(
    sessionAccountView({
      sessionId: "s-1",
      accountId: null,
      accounts: [],
      sessions,
    })?.name,
    "Default",
  );
  assert.equal(
    sessionAccountView({
      sessionId: null,
      accountId: "default",
      accounts: undefined,
      sessions: undefined,
    })?.name,
    "Default",
  );
});

test("a stale entry is stale", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ stale: true })],
  });
  assert.equal(view?.stale, true);
});

test("a limit with allowance carries the continue action", () => {
  for (const continueAction of ["available", "usage-unknown"] as const) {
    const view = sessionAccountView({
      sessionId: "s-1",
      accountId: "acc-1",
      accounts,
      sessions: [entry({ turn: "limit", continueAction })],
    });
    assert.equal(view?.continueAction, continueAction);
  }
});

test("a limit without allowance has no continue action key", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ turn: "limit" })],
  });
  assert.ok(view != null);
  assert.equal("continueAction" in view, false);
});

test("a session with no entry falls back to the passed account, not stale", () => {
  const view = sessionAccountView({
    sessionId: "s-9",
    accountId: "acc-1",
    accounts,
    sessions: [entry()],
  });
  assert.deepEqual(view, {
    accountId: "acc-1",
    name: "work@corp.test",
    stale: false,
  });
});

test("the entry account wins over the passed account", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "default",
    accounts,
    sessions: [entry({ accountId: "acc-1" })],
  });
  assert.equal(view?.accountId, "acc-1");
});

test("no entry and no account id gives null", () => {
  assert.equal(
    sessionAccountView({
      sessionId: "s-9",
      accountId: undefined,
      accounts,
      sessions: [entry()],
    }),
    null,
  );
});

test("a removed account shows its id", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ accountId: "gone" })],
  });
  assert.equal(view?.name, "gone");
});

test("an added account has no view until the accounts list loads", () => {
  const input = {
    sessionId: "s-1",
    accountId: "acc-1",
    accounts: undefined,
    sessions: [entry()],
  };
  assert.equal(sessionAccountView(input), null);
  assert.equal(sessionAccountView({ ...input, sessions: undefined }), null);
});

test("an unlisted Default account is named Default", () => {
  assert.equal(accountName([], "default"), "Default");
  assert.equal(accountName([accounts[1]], "default"), "Default");
});

test("a queued move to another account carries a pending note", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "default",
    accounts,
    sessions: [entry({ accountId: "default", pendingAccountId: "acc-1" })],
  });
  assert.equal(view?.pendingNote, "Moves to work@corp.test after this turn");
});

test("a queued move to its own account reads as a restart", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ pendingAccountId: "acc-1" })],
  });
  assert.equal(view?.pendingNote, "Restarts after this turn");
});

test("a queued move to the entry's own account reads as a restart even when another account id is passed", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "default",
    accounts,
    sessions: [entry({ accountId: "acc-1", pendingAccountId: "acc-1" })],
  });
  assert.equal(view?.accountId, "acc-1");
  assert.equal(view?.pendingNote, "Restarts after this turn");
});

test("a queued move to an account missing from the list names the id", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ pendingAccountId: "gone" })],
  });
  assert.equal(view?.pendingNote, "Moves to gone after this turn");
});

test("a listed account with an empty email shows its id", () => {
  const listed = [...accounts, account({ id: "acc-2", email: "" })];
  assert.equal(accountName(listed, "acc-2"), "acc-2");
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-2",
    accounts: listed,
    sessions: [entry({ accountId: "acc-2" })],
  });
  assert.equal(view?.name, "acc-2");
});

test("a queued move back to Default reads as a move to Default", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ pendingAccountId: "default" })],
  });
  assert.equal(view?.pendingNote, "Moves to Default after this turn");
});

test("a usage-unknown continue action is carried through unchanged", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry({ turn: "limit", continueAction: "usage-unknown" })],
  });
  assert.deepEqual(view, {
    accountId: "acc-1",
    name: "work@corp.test",
    stale: false,
    continueAction: "usage-unknown",
  });
});

test("an entry with no queued move has no pending note key", () => {
  const view = sessionAccountView({
    sessionId: "s-1",
    accountId: "acc-1",
    accounts,
    sessions: [entry()],
  });
  assert.ok(view != null);
  assert.equal("pendingNote" in view, false);
});

test("the pending note names the target account", () => {
  assert.equal(
    pendingNote("work@corp.test", false),
    "Moves to work@corp.test after this turn",
  );
  assert.equal(pendingNote("Default", true), "Restarts after this turn");
});

test("a refused move is an error note with the refusal message", () => {
  assert.deepEqual(
    moveNote({ ok: false, error: "legacy", message: "Cannot move." }, "Moved"),
    { tone: "error", text: "Cannot move." },
  );
});

test("a queued move says Queued", () => {
  assert.deepEqual(moveNote({ ok: true, outcome: "queued" }, "Moved"), {
    tone: "info",
    text: "Queued",
  });
});

test("a finished move says the moved text", () => {
  for (const outcome of ["moved", "same"] as const) {
    assert.deepEqual(moveNote({ ok: true, outcome }, "Restarted"), {
      tone: "info",
      text: "Restarted",
    });
  }
});

test("a failed call is an error note", () => {
  assert.equal(MOVE_FAILED_NOTE.tone, "error");
  assert.equal(MOVE_FAILED_NOTE.text, "Couldn't move the session.");
});
