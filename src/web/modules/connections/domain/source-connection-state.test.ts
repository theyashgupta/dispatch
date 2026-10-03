import assert from "node:assert/strict";
import { test } from "node:test";
import {
  connectionFromRead,
  startedConnectedFrom,
} from "./source-connection-state.js";

test("a good read is shown as it is, and no read is null", () => {
  const data = { configured: true, connected: true, account: "ada" };
  assert.equal(connectionFromRead(data, false), data);
  assert.equal(connectionFromRead(undefined, false), null);
});

test("a failed first read is unreachable and not configured", () => {
  assert.deepEqual(connectionFromRead(undefined, true), {
    configured: false,
    connected: false,
    error: "unreachable",
  });
});

test("a failed later read keeps configured, enabled and account", () => {
  assert.deepEqual(
    connectionFromRead(
      { configured: true, connected: true, enabled: true, account: "ada" },
      true,
    ),
    {
      configured: true,
      connected: false,
      enabled: true,
      account: "ada",
      error: "unreachable",
    },
  );
});

test("a failed read drops every other field", () => {
  const shown = connectionFromRead(
    { configured: true, connected: true, via: "gh", tokenKind: "bot" },
    true,
  );
  assert.deepEqual(shown, {
    configured: true,
    connected: false,
    error: "unreachable",
  });
});

test("started connected is true only for a good connected read", () => {
  assert.equal(
    startedConnectedFrom({ configured: true, connected: true }, false),
    true,
  );
  assert.equal(
    startedConnectedFrom({ configured: true, connected: false }, false),
    false,
  );
  assert.equal(
    startedConnectedFrom({ configured: true, connected: true }, true),
    false,
  );
  assert.equal(startedConnectedFrom(undefined, true), false);
});
