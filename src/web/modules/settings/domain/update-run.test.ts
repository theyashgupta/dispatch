import assert from "node:assert/strict";
import { test } from "node:test";
import { MANUAL_COMMAND, runPhaseFrom } from "./update-run.js";

void test("no request yet is idle", () => {
  assert.deepEqual(
    runPhaseFrom({ pending: false, failed: false, result: undefined }),
    { kind: "idle" },
  );
});

void test("a running request is pending", () => {
  assert.deepEqual(
    runPhaseFrom({ pending: true, failed: false, result: undefined }),
    { kind: "pending" },
  );
});

void test("an accepted update carries the new version", () => {
  assert.deepEqual(
    runPhaseFrom({
      pending: false,
      failed: false,
      result: { ok: true, version: "1.2.3" },
    }),
    { kind: "success", version: "1.2.3" },
  );
});

void test("a refused update shows its own command", () => {
  assert.deepEqual(
    runPhaseFrom({
      pending: false,
      failed: false,
      result: { ok: false, command: "pnpm up dispatch" },
    }),
    { kind: "error", command: "pnpm up dispatch" },
  );
});

void test("a refused update with an empty command falls back to the manual one", () => {
  assert.deepEqual(
    runPhaseFrom({
      pending: false,
      failed: false,
      result: { ok: false, command: "" },
    }),
    { kind: "error", command: MANUAL_COMMAND },
  );
});

void test("a failed request falls back to the manual command", () => {
  assert.deepEqual(
    runPhaseFrom({ pending: false, failed: true, result: undefined }),
    { kind: "error", command: MANUAL_COMMAND },
  );
});
