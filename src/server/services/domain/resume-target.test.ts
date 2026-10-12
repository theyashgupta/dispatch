import test from "node:test";
import assert from "node:assert/strict";
import { chooseResumeTarget } from "./resume-target.js";

const STARTED = "2026-10-10T10:00:00.000Z";
const T0 = Date.parse(STARTED);
const stored = { id: "A", startedAt: STARTED };

void test("a conversation born after the stored one started wins", () => {
  assert.deepEqual(
    chooseResumeTarget(stored, [
      { id: "A", bornAtMs: T0 - 1000 },
      { id: "B", bornAtMs: T0 + 5000 },
    ]),
    {
      mode: "resume",
      sessionId: "B",
      startedAt: new Date(T0 + 5000).toISOString(),
      replaced: { storedId: "A", reason: "newer-on-disk" },
    },
  );
});

void test("the stored conversation resumes when its file exists and no file is newer", () => {
  assert.deepEqual(chooseResumeTarget(stored, [{ id: "A", bornAtMs: T0 }]), {
    mode: "resume",
    sessionId: "A",
    startedAt: STARTED,
  });
});

void test("a stored conversation with no file continues and reports it replaced", () => {
  assert.deepEqual(chooseResumeTarget(stored, []), {
    mode: "continue",
    replaced: { storedId: "A", reason: "no-conversation" },
  });
});

void test("a folder with no files and no stored conversation continues with nothing replaced", () => {
  assert.deepEqual(chooseResumeTarget(undefined, []), { mode: "continue" });
});

void test("a file older than the stored start never replaces it, and the id on disk is not invented", () => {
  assert.deepEqual(
    chooseResumeTarget(stored, [{ id: "B", bornAtMs: T0 - 1000 }]),
    {
      mode: "continue",
      replaced: { storedId: "A", reason: "no-conversation" },
    },
  );
});

void test("the stored id is never replaced by itself", () => {
  const target = chooseResumeTarget(stored, [{ id: "A", bornAtMs: T0 + 9000 }]);
  assert.deepEqual(target, {
    mode: "resume",
    sessionId: "A",
    startedAt: STARTED,
  });
});

void test("with nothing stored the newest file resumes and nothing is replaced", () => {
  const target = chooseResumeTarget(undefined, [
    { id: "B", bornAtMs: T0 },
    { id: "C", bornAtMs: T0 + 1 },
  ]);
  assert.deepEqual(target, {
    mode: "resume",
    sessionId: "C",
    startedAt: new Date(T0 + 1).toISOString(),
  });
  assert.equal("replaced" in target, false);
});
