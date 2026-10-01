import assert from "node:assert/strict";
import { test } from "node:test";
import { InternalError, NotFoundError } from "../services/domain/errors.js";
import { firstLine, orFail } from "./error-handler.js";

test("orFail returns the value of a step that succeeds", async () => {
  assert.equal(await orFail("x-failed", () => 7), 7);
  assert.equal(await orFail("x-failed", () => Promise.resolve("ok")), "ok");
});

test("orFail turns a plain throw into InternalError with the code", async () => {
  await assert.rejects(
    orFail("x-failed", () => {
      throw new Error("disk gone");
    }),
    (err: unknown) =>
      err instanceof InternalError &&
      err.code === "x-failed" &&
      err.details === undefined,
  );
  await assert.rejects(
    orFail("y-failed", () => Promise.reject(new Error("nope"))),
    (err: unknown) => err instanceof InternalError && err.code === "y-failed",
  );
});

test("orFail passes a typed HttpError through unchanged", async () => {
  const typed = new NotFoundError("not-found");
  await assert.rejects(
    orFail(
      "x-failed",
      () => {
        throw typed;
      },
      "[label]",
    ),
    (err: unknown) => err === typed,
  );
});

test("orFail logs the first line under the label only when a label is given", async (t) => {
  const warn = t.mock.method(console, "warn", () => undefined);
  await assert.rejects(
    orFail(
      "x-failed",
      () => {
        throw new Error("line one\nline two");
      },
      "[route] failed:",
    ),
  );
  assert.deepEqual(warn.mock.calls[0]?.arguments, [
    "[route] failed:",
    "line one",
  ]);

  await assert.rejects(
    orFail("x-failed", () => {
      throw new Error("quiet");
    }),
  );
  await assert.rejects(
    orFail(
      "x-failed",
      () => {
        throw new NotFoundError("not-found");
      },
      "[route] failed:",
    ),
  );
  assert.equal(warn.mock.callCount(), 1);
});

test("firstLine reads the first message line or a fixed fallback", () => {
  assert.equal(firstLine(new Error("a\nb")), "a");
  assert.equal(firstLine("not an error"), "unknown error");
});
