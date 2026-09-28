import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { checkSourceKey, SourceNotFound } from "./source-gateway.js";

afterEach(() => {
  mock.restoreAll();
});

test("the key check refuses any source id but linear before calling the network", () => {
  const fetchMock = mock.method(globalThis, "fetch", () =>
    Promise.reject(new Error("must not be called")),
  );
  assert.throws(() => checkSourceKey("github", "k"), SourceNotFound);
  assert.equal(fetchMock.mock.callCount(), 0);
});
